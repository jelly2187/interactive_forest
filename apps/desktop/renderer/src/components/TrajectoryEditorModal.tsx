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
        position: { x: number; y: number };
        scale: number;
        rotation: number;
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
    const [easing, setEasing] = useState<string>((element as any).trajectory?.easing ?? 'easeInOut');
    const [effectType, setEffectType] = useState<'none' | 'breathing' | 'swinging'>((element as any).trajectory?.effectType ?? 'none');
    const [effectContinue, setEffectContinue] = useState<boolean>((element as any).trajectory?.effectContinue ?? false);
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
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 清空
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 背景底图
        if (bgImageRef.current) {
            try { ctx.drawImage(bgImageRef.current, 0, 0, canvas.width, canvas.height); } catch { }
        } else {
            // 无底图时画参考网格
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 1;
            for (let x = 0; x <= canvas.width; x += 20) {
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
            }
            for (let y = 0; y <= canvas.height; y += 20) {
                ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
            }
        }

        // 手绘路径渲染（禁用）

        // 关键帧路径与点（仅在关键点模式显示）
        if (keyframes.length >= 1) {
            ctx.strokeStyle = '#2196F3';
            ctx.lineWidth = 3;
            if (keyframes.length >= 2) {
                ctx.beginPath();
                for (let i = 0; i < keyframes.length; i++) {
                    const kf = keyframes[i];
                    const x = (kf.x / 1920) * canvas.width;
                    const y = (kf.y / 1080) * canvas.height;
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
                ctx.stroke();
            }
            keyframes.forEach((kf, index) => {
                const x = (kf.x / 1920) * canvas.width;
                const y = (kf.y / 1080) * canvas.height;
                ctx.beginPath();
                ctx.arc(x, y, 8, 0, 2 * Math.PI);
                ctx.fillStyle = index === selectedKeyframe ? '#FF9800' : '#4CAF50';
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.fillStyle = '#fff';
                ctx.font = '12px Arial';
                ctx.textAlign = 'center';
                ctx.fillText((index + 1).toString(), x, y + 4);
            });
        }

        // 当前播放位置标记
        if (isPlaying) {
            const rawProgress = duration > 0 ? (currentTime / duration) : 0;
            const progress = applyEasing(rawProgress);
            let currentPos = { x: 0, y: 0 };
            if (mode === 'points' && keyframes.length > 1) {
                for (let i = 0; i < keyframes.length - 1; i++) {
                    const start = keyframes[i];
                    const end = keyframes[i + 1];
                    if (progress >= start.time && progress <= end.time) {
                        const t = (progress - start.time) / (end.time - start.time);
                        currentPos.x = start.x + (end.x - start.x) * t;
                        currentPos.y = start.y + (end.y - start.y) * t;
                        break;
                    }
                }
            }
            const fx = (currentPos.x / 1920) * canvas.width;
            const fy = (currentPos.y / 1080) * canvas.height;
            ctx.beginPath();
            ctx.arc(fx, fy, 6, 0, 2 * Math.PI);
            ctx.fillStyle = '#FF5722';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }, [keyframes, selectedKeyframe, isPlaying, currentTime, duration, mode, easing]);

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
            if (!over || loop) {
                animationRef.current = requestAnimationFrame(animate);
            } else {
                setIsPlaying(false);
                setCurrentTime(0);
            }
        };
        animationRef.current = requestAnimationFrame(animate);
    };

    const stopAnimation = () => {
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
        setIsPlaying(false);
        setCurrentTime(0);
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

                {/* 动画控制 */}
                <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
                            动画时长: {duration}ms
                        </label>
                        <input
                            type="range"
                            min="1000"
                            max="10000"
                            step="500"
                            value={duration}
                            onChange={(e) => setDuration(parseInt(e.target.value))}
                            style={{ width: '100%' }}
                        />
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        <input
                            type="checkbox"
                            checked={loop}
                            onChange={(e) => {
                                const v = e.target.checked;
                                setLoop(v);
                                if (v && effectContinue) setEffectContinue(false);
                            }}
                        /> 循环（往返）
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        速度曲线:
                        <select value={easing} onChange={(e) => setEasing(e.target.value)} style={{ background: '#1e1e2f', color: '#fff', border: '1px solid #555', borderRadius: 4, padding: '2px 6px' }}>
                            <option value="linear">匀速（线性）</option>
                            <option value="easeInOut">慢→快→慢</option>
                            <option value="easeIn">缓入</option>
                            <option value="easeOut">缓出</option>
                        </select>
                    </label>
                    <button
                        onClick={isPlaying ? stopAnimation : playAnimation}
                        style={{
                            padding: '8px 16px',
                            backgroundColor: isPlaying ? '#f44336' : '#4CAF50',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }}
                    >
                        {isPlaying ? '⏹️ 停止' : '▶️ 预览'}
                    </button>
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