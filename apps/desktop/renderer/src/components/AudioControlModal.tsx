import { useState, useEffect, useRef } from 'react';

interface AudioControlModalProps {
    isOpen: boolean;
    onClose: () => void;
    element: {
        id: string;
        name: string;
        audio?: {
            src: string;
            volume: number;
            loop: boolean;
            isPlaying: boolean;
        };
    };
    onUpdate: (audioConfig: any) => void;
}

export default function AudioControlModal({ isOpen, onClose, element, onUpdate }: AudioControlModalProps) {
    const [audioConfig, setAudioConfig] = useState({
        src: element.audio?.src || '',
        volume: element.audio?.volume || 0.5,
        loop: element.audio?.loop || false,
        isPlaying: element.audio?.isPlaying || false
    });

    const [availableAudioFiles, setAvailableAudioFiles] = useState<string[]>([]);
    const audioRef = useRef<HTMLAudioElement>(null);

    // 加载可用音频文件列表：优先从 /audio/manifest.json 读取，失败则回退到内置列表
    useEffect(() => {
        let disposed = false;
        const fallback = [
            './audio/forest-ambient.mp3',
            './audio/bird-chirp.mp3',
            './audio/wind-leaves.mp3',
            './audio/water-flow.mp3',
            './audio/magic-sparkle.mp3',
            './audio/click-sound.mp3'
        ];
        fetch('/audio/manifest.json', { cache: 'no-cache' })
            .then(r => (r.ok ? r.json() : Promise.reject()))
            .then((list: string[]) => { if (!disposed) setAvailableAudioFiles(list && list.length ? list : fallback); })
            .catch(() => { if (!disposed) setAvailableAudioFiles(fallback); });
        return () => { disposed = true; };
    }, []);

    // 播放预览
    const playPreview = () => {
        if (audioRef.current && audioConfig.src) {
            audioRef.current.src = audioConfig.src;
            audioRef.current.volume = audioConfig.volume;
            audioRef.current.loop = audioConfig.loop;
            audioRef.current.play().catch(console.warn);
        }
    };

    // 停止预览
    const stopPreview = () => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }
    };

    // 保存配置
    const handleSave = () => {
        onUpdate(audioConfig);
        onClose();
    };

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
                width: '400px',
                maxHeight: '80vh',
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
                    <h3 style={{ margin: 0 }}>🎵 音效控制 - {element.name}</h3>
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

                {/* 音频文件选择 */}
                <div style={{ marginBottom: '15px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>
                        选择音频文件:
                    </label>
                    <select
                        value={audioConfig.src}
                        onChange={(e) => setAudioConfig(prev => ({ ...prev, src: e.target.value }))}
                        style={{
                            width: '100%',
                            padding: '8px',
                            backgroundColor: '#444',
                            color: 'white',
                            border: '1px solid #666',
                            borderRadius: '4px'
                        }}
                    >
                        <option value="">无音效</option>
                        {availableAudioFiles.map(file => (
                            <option key={file} value={file}>
                                {file.split('/').pop()?.replace('.mp3', '')}
                            </option>
                        ))}
                    </select>
                </div>

                {/* 音量控制 */}
                <div style={{ marginBottom: '15px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>
                        音量: {Math.round(audioConfig.volume * 100)}%
                    </label>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={audioConfig.volume}
                        onChange={(e) => setAudioConfig(prev => ({ ...prev, volume: parseFloat(e.target.value) }))}
                        style={{
                            width: '100%',
                            height: '6px',
                            backgroundColor: '#666',
                            borderRadius: '3px'
                        }}
                    />
                </div>

                {/* 循环播放 */}
                <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', fontSize: '14px', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={audioConfig.loop}
                            onChange={(e) => setAudioConfig(prev => ({ ...prev, loop: e.target.checked }))}
                            style={{ marginRight: '8px' }}
                        />
                        循环播放
                    </label>
                </div>

                {/* 预览控制 */}
                {audioConfig.src && (
                    <div style={{ marginBottom: '20px' }}>
                        <div style={{ fontSize: '14px', marginBottom: '8px' }}>预览:</div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button
                                onClick={playPreview}
                                style={{
                                    flex: 1,
                                    padding: '8px',
                                    backgroundColor: '#4CAF50',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer'
                                }}
                            >
                                ▶️ 播放
                            </button>
                            <button
                                onClick={stopPreview}
                                style={{
                                    flex: 1,
                                    padding: '8px',
                                    backgroundColor: '#f44336',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer'
                                }}
                            >
                                ⏹️ 停止
                            </button>
                        </div>
                    </div>
                )}

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
                        ✅ 保存
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

                {/* 隐藏的音频元素用于预览 */}
                <audio ref={audioRef} style={{ display: 'none' }} />
            </div>
        </div>
    );
}