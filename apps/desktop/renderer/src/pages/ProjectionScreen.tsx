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
        // 检查缓存
        const cachedImage = imageCache.current.get(src);
        if (cachedImage) {
            return Promise.resolve(cachedImage);
        }

        // 检查是否已有加载Promise
        const existingPromise = imageLoadPromises.current.get(src);
        if (existingPromise) {
            return existingPromise;
        }

        // 创建新的加载Promise
        const loadPromise = new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                imageCache.current.set(src, img);
                imageLoadPromises.current.delete(src);
                resolve(img);
            };
            img.onerror = () => {
                imageLoadPromises.current.delete(src);
                reject(new Error(`Failed to load image: ${src}`));
            };
            img.src = src;
        });

        imageLoadPromises.current.set(src, loadPromise);
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
            forestState.elements.forEach(element => {
                if (!element.visible || element.opacity <= 0) return;

                ctx.save();

                // 计算当前位置（考虑动画轨迹）
                let currentPos = { ...element.position };
                let currentScale = element.scale;
                let currentRotation = element.rotation;
                let currentOpacity = element.opacity;

                if (element.trajectory?.isAnimating) {
                    const elapsed = now - element.trajectory.startTime;
                    const progress = Math.min(elapsed / element.trajectory.duration, 1);

                    // 轨迹插值
                    const keyframes = element.trajectory.keyframes;
                    if (keyframes.length > 1) {
                        // 找到当前进度对应的关键帧
                        let startFrame = keyframes[0];
                        let endFrame = keyframes[keyframes.length - 1];

                        for (let i = 0; i < keyframes.length - 1; i++) {
                            if (progress >= keyframes[i].time && progress <= keyframes[i + 1].time) {
                                startFrame = keyframes[i];
                                endFrame = keyframes[i + 1];
                                break;
                            }
                        }

                        const frameProgress = (progress - startFrame.time) / (endFrame.time - startFrame.time);
                        const smoothProgress = easeInOutCubic(frameProgress);

                        currentPos.x = lerp(startFrame.x, endFrame.x, smoothProgress);
                        currentPos.y = lerp(startFrame.y, endFrame.y, smoothProgress);

                        if (startFrame.scale !== undefined && endFrame.scale !== undefined) {
                            currentScale = lerp(startFrame.scale, endFrame.scale, smoothProgress);
                        }
                        if (startFrame.rotation !== undefined && endFrame.rotation !== undefined) {
                            currentRotation = lerp(startFrame.rotation, endFrame.rotation, smoothProgress);
                        }
                        if (startFrame.opacity !== undefined && endFrame.opacity !== undefined) {
                            currentOpacity = lerp(startFrame.opacity, endFrame.opacity, smoothProgress);
                        }
                    }
                }

                // 设置变换
                ctx.globalAlpha = currentOpacity;
                ctx.translate(currentPos.x, currentPos.y);
                ctx.rotate(currentRotation);
                ctx.scale(currentScale, currentScale);

                // 绘制元素图像
                if (element.image) {
                    const cachedImage = imageCache.current.get(element.image);
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
                        loadImage(element.image).catch(console.warn);
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

    // 监听来自控制台的消息
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;

            const { type, data } = event.data;

            switch (type) {
                case 'ADD_ELEMENT':
                    setForestState(prev => ({
                        ...prev,
                        elements: [...prev.elements, data]
                    }));
                    break;

                case 'UPDATE_ELEMENT':
                    setForestState(prev => ({
                        ...prev,
                        elements: prev.elements.map(el =>
                            el.id === data.id ? { ...el, ...data } : el
                        )
                    }));
                    break;

                case 'REMOVE_ELEMENT':
                    setForestState(prev => ({
                        ...prev,
                        elements: prev.elements.filter(el => el.id !== data.id)
                    }));
                    break;

                case 'UPDATE_FOREST_CONFIG':
                    setForestState(prev => ({ ...prev, ...data }));
                    break;
            }
        };

        const handleElectronMessage = (event: any, data: any) => {
            const { type } = data;

            switch (type) {
                case 'ADD_ELEMENT':
                    setForestState(prev => ({
                        ...prev,
                        elements: [...prev.elements, data.data]
                    }));
                    console.log('元素已添加到投影屏幕:', data.data.name);
                    break;

                case 'UPDATE_ELEMENT':
                    setForestState(prev => ({
                        ...prev,
                        elements: prev.elements.map(el =>
                            el.id === data.data.id ? { ...el, ...data.data } : el
                        )
                    }));
                    break;

                case 'REMOVE_ELEMENT':
                    setForestState(prev => ({
                        ...prev,
                        elements: prev.elements.filter(el => el.id !== data.data.id)
                    }));
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
        }

        return () => {
            window.removeEventListener('message', handleMessage);
            if (typeof window !== 'undefined' && (window as any).electronAPI) {
                (window as any).electronAPI.removeAllListeners('projection-message');
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
        };
    }, [render, handleResize]);

    // 辅助函数
    function lerp(start: number, end: number, t: number): number {
        return start + (end - start) * t;
    }

    function easeInOutCubic(t: number): number {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
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