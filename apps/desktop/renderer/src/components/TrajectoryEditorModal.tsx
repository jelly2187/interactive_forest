import { useState, useRef, useCallback, useEffect } from 'react';

interface TrajectoryKeyframe {
    time: number; // 0-1
    x: number;
    y: number;
    scale?: number;
    rotation?: number;
    opacity?: number;
}

interface TrajectoryEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    element: {
        id: string;
        name: string;
        image?: string; // 可选：元素缩略图路径（若无则用占位圆）
        position: { x: number; y: number };
        scale: number;
        rotation: number;
        trajectory?: {
            isAnimating: boolean;
            startTime: number;
            duration: number;
            loop?: boolean;
            mirrorEnd?: boolean; // 新增：往返镜像
            smooth?: boolean; // 新增：平滑曲线
            tension?: number; // 新增：平滑张力 (0=松弛Catmull-Rom, 1=直线)
            easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
            effectType?: 'none' | 'breathing' | 'swinging';
            effectContinue?: boolean;
            effectPeriodMs?: number;
            effectBreathAmp?: number;
            effectSwingDeg?: number;
            keyframes: TrajectoryKeyframe[];
        };
    };
    onUpdate: (trajectoryConfig: any) => void;
}

export default function TrajectoryEditorModal({ isOpen, onClose, element, onUpdate }: TrajectoryEditorModalProps) {
    const [duration, setDuration] = useState(element.trajectory?.duration || 5000);
    // 如果已有轨迹则使用；否则从空开始，让用户自行添加
    const [keyframes, setKeyframes] = useState<TrajectoryKeyframe[]>(element.trajectory?.keyframes || []);
    const [selectedKeyframe, setSelectedKeyframe] = useState<number>(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    // 轨迹循环默认不勾选；循环语义为往返（起点->终点->起点）
    const [loop, setLoop] = useState<boolean>(element.trajectory?.loop ?? false);
    const [mirrorEnd, setMirrorEnd] = useState<boolean>((element as any).trajectory?.mirrorEnd ?? false);
    const [smooth, setSmooth] = useState<boolean>((element as any).trajectory?.smooth ?? true);
    const [tension, setTension] = useState<number>((element as any).trajectory?.tension ?? 0); // 0..1
    const [easing, setEasing] = useState<string>((element as any).trajectory?.easing ?? 'easeIn');
    const [effectType, setEffectType] = useState<'none' | 'breathing' | 'swinging'>((element as any).trajectory?.effectType ?? 'swinging');
    const [effectContinue, setEffectContinue] = useState<boolean>((element as any).trajectory?.effectContinue ?? true);
    const [effectPeriodMs, setEffectPeriodMs] = useState<number>((element as any).trajectory?.effectPeriodMs ?? 2000);
    const [effectBreathAmp, setEffectBreathAmp] = useState<number>((element as any).trajectory?.effectBreathAmp ?? 0.08);
    const [effectSwingDeg, setEffectSwingDeg] = useState<number>((element as any).trajectory?.effectSwingDeg ?? 10);

    // Freehand mode state
    // 暂时只保留关键点模式（禁用手绘）
    const mode: 'points' = 'points';
    // const [mode, setMode] = useState<'freehand' | 'points'>('points');
    // const [strokes, setStrokes] = useState<Array<Array<{ x: number; y: number }>>>([]);
    // const [isDrawing, setIsDrawing] = useState(false);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const bgImageRef = useRef<HTMLImageElement | null>(null);
    // const currentStrokeRef = useRef<Array<{ x: number; y: number }> | null>(null);
    const animationRef = useRef<number | null>(null);
    const playStartRef = useRef<number>(0);
    const elementImageRef = useRef<HTMLImageElement | null>(null);

    // 全局尺寸滑条（对所有关键帧成比例缩放）
    const [globalScaleFactor, setGlobalScaleFactor] = useState(1); // 1 = 不变
    const prevGlobalScaleRef = useRef(1);

    // 额外的播放累计时间（用于效果：呼吸 / 摇摆）
    const [playElapsed, setPlayElapsed] = useState(0);

    // 请求一次背景快照（打开时）
    useEffect(() => {
        if (!isOpen) return;
        try {
            if ((window as any).electronAPI?.requestBackground) {
                (window as any).electronAPI.requestBackground();
            } else {
                window.postMessage({ type: 'REQUEST_BACKGROUND_SNAPSHOT' }, window.location.origin);
            }
        } catch { }
    }, [isOpen]);

    // 监听背景快照返回（仅在打开时绑定）
    useEffect(() => {
        if (!isOpen) return;
        const onSnapshot = (ev: MessageEvent) => {
            if (ev.origin !== window.location.origin) return;
            const { type, data } = ev.data || {};
            if (type !== 'BACKGROUND_SNAPSHOT' || !data?.dataUrl) return;
            const img = new Image();
            img.onload = () => { bgImageRef.current = img; requestAnimationFrame(() => drawTrajectoryPreview()); };
            img.src = data.dataUrl;
        };
        window.addEventListener('message', onSnapshot);
        // Electron IPC 回调
        let ipcUnsub: (() => void) | null = null;
        if ((window as any).electronAPI?.onBackgroundSnapshot) {
            const handler = (_event: any, dataUrl: string) => {
                if (!dataUrl) return;
                const img = new Image();
                img.onload = () => { bgImageRef.current = img; requestAnimationFrame(() => drawTrajectoryPreview()); };
                img.src = dataUrl;
            };
            (window as any).electronAPI.onBackgroundSnapshot(handler);
            ipcUnsub = () => (window as any).electronAPI.removeAllListeners('background-snapshot');
        }
        return () => {
            window.removeEventListener('message', onSnapshot);
            if (ipcUnsub) ipcUnsub();
            bgImageRef.current = null; // 关闭时清空，避免旧图在重开时闪烁
        };
    }, [isOpen]);

    // 载入元素缩略图（如果有）
    useEffect(() => {
        if (!isOpen) return;
        if (!element.image) { elementImageRef.current = null; return; }
        const img = new Image();
        img.onload = () => {
            elementImageRef.current = img; requestAnimationFrame(() => {
                // 延迟一次，等 canvasRef 安装完
                const c = canvasRef.current; if (c) {
                    const ctx = c.getContext('2d');
                    if (ctx) { /* 触发一次重绘 */ drawTrajectoryPreview(); }
                }
            });
        };
        img.onerror = () => { elementImageRef.current = null; };
        img.src = element.image;
        // 不依赖 drawTrajectoryPreview，避免声明顺序引用问题
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, element.image]);

    // Easing helpers（与投影端保持一致）
    const easeLinear = (t: number) => t;
    const easeInCubic = (t: number) => t * t * t;
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
    const easeInOutCubic = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const applyEasing = (t: number) => {
        const tt = Math.max(0, Math.min(1, t));
        switch (easing) {
            case 'linear': return easeLinear(tt);
            case 'easeIn': return easeInCubic(tt);
            case 'easeOut': return easeOutCubic(tt);
            case 'easeInOut':
            default: return easeInOutCubic(tt);
        }
    };

    // 绘制轨迹预览
    const drawTrajectoryPreview = useCallback(() => {
        const canvas = canvasRef.current; if (!canvas) return;
        const ctx = canvas.getContext('2d'); if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 背景
        if (bgImageRef.current) {
            try { ctx.drawImage(bgImageRef.current, 0, 0, canvas.width, canvas.height); } catch { }
        } else {
            ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
            for (let x = 0; x <= canvas.width; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
            for (let y = 0; y <= canvas.height; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
        }

        // 路径线（支持平滑曲线）
        if (keyframes.length >= 2) {
            // 1) 先画关键帧直线辅助（淡）
            ctx.save(); ctx.strokeStyle = 'rgba(120,160,255,0.25)'; ctx.lineWidth = 1; ctx.beginPath();
            keyframes.forEach((kf, i) => {
                const px = (kf.x / 1920) * canvas.width; const py = (kf.y / 1080) * canvas.height;
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }); ctx.stroke(); ctx.restore();

            // 2) 主轨迹（平滑或折线）
            ctx.strokeStyle = '#2196F3'; ctx.lineWidth = 2; ctx.beginPath();
            if (!smooth || keyframes.length < 3) {
                keyframes.forEach((kf, i) => {
                    const px = (kf.x / 1920) * canvas.width; const py = (kf.y / 1080) * canvas.height;
                    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
                });
                ctx.stroke();
            } else {
                const pts = keyframes.map(kf => ({ x: (kf.x / 1920) * canvas.width, y: (kf.y / 1080) * canvas.height }));
                const T = Math.min(1, Math.max(0, tension)); // clamp
                for (let i = 0; i < pts.length - 1; i++) {
                    const p0 = pts[i - 1] || pts[i];
                    const p1 = pts[i];
                    const p2 = pts[i + 1];
                    const p3 = pts[i + 2] || pts[i + 1];
                    if (i === 0) ctx.moveTo(p1.x, p1.y);
                    // Cardinal (tension) to Bezier: m1=(1-T)/2*(p2-p0); m2=(1-T)/2*(p3-p1); c1=p1+m1/3; c2=p2-m2/3
                    const m1x = (1 - T) * (p2.x - p0.x) / 2; const m1y = (1 - T) * (p2.y - p0.y) / 2;
                    const m2x = (1 - T) * (p3.x - p1.x) / 2; const m2y = (1 - T) * (p3.y - p1.y) / 2;
                    const c1x = p1.x + m1x / 3; const c1y = p1.y + m1y / 3;
                    const c2x = p2.x - m2x / 3; const c2y = p2.y - m2y / 3;
                    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
                }
                ctx.stroke();

                // 3) 采样虚线路径（实际运行采样）
                ctx.save();
                ctx.strokeStyle = 'rgba(33,150,243,0.5)';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([6, 6]);
                ctx.beginPath();
                const samplePerSeg = 16; // 每段采样点数
                let first = true;
                const evalPoint = (p0: any, p1: any, p2: any, p3: any, t: number) => { // Hermite 基函数
                    const Tt = Math.min(1, Math.max(0, tension));
                    const m1x = (1 - Tt) * (p2.x - p0.x) / 2; const m1y = (1 - Tt) * (p2.y - p0.y) / 2;
                    const m2x = (1 - Tt) * (p3.x - p1.x) / 2; const m2y = (1 - Tt) * (p3.y - p1.y) / 2;
                    const t2 = t * t, t3 = t2 * t;
                    const h00 = 2 * t3 - 3 * t2 + 1;
                    const h10 = t3 - 2 * t2 + t;
                    const h01 = -2 * t3 + 3 * t2;
                    const h11 = t3 - t2;
                    return {
                        x: h00 * p1.x + h10 * m1x + h01 * p2.x + h11 * m2x,
                        y: h00 * p1.y + h10 * m1y + h01 * p2.y + h11 * m2y
                    };
                };
                for (let i = 0; i < pts.length - 1; i++) {
                    const p0 = pts[i - 1] || pts[i];
                    const p1 = pts[i];
                    const p2 = pts[i + 1];
                    const p3 = pts[i + 2] || pts[i + 1];
                    for (let s = 0; s <= samplePerSeg; s++) {
                        const t = s / samplePerSeg;
                        const pt = evalPoint(p0, p1, p2, p3, t);
                        if (first) { ctx.moveTo(pt.x, pt.y); first = false; }
                        else ctx.lineTo(pt.x, pt.y);
                    }
                }
                ctx.stroke();
                ctx.restore();
            }
        }

        // 关键帧标记（统一使用圆点）
        keyframes.forEach((kf, index) => {
            const px = (kf.x / 1920) * canvas.width; const py = (kf.y / 1080) * canvas.height;
            ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2);
            ctx.fillStyle = index === selectedKeyframe ? '#FF9800' : '#4CAF50';
            ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
            ctx.fillStyle = '#fff'; ctx.font = '12px Arial'; ctx.textAlign = 'center';
            ctx.fillText(String(index + 1), px, py + 4);
        });

        // 仅在播放时渲染动态元素缩略图动画
        if (isPlaying && keyframes.length > 0) {
            let raw = duration > 0 ? (currentTime / duration) : 0; raw = Math.min(1, Math.max(0, raw));
            const prog = applyEasing(raw);
            const sampleAttr = (attr: keyof TrajectoryKeyframe, def: number) => {
                if (keyframes.length === 1) return (keyframes[0] as any)[attr] ?? def;
                for (let i = 0; i < keyframes.length - 1; i++) {
                    const a = keyframes[i]; const b = keyframes[i + 1];
                    if (prog >= a.time && prog <= b.time) {
                        const span = (b.time - a.time) || 1; const t = span === 0 ? 0 : (prog - a.time) / span;
                        const av = (a as any)[attr] ?? def; const bv = (b as any)[attr] ?? def;
                        return av + (bv - av) * t;
                    }
                }
                return (keyframes[keyframes.length - 1] as any)[attr] ?? def;
            };
            const pos = { x: sampleAttr('x', element.position.x), y: sampleAttr('y', element.position.y) };
            let sc = sampleAttr('scale', element.scale) * globalScaleFactor; let rot = sampleAttr('rotation', element.rotation) || 0; let op = sampleAttr('opacity', 1);
            if (effectType !== 'none') {
                const period = Math.max(100, effectPeriodMs); const cyc = (playElapsed % period) / period; const wave = Math.sin(cyc * Math.PI * 2);
                if (effectType === 'breathing') sc *= (1 + effectBreathAmp * wave); else if (effectType === 'swinging') rot += effectSwingDeg * wave;
            }
            const fx = (pos.x / 1920) * canvas.width; const fy = (pos.y / 1080) * canvas.height;
            const img = elementImageRef.current;
            // 舞台使用 sx = canvas.width/1920, sy = canvas.height/1080，保持原始像素在各轴独立缩放；我们在预览中采用相同逻辑。
            const sx = canvas.width / 1920;
            const sy = canvas.height / 1080;
            let baseW: number; let baseH: number;
            // 若存在 originalROI（舞台可能使用的裁剪尺寸），优先使用
            const roi = (element as any).originalROI;
            if (roi && roi.width && roi.height) {
                baseW = roi.width; baseH = roi.height;
            } else if (img && img.naturalWidth && img.naturalHeight) {
                baseW = img.naturalWidth; baseH = img.naturalHeight;
            } else {
                baseW = 200; baseH = 200; // 占位
            }
            const w = baseW * sc * sx;
            const h = baseH * sc * sy;
            ctx.save(); ctx.translate(fx, fy); ctx.rotate(rot * Math.PI / 180); ctx.globalAlpha = op;
            // 与投影端一致：loop + mirrorEnd 时在返程段水平镜像（使用本地 state，勾选后即刻生效）
            if (loop && mirrorEnd) {
                const total = duration;
                if (total > 0) {
                    // 注意：currentTime 在往返时被压缩到 [0,duration]（反向阶段也映射到 0→duration），
                    // 用它无法区分前进/返回。这里改用 playElapsed（真实累计时间）来判断当前是否处于返回段。
                    const cycle = playElapsed % (total * 2); // ms
                    const forward = cycle <= total; // 0..total 前进，total..2*total 返回
                    if (!forward) ctx.scale(-1, 1);
                }
            }
            if (img) ctx.drawImage(img, -w / 2, -h / 2, w, h); else { ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.strokeStyle = '#FF5722'; ctx.lineWidth = 2; ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.fill(); ctx.stroke(); }
            ctx.restore();
        }
    }, [keyframes, selectedKeyframe, currentTime, duration, applyEasing, element.position.x, element.position.y, element.scale, element.rotation, globalScaleFactor, effectType, effectBreathAmp, effectSwingDeg, effectPeriodMs, playElapsed, isPlaying, loop, mirrorEnd, smooth, tension]);

    useEffect(() => {
        drawTrajectoryPreview();
    }, [drawTrajectoryPreview]);

    // 点击添加关键帧（仅关键点模式）
    const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current; if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        // 使用 rect 尺寸，避免 CSS 缩放或 DPR 导致坐标偏差
        const x = ((e.clientX - rect.left) / rect.width) * 1920;
        const y = ((e.clientY - rect.top) / rect.height) * 1080;
        const newTime = keyframes.length > 0 ? Math.max(...keyframes.map(kf => kf.time)) + 0.2 : 0;
        const newKeyframe: TrajectoryKeyframe = {
            time: Math.min(newTime, 1),
            x: Math.round(x),
            y: Math.round(y),
            scale: element.scale,
            rotation: element.rotation,
            opacity: 1
        };
        setKeyframes(prev => [...prev, newKeyframe].sort((a, b) => a.time - b.time));
    }, [keyframes, element.scale, element.rotation, mode]);

    // 手绘模式：鼠标事件
    // 手绘相关事件暂时禁用

    // 删除关键帧
    const deleteKeyframe = (index: number) => {
        setKeyframes(prev => prev.filter((_, i) => i !== index));
        if (selectedKeyframe >= index && selectedKeyframe > 0) {
            setSelectedKeyframe(prev => prev - 1);
        }
    };

    // 更新关键帧
    const updateKeyframe = (index: number, updates: Partial<TrajectoryKeyframe>) => {
        setKeyframes(prev => prev.map((kf, i) => i === index ? { ...kf, ...updates } : kf));
    };

    // 播放/停止动画预览
    const playAnimation = () => {
        setIsPlaying(true);
        setCurrentTime(0);
        setPlayElapsed(0);
        playStartRef.current = performance.now();
        const startTime = Date.now();
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const over = elapsed >= duration;
            if (loop && duration > 0) {
                const cycle = elapsed % (duration * 2);
                const progress = cycle <= duration ? (cycle / duration) : (1 - ((cycle - duration) / duration));
                setCurrentTime(progress * duration);
            } else {
                setCurrentTime(elapsed);
            }
            setPlayElapsed(performance.now() - playStartRef.current);
            if (!over || loop) {
                animationRef.current = requestAnimationFrame(animate);
            } else {
                setIsPlaying(false);
                setCurrentTime(0);
                setPlayElapsed(0);
            }
        };
        animationRef.current = requestAnimationFrame(animate);
    };

    const stopAnimation = () => {
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
        setIsPlaying(false);
        setCurrentTime(0);
        setPlayElapsed(0);
    };

    // 将手绘笔划采样为关键帧
    // 手绘到关键帧的转换暂时移除

    // 保存轨迹
    const handleSave = () => {
        let finalKeyframes = keyframes;
        // 统一规范时间轴：按顺序等间距分布到 [0,1]
        if (finalKeyframes.length >= 2) {
            const sorted = [...finalKeyframes].sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
            const n = sorted.length;
            finalKeyframes = sorted.map((kf, i) => ({ ...kf, time: n === 1 ? 0 : i / (n - 1) }));
        }
        const trajectoryConfig = {
            isAnimating: false,
            startTime: 0,
            duration,
            loop,
            mirrorEnd,
            tension,
            smooth,
            easing,
            effectType,
            effectContinue,
            keyframes: finalKeyframes.sort((a, b) => a.time - b.time)
        };
        onUpdate(trajectoryConfig);
        onClose();
    };

    useEffect(() => {
        return () => {
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
        };
    }, []);

    if (!isOpen) return null;

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000
        }}>
            <div style={{
                backgroundColor: '#2a2a3e',
                borderRadius: '10px',
                padding: '20px',
                width: '700px',
                maxHeight: '90vh',
                overflowY: 'auto',
                color: 'white',
                border: '2px solid #4a4a6e'
            }}>
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '20px'
                }}>
                    <h3 style={{ margin: 0 }}>📍 轨迹编辑器 - {element.name}</h3>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: 'white',
                            fontSize: '20px',
                            cursor: 'pointer'
                        }}
                    >
                        ✕
                    </button>
                </div>

                {/* 轨迹预览画布 */}
                <div style={{ marginBottom: '20px' }}>
                    <div style={{ fontSize: '14px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>轨迹预览（点击添加关键帧）</span>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <button onClick={() => setKeyframes([])} disabled={keyframes.length === 0} style={{ padding: '4px 8px', background: '#555', color: '#fff', border: 'none', borderRadius: 4, cursor: keyframes.length ? 'pointer' : 'not-allowed' }}>清空关键帧</button>
                        </div>
                    </div>
                    <canvas
                        ref={canvasRef}
                        width={600}
                        height={300}
                        onClick={handleCanvasClick}
                        // 手绘事件已禁用
                        style={{
                            border: '2px solid #666',
                            borderRadius: '4px',
                            backgroundColor: '#1a1a2e',
                            cursor: 'crosshair',
                            display: 'block'
                        }}
                    />
                </div>

                {/* 动画控制行 1 */}
                <div style={{ marginBottom: 8, display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 230 }}>
                        <label style={{ display: 'block', marginBottom: 4, fontSize: 14 }}>动画时长: {duration}ms</label>
                        <input type="range" min="1000" max="15000" step="500" value={duration} onChange={(e) => setDuration(parseInt(e.target.value))} style={{ width: '100%' }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, opacity: 0.6, marginTop: 2 }}>
                            <span>1s</span><span>15s</span>
                        </div>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        <input type="checkbox" checked={loop} onChange={(e) => { const v = e.target.checked; setLoop(v); if (v && effectContinue) setEffectContinue(false); }} /> 循环（往返）
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: loop ? 1 : 0.5 }} title="启用后：每次到达路径终点将水平镜像翻转一次">
                        <input type="checkbox" disabled={!loop} checked={mirrorEnd} onChange={(e) => setMirrorEnd(e.target.checked)} /> 终点镜像
                    </label>
                    <button onClick={isPlaying ? stopAnimation : playAnimation} style={{ padding: '8px 16px', backgroundColor: isPlaying ? '#f44336' : '#4CAF50', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                        {isPlaying ? '⏹️ 停止' : '▶️ 预览'}
                    </button>
                </div>
                {/* 动画控制行 2：速度曲线 / 平滑 */}
                <div style={{ marginBottom: '20px', display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        速度曲线:
                        <select value={easing} onChange={(e) => setEasing(e.target.value)} style={{ background: '#1e1e2f', color: '#fff', border: '1px solid #555', borderRadius: 4, padding: '2px 6px' }}>
                            <option value="linear">匀速（线性）</option>
                            <option value="easeInOut">慢→快→慢</option>
                            <option value="easeIn">缓入</option>
                            <option value="easeOut">缓出</option>
                        </select>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }} title="使用 Catmull-Rom 平滑曲线让路径更自然">
                        <input type="checkbox" checked={smooth} onChange={(e) => setSmooth(e.target.checked)} /> 平滑
                    </label>
                    {smooth && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', width: 140 }}>
                                <label style={{ fontSize: 10, opacity: 0.8 }}>张力: {tension.toFixed(2)}</label>
                                <input type="range" min={0} max={1} step={0.01} value={tension} onChange={(e) => setTension(parseFloat(e.target.value))} />
                            </div>
                            <div style={{ fontSize: 10, opacity: 0.55, maxWidth: 150, lineHeight: 1.3 }}>0 更柔顺 / 1 更接近折线</div>
                        </div>
                    )}
                </div>

                {/* 全局尺寸调整 */}
                <div style={{ marginBottom: 20 }}>
                    <label style={{ display: 'block', marginBottom: 6, fontSize: 13 }}>
                        全局尺寸调整: {(globalScaleFactor * 100).toFixed(0)}%
                    </label>
                    <input
                        type="range"
                        min={0.2}
                        max={3}
                        step={0.05}
                        value={globalScaleFactor}
                        onChange={(e) => {
                            const newVal = parseFloat(e.target.value);
                            const ratio = newVal / prevGlobalScaleRef.current;
                            setKeyframes(prev => prev.map(kf => ({ ...kf, scale: (kf.scale ?? element.scale) * ratio })));
                            prevGlobalScaleRef.current = newVal;
                            setGlobalScaleFactor(newVal);
                        }}
                        style={{ width: '100%' }}
                    />
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                        <button
                            onClick={() => {
                                const base = element.scale || 1;
                                setKeyframes(prev => prev.map(kf => ({ ...kf, scale: base })));
                                prevGlobalScaleRef.current = 1;
                                setGlobalScaleFactor(1);
                            }}
                            style={{ padding: '4px 10px', background: '#555', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                        >重置尺寸</button>
                    </div>
                </div>

                {/* 运动效果设置 */}
                <div style={{ marginBottom: '16px', display: 'flex', gap: 16, alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        运动效果:
                        <select
                            value={effectType}
                            onChange={(e) => setEffectType(e.target.value as any)}
                            style={{ background: '#1e1e2f', color: '#fff', border: '1px solid #555', borderRadius: 4, padding: '2px 6px' }}
                        >
                            <option value="none">无</option>
                            <option value="breathing">呼吸（尺寸起伏）</option>
                            <option value="swinging">摇摆（角度起伏）</option>
                        </select>
                    </label>
                    <label title={loop ? '已启用循环：效果持续不可用' : ''} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: loop ? 0.6 : 1 }}>
                        <input
                            type="checkbox"
                            disabled={loop}
                            checked={effectContinue && !loop}
                            onChange={(e) => setEffectContinue(e.target.checked)}
                        /> 效果在到达终点后继续
                    </label>
                </div>

                {effectType !== 'none' && (
                    <div style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                                强度：
                                <span style={{ opacity: 0.8, marginLeft: 6 }}>
                                    {effectType === 'breathing' ? `${Math.round(effectBreathAmp * 100)}%` : `${Math.round(effectSwingDeg)}°`}
                                </span>
                            </label>
                            {effectType === 'breathing' ? (
                                <input
                                    type="range"
                                    min={0}
                                    max={0.3}
                                    step={0.01}
                                    value={effectBreathAmp}
                                    onChange={(e) => setEffectBreathAmp(parseFloat(e.target.value))}
                                    style={{ width: '100%' }}
                                />
                            ) : (
                                <input
                                    type="range"
                                    min={0}
                                    max={30}
                                    step={1}
                                    value={effectSwingDeg}
                                    onChange={(e) => setEffectSwingDeg(parseInt(e.target.value))}
                                    style={{ width: '100%' }}
                                />
                            )}
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                                周期：
                                <span style={{ opacity: 0.8, marginLeft: 6 }}>{(effectPeriodMs / 1000).toFixed(1)}s</span>
                            </label>
                            <input
                                type="range"
                                min={500}
                                max={5000}
                                step={100}
                                value={effectPeriodMs}
                                onChange={(e) => setEffectPeriodMs(parseInt(e.target.value))}
                                style={{ width: '100%' }}
                            />
                        </div>
                    </div>
                )}

                {/* 关键帧列表 */}
                <div style={{ marginBottom: '20px' }}>
                    <div style={{ fontSize: '14px', marginBottom: '8px' }}>关键帧列表{keyframes.length === 0 ? '（尚未添加）' : ''}:</div>
                    <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                        {keyframes.map((kf, index) => (
                            <div
                                key={index}
                                style={{
                                    padding: '10px',
                                    margin: '4px 0',
                                    backgroundColor: index === selectedKeyframe ? '#4CAF50' : '#444',
                                    borderRadius: '4px',
                                    fontSize: '12px',
                                    cursor: 'pointer'
                                }}
                                onClick={() => setSelectedKeyframe(index)}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>#{index + 1} - 时间: {(kf.time * 100).toFixed(0)}%</span>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); deleteKeyframe(index); }}
                                        style={{
                                            background: '#f44336',
                                            border: 'none',
                                            color: 'white',
                                            padding: '2px 6px',
                                            borderRadius: '3px',
                                            fontSize: '10px',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        删除
                                    </button>
                                </div>
                                <div style={{ marginTop: '4px', color: '#ccc' }}>
                                    位置: ({kf.x}, {kf.y}) | 缩放: {((kf.scale || 1) * 100).toFixed(0)}% | 透明度: {((kf.opacity ?? 1) * 100).toFixed(0)}% | 旋转: {(kf.rotation || 0).toFixed(1)}°
                                </div>
                                {index === selectedKeyframe && (
                                    <div style={{ marginTop: '8px', padding: '8px', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '4px' }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11px' }}>
                                            <div>
                                                <label>X:</label>
                                                <input
                                                    type="number"
                                                    value={kf.x}
                                                    onChange={(e) => updateKeyframe(index, { x: parseInt(e.target.value) || 0 })}
                                                    style={{ width: '100%', padding: '2px', backgroundColor: '#666', color: 'white', border: '1px solid #888', borderRadius: '2px' }}
                                                />
                                            </div>
                                            <div>
                                                <label>Y:</label>
                                                <input
                                                    type="number"
                                                    value={kf.y}
                                                    onChange={(e) => updateKeyframe(index, { y: parseInt(e.target.value) || 0 })}
                                                    style={{ width: '100%', padding: '2px', backgroundColor: '#666', color: 'white', border: '1px solid #888', borderRadius: '2px' }}
                                                />
                                            </div>
                                            <div>
                                                <label>缩放:</label>
                                                <input
                                                    type="range"
                                                    min="0.1"
                                                    max="3"
                                                    step="0.1"
                                                    value={kf.scale || 1}
                                                    onChange={(e) => updateKeyframe(index, { scale: parseFloat(e.target.value) })}
                                                    style={{ width: '100%' }}
                                                />
                                            </div>
                                            <div>
                                                <label>透明度:</label>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="1"
                                                    step="0.1"
                                                    value={kf.opacity || 1}
                                                    onChange={(e) => updateKeyframe(index, { opacity: parseFloat(e.target.value) })}
                                                    style={{ width: '100%' }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* 操作按钮 */}
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                        onClick={handleSave}
                        style={{
                            flex: 1,
                            padding: '12px',
                            backgroundColor: '#2196F3',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '14px'
                        }}
                    >
                        ✅ 保存轨迹
                    </button>
                    <button
                        onClick={onClose}
                        style={{
                            flex: 1,
                            padding: '12px',
                            backgroundColor: '#666',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '14px'
                        }}
                    >
                        取消
                    </button>
                </div>
            </div>
        </div>
    );
}