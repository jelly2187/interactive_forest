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
            keyframes: TrajectoryKeyframe[];
        };
    };
    onUpdate: (trajectoryConfig: any) => void;
}

export default function TrajectoryEditorModal({ isOpen, onClose, element, onUpdate }: TrajectoryEditorModalProps) {
    const [duration, setDuration] = useState(element.trajectory?.duration || 5000);
    const [keyframes, setKeyframes] = useState<TrajectoryKeyframe[]>(
        element.trajectory?.keyframes || [
            { time: 0, x: element.position.x, y: element.position.y, scale: element.scale, rotation: element.rotation, opacity: 1 },
            { time: 1, x: element.position.x + 100, y: element.position.y, scale: element.scale, rotation: element.rotation, opacity: 1 }
        ]
    );
    const [selectedKeyframe, setSelectedKeyframe] = useState<number>(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number | null>(null);

    // 绘制轨迹预览
    const drawTrajectoryPreview = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 绘制背景网格
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        for (let x = 0; x <= canvas.width; x += 20) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }
        for (let y = 0; y <= canvas.height; y += 20) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }

        if (keyframes.length < 2) return;

        // 绘制轨迹路径
        ctx.strokeStyle = '#2196F3';
        ctx.lineWidth = 3;
        ctx.beginPath();

        for (let i = 0; i < keyframes.length; i++) {
            const kf = keyframes[i];
            const x = (kf.x / 1920) * canvas.width; // 假设投影分辨率1920x1080
            const y = (kf.y / 1080) * canvas.height;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        // 绘制关键帧点
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

            // 绘制关键帧序号
            ctx.fillStyle = '#fff';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText((index + 1).toString(), x, y + 4);
        });

        // 绘制当前播放位置
        if (isPlaying && keyframes.length > 1) {
            const progress = currentTime / duration;

            // 找到当前进度对应的位置
            let currentPos = { x: 0, y: 0 };
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

            const x = (currentPos.x / 1920) * canvas.width;
            const y = (currentPos.y / 1080) * canvas.height;

            ctx.beginPath();
            ctx.arc(x, y, 6, 0, 2 * Math.PI);
            ctx.fillStyle = '#FF5722';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }, [keyframes, selectedKeyframe, isPlaying, currentTime, duration]);

    // 处理画布点击
    const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / canvas.width) * 1920;
        const y = ((e.clientY - rect.top) / canvas.height) * 1080;

        // 添加新关键帧
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
    }, [keyframes, element.scale, element.rotation]);

    // 删除关键帧
    const deleteKeyframe = (index: number) => {
        if (keyframes.length <= 2) return; // 至少保留2个关键帧
        setKeyframes(prev => prev.filter((_, i) => i !== index));
        if (selectedKeyframe >= index && selectedKeyframe > 0) {
            setSelectedKeyframe(prev => prev - 1);
        }
    };

    // 更新关键帧
    const updateKeyframe = (index: number, updates: Partial<TrajectoryKeyframe>) => {
        setKeyframes(prev => prev.map((kf, i) => i === index ? { ...kf, ...updates } : kf));
    };

    // 播放动画预览
    const playAnimation = () => {
        setIsPlaying(true);
        setCurrentTime(0);

        const startTime = Date.now();
        const animate = () => {
            const elapsed = Date.now() - startTime;
            setCurrentTime(elapsed);

            if (elapsed < duration) {
                animationRef.current = requestAnimationFrame(animate);
            } else {
                setIsPlaying(false);
                setCurrentTime(0);
            }
        };

        animationRef.current = requestAnimationFrame(animate);
    };

    // 停止动画
    const stopAnimation = () => {
        if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
        }
        setIsPlaying(false);
        setCurrentTime(0);
    };

    // 保存轨迹
    const handleSave = () => {
        const trajectoryConfig = {
            isAnimating: false,
            startTime: 0,
            duration,
            keyframes: keyframes.sort((a, b) => a.time - b.time)
        };

        onUpdate(trajectoryConfig);
        onClose();
    };

    useEffect(() => {
        drawTrajectoryPreview();
    }, [drawTrajectoryPreview]);

    useEffect(() => {
        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
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
                    <div style={{ fontSize: '14px', marginBottom: '8px' }}>
                        轨迹预览 (点击添加关键帧):
                    </div>
                    <canvas
                        ref={canvasRef}
                        width={600}
                        height={300}
                        onClick={handleCanvasClick}
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
                    <div style={{ fontSize: '14px', marginBottom: '8px' }}>关键帧列表:</div>
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
                                    {keyframes.length > 2 && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                deleteKeyframe(index);
                                            }}
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
                                    )}
                                </div>
                                <div style={{ marginTop: '4px', color: '#ccc' }}>
                                    位置: ({kf.x}, {kf.y}) | 缩放: {((kf.scale || 1) * 100).toFixed(0)}% | 旋转: {(kf.rotation || 0).toFixed(1)}°
                                </div>

                                {/* 关键帧属性编辑 */}
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