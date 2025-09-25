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
    const [loop, setLoop] = useState<boolean>(element.trajectory?.loop ?? true);

    // Freehand mode state
    const [mode, setMode] = useState<'freehand' | 'points'>('freehand');
    const [strokes, setStrokes] = useState<Array<Array<{ x: number; y: number }>>>([]);
    const [isDrawing, setIsDrawing] = useState(false);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const bgImageRef = useRef<HTMLImageElement | null>(null);
    const currentStrokeRef = useRef<Array<{ x: number; y: number }> | null>(null);
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

        // 手绘路径渲染（叠加层）
        if (mode === 'freehand') {
            ctx.strokeStyle = 'rgba(255, 193, 7, 0.9)';
            ctx.lineWidth = 3;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            const list = Array.isArray(strokes) ? strokes : [];
            list.forEach(stroke => {
                if (!stroke || stroke.length < 2) return;
                ctx.beginPath();
                for (let i = 0; i < stroke.length; i++) {
                    const p = stroke[i];
                    const x = (p.x / 1920) * canvas.width;
                    const y = (p.y / 1080) * canvas.height;
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
                ctx.stroke();
            });
            if (currentStrokeRef.current && currentStrokeRef.current.length > 1) {
                const stroke = currentStrokeRef.current;
                ctx.beginPath();
                for (let i = 0; i < stroke.length; i++) {
                    const p = stroke[i];
                    const x = (p.x / 1920) * canvas.width;
                    const y = (p.y / 1080) * canvas.height;
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
                ctx.stroke();
            }
        }

        // 关键帧路径与点（仅在关键点模式显示）
        if (mode === 'points' && keyframes.length >= 1) {
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
            const progress = duration > 0 ? (currentTime / duration) : 0;
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
            } else if (mode === 'freehand' && strokes.length > 0) {
                const points: Array<{ x: number; y: number }> = [];
                strokes.forEach(stroke => { if (stroke) stroke.forEach(p => points.push(p)); });
                if (points.length >= 2) {
                    const cum: number[] = [0];
                    for (let i = 1; i < points.length; i++) {
                        cum[i] = cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
                    }
                    const total = cum[cum.length - 1] || 1;
                    const L = progress * total;
                    let idx = 0;
                    while (idx < cum.length - 1 && cum[idx + 1] < L) idx++;
                    const segLen = cum[idx + 1] - cum[idx] || 1;
                    const t = (L - cum[idx]) / segLen;
                    const p0 = points[idx];
                    const p1 = points[idx + 1];
                    currentPos.x = p0.x + (p1.x - p0.x) * t;
                    currentPos.y = p0.y + (p1.y - p0.y) * t;
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
    }, [keyframes, selectedKeyframe, isPlaying, currentTime, duration, strokes, mode]);

    useEffect(() => {
        drawTrajectoryPreview();
    }, [drawTrajectoryPreview]);

    // 点击添加关键帧（仅关键点模式）
    const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (mode === 'freehand') return;
        const canvas = canvasRef.current; if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / canvas.width) * 1920;
        const y = ((e.clientY - rect.top) / canvas.height) * 1080;
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
    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (mode !== 'freehand') return;
        const canvas = canvasRef.current; if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / canvas.width) * 1920;
        const y = ((e.clientY - rect.top) / canvas.height) * 1080;
        currentStrokeRef.current = [{ x, y }];
        setIsDrawing(true);
        drawTrajectoryPreview();
    }, [mode, drawTrajectoryPreview]);

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (mode !== 'freehand' || !isDrawing) return;
        const canvas = canvasRef.current; if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / canvas.width) * 1920;
        const y = ((e.clientY - rect.top) / canvas.height) * 1080;
        const stroke = currentStrokeRef.current; if (!stroke) return;
        const last = stroke[stroke.length - 1];
        const dx = x - last.x; const dy = y - last.y;
        if (dx * dx + dy * dy < 4) return; // 2px 阈值
        stroke.push({ x, y });
        drawTrajectoryPreview();
    }, [mode, isDrawing, drawTrajectoryPreview]);

    const handleMouseUp = useCallback(() => {
        if (mode !== 'freehand') return;
        if (currentStrokeRef.current && currentStrokeRef.current.length > 1) {
            setStrokes(prev => [...prev, currentStrokeRef.current as Array<{ x: number; y: number }>]);
        }
        currentStrokeRef.current = null;
        setIsDrawing(false);
        drawTrajectoryPreview();
    }, [mode, drawTrajectoryPreview]);

    const handleMouseLeaveCanvas = useCallback(() => {
        if (mode !== 'freehand') return;
        if (isDrawing) handleMouseUp();
    }, [mode, isDrawing, handleMouseUp]);

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
            setCurrentTime(loop && duration > 0 ? (elapsed % duration) : elapsed);
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
    const strokesToKeyframes = useCallback((): TrajectoryKeyframe[] => {
        const allPoints: Array<{ x: number; y: number }> = [];
        strokes.forEach(stroke => { stroke.forEach(p => allPoints.push({ x: Math.round(p.x), y: Math.round(p.y) })); });
        if (allPoints.length < 2) return [];
        const cumlen: number[] = [0];
        for (let i = 1; i < allPoints.length; i++) {
            const dx = allPoints[i].x - allPoints[i - 1].x;
            const dy = allPoints[i].y - allPoints[i - 1].y;
            cumlen[i] = cumlen[i - 1] + Math.hypot(dx, dy);
        }
        const total = cumlen[cumlen.length - 1] || 1;
        const targetCount = Math.min(60, Math.max(2, Math.round(total / 15)));
        const keyfs: TrajectoryKeyframe[] = [];
        for (let i = 0; i < targetCount; i++) {
            const t = i / (targetCount - 1);
            const L = t * total;
            let idx = 0;
            while (idx < cumlen.length - 1 && cumlen[idx + 1] < L) idx++;
            const segLen = cumlen[idx + 1] - cumlen[idx] || 1;
            const segT = (L - cumlen[idx]) / segLen;
            const p0 = allPoints[idx];
            const p1 = allPoints[idx + 1];
            const x = Math.round(p0.x + (p1.x - p0.x) * segT);
            const y = Math.round(p0.y + (p1.y - p0.y) * segT);
            keyfs.push({ time: t, x, y, scale: element.scale, rotation: element.rotation, opacity: 1 });
        }
        return keyfs;
    }, [strokes, element.scale, element.rotation]);

    // 保存轨迹
    const handleSave = () => {
        let finalKeyframes = keyframes;
        if (mode === 'freehand' && strokes.length >= 1) {
            const kfs = strokesToKeyframes();
            if (kfs.length >= 2) finalKeyframes = kfs;
        }
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
                        <span>
                            轨迹预览 {mode === 'points' ? '(点击添加关键帧)' : '(按住左键手绘路径)'}
                        </span>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                                模式:
                                <select value={mode} onChange={(e) => setMode(e.target.value as any)} style={{ background: '#1e1e2f', color: '#fff', border: '1px solid #555', borderRadius: 4, padding: '2px 6px' }}>
                                    <option value="freehand">手绘</option>
                                    <option value="points">关键点</option>
                                </select>
                            </label>
                            {mode === 'freehand' && (
                                <>
                                    <button onClick={() => setStrokes(prev => prev.slice(0, -1))} disabled={strokes.length === 0} style={{ padding: '4px 8px', background: '#555', color: '#fff', border: 'none', borderRadius: 4, cursor: strokes.length ? 'pointer' : 'not-allowed' }}>撤回</button>
                                    <button onClick={() => setStrokes([])} disabled={strokes.length === 0} style={{ padding: '4px 8px', background: '#555', color: '#fff', border: 'none', borderRadius: 4, cursor: strokes.length ? 'pointer' : 'not-allowed' }}>清空</button>
                                </>
                            )}
                            {mode === 'points' && (
                                <button onClick={() => setKeyframes([])} disabled={keyframes.length === 0} style={{ padding: '4px 8px', background: '#555', color: '#fff', border: 'none', borderRadius: 4, cursor: keyframes.length ? 'pointer' : 'not-allowed' }}>清空关键帧</button>
                            )}
                        </div>
                    </div>
                    <canvas
                        ref={canvasRef}
                        width={600}
                        height={300}
                        onClick={handleCanvasClick}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseLeaveCanvas}
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
                        <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> 循环
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