import { useEffect, useRef, useState, useCallback } from "react";

interface Element {
    id: string;
    name: string;
    image: string;
    position: { x: number; y: number };
    scale: number;
    rotation: number;
    visible: boolean;
    opacity: number;
    audio?: {
        src: string;
        volume: number;
        loop: boolean;
        isPlaying: boolean;
    };
    trajectory?: {
        isAnimating: boolean;
        startTime: number;
        duration: number;
        loop?: boolean;
        easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
        effectType?: 'none' | 'breathing' | 'swinging';
        effectContinue?: boolean;
        effectPeriodMs?: number;
        effectBreathAmp?: number;
        effectSwingDeg?: number;
        keyframes: Array<{
            time: number; // 0-1
            x: number;
            y: number;
            scale?: number;
            rotation?: number;
            opacity?: number;
        }>;
    };
}

interface ForestState {
    backgroundVideo: string;
    elements: Element[];
    ambientAudio: {
        volume: number;
        sources: string[];
    };
    interaction: {
        mouseEffects: boolean;
        clickEffects: boolean;
        soundOnInteraction: boolean;
    };
}

export default function ProjectionScreen() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const animationFrameRef = useRef<number | null>(null);
    const audioMap = useRef<Map<string, HTMLAudioElement>>(new Map());
    const audioDesired = useRef<Map<string, { src: string; isPlaying: boolean; loop: boolean; volume: number }>>(new Map());
    const motionStartPlayed = useRef<Map<string, number>>(new Map());
    // 防抖锁：在触发 play() 后的短时间内，不允许外部“期望状态”为 false 立即触发 pause()，避免 play/pause 竞态
    const playLockUntil = useRef<Map<string, number>>(new Map());
    // 手动播放覆盖：在手动单次播放期间，忽略外部 isPlaying=false 的暂停请求，直到 ended
    const manualPlayOverride = useRef<Set<string>>(new Set());
    // 手动一次性播放的独立音频实例，避免与期望状态引擎相互干扰
    const manualAudioMap = useRef<Map<string, HTMLAudioElement>>(new Map());
    // 防止“开始运动”短时间内被重复判定而触发二次自动播放
    const autoPlayGuardUntil = useRef<Map<string, number>>(new Map());
    // 调试开关：若需要关闭日志设为 false
    const AUDIO_DEBUG = true;
    const dlog = (...args: any[]) => { if (AUDIO_DEBUG) console.log('[AUDIO]', ...args); };

    // 图像缓存
    const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());
    const imageLoadPromises = useRef<Map<string, Promise<HTMLImageElement>>>(new Map());

    // 森林状态
    const [forestState, setForestState] = useState<ForestState>({
        backgroundVideo: './video/forest.mp4', // 修正路径
        elements: [],
        ambientAudio: {
            volume: 0.3,
            sources: []
        },
        interaction: {
            mouseEffects: true,
            clickEffects: true,
            soundOnInteraction: true
        }
    });
    const forestStateRef = useRef(forestState);
    useEffect(() => { forestStateRef.current = forestState; }, [forestState]);

    // 音频控制
    const updateElementAudio = useCallback((element: Element) => {
        const audioCfg = element.audio;
        const existing = audioMap.current.get(element.id);
        if (!audioCfg) {
            if (existing) {
                try { existing.pause(); } catch { }
                audioMap.current.delete(element.id);
            }
            audioDesired.current.delete(element.id);
            return;
        }
        let audioEl = existing;
        if (!audioEl) {
            audioEl = new Audio();
            audioEl.crossOrigin = 'anonymous';
            audioMap.current.set(element.id, audioEl);
            // 绑定进度与结束事件，向主窗口汇报
            const bindProgress = () => {
                if ((audioEl as any).__progressBound) return;
                (audioEl as any).__progressBound = true;
                (audioEl as any).__endedSent = false;
                (audioEl as any).__pendingPlay = false;
                const sendInitial = () => {
                    try {
                        if ((window as any).electronAPI?.sendToMain) {
                            (window as any).electronAPI.sendToMain({ type: 'AUDIO_PROGRESS', data: { id: element.id, currentTime: 0, duration: isFinite(audioEl!.duration) ? audioEl!.duration : 0, progress: 0 } });
                        }
                    } catch { }
                };
                audioEl!.addEventListener('play', () => { (audioEl as any).__endedSent = false; (audioEl as any).__pendingPlay = true; dlog(element.id, 'event:play'); sendInitial(); });
                audioEl!.addEventListener('playing', () => { (audioEl as any).__pendingPlay = false; dlog(element.id, 'event:playing'); });
                const sendProgress = () => {
                    const dur = isFinite(audioEl!.duration) && audioEl!.duration > 0 ? audioEl!.duration : 0;
                    const cur = audioEl!.currentTime || 0;
                    const progress = dur > 0 ? Math.min(1, Math.max(0, cur / dur)) : 0;
                    if ((audioEl as any).__lastLoggedProgress === undefined || Math.abs(progress - (audioEl as any).__lastLoggedProgress) >= 0.3) {
                        (audioEl as any).__lastLoggedProgress = progress;
                        dlog(element.id, 'progress', progress.toFixed(2));
                    }
                    try {
                        if ((window as any).electronAPI?.sendToMain) {
                            (window as any).electronAPI.sendToMain({ type: 'AUDIO_PROGRESS', data: { id: element.id, currentTime: cur, duration: dur, progress } });
                        }
                    } catch { }
                    // 兜底：有些情况下 'ended' 事件不可靠，这里在接近尾声时主动上报一次
                    if (!audioEl!.loop && dur > 0 && cur >= dur - 0.03 && !(audioEl as any).__endedSent) {
                        (audioEl as any).__endedSent = true;
                        try {
                            if ((window as any).electronAPI?.sendToMain) {
                                (window as any).electronAPI.sendToMain({ type: 'AUDIO_ENDED', data: { id: element.id } });
                            }
                        } catch { }
                    }
                };
                audioEl!.addEventListener('timeupdate', sendProgress);
                audioEl!.addEventListener('ended', () => {
                    dlog(element.id, 'event:ended');
                    (audioEl as any).__endedSent = true;
                    manualPlayOverride.current.delete(element.id);
                    try {
                        if ((window as any).electronAPI?.sendToMain) {
                            (window as any).electronAPI.sendToMain({ type: 'AUDIO_ENDED', data: { id: element.id } });
                        }
                    } catch { }
                });
            };
            bindProgress();
        }
        // 统一为绝对URL
        // 使用 href 而非 origin，兼容 file:// 场景，确保相对路径可被正确解析
        const srcUrl = new URL(audioCfg.src, window.location.href).href;
        const desired = {
            src: srcUrl,
            isPlaying: !!audioCfg.isPlaying,
            loop: !!audioCfg.loop,
            volume: Math.max(0, Math.min(1, audioCfg.volume ?? 0.5))
        };
        const prevDesired = audioDesired.current.get(element.id);
        // 若期望状态完全一致且 src 未变化，也要确保实际播放状态与期望一致（避免“已结束但 isPlaying=true”时无法再次播放）
        if (prevDesired && prevDesired.src === desired.src && prevDesired.isPlaying === desired.isPlaying && prevDesired.loop === desired.loop && prevDesired.volume === desired.volume) {
            // 同步静态属性
            audioEl.loop = desired.loop;
            audioEl.volume = desired.volume;
            const nowPlaying = !audioEl.paused && !audioEl.ended && audioEl.currentTime > 0;
            const pendingPlay = !!(audioEl as any).__pendingPlay; // 新增：播放尚未进入 playing 事件
            if (desired.isPlaying && !nowPlaying) {
                // 如果已经有一次 play() 调用在 pending，直接跳过，避免重置 currentTime 造成“第二次播放”现象
                if (pendingPlay) return;
                try {
                    const dur = isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 0;
                    if (audioEl.ended || (dur > 0 && audioEl.currentTime >= dur - 0.02)) {
                        (audioEl as any).__endedSent = false;
                        audioEl.currentTime = 0;
                    }
                } catch { }
                // 设置短暂锁，避免后续 update 立刻 pause
                playLockUntil.current.set(element.id, Date.now() + 800);
                (audioEl as any).__pendingPlay = true;
                dlog(element.id, 'play(reuse-desired)');
                audioEl.play().catch(err => {
                    (audioEl as any).__pendingPlay = false;
                    console.warn('音频播放失败:', err);
                    try { if ((window as any).electronAPI?.sendToMain) { (window as any).electronAPI.sendToMain({ type: 'AUDIO_ERROR', data: { id: element.id, message: String(err) } }); } } catch { }
                    dlog(element.id, 'play error', err);
                });
            } else if (!desired.isPlaying && nowPlaying) {
                const lock = playLockUntil.current.get(element.id) || 0;
                const pending = !!(audioEl as any).__pendingPlay;
                if (Date.now() < lock || pending || manualPlayOverride.current.has(element.id)) {
                    // 忽略短时间内的反向暂停请求
                } else {
                    try { audioEl.pause(); dlog(element.id, 'pause(reuse-desired)'); } catch { }
                }
            }
            return;
        }
        audioDesired.current.set(element.id, desired);

        // 应用静态属性变更
        audioEl.loop = desired.loop;
        audioEl.volume = desired.volume;

        const changeSrc = audioEl.src !== desired.src;
        if (changeSrc) {
            audioEl.src = desired.src;
        }

        const applyPlayState = () => {
            // 只在状态变化时操作，避免 play 后立刻 pause 的竞态
            const nowPlaying = !audioEl.paused && !audioEl.ended && audioEl.currentTime > 0;
            const pendingPlay = !!(audioEl as any).__pendingPlay;
            if (desired.isPlaying && !nowPlaying) {
                if (pendingPlay) return; // 避免在第一条 play() 尚未真正开始前重复触发
                try {
                    const dur = isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 0;
                    if (audioEl.ended || (dur > 0 && audioEl.currentTime >= dur - 0.02)) {
                        (audioEl as any).__endedSent = false;
                        audioEl.currentTime = 0;
                    }
                } catch { }
                playLockUntil.current.set(element.id, Date.now() + 800);
                (audioEl as any).__pendingPlay = true;
                dlog(element.id, 'play(applyState)');
                audioEl.play().catch(err => {
                    (audioEl as any).__pendingPlay = false;
                    console.warn('音频播放失败:', err);
                    try { if ((window as any).electronAPI?.sendToMain) { (window as any).electronAPI.sendToMain({ type: 'AUDIO_ERROR', data: { id: element.id, message: String(err) } }); } } catch { }
                    dlog(element.id, 'play error', err);
                });
            } else if (!desired.isPlaying && nowPlaying) {
                const lock = playLockUntil.current.get(element.id) || 0;
                const pending = !!(audioEl as any).__pendingPlay;
                if (Date.now() < lock || pending || manualPlayOverride.current.has(element.id)) {
                    // 忽略短时间内的反向暂停请求
                } else {
                    try { audioEl.pause(); dlog(element.id, 'pause(applyState)'); } catch { }
                }
            }
        };

        if (changeSrc) {
            if (!desired.isPlaying) {
                // 仅更换资源且不要求立即播放：避免注册 canplay 与超时回调，等后续需要播放时再处理
                return;
            }
            // 等待资源可播放后再根据期望状态播放，避免 "play() request was interrupted by pause()"
            const onCanPlay = () => {
                audioEl.removeEventListener('canplay', onCanPlay);
                // 成功 canplay 后清理兜底超时，避免 1.5s 后再次触发重复播放
                try {
                    const tid = (audioEl as any).__canplayTimeout;
                    if (tid) { clearTimeout(tid); (audioEl as any).__canplayTimeout = null; }
                } catch { }
                dlog(element.id, 'canplay');
                try {
                    if (desired.isPlaying) {
                        (audioEl as any).__endedSent = false;
                        audioEl.currentTime = 0;
                        playLockUntil.current.set(element.id, Date.now() + 800);
                    }
                } catch { }
                applyPlayState();
            };
            audioEl.addEventListener('canplay', onCanPlay);
            // 也设置一个兜底超时（若 1.5s 内没有收到 canplay）
            (audioEl as any).__canplayTimeout = window.setTimeout(() => {
                // 如果已经开始播放则跳过，防止重复 play
                const nowPlaying = !audioEl.paused && !audioEl.ended && audioEl.currentTime > 0;
                if (nowPlaying) { dlog(element.id, 'canplay timeout skipped (already playing)'); return; }
                try { audioEl.removeEventListener('canplay', onCanPlay); } catch { }
                if (desired.isPlaying) {
                    (audioEl as any).__endedSent = false;
                    try { audioEl.currentTime = 0; } catch { }
                    playLockUntil.current.set(element.id, Date.now() + 800);
                    dlog(element.id, 'canplay timeout');
                }
                applyPlayState();
            }, 1500);
        } else {
            applyPlayState();
        }
    }, []);

    // 鼠标交互状态
    const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
    const [mouseEffects, setMouseEffects] = useState<Array<{
        id: string;
        x: number;
        y: number;
        startTime: number;
        duration: number;
        type: 'ripple' | 'sparkle' | 'leaves';
    }>>([]);

    // 性能监控
    const [fps, setFps] = useState(60);
    const [isVideoLoaded, setIsVideoLoaded] = useState(false);
    const [videoError, setVideoError] = useState<string | null>(null);
    const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
    const [error, setError] = useState<string | null>(null);

    // 可用的背景视频列表
    const availableVideos = ['./video/forest.mp4', './video/forest1.mp4'];

    // 画布尺寸
    const [canvasSize, setCanvasSize] = useState({ width: 1920, height: 1080 });

    // 尝试加载下一个视频
    const tryNextVideo = useCallback(() => {
        const nextIndex = (currentVideoIndex + 1) % availableVideos.length;
        if (nextIndex === 0) {
            // 所有视频都尝试过了，使用静态背景
            setVideoError('所有背景视频加载失败，使用静态背景');
            setIsVideoLoaded(false);
            return;
        }

        setCurrentVideoIndex(nextIndex);
        setForestState(prev => ({
            ...prev,
            backgroundVideo: availableVideos[nextIndex]
        }));
        setVideoError(null);
    }, [currentVideoIndex, availableVideos]);

    // 视频加载成功处理
    const handleVideoLoaded = useCallback(() => {
        setIsVideoLoaded(true);
        setVideoError(null);
        console.log(`背景视频加载成功: ${forestState.backgroundVideo}`);
    }, [forestState.backgroundVideo]);

    // 视频加载失败处理
    const handleVideoError = useCallback((e: any) => {
        console.warn(`视频加载失败: ${forestState.backgroundVideo}`, e);
        setVideoError(`视频加载失败: ${forestState.backgroundVideo}`);
        setIsVideoLoaded(false);

        // 尝试下一个视频
        setTimeout(tryNextVideo, 1000);
    }, [forestState.backgroundVideo, tryNextVideo]);

    // 图像预加载函数
    const loadImage = useCallback((src: string): Promise<HTMLImageElement> => {
        // 允许使用相对路径（/files/xxx.png）或完整URL
        let finalSrc = src;
        if (src.startsWith('/files/')) {
            // 优先使用后端 API 基地址（Electron preload 中注入）
            const apiBase = (window as any).__API_BASE__ || window.location.origin;
            try {
                // new URL('/files/xxx', 'http://localhost:7001') => http://localhost:7001/files/xxx
                finalSrc = new URL(src, apiBase).href;
            } catch {
                // 兜底拼接
                finalSrc = apiBase.replace(/\/$/, '') + src;
            }
        }
        // 检查缓存
        const cachedImage = imageCache.current.get(finalSrc);
        if (cachedImage) {
            return Promise.resolve(cachedImage);
        }

        // 检查是否已有加载Promise
        const existingPromise = imageLoadPromises.current.get(finalSrc);
        if (existingPromise) {
            return existingPromise;
        }

        // 创建新的加载Promise
        const loadPromise = new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                imageCache.current.set(finalSrc, img);
                imageLoadPromises.current.delete(finalSrc);
                resolve(img);
            };
            img.onerror = () => {
                imageLoadPromises.current.delete(finalSrc);
                console.warn('[ImageLoad] failed', finalSrc);
                reject(new Error(`Failed to load image: ${finalSrc}`));
            };
            img.src = finalSrc;
        });

        imageLoadPromises.current.set(finalSrc, loadPromise);
        return loadPromise;
    }, []);

    // 预加载森林状态中的所有图像
    useEffect(() => {
        forestState.elements.forEach(element => {
            if (element.image) {
                loadImage(element.image).catch(err => {
                    console.warn('Failed to preload image:', element.image, err);
                });
            }
        });
    }, [forestState.elements, loadImage]);

    // 渲染循环
    const render = useCallback(() => {
        const canvas = canvasRef.current;
        const video = videoRef.current;

        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const now = Date.now();

        // 清空画布
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        try {
            // 1. 绘制背景视频
            if (video && isVideoLoaded && !video.paused) {
                // 视频全屏拉伸
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                // 添加森林氛围叠加层
                const gradient = ctx.createRadialGradient(
                    canvas.width / 2, canvas.height / 2, 0,
                    canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) / 2
                );
                gradient.addColorStop(0, 'rgba(34, 139, 34, 0.1)');
                gradient.addColorStop(0.7, 'rgba(0, 100, 0, 0.2)');
                gradient.addColorStop(1, 'rgba(0, 50, 0, 0.4)');

                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            } else {
                // 备用森林背景
                const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
                gradient.addColorStop(0, '#1a4b1a');
                gradient.addColorStop(0.5, '#2d5a2d');
                gradient.addColorStop(1, '#0d2d0d');

                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // 绘制简单的树木剪影
                drawTreeSilhouettes(ctx, canvas.width, canvas.height);
            }

            // 2. 绘制交互元素
            const sx = canvas.width / 1920;
            const sy = canvas.height / 1080;
            forestState.elements.forEach(element => {
                if (!element.visible || element.opacity <= 0) return;

                ctx.save();

                // 计算当前位置（考虑动画轨迹）
                let currentPos = { ...element.position };
                let currentScale = element.scale;
                let currentRotation = element.rotation;
                let currentOpacity = element.opacity;

                const traj = element.trajectory;
                if (traj?.isAnimating) {
                    const duration = Math.max(1, traj.duration || 1);
                    const elapsed = now - traj.startTime;
                    // 往返循环：起点->终点->起点
                    let progress = 0;
                    if (traj.loop) {
                        const cycle = elapsed % (duration * 2);
                        if (cycle <= duration) {
                            progress = cycle / duration; // 正向 0->1
                        } else {
                            const back = cycle - duration;
                            progress = 1 - (back / duration); // 反向 1->0
                        }
                    } else {
                        progress = Math.min(elapsed / duration, 1);
                    }
                    // 根据配置选择速度曲线（默认 easeInOut）
                    const easedProgress = applyEasing(progress, traj.easing);

                    // 轨迹插值
                    // 当运动开始时（startTime 变化），若元素有音频，则自动播放一次（非循环）
                    if (element.audio?.src) {
                        const lastStamp = motionStartPlayed.current.get(element.id);
                        if (lastStamp !== traj.startTime) {
                            // 先做时间去抖，避免短时间内重复开播
                            const guard = autoPlayGuardUntil.current.get(element.id) || 0;
                            if (now >= guard) {
                                // 若已有同 id 的音频正在播放，则不再触发自动播放
                                const existingAudio = audioMap.current.get(element.id);
                                if (existingAudio) {
                                    const alreadyPlaying = !existingAudio.paused && !existingAudio.ended && existingAudio.currentTime > 0;
                                    const pendingFirstPlay = !!(existingAudio as any).__pendingPlay && existingAudio.currentTime === 0;
                                    if (pendingFirstPlay) {
                                        // 正在等待第一次播放稳定，直接记录 startTime 防止重复
                                        motionStartPlayed.current.set(element.id, traj.startTime);
                                        return;
                                    }
                                    if (alreadyPlaying) {
                                        motionStartPlayed.current.set(element.id, traj.startTime);
                                        return;
                                    }
                                }
                                autoPlayGuardUntil.current.set(element.id, now + 800);
                                motionStartPlayed.current.set(element.id, traj.startTime);
                                // 触发一次单次播放（统一走 updateElementAudio 以确保绑定进度/结束事件）
                                const tempEl: Element = { ...element, audio: { ...element.audio, isPlaying: true, loop: false } } as Element;
                                dlog(element.id, 'auto-play trigger');
                                try { updateElementAudio(tempEl); } catch { dlog(element.id, 'auto-play trigger error'); }
                            }
                        }
                    }

                    const keyframes = traj.keyframes;
                    if (keyframes.length > 1) {
                        // 找到当前进度对应的关键帧
                        let startFrame = keyframes[0];
                        let endFrame = keyframes[keyframes.length - 1];

                        // 覆盖最后一段：当 easedProgress === 1 精确匹配到最后一段终点
                        for (let i = 0; i < keyframes.length - 1; i++) {
                            const a = keyframes[i].time;
                            const b = keyframes[i + 1].time;
                            if (easedProgress >= a && (easedProgress <= b || (i === keyframes.length - 2 && easedProgress >= b))) {
                                startFrame = keyframes[i];
                                endFrame = keyframes[i + 1];
                                break;
                            }
                        }

                        // 段内线性插值（整体节奏已做缓动）
                        const frameProgress = (easedProgress - startFrame.time) / Math.max(1e-6, (endFrame.time - startFrame.time));
                        currentPos.x = lerp(startFrame.x, endFrame.x, frameProgress);
                        currentPos.y = lerp(startFrame.y, endFrame.y, frameProgress);

                        if (startFrame.scale !== undefined && endFrame.scale !== undefined) {
                            currentScale = lerp(startFrame.scale, endFrame.scale, frameProgress);
                        }
                        if (startFrame.rotation !== undefined && endFrame.rotation !== undefined) {
                            currentRotation = lerp(startFrame.rotation, endFrame.rotation, frameProgress);
                        }
                        if (startFrame.opacity !== undefined && endFrame.opacity !== undefined) {
                            currentOpacity = lerp(startFrame.opacity, endFrame.opacity, frameProgress);
                        }
                    }

                    // 往返循环无需重置 startTime，由双倍周期的取模实现

                    // 若不循环且到达终点，停止动画并停止音频
                    if (!traj.loop && elapsed >= duration) {
                        const lastKf = (traj.keyframes && traj.keyframes.length > 0) ? traj.keyframes[traj.keyframes.length - 1] : undefined;
                        setForestState(prev => ({
                            ...prev,
                            elements: prev.elements.map(el => {
                                if (el.id !== element.id) return el;
                                const newEl: any = { ...el, trajectory: { ...el.trajectory!, isAnimating: false } };
                                if (lastKf) {
                                    newEl.position = { x: lastKf.x, y: lastKf.y };
                                    if (lastKf.scale !== undefined) newEl.scale = lastKf.scale;
                                    if (lastKf.rotation !== undefined) newEl.rotation = lastKf.rotation;
                                    if (lastKf.opacity !== undefined) newEl.opacity = lastKf.opacity;
                                }
                                if (newEl.audio) newEl.audio = { ...newEl.audio, isPlaying: false };
                                return newEl;
                            })
                        }));
                        // 主动通知主窗口音频已结束（此处是手动停止，不会触发 ended 事件）
                        try {
                            if ((window as any).electronAPI?.sendToMain) {
                                (window as any).electronAPI.sendToMain({ type: 'AUDIO_ENDED', data: { id: element.id } });
                            }
                        } catch { }
                    }
                }
                // 基于配置叠加呼吸/摇摆效果（动画中；或在非循环且到达终点后选择持续时）
                if (traj) {
                    const effect = traj.effectType ?? 'none';
                    const continueAfter = !!traj.effectContinue;
                    const duration = Math.max(1, traj.duration || 1);
                    const elapsed = now - traj.startTime;
                    const shouldContinue = !traj.loop && !traj.isAnimating && continueAfter && (elapsed >= duration);
                    const isActive = traj.isAnimating || shouldContinue;
                    if (isActive && effect !== 'none') {
                        const period = Math.max(200, traj.effectPeriodMs ?? 2000); // ms，一个周期
                        const t = ((now - traj.startTime) % period) / period; // 0..1
                        const wave = Math.sin(t * Math.PI * 2);
                        if (effect === 'breathing') {
                            const amp = Math.max(0, Math.min(0.5, traj.effectBreathAmp ?? 0.08)); // 尺寸起伏
                            const mul = 1 + amp * wave;
                            currentScale *= mul;
                        } else if (effect === 'swinging') {
                            const deg = Math.max(0, Math.min(60, traj.effectSwingDeg ?? 10)); // ±deg 摇摆
                            const rad = (deg * Math.PI / 180) * wave;
                            currentRotation += rad;
                        }
                    }
                }
                // 不再强制运动中循环播放；手动播放与自动开场播放均为单次

                // 设置变换
                ctx.globalAlpha = currentOpacity;
                // 将虚拟坐标(1920x1080)映射到实际画布尺寸
                ctx.translate(currentPos.x * sx, currentPos.y * sy);
                ctx.rotate(currentRotation);
                ctx.scale(currentScale, currentScale);

                // 绘制元素图像
                if (element.image) {
                    // 与 loadImage 使用的 finalSrc 逻辑对齐（使用 __API_BASE__ 而非当前窗口 origin）
                    let lookupKey = element.image;
                    if (lookupKey.startsWith('/files/')) {
                        const apiBase = (window as any).__API_BASE__ || window.location.origin;
                        try { lookupKey = new URL(lookupKey, apiBase).href; } catch { lookupKey = apiBase.replace(/\/$/, '') + lookupKey; }
                    }
                    const cachedImage = imageCache.current.get(lookupKey);
                    if (cachedImage) {
                        const imgWidth = cachedImage.naturalWidth;
                        const imgHeight = cachedImage.naturalHeight;

                        // 根据originalROI调整渲染大小
                        if ((element as any).originalROI) {
                            const roi = (element as any).originalROI;
                            ctx.drawImage(cachedImage, -roi.width / 2, -roi.height / 2, roi.width, roi.height);
                        } else {
                            ctx.drawImage(cachedImage, -imgWidth / 2, -imgHeight / 2, imgWidth, imgHeight);
                        }
                    } else {
                        // 图像未加载时绘制占位符，并尝试加载
                        ctx.fillStyle = `hsl(${element.id.charCodeAt(0) * 137 % 360}, 70%, 60%)`;
                        ctx.fillRect(-50, -50, 100, 100);
                        ctx.fillStyle = 'white';
                        ctx.font = '14px Arial';
                        ctx.textAlign = 'center';
                        ctx.fillText('Loading...', 0, 0);
                        ctx.fillText(element.name.slice(0, 8), 0, 16);

                        // 异步加载图像
                        loadImage(element.image).catch(err => console.warn('[RenderLoop] image load error', element.image, err));
                    }
                } else {
                    // 没有图像时绘制默认占位符
                    ctx.fillStyle = `hsl(${element.id.charCodeAt(0) * 137 % 360}, 70%, 60%)`;
                    ctx.fillRect(-50, -50, 100, 100);
                    ctx.fillStyle = 'white';
                    ctx.font = '14px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText('No Image', 0, 0);
                    ctx.fillText(element.name.slice(0, 8), 0, 16);
                }

                ctx.restore();
            });

            // 3. 绘制鼠标交互效果
            mouseEffects.forEach(effect => {
                const elapsed = now - effect.startTime;
                const progress = elapsed / effect.duration;

                if (progress >= 1) return; // 效果已结束

                ctx.save();
                ctx.translate(effect.x, effect.y);

                switch (effect.type) {
                    case 'ripple':
                        drawRippleEffect(ctx, progress);
                        break;
                    case 'sparkle':
                        drawSparkleEffect(ctx, progress);
                        break;
                    case 'leaves':
                        drawLeavesEffect(ctx, progress);
                        break;
                }

                ctx.restore();
            });

            // 4. 绘制环境粒子效果
            drawAmbientParticles(ctx, canvas.width, canvas.height, now);

            // 清理过期的鼠标效果
            setMouseEffects(prev => prev.filter(effect =>
                now - effect.startTime < effect.duration
            ));

        } catch (err) {
            console.error('渲染错误:', err);
            setError('渲染过程中发生错误');
        }

        // 继续下一帧
        animationFrameRef.current = requestAnimationFrame(render);
    }, [forestState, isVideoLoaded, mouseEffects, loadImage]);

    // 鼠标移动处理
    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!forestState.interaction.mouseEffects) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (canvas.width / rect.width);
        const y = (e.clientY - rect.top) * (canvas.height / rect.height);

        setMousePosition({ x, y });

        // 随机生成跟随效果
        if (Math.random() < 0.1) { // 10% 概率
            const effectType = ['ripple', 'sparkle', 'leaves'][Math.floor(Math.random() * 3)] as 'ripple' | 'sparkle' | 'leaves';

            setMouseEffects(prev => [...prev, {
                id: `effect-${Date.now()}-${Math.random()}`,
                x,
                y,
                startTime: Date.now(),
                duration: 2000,
                type: effectType
            }]);
        }
    }, [forestState.interaction.mouseEffects]);

    // 鼠标点击处理
    const handleMouseClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!forestState.interaction.clickEffects) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (canvas.width / rect.width);
        const y = (e.clientY - rect.top) * (canvas.height / rect.height);

        // 创建点击效果
        const effects = [
            { type: 'ripple' as const, duration: 1500 },
            { type: 'sparkle' as const, duration: 2000 },
            { type: 'leaves' as const, duration: 3000 }
        ];

        effects.forEach((effect, index) => {
            setTimeout(() => {
                setMouseEffects(prev => [...prev, {
                    id: `click-effect-${Date.now()}-${index}`,
                    x: x + (Math.random() - 0.5) * 50,
                    y: y + (Math.random() - 0.5) * 50,
                    startTime: Date.now(),
                    duration: effect.duration,
                    type: effect.type
                }]);
            }, index * 200);
        });

        // 播放交互音效
        if (forestState.interaction.soundOnInteraction) {
            playInteractionSound();
        }
    }, [forestState.interaction]);

    // 窗口大小调整
    const handleResize = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // 全屏投影模式
        canvas.width = window.innerWidth * window.devicePixelRatio;
        canvas.height = window.innerHeight * window.devicePixelRatio;

        canvas.style.width = window.innerWidth + 'px';
        canvas.style.height = window.innerHeight + 'px';

        setCanvasSize({
            width: canvas.width,
            height: canvas.height
        });
    }, []);

    // 监听来自控制台的消息（window.postMessage 路径）
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            const payload = event.data || {};
            const { type, data } = payload;
            if (!type) return;

            switch (type) {
                case 'REQUEST_BACKGROUND_SNAPSHOT': {
                    // 返回当前画布快照（dataURL），给编辑器用于当作底图
                    const canvas = canvasRef.current;
                    if (!canvas) return;
                    try {
                        const dataUrl = canvas.toDataURL('image/png');
                        window.postMessage({ type: 'BACKGROUND_SNAPSHOT', data: { dataUrl } }, window.location.origin);
                    } catch (e) { console.warn('快照失败', e); }
                    break;
                }
                case 'PLAY_AUDIO_ONCE': {
                    const { id } = data || {};
                    if (!id) break;
                    const element = forestStateRef.current.elements.find(el => el.id === id);
                    if (!element || !element.audio?.src) break;
                    // 使用独立的手动一次性音频实例，完全避开期望状态引擎，杜绝被 pause 打断
                    try {
                        // 如已有残留实例，先清理
                        const existing = manualAudioMap.current.get(id);
                        if (existing) { try { existing.pause(); } catch { } manualAudioMap.current.delete(id); }
                        const mAu = new Audio();
                        mAu.crossOrigin = 'anonymous';
                        const targetSrc = new URL(element.audio.src, window.location.href).href;
                        mAu.src = targetSrc;
                        mAu.loop = false;
                        mAu.volume = Math.max(0, Math.min(1, element.audio.volume ?? 0.5));
                        const sendInitial = () => {
                            try { if ((window as any).electronAPI?.sendToMain) { (window as any).electronAPI.sendToMain({ type: 'AUDIO_PROGRESS', data: { id, currentTime: 0, duration: isFinite(mAu.duration) ? mAu.duration : 0, progress: 0 } }); } } catch { }
                        };
                        const onTime = () => {
                            const dur = isFinite(mAu.duration) && mAu.duration > 0 ? mAu.duration : 0;
                            const cur = mAu.currentTime || 0;
                            const progress = dur > 0 ? Math.min(1, Math.max(0, cur / dur)) : 0;
                            try { if ((window as any).electronAPI?.sendToMain) { (window as any).electronAPI.sendToMain({ type: 'AUDIO_PROGRESS', data: { id, currentTime: cur, duration: dur, progress } }); } } catch { }
                            if (dur > 0 && cur >= dur - 0.03) { // 兜底 ended
                                cleanup();
                                try { if ((window as any).electronAPI?.sendToMain) { (window as any).electronAPI.sendToMain({ type: 'AUDIO_ENDED', data: { id } }); } } catch { }
                            }
                        };
                        const cleanup = () => {
                            try { mAu.removeEventListener('timeupdate', onTime); } catch { }
                            try { mAu.removeEventListener('ended', onEnded); } catch { }
                            try { mAu.removeEventListener('play', onPlay); } catch { }
                            manualAudioMap.current.delete(id);
                        };
                        const onEnded = () => { cleanup(); try { if ((window as any).electronAPI?.sendToMain) { (window as any).electronAPI.sendToMain({ type: 'AUDIO_ENDED', data: { id } }); } } catch { } };
                        const onPlay = () => { sendInitial(); };
                        mAu.addEventListener('timeupdate', onTime);
                        mAu.addEventListener('ended', onEnded);
                        mAu.addEventListener('play', onPlay);
                        manualAudioMap.current.set(id, mAu);
                        try { mAu.currentTime = 0; } catch { }
                        mAu.play().catch(err => { cleanup(); try { if ((window as any).electronAPI?.sendToMain) { (window as any).electronAPI.sendToMain({ type: 'AUDIO_ERROR', data: { id, message: String(err) } }); } } catch { } });
                    } catch { }
                    break;
                }
                case 'ADD_ELEMENT':
                    setForestState(prev => ({
                        ...prev,
                        elements: [...prev.elements, data]
                    }));
                    try {
                        const el = data as Element;
                        // 同步音频静态属性（不在此处触发播放，统一由渲染循环在“开始运动”时触发一次）
                        updateElementAudio(el as any);
                    } catch { }
                    break;

                case 'UPDATE_ELEMENT':
                    setForestState(prev => {
                        const mergedElements = prev.elements.map(el => el.id === data.id ? { ...el, ...data } : el);
                        const merged = mergedElements.find(el => el.id === data.id);
                        if (merged) { try { updateElementAudio(merged as any); } catch { } }
                        return { ...prev, elements: mergedElements };
                    });
                    break;

                case 'REMOVE_ELEMENT':
                    setForestState(prev => ({
                        ...prev,
                        elements: prev.elements.filter(el => el.id !== data.id)
                    }));
                    {
                        const existing = audioMap.current.get(data.id);
                        if (existing) { try { existing.pause(); } catch { }; audioMap.current.delete(data.id); }
                        audioDesired.current.delete(data.id);
                    }
                    break;

                case 'UPDATE_FOREST_CONFIG':
                    setForestState(prev => ({ ...prev, ...data }));
                    break;
            }
        };

        const handleElectronMessage = (event: any, data: any) => {
            const { type } = data;

            switch (type) {
                case 'PLAY_AUDIO_ONCE': {
                    const { id } = data.data || {};
                    if (!id) break;
                    const element = forestStateRef.current.elements.find(el => el.id === id);
                    if (!element || !element.audio?.src) break;
                    try {
                        const existing = manualAudioMap.current.get(id);
                        if (existing) { try { existing.pause(); } catch { } manualAudioMap.current.delete(id); }
                        const mAu = new Audio();
                        mAu.crossOrigin = 'anonymous';
                        const targetSrc = new URL(element.audio.src, window.location.href).href;
                        mAu.src = targetSrc;
                        mAu.loop = false;
                        mAu.volume = Math.max(0, Math.min(1, element.audio.volume ?? 0.5));
                        const sendInitial = () => {
                            try { if ((window as any).electronAPI?.sendToMain) { (window as any).electronAPI.sendToMain({ type: 'AUDIO_PROGRESS', data: { id, currentTime: 0, duration: isFinite(mAu.duration) ? mAu.duration : 0, progress: 0 } }); } } catch { }
                        };
                        const onTime = () => {
                            const dur = isFinite(mAu.duration) && mAu.duration > 0 ? mAu.duration : 0;
                            const cur = mAu.currentTime || 0;
                            const progress = dur > 0 ? Math.min(1, Math.max(0, cur / dur)) : 0;
                            try { if ((window as any).electronAPI?.sendToMain) { (window as any).electronAPI.sendToMain({ type: 'AUDIO_PROGRESS', data: { id, currentTime: cur, duration: dur, progress } }); } } catch { }
                            if (dur > 0 && cur >= dur - 0.03) { cleanup(); try { if ((window as any).electronAPI?.sendToMain) { (window as any).electronAPI.sendToMain({ type: 'AUDIO_ENDED', data: { id } }); } } catch { } }
                        };
                        const cleanup = () => { try { mAu.removeEventListener('timeupdate', onTime); } catch { } try { mAu.removeEventListener('ended', onEnded); } catch { } try { mAu.removeEventListener('play', onPlay); } catch { } manualAudioMap.current.delete(id); };
                        const onEnded = () => { cleanup(); try { if ((window as any).electronAPI?.sendToMain) { (window as any).electronAPI.sendToMain({ type: 'AUDIO_ENDED', data: { id } }); } } catch { } };
                        const onPlay = () => { sendInitial(); };
                        mAu.addEventListener('timeupdate', onTime);
                        mAu.addEventListener('ended', onEnded);
                        mAu.addEventListener('play', onPlay);
                        manualAudioMap.current.set(id, mAu);
                        try { mAu.currentTime = 0; } catch { }
                        mAu.play().catch(err => { cleanup(); try { if ((window as any).electronAPI?.sendToMain) { (window as any).electronAPI.sendToMain({ type: 'AUDIO_ERROR', data: { id, message: String(err) } }); } } catch { } });
                    } catch { }
                    break;
                }
                case 'ADD_ELEMENT':
                    setForestState(prev => ({
                        ...prev,
                        elements: [...prev.elements, data.data]
                    }));
                    try { updateElementAudio(data.data as any); } catch { }
                    console.log('元素已添加到投影屏幕:', data.data.name);
                    break;

                case 'UPDATE_ELEMENT':
                    setForestState(prev => {
                        const mergedElements = prev.elements.map(el => el.id === data.data.id ? { ...el, ...data.data } : el);
                        const merged = mergedElements.find(el => el.id === data.data.id);
                        if (merged) { try { updateElementAudio(merged as any); } catch { } }
                        return { ...prev, elements: mergedElements };
                    });
                    break;

                case 'REMOVE_ELEMENT':
                    setForestState(prev => ({
                        ...prev,
                        elements: prev.elements.filter(el => el.id !== data.data.id)
                    }));
                    {
                        const existing = audioMap.current.get(data.data.id);
                        if (existing) { try { existing.pause(); } catch { }; audioMap.current.delete(data.data.id); }
                        audioDesired.current.delete(data.data.id);
                    }
                    break;

                case 'UPDATE_FOREST_CONFIG':
                    setForestState(prev => ({ ...prev, ...data.data }));
                    break;
            }
        };

        // 监听传统的window消息
        window.addEventListener('message', handleMessage);

        // 监听Electron IPC消息
        if (typeof window !== 'undefined' && (window as any).electronAPI) {
            (window as any).electronAPI.onProjectionMessage(handleElectronMessage);
            (window as any).electronAPI.onRequestBackground(() => {
                const canvas = canvasRef.current;
                if (!canvas) return;
                try {
                    const dataUrl = canvas.toDataURL('image/png');
                    (window as any).electronAPI.replyBackground(dataUrl);
                } catch (e) { console.warn('快照失败', e); }
            });
        }

        return () => {
            window.removeEventListener('message', handleMessage);
            if (typeof window !== 'undefined' && (window as any).electronAPI) {
                (window as any).electronAPI.removeAllListeners('projection-message');
                (window as any).electronAPI.removeAllListeners('request-background');
                (window as any).electronAPI.removeAllListeners('background-snapshot');
            }
        };
    }, []);

    // 初始化
    useEffect(() => {
        handleResize();
        window.addEventListener('resize', handleResize);

        // 启动渲染循环
        animationFrameRef.current = requestAnimationFrame(render);

        // 强制启动视频播放
        const video = videoRef.current;
        if (video) {
            video.play().catch(e => {
                console.warn('视频自动播放失败，这在某些浏览器中是正常的:', e);
            });
        }

        return () => {
            window.removeEventListener('resize', handleResize);
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            // 清理所有音频
            audioMap.current.forEach(a => { try { a.pause(); } catch { } });
            audioMap.current.clear();
        };
    }, [render, handleResize]);

    // 辅助函数
    function lerp(start: number, end: number, t: number): number {
        return start + (end - start) * t;
    }

    function easeLinear(t: number): number { return t; }
    function easeInCubic(t: number): number { return t * t * t; }
    function easeOutCubic(t: number): number { return 1 - Math.pow(1 - t, 3); }
    function easeInOutCubic(t: number): number {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function applyEasing(t: number, mode?: string): number {
        const tt = Math.max(0, Math.min(1, t));
        switch (mode) {
            case 'linear':
                return easeLinear(tt);
            case 'easeIn':
                return easeInCubic(tt);
            case 'easeOut':
                return easeOutCubic(tt);
            case 'easeInOut':
            default:
                return easeInOutCubic(tt);
        }
    }

    function drawTreeSilhouettes(ctx: CanvasRenderingContext2D, width: number, height: number) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';

        // 绘制几棵简单的树
        for (let i = 0; i < 8; i++) {
            const x = (width / 8) * i + Math.random() * 100;
            const treeHeight = height * 0.6 + Math.random() * height * 0.3;
            const treeWidth = 20 + Math.random() * 40;

            // 树干
            ctx.fillRect(x - 5, height - treeHeight * 0.3, 10, treeHeight * 0.3);

            // 树冠
            ctx.beginPath();
            ctx.ellipse(x, height - treeHeight, treeWidth, treeHeight * 0.7, 0, 0, 2 * Math.PI);
            ctx.fill();
        }
    }

    function drawRippleEffect(ctx: CanvasRenderingContext2D, progress: number) {
        const radius = progress * 100;
        const opacity = 1 - progress;

        ctx.strokeStyle = `rgba(144, 238, 144, ${opacity})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, 2 * Math.PI);
        ctx.stroke();

        ctx.strokeStyle = `rgba(173, 255, 47, ${opacity * 0.5})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.7, 0, 2 * Math.PI);
        ctx.stroke();
    }

    function drawSparkleEffect(ctx: CanvasRenderingContext2D, progress: number) {
        const sparkles = 8;
        const radius = progress * 60;
        const opacity = 1 - progress;

        for (let i = 0; i < sparkles; i++) {
            const angle = (2 * Math.PI / sparkles) * i + progress * Math.PI;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;

            ctx.fillStyle = `rgba(255, 215, 0, ${opacity})`;
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, 2 * Math.PI);
            ctx.fill();

            // 闪光线
            ctx.strokeStyle = `rgba(255, 255, 255, ${opacity * 0.8})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x - 5, y);
            ctx.lineTo(x + 5, y);
            ctx.moveTo(x, y - 5);
            ctx.lineTo(x, y + 5);
            ctx.stroke();
        }
    }

    function drawLeavesEffect(ctx: CanvasRenderingContext2D, progress: number) {
        const leaves = 6;
        const opacity = 1 - progress;

        for (let i = 0; i < leaves; i++) {
            const angle = (2 * Math.PI / leaves) * i;
            const distance = progress * 80 + Math.sin(progress * Math.PI * 4 + i) * 10;
            const x = Math.cos(angle) * distance;
            const y = Math.sin(angle) * distance + progress * 30; // 叶子下落

            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(progress * Math.PI * 2 + i);

            // 绘制叶子
            ctx.fillStyle = `rgba(34, 139, 34, ${opacity})`;
            ctx.beginPath();
            ctx.ellipse(0, 0, 8, 12, 0, 0, 2 * Math.PI);
            ctx.fill();

            ctx.restore();
        }
    }

    function drawAmbientParticles(ctx: CanvasRenderingContext2D, width: number, height: number, now: number) {
        // 飘落的森林粒子
        for (let i = 0; i < 20; i++) {
            const x = (now * 0.05 + i * 123) % width;
            const y = (now * 0.02 + i * 456) % height;
            // 计算粒子大小并夹紧下限，避免传入负半径导致 Canvas arc 报错
            const sizeBase = 1 + Math.sin(now * 0.01 + i) * 2;
            const size = Math.max(0.5, sizeBase);
            const opacity = 0.3 + Math.sin(now * 0.008 + i) * 0.2;

            ctx.fillStyle = `rgba(144, 238, 144, ${opacity})`;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, 2 * Math.PI);
            ctx.fill();
        }
    }

    function playInteractionSound() {
        try {
            // 这里应该播放真实的音效文件
            // const audio = new Audio('/public/audio/forest-click.mp3');
            // audio.volume = forestState.ambientAudio.volume;
            // audio.play();
            console.log('播放交互音效');
        } catch (err) {
            console.warn('音效播放失败:', err);
        }
    }

    return (
        <div style={{
            width: "100vw",
            height: "100vh",
            backgroundColor: "#000",
            overflow: "hidden",
            position: "relative",
            cursor: "none" // 隐藏鼠标光标以获得更好的投影体验
        }}>
            {/* 背景视频 */}
            <video
                ref={videoRef}
                src={forestState.backgroundVideo}
                autoPlay
                loop
                muted
                playsInline
                onLoadedData={handleVideoLoaded}
                onError={handleVideoError}
                onCanPlay={() => console.log('视频可以播放')}
                onPlay={() => console.log('视频开始播放')}
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    zIndex: -1,
                    display: "none" // 视频内容通过canvas绘制
                }}
            />

            {/* 主画布 */}
            <canvas
                ref={canvasRef}
                onMouseMove={handleMouseMove}
                onClick={handleMouseClick}
                style={{
                    display: "block",
                    width: "100%",
                    height: "100%"
                }}
            />

            {/* 性能监控（开发模式） */}
            {process.env.NODE_ENV === 'development' && (
                <div style={{
                    position: "fixed",
                    top: "10px",
                    left: "10px",
                    backgroundColor: "rgba(0, 0, 0, 0.7)",
                    color: "white",
                    padding: "10px",
                    borderRadius: "5px",
                    fontSize: "12px",
                    fontFamily: "monospace",
                    zIndex: 1000
                }}>
                    <div>FPS: {fps}</div>
                    <div>Elements: {forestState.elements.length}</div>
                    <div>Effects: {mouseEffects.length}</div>
                    <div>Video: {isVideoLoaded ? '✓ 播放中' : '✗ 未加载'}</div>
                    <div>Video Source: {forestState.backgroundVideo.split('/').pop()}</div>
                    {videoError && <div style={{ color: '#ff6b6b' }}>Error: {videoError}</div>}
                    <div>Canvas: {canvasSize.width}×{canvasSize.height}</div>
                    <div>Mouse: ({mousePosition.x.toFixed(0)}, {mousePosition.y.toFixed(0)})</div>
                </div>
            )}

            {/* 错误提示 */}
            {error && (
                <div style={{
                    position: 'fixed',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    backgroundColor: 'rgba(244, 67, 54, 0.9)',
                    color: 'white',
                    padding: '20px',
                    borderRadius: '10px',
                    fontSize: '18px',
                    textAlign: 'center',
                    zIndex: 1000
                }}>
                    ❌ {error}
                    <br />
                    <button
                        onClick={() => setError(null)}
                        style={{
                            marginTop: "10px",
                            padding: "5px 15px",
                            backgroundColor: "white",
                            color: "black",
                            border: "none",
                            borderRadius: "5px",
                            cursor: "pointer"
                        }}
                    >
                        关闭
                    </button>
                </div>
            )}
        </div>
    );
}