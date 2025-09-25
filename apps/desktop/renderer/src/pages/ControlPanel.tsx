import { useEffect, useRef, useState, useCallback } from "react";
import { apiService, type Point } from "../services/apiService";
import AudioControlModal from "../components/AudioControlModal";
import TrajectoryEditorModal from "../components/TrajectoryEditorModal";

// CandidatePreview组件，用于渲染原图+mask叠加
interface CandidatePreviewProps {
    image: HTMLImageElement | null;
    maskUrl: string;
    points: { x: number; y: number; type: 'positive' | 'negative' }[];
    currentROI?: { x: number; y: number; width: number; height: number } | null;
}

const CandidatePreview: React.FC<CandidatePreviewProps> = ({
    image,
    maskUrl,
    points,
    currentROI
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [maskImage, setMaskImage] = useState<HTMLImageElement | null>(null);

    // 加载mask图片
    useEffect(() => {
        if (maskUrl) {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => setMaskImage(img);
            img.onerror = () => console.error('Failed to load mask image:', maskUrl);
            img.src = maskUrl;
        }
    }, [maskUrl]);

    // 绘制canvas内容
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !image || !maskImage) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 设置canvas尺寸（增大预览尺寸）
        const previewWidth = 400;
        const previewHeight = 200;
        canvas.width = previewWidth;
        canvas.height = previewHeight;

        // 清空canvas
        ctx.clearRect(0, 0, previewWidth, previewHeight);

        // 计算ROI区域的缩放比例
        let sourceX = 0, sourceY = 0, sourceWidth = image.width, sourceHeight = image.height;
        if (currentROI) {
            sourceX = currentROI.x;
            sourceY = currentROI.y;
            sourceWidth = currentROI.width;
            sourceHeight = currentROI.height;
        }

        // 绘制原图（ROI区域）
        const aspectRatio = sourceWidth / sourceHeight;
        let drawWidth = previewWidth;
        let drawHeight = previewWidth / aspectRatio;

        if (drawHeight > previewHeight) {
            drawHeight = previewHeight;
            drawWidth = previewHeight * aspectRatio;
        }

        const offsetX = (previewWidth - drawWidth) / 2;
        const offsetY = (previewHeight - drawHeight) / 2;

        ctx.drawImage(
            image,
            sourceX, sourceY, sourceWidth, sourceHeight,
            offsetX, offsetY, drawWidth, drawHeight
        );

        // 绘制mask叠加（半透明彩色）
        ctx.globalAlpha = 0.5;
        ctx.globalCompositeOperation = 'source-over';

        // 创建一个临时canvas来处理mask的颜色
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        if (tempCtx) {
            tempCanvas.width = maskImage.width;
            tempCanvas.height = maskImage.height;

            // 绘制mask
            tempCtx.drawImage(maskImage, 0, 0);

            // 获取mask数据并应用颜色
            const imageData = tempCtx.getImageData(0, 0, maskImage.width, maskImage.height);
            const data = imageData.data;

            for (let i = 0; i < data.length; i += 4) {
                // 如果像素不是纯黑色（即是mask区域）
                if (data[i] > 50 || data[i + 1] > 50 || data[i + 2] > 50) {
                    data[i] = 135;   // R - 浅蓝色
                    data[i + 1] = 206; // G - 浅蓝色  
                    data[i + 2] = 250; // B - 浅蓝色
                    data[i + 3] = 200; // A - 透明度
                } else {
                    data[i + 3] = 0; // 完全透明
                }
            }

            tempCtx.putImageData(imageData, 0, 0);

            // 将处理后的mask绘制到主canvas上
            ctx.drawImage(
                tempCanvas,
                sourceX, sourceY, sourceWidth, sourceHeight,
                offsetX, offsetY, drawWidth, drawHeight
            );
        }

        // 恢复混合模式和透明度
        ctx.globalAlpha = 1.0;
        ctx.globalCompositeOperation = 'source-over';

        // 绘制点击点
        const scaleX = drawWidth / sourceWidth;
        const scaleY = drawHeight / sourceHeight;

        points.forEach(point => {
            if (currentROI) {
                // 检查点是否在当前ROI内
                if (point.x >= currentROI.x && point.x <= currentROI.x + currentROI.width &&
                    point.y >= currentROI.y && point.y <= currentROI.y + currentROI.height) {

                    const relativeX = point.x - currentROI.x;
                    const relativeY = point.y - currentROI.y;

                    const drawX = offsetX + relativeX * scaleX;
                    const drawY = offsetY + relativeY * scaleY;

                    ctx.beginPath();
                    ctx.arc(drawX, drawY, 4, 0, 2 * Math.PI);
                    ctx.fillStyle = point.type === 'positive' ? '#00ff00' : '#ff0000';
                    ctx.fill();
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            }
        });

    }, [image, maskImage, points, currentROI]);

    return (
        <canvas
            ref={canvasRef}
            style={{
                width: "100%",
                height: "120px",
                backgroundColor: "#1a1a2e",
                borderRadius: "4px",
                border: "1px solid #666",
                objectFit: "contain"
            }}
        />
    );
};

// BrushRefinementPreview组件，用于实时预览画笔润色效果
interface BrushRefinementPreviewProps {
    image: HTMLImageElement | null;
    maskUrl: string;
    currentROI?: { x: number; y: number; width: number; height: number } | null;
    brushSize: number;
    brushMode: 'add' | 'erase';
    tempBrushEffects: Array<{
        x: number;
        y: number;
        brush_size: number;
        brush_mode: 'add' | 'erase';
    }>;
}

const BrushRefinementPreview: React.FC<BrushRefinementPreviewProps> = ({
    image,
    maskUrl,
    currentROI,
    brushSize,
    brushMode,
    tempBrushEffects
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [maskImage, setMaskImage] = useState<HTMLImageElement | null>(null);
    const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
    const [isPainting, setIsPainting] = useState(false);

    // 加载mask图片
    useEffect(() => {
        if (maskUrl) {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => setMaskImage(img);
            img.onerror = () => console.error('Failed to load mask image:', maskUrl);
            img.src = maskUrl;
        }
    }, [maskUrl]);

    // 绘制canvas内容
    const drawPreview = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || !image || !maskImage) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 设置canvas尺寸（优化预览尺寸以匹配更大的控制面板）
        const previewWidth = 500; // 增加宽度
        const previewHeight = 300; // 增加高度
        canvas.width = previewWidth;
        canvas.height = previewHeight;

        // 清空canvas
        ctx.clearRect(0, 0, previewWidth, previewHeight);

        // 计算ROI区域的缩放比例
        let sourceX = 0, sourceY = 0, sourceWidth = image.width, sourceHeight = image.height;
        if (currentROI) {
            sourceX = currentROI.x;
            sourceY = currentROI.y;
            sourceWidth = currentROI.width;
            sourceHeight = currentROI.height;
        }

        // 绘制原图（ROI区域）
        const aspectRatio = sourceWidth / sourceHeight;
        let drawWidth = previewWidth;
        let drawHeight = previewWidth / aspectRatio;

        if (drawHeight > previewHeight) {
            drawHeight = previewHeight;
            drawWidth = previewHeight * aspectRatio;
        }

        const offsetX = (previewWidth - drawWidth) / 2;
        const offsetY = (previewHeight - drawHeight) / 2;

        ctx.drawImage(
            image,
            sourceX, sourceY, sourceWidth, sourceHeight,
            offsetX, offsetY, drawWidth, drawHeight
        );

        // 绘制mask叠加 - 修复：正确处理全图尺寸的mask
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        if (tempCtx) {
            tempCanvas.width = maskImage.width;
            tempCanvas.height = maskImage.height;

            tempCtx.drawImage(maskImage, 0, 0);

            // 应用临时画笔效果到mask上进行预览
            if (tempBrushEffects.length > 0 && currentROI) {
                // 应用临时画笔效果
                tempBrushEffects.forEach((effect: {
                    x: number;
                    y: number;
                    brush_size: number;
                    brush_mode: 'add' | 'erase';
                }) => {
                    // 将ROI相对坐标(0-1)转换为mask绝对坐标
                    const maskX = currentROI.x + effect.x * currentROI.width;
                    const maskY = currentROI.y + effect.y * currentROI.height;
                    const radius = effect.brush_size;

                    tempCtx.globalCompositeOperation = effect.brush_mode === 'add' ? 'source-over' : 'destination-out';
                    tempCtx.fillStyle = effect.brush_mode === 'add' ? 'white' : 'transparent';
                    tempCtx.beginPath();
                    tempCtx.arc(maskX, maskY, radius, 0, 2 * Math.PI);
                    tempCtx.fill();
                });

                // 重置composite operation
                tempCtx.globalCompositeOperation = 'source-over';
            }

            const imageData = tempCtx.getImageData(0, 0, maskImage.width, maskImage.height);
            const data = imageData.data;

            for (let i = 0; i < data.length; i += 4) {
                if (data[i] > 50 || data[i + 1] > 50 || data[i + 2] > 50) {
                    data[i] = 135;   // R - 浅蓝色
                    data[i + 1] = 206; // G - 浅蓝色  
                    data[i + 2] = 250; // B - 浅蓝色
                    data[i + 3] = 150; // A
                } else {
                    data[i + 3] = 0;
                }
            }

            tempCtx.putImageData(imageData, 0, 0);

            ctx.globalAlpha = 0.7;
            // 修复：只绘制ROI区域的mask部分
            ctx.drawImage(
                tempCanvas,
                sourceX, sourceY, sourceWidth, sourceHeight,
                offsetX, offsetY, drawWidth, drawHeight
            );
            ctx.globalAlpha = 1.0;
        }

        // 绘制鼠标画笔预览
        if (mousePos) {
            const scaleX = drawWidth / sourceWidth;
            const scaleY = drawHeight / sourceHeight;

            ctx.beginPath();
            ctx.arc(
                offsetX + mousePos.x * scaleX,
                offsetY + mousePos.y * scaleY,
                brushSize * Math.min(scaleX, scaleY),
                0,
                2 * Math.PI
            );

            if (brushMode === 'add') {
                ctx.strokeStyle = '#00ff00';
                ctx.fillStyle = 'rgba(0, 255, 0, 0.2)';
            } else {
                ctx.strokeStyle = '#ff0000';
                ctx.fillStyle = 'rgba(255, 0, 0, 0.2)';
            }

            ctx.lineWidth = 2;
            ctx.fill();
            ctx.stroke();
        }

    }, [image, maskImage, currentROI, mousePos, brushSize, brushMode, tempBrushEffects]);

    useEffect(() => {
        drawPreview();
    }, [drawPreview]);

    // 鼠标事件处理
    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas || !currentROI) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // 转换为ROI内的相对坐标
        const previewWidth = 400;
        const previewHeight = 250;
        const aspectRatio = currentROI.width / currentROI.height;
        let drawWidth = previewWidth;
        let drawHeight = previewWidth / aspectRatio;

        if (drawHeight > previewHeight) {
            drawHeight = previewHeight;
            drawWidth = previewHeight * aspectRatio;
        }

        const offsetX = (previewWidth - drawWidth) / 2;
        const offsetY = (previewHeight - drawHeight) / 2;

        if (x >= offsetX && x <= offsetX + drawWidth && y >= offsetY && y <= offsetY + drawHeight) {
            const relativeX = (x - offsetX) / drawWidth * currentROI.width;
            const relativeY = (y - offsetY) / drawHeight * currentROI.height;
            setMousePos({ x: relativeX, y: relativeY });
        } else {
            setMousePos(null);
        }
    };

    const handleMouseLeave = () => {
        setMousePos(null);
    };

    return (
        <canvas
            ref={canvasRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            style={{
                width: "100%",
                height: "200px", // 增加高度从150px到200px，充分利用扩大的控制面板空间
                backgroundColor: "#1a1a2e",
                borderRadius: "4px",
                border: "1px solid #666",
                cursor: "crosshair"
            }}
        />
    );
};

interface ROIBox {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
    processed: boolean;
}

interface SegmentationCandidate {
    id: string;
    mask: string;
    score: number;
    bbox: [number, number, number, number];
    selected: boolean;
}

interface ProcessedElement {
    id: string;
    name: string;
    image: string;
    position: { x: number; y: number };
    scale: number;
    rotation: number;
    visible: boolean;
    published?: boolean;
    originalROI?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
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
            time: number;
            x: number;
            y: number;
            scale?: number;
            rotation?: number;
            opacity?: number;
        }>;
    };
}

export default function ControlPanel() {
    // 基础状态
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [image, setImage] = useState<HTMLImageElement | null>(null);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking');

    // 工作流状态
    const [currentStep, setCurrentStep] = useState<'upload' | 'roi_selection' | 'segmentation' | 'candidates' | 'optimization' | 'integration'>('upload');
    const [roiBoxes, setRoiBoxes] = useState<ROIBox[]>([]);
    const [currentROIIndex, setCurrentROIIndex] = useState(0);
    const [isDrawingROI, setIsDrawingROI] = useState(false);
    const [roiStart, setRoiStart] = useState<{ x: number; y: number } | null>(null);

    // 分割相关
    const [points, setPoints] = useState<Point[]>([]);
    const [candidates, setCandidates] = useState<SegmentationCandidate[]>([]);
    const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 画布和显示
    const [canvasScale, setCanvasScale] = useState(1);
    const [canvasOffset, setCanvasOffset] = useState({ x: 0, y: 0 });

    // 元素管理
    const [processedElements, setProcessedElements] = useState<ProcessedElement[]>([]);

    // 统一的投影窗口消息发送辅助（优先 Electron IPC，回退 postMessage）
    const sendProjectionMessage = useCallback((payload: any) => {
        try {
            if (typeof window !== 'undefined' && (window as any).electronAPI && (window as any).electronAPI.sendToProjection) {
                (window as any).electronAPI.sendToProjection(payload);
            } else {
                window.postMessage(payload, window.location.origin);
            }
        } catch (err) {
            console.warn('发送投影消息失败', err, payload);
        }
    }, []);

    // ROI状态持久化 - 保存每个ROI的工作状态
    const [roiStates, setRoiStates] = useState<Map<number, {
        points: Point[];
        candidates: SegmentationCandidate[];
        selectedCandidate: string | null;
        step: 'segmentation' | 'candidates' | 'optimization';
    }>>(new Map());

    // 鼠标位置状态
    const [currentMousePos, setCurrentMousePos] = useState<{ x: number; y: number } | null>(null);

    // mask图片缓存
    const [loadedMasks, setLoadedMasks] = useState<Map<string, HTMLImageElement>>(new Map());

    // 画笔润色相关状态
    const [isRefining, setIsRefining] = useState(false);
    const [brushSize, setBrushSize] = useState(12);
    const [brushMode, setBrushMode] = useState<'add' | 'erase'>('add');
    const [refinedMask, setRefinedMask] = useState<ImageData | null>(null);
    const [isPainting, setIsPainting] = useState(false);
    const [lastBrushPoint, setLastBrushPoint] = useState<{ x: number; y: number } | null>(null);
    const [brushStrokes, setBrushStrokes] = useState<Array<{
        x: number;
        y: number;
        brush_size: number;
        brush_mode: 'add' | 'erase';
    }>>([]);
    // 临时画笔效果，用于实时预览
    const [tempBrushEffects, setTempBrushEffects] = useState<Array<{
        x: number;
        y: number;
        brush_size: number;
        brush_mode: 'add' | 'erase';
    }>>([]);

    // 模态对话框状态
    const [audioModalOpen, setAudioModalOpen] = useState(false);
    const [trajectoryModalOpen, setTrajectoryModalOpen] = useState(false);
    const [selectedElementForModal, setSelectedElementForModal] = useState<ProcessedElement | null>(null);

    // ROI状态管理函数
    const saveCurrentROIState = useCallback(() => {
        if (currentStep === 'roi_selection' || currentStep === 'upload') return;

        setRoiStates(prev => {
            const newMap = new Map(prev);
            newMap.set(currentROIIndex, {
                points: [...points],
                candidates: [...candidates],
                selectedCandidate,
                step: currentStep as 'segmentation' | 'candidates' | 'optimization'
            });
            return newMap;
        });
    }, [currentROIIndex, points, candidates, selectedCandidate, currentStep]);

    const restoreROIState = useCallback((roiIndex: number) => {
        const savedState = roiStates.get(roiIndex);
        if (savedState) {
            setPoints(savedState.points);
            setCandidates(savedState.candidates);
            setSelectedCandidate(savedState.selectedCandidate);
            setCurrentStep(savedState.step);
        } else {
            // 没有保存的状态，重置为初始状态
            setPoints([]);
            setCandidates([]);
            setSelectedCandidate(null);
            setCurrentStep('segmentation');
        }
    }, [roiStates]);    // 绘制画布内容
    const drawCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (image) {
            const { width, height } = image;
            const scale = Math.min(canvas.width / width, canvas.height / height);
            const scaledWidth = width * scale;
            const scaledHeight = height * scale;
            const offsetX = (canvas.width - scaledWidth) / 2;
            const offsetY = (canvas.height - scaledHeight) / 2;

            setCanvasScale(scale);
            setCanvasOffset({ x: offsetX, y: offsetY });

            ctx.drawImage(image, offsetX, offsetY, scaledWidth, scaledHeight);

            // 绘制ROI框
            roiBoxes.forEach((roi, index) => {
                const scaledX = offsetX + roi.x * scale;
                const scaledY = offsetY + roi.y * scale;
                const scaledWidth = roi.width * scale;
                const scaledHeight = roi.height * scale;

                // ROI框
                ctx.strokeStyle = index === currentROIIndex ? '#00ff00' : roi.processed ? '#0080ff' : '#ff8800';
                ctx.lineWidth = 2;
                ctx.strokeRect(scaledX, scaledY, scaledWidth, scaledHeight);

                // ROI标签
                ctx.fillStyle = index === currentROIIndex ? '#00ff00' : roi.processed ? '#0080ff' : '#ff8800';
                ctx.font = '12px Arial';
                ctx.fillText(`${index + 1}. ${roi.label}`, scaledX, scaledY - 5);
            });

            // 绘制当前选中候选的mask（如果有）
            if (selectedCandidate && candidates.length > 0) {
                const selectedCandidateData = candidates.find(c => c.id === selectedCandidate);
                if (selectedCandidateData?.mask && currentROIIndex < roiBoxes.length) {
                    const currentROI = roiBoxes[currentROIIndex];

                    // 使用预加载的mask图片
                    const maskKey = `mask_${selectedCandidate}`;
                    const cachedMask = loadedMasks.get(maskKey);

                    if (cachedMask) {
                        // 创建一个临时canvas来处理mask颜色
                        const tempCanvas = document.createElement('canvas');
                        const tempCtx = tempCanvas.getContext('2d');
                        if (tempCtx) {
                            tempCanvas.width = cachedMask.width;
                            tempCanvas.height = cachedMask.height;

                            // 绘制mask
                            tempCtx.drawImage(cachedMask, 0, 0);

                            // 获取mask数据并应用半透明绿色
                            const imageData = tempCtx.getImageData(0, 0, cachedMask.width, cachedMask.height);
                            const data = imageData.data;

                            for (let i = 0; i < data.length; i += 4) {
                                // 如果像素不是纯黑色（即是mask区域）
                                if (data[i] > 50 || data[i + 1] > 50 || data[i + 2] > 50) {
                                    data[i] = 135;   // R - 浅蓝色
                                    data[i + 1] = 206; // G - 浅蓝色  
                                    data[i + 2] = 250; // B - 浅蓝色
                                    data[i + 3] = 150; // A - 透明度
                                } else {
                                    data[i + 3] = 0; // 完全透明
                                }
                            }

                            tempCtx.putImageData(imageData, 0, 0);

                            // 关键修复：mask图片是全图尺寸，需要按照原图比例绘制，而不是只绘制到ROI区域
                            // mask图片尺寸应该与原图一致，按照与原图相同的缩放比例绘制
                            ctx.globalAlpha = 0.6;
                            ctx.drawImage(tempCanvas, offsetX, offsetY, scaledWidth, scaledHeight);
                            ctx.globalAlpha = 1.0;
                        }
                    }
                }
            }

            // 绘制当前ROI的标注点
            if (currentROIIndex < roiBoxes.length) {
                const currentROI = roiBoxes[currentROIIndex];
                points.forEach((point, index) => {
                    // 检查点是否在当前ROI内
                    if (point.x >= currentROI.x && point.x <= currentROI.x + currentROI.width &&
                        point.y >= currentROI.y && point.y <= currentROI.y + currentROI.height) {
                        const scaledX = offsetX + point.x * scale;
                        const scaledY = offsetY + point.y * scale;

                        ctx.beginPath();
                        ctx.arc(scaledX, scaledY, 6, 0, 2 * Math.PI);
                        ctx.fillStyle = point.type === 'positive' ? '#00ff00' : '#ff0000';
                        ctx.fill();
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 2;
                        ctx.stroke();

                        ctx.fillStyle = '#ffffff';
                        ctx.font = '12px Arial';
                        ctx.textAlign = 'center';
                        ctx.fillText((index + 1).toString(), scaledX, scaledY - 10);
                    }
                });
            }

            // 绘制正在创建的ROI
            if (isDrawingROI && roiStart && currentMousePos) {
                const startX = offsetX + roiStart.x * scale;
                const startY = offsetY + roiStart.y * scale;
                const currentX = offsetX + currentMousePos.x * scale;
                const currentY = offsetY + currentMousePos.y * scale;

                const width = currentX - startX;
                const height = currentY - startY;

                // 绘制预览ROI框
                ctx.strokeStyle = '#ffff00';
                ctx.setLineDash([5, 5]);
                ctx.lineWidth = 2;
                ctx.strokeRect(startX, startY, width, height);
                ctx.setLineDash([]); // 重置线段样式

                // 显示尺寸信息
                ctx.fillStyle = '#ffff00';
                ctx.font = '12px Arial';
                ctx.fillText(
                    `${Math.abs(Math.round(width / scale))}×${Math.abs(Math.round(height / scale))}`,
                    startX,
                    startY - 10
                );
            }
        } else {
            ctx.fillStyle = '#666666';
            ctx.font = '24px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('上传图像开始工作流', canvas.width / 2, canvas.height / 2);
        }
    }, [image, roiBoxes, currentROIIndex, points, isDrawingROI, roiStart, currentMousePos, loadedMasks, selectedCandidate, candidates]);

    // 确保在相关状态更新后自动重绘（初次上传/切换ROI/新增点/加载mask 等）
    useEffect(() => {
        drawCanvas();
    }, [drawCanvas]);

    // 处理文件上传
    const handleFileSelect = useCallback((file: File) => {
        if (!file.type.startsWith('image/')) {
            setError('请选择有效的图片文件');
            return;
        }

        setError(null);
        setImageFile(file);
        setRoiBoxes([]);
        setPoints([]);
        setCandidates([]);
        setCurrentStep('roi_selection');

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                setImage(img);
                // 图像加载完成后马上重绘
                requestAnimationFrame(() => drawCanvas());
            };
            img.src = e.target?.result as string;
        };
        reader.readAsDataURL(file);
    }, [drawCanvas]);

    // 处理画布鼠标事件
    const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!image) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const imageX = (x - canvasOffset.x) / canvasScale;
        const imageY = (y - canvasOffset.y) / canvasScale;

        if (imageX < 0 || imageX > image.width || imageY < 0 || imageY > image.height) {
            return;
        }

        if (currentStep === 'roi_selection') {
            setIsDrawingROI(true);
            setRoiStart({ x: imageX, y: imageY });
        } else if (currentStep === 'segmentation' || currentStep === 'candidates' || currentStep === 'optimization') {
            // 检查是否点击了其他ROI框来切换
            let clickedROIIndex = -1;
            for (let i = 0; i < roiBoxes.length; i++) {
                const roi = roiBoxes[i];
                if (imageX >= roi.x && imageX <= roi.x + roi.width &&
                    imageY >= roi.y && imageY <= roi.y + roi.height) {
                    clickedROIIndex = i;
                    break;
                }
            }

            if (clickedROIIndex !== -1 && clickedROIIndex !== currentROIIndex) {
                // 切换ROI
                saveCurrentROIState();
                setCurrentROIIndex(clickedROIIndex);
                restoreROIState(clickedROIIndex);
            } else if (currentStep === 'segmentation') {
                // 在当前ROI内添加点
                const pointType = e.button === 2 ? 'negative' : 'positive';
                const newPoint: Point = { x: imageX, y: imageY, type: pointType };
                setPoints(prev => [...prev, newPoint]);
            }
        }
    }, [image, canvasOffset, canvasScale, currentStep, roiBoxes, currentROIIndex, saveCurrentROIState, restoreROIState]);

    // 处理鼠标移动事件
    const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!image) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const imageX = (x - canvasOffset.x) / canvasScale;
        const imageY = (y - canvasOffset.y) / canvasScale;

        // 更新当前鼠标位置
        setCurrentMousePos({ x: imageX, y: imageY });
    }, [image, canvasOffset, canvasScale]);

    const handleCanvasMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!image || !isDrawingROI || !roiStart) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const imageX = (x - canvasOffset.x) / canvasScale;
        const imageY = (y - canvasOffset.y) / canvasScale;

        // 确保ROI在图像边界内
        const constrainedX = Math.max(0, Math.min(imageX, image.width));
        const constrainedY = Math.max(0, Math.min(imageY, image.height));
        const constrainedStartX = Math.max(0, Math.min(roiStart.x, image.width));
        const constrainedStartY = Math.max(0, Math.min(roiStart.y, image.height));

        const width = Math.abs(constrainedX - constrainedStartX);
        const height = Math.abs(constrainedY - constrainedStartY);

        // 只有当ROI有足够大小时才添加
        if (width > 10 && height > 10) {
            const newROI: ROIBox = {
                id: `roi-${Date.now()}`,
                x: Math.min(constrainedStartX, constrainedX),
                y: Math.min(constrainedStartY, constrainedY),
                width: width,
                height: height,
                label: `区域${roiBoxes.length + 1}`,
                processed: false
            };

            setRoiBoxes(prev => [...prev, newROI]);

            // 如果这是第一个ROI，自动进入分割模式
            if (roiBoxes.length === 0) {
                setCurrentStep('segmentation');
            }
        }

        setIsDrawingROI(false);
        setRoiStart(null);
    }, [image, isDrawingROI, roiStart, canvasOffset, canvasScale, roiBoxes.length]);

    // 执行分割
    const performSegmentation = useCallback(async () => {
        if (!imageFile || points.length === 0 || currentROIIndex >= roiBoxes.length) {
            setError('请确保已选择ROI区域并添加标注点');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            // 获取当前ROI的坐标
            const currentROI = roiBoxes[currentROIIndex];

            const response = await apiService.performSegmentation({
                file: imageFile,
                points: points,
                roiBox: currentROI // 传递ROI坐标给后端
            });

            if (response.success && response.data) {
                // 保存sessionId供后续使用
                setSessionId(response.data.session_id);

                // 将后端返回的masks转换为candidates
                const newCandidates: SegmentationCandidate[] = response.data.masks.map((mask, index) => ({
                    id: mask.mask_id,
                    mask: `http://localhost:7001/sam/mask/${response.data!.session_id}/${mask.mask_id}`, // 构建mask图片URL
                    score: mask.score,
                    bbox: [0, 0, response.data!.width, response.data!.height], // 使用图片尺寸作为默认bbox
                    selected: index === 0 // 默认选中第一个
                }));

                setCandidates(newCandidates);

                // 预加载mask图片
                newCandidates.forEach(candidate => {
                    const maskKey = `mask_${candidate.id}`;
                    if (!loadedMasks.has(maskKey)) {
                        const img = new Image();
                        img.crossOrigin = "anonymous";
                        img.onload = () => {
                            setLoadedMasks(prev => {
                                const newMap = new Map(prev);
                                newMap.set(maskKey, img);
                                return newMap;
                            });
                            // 重绘canvas以显示新加载的mask
                            drawCanvas();
                        };
                        img.onerror = () => {
                            console.error('Failed to load mask:', candidate.mask);
                        };
                        img.src = candidate.mask;
                    }
                });

                setCurrentStep('candidates');
            } else {
                setError(response.error || '分割处理失败');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : '分割处理失败');
        } finally {
            setIsLoading(false);
        }
    }, [imageFile, points, currentROIIndex, roiBoxes.length]);

    // 下一个ROI
    const nextROI = useCallback(() => {
        if (currentROIIndex < roiBoxes.length - 1) {
            // 保存当前ROI状态
            saveCurrentROIState();

            // 标记当前ROI为已处理（如果有选中的候选）
            if (selectedCandidate) {
                setRoiBoxes(prev => prev.map((roi, index) =>
                    index === currentROIIndex ? { ...roi, processed: true } : roi
                ));
            }

            // 切换到下一个ROI并恢复其状态
            const nextIndex = currentROIIndex + 1;
            setCurrentROIIndex(nextIndex);
            restoreROIState(nextIndex);
        }
    }, [currentROIIndex, roiBoxes.length, selectedCandidate, saveCurrentROIState, restoreROIState]);

    // 上一个ROI
    const prevROI = useCallback(() => {
        if (currentROIIndex > 0) {
            // 保存当前ROI状态
            saveCurrentROIState();

            // 切换到上一个ROI并恢复其状态
            const prevIndex = currentROIIndex - 1;
            setCurrentROIIndex(prevIndex);
            restoreROIState(prevIndex);
        }
    }, [currentROIIndex, saveCurrentROIState, restoreROIState]);

    // 完成当前ROI的处理
    const finishCurrentROI = useCallback(async () => {
        if (!selectedCandidate || currentROIIndex >= roiBoxes.length || !sessionId) return;

        setIsLoading(true);
        setError(null);

        const currentROI = roiBoxes[currentROIIndex];
        const candidate = candidates.find(c => c.id === selectedCandidate);

        if (!candidate) {
            setIsLoading(false);
            return;
        }

        try {
            // 不再从canvas获取mask，因为如果用户使用了画笔精细化，
            // selectedCandidate已经是refined mask的ID，后端会使用正确的mask
            console.log('导出ROI - 当前候选:', candidate.id, '当前ROI:', currentROI);

            // 调用导出API - 传递选中的mask ID和ROI坐标
            const exportResult = await apiService.exportROI(
                sessionId,
                candidate.id,  // 这里已经是refined mask ID（如果用户使用了画笔）
                currentROIIndex + 1,
                undefined,     // 不传递maskPngB64，让后端使用mask_id
                currentROI     // 传递ROI坐标信息
            );

            if (!exportResult.success) {
                setError(exportResult.error || '导出失败');
                setIsLoading(false);
                return;
            }

            // 标记为已处理
            setRoiBoxes(prev => prev.map((roi, index) =>
                index === currentROIIndex ? { ...roi, processed: true } : roi
            ));

            // 创建处理后的元素
            const newElement: ProcessedElement = {
                id: `element-${Date.now()}`,
                name: `${currentROI.label}_元素`,
                // 将文件系统路径转换为HTTP URL
                image: exportResult.spritePath ?
                    `http://localhost:7001/files/${exportResult.spritePath.split(/[/\\]/).pop()}` :
                    candidate.mask,
                position: {
                    // 使用原图的绝对坐标系统，而不是ROI的相对坐标
                    x: currentROI.x + currentROI.width / 2,
                    y: currentROI.y + currentROI.height / 2
                },
                scale: 1.0,
                rotation: 0,
                visible: true,
                // 添加ROI信息用于舞台渲染
                originalROI: {
                    x: currentROI.x,
                    y: currentROI.y,
                    width: currentROI.width,
                    height: currentROI.height
                }
            };

            setProcessedElements(prev => [...prev, newElement]);

            // 重置画笔状态
            if (isRefining) {
                setIsRefining(false);
                setRefinedMask(null);
                setLastBrushPoint(null);
                setIsPainting(false);
            }

            // 移动到下一个ROI或完成
            if (currentROIIndex < roiBoxes.length - 1) {
                nextROI();
            } else {
                setCurrentStep('integration');
            }

            console.log('ROI处理完成，文件已保存到:', exportResult.spritePath);
        } catch (err) {
            setError(err instanceof Error ? err.message : '处理失败');
        } finally {
            setIsLoading(false);
        }
    }, [selectedCandidate, currentROIIndex, roiBoxes, candidates, sessionId, isRefining, refinedMask, nextROI]);

    // 删除ROI
    const deleteROI = useCallback((index: number) => {
        setRoiBoxes(prev => prev.filter((_, i) => i !== index));

        // 调整当前索引
        if (index <= currentROIIndex && currentROIIndex > 0) {
            setCurrentROIIndex(prev => prev - 1);
        } else if (index < currentROIIndex) {
            // 不需要调整
        } else if (index === currentROIIndex && index === roiBoxes.length - 1) {
            setCurrentROIIndex(Math.max(0, roiBoxes.length - 2));
        }

        setPoints([]);
        setCandidates([]);
        setSelectedCandidate(null);
    }, [currentROIIndex, roiBoxes.length]);

    // 重置整个工作流
    const resetWorkflow = useCallback(() => {
        setRoiBoxes([]);
        setPoints([]);
        setCandidates([]);
        setSelectedCandidate(null);
        setCurrentROIIndex(0);
        setCurrentStep('roi_selection');
        setProcessedElements([]);
        setError(null);
    }, []);

    // 画笔润色功能
    const startRefining = useCallback(() => {
        if (!selectedCandidate) return;

        setIsRefining(true);
        setCurrentStep('optimization');

        // 加载选中的candidate mask到画布进行编辑
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 获取当前画布的ImageData作为基础
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        setRefinedMask(imageData);
    }, [selectedCandidate]);

    const stopRefining = useCallback(() => {
        setIsRefining(false);
        setRefinedMask(null);
        setLastBrushPoint(null);
        setIsPainting(false);
        setTempBrushEffects([]); // 清除临时效果
        setCurrentStep('candidates');
    }, []);

    const applyBrushStroke = useCallback((x: number, y: number) => {
        const canvas = canvasRef.current;
        if (!canvas || !isRefining || !image || currentROIIndex >= roiBoxes.length) return;

        const currentROI = roiBoxes[currentROIIndex];
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 计算原图坐标
        const imageX = (x - canvasOffset.x) / canvasScale;
        const imageY = (y - canvasOffset.y) / canvasScale;

        if (imageX < 0 || imageX > image.width ||
            imageY < 0 || imageY > image.height) {
            return;
        }

        // 绘制画笔效果（视觉反馈）
        ctx.save();
        ctx.globalCompositeOperation = brushMode === 'add' ? 'source-over' : 'destination-out';
        ctx.fillStyle = brushMode === 'add' ? 'rgba(255, 255, 0, 0.5)' : 'rgba(255, 255, 255, 1)';

        const scaledBrushSize = brushSize * canvasScale;
        const canvasX = canvasOffset.x + imageX * canvasScale;
        const canvasY = canvasOffset.y + imageY * canvasScale;

        ctx.beginPath();
        ctx.arc(canvasX, canvasY, scaledBrushSize, 0, 2 * Math.PI);
        ctx.fill();
        ctx.restore();

        // 如果有上一个点，绘制连线
        if (lastBrushPoint) {
            const lastCanvasX = canvasOffset.x + lastBrushPoint.x * canvasScale;
            const lastCanvasY = canvasOffset.y + lastBrushPoint.y * canvasScale;

            ctx.save();
            ctx.globalCompositeOperation = brushMode === 'add' ? 'source-over' : 'destination-out';
            ctx.strokeStyle = brushMode === 'add' ? 'rgba(255, 255, 0, 0.5)' : 'rgba(255, 255, 255, 1)';
            ctx.lineWidth = scaledBrushSize * 2;
            ctx.lineCap = 'round';

            ctx.beginPath();
            ctx.moveTo(lastCanvasX, lastCanvasY);
            ctx.lineTo(canvasX, canvasY);
            ctx.stroke();
            ctx.restore();
        }

        // 记录画笔操作（相对于ROI的归一化坐标）
        const roiRelativeX = imageX - currentROI.x;
        const roiRelativeY = imageY - currentROI.y;

        // 检查是否在ROI范围内
        if (roiRelativeX < 0 || roiRelativeX > currentROI.width ||
            roiRelativeY < 0 || roiRelativeY > currentROI.height) {
            return;
        }

        const normalizedStroke = {
            x: roiRelativeX / currentROI.width,  // 相对于ROI的归一化坐标
            y: roiRelativeY / currentROI.height,
            brush_size: brushSize / Math.max(currentROI.width, currentROI.height), // 相对于ROI的归一化画笔大小
            brush_mode: brushMode
        };

        setBrushStrokes(prev => [...prev, normalizedStroke]);
        setTempBrushEffects(prev => [...prev, normalizedStroke]); // 同时更新临时效果用于实时预览
        setLastBrushPoint({ x: imageX, y: imageY });
    }, [isRefining, canvasOffset, canvasScale, brushSize, brushMode, lastBrushPoint, image, currentROIIndex, roiBoxes]);

    const handleBrushMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isRefining) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        setIsPainting(true);
        setLastBrushPoint(null);
        applyBrushStroke(x, y);
    }, [isRefining, applyBrushStroke]);

    const handleBrushMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isRefining || !isPainting) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        applyBrushStroke(x, y);
    }, [isRefining, isPainting, applyBrushStroke]);

    const handleBrushMouseUp = useCallback(() => {
        if (!isRefining) return;

        setIsPainting(false);
        setLastBrushPoint(null);
    }, [isRefining]);

    // 应用画笔删补到后端
    const applyBrushRefinement = useCallback(async () => {
        if (!sessionId || !selectedCandidate || brushStrokes.length === 0 || currentROIIndex >= roiBoxes.length) {
            setError('无法应用画笔删补：缺少必要数据');
            return;
        }

        const currentROI = roiBoxes[currentROIIndex];
        setIsLoading(true);
        try {
            const response = await apiService.brushRefinement({
                sessionId,
                maskId: selectedCandidate,
                strokes: brushStrokes,
                roiBox: currentROI  // 传递ROI坐标信息
            });

            if (response.success && response.data) {
                // 更新当前选中的候选，使用refined mask
                const updatedCandidates = candidates.map(candidate =>
                    candidate.id === selectedCandidate
                        ? {
                            ...candidate,
                            id: response.data!.refined_mask_id,
                            mask: `http://localhost:7001/sam/mask/${sessionId}/${response.data!.refined_mask_id}`
                        }
                        : candidate
                );

                setCandidates(updatedCandidates);
                setSelectedCandidate(response.data.refined_mask_id);
                setBrushStrokes([]); // 清空画笔操作记录
                setTempBrushEffects([]); // 清空临时预览效果

                // 预加载新的refined mask
                const maskKey = `mask_${response.data.refined_mask_id}`;
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => {
                    setLoadedMasks(prev => {
                        const newMap = new Map(prev);
                        newMap.set(maskKey, img);
                        return newMap;
                    });
                    drawCanvas();
                };
                img.src = `http://localhost:7001/sam/mask/${sessionId}/${response.data.refined_mask_id}`;

                console.log('画笔删补完成，新mask ID:', response.data.refined_mask_id);
            } else {
                setError(response.error || '画笔删补失败');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : '画笔删补失败');
        } finally {
            setIsLoading(false);
        }
    }, [sessionId, selectedCandidate, brushStrokes, candidates, drawCanvas, currentROIIndex, roiBoxes]);



    // 打开音效配置对话框
    const openAudioModal = useCallback((element: ProcessedElement) => {
        setSelectedElementForModal(element);
        setAudioModalOpen(true);
    }, []);

    // 打开轨迹编辑器
    const openTrajectoryModal = useCallback((element: ProcessedElement) => {
        setSelectedElementForModal(element);
        setTrajectoryModalOpen(true);
    }, []);

    // 更新元素音效配置（统一通过 sendProjectionMessage 通知投影窗口）
    const updateElementAudio = useCallback((audioConfig: any) => {
        if (!selectedElementForModal) return;
        setProcessedElements(prev => prev.map(el => el.id === selectedElementForModal.id ? { ...el, audio: audioConfig } : el));
        sendProjectionMessage({ type: 'UPDATE_ELEMENT', data: { id: selectedElementForModal.id, audio: audioConfig } });
    }, [selectedElementForModal, sendProjectionMessage]);

    // 更新元素轨迹配置
    const updateElementTrajectory = useCallback((trajectoryConfig: any) => {
        if (!selectedElementForModal) return;
        // 如果关键帧有效，立即启动动画并设置开始时间
        const hasValidKeyframes = Array.isArray(trajectoryConfig?.keyframes) && trajectoryConfig.keyframes.length >= 2;
        const mergedTrajectory = {
            ...trajectoryConfig,
            isAnimating: hasValidKeyframes ? true : !!trajectoryConfig?.isAnimating,
            startTime: hasValidKeyframes ? Date.now() : (trajectoryConfig?.startTime ?? 0)
        };
        setProcessedElements(prev => prev.map(el => el.id === selectedElementForModal.id ? { ...el, trajectory: mergedTrajectory } : el));
        sendProjectionMessage({ type: 'UPDATE_ELEMENT', data: { id: selectedElementForModal.id, trajectory: mergedTrajectory } });
    }, [selectedElementForModal, sendProjectionMessage]);

    // 服务器状态检查（修复位置：不嵌套在错误的回调内部）
    useEffect(() => {
        const checkServerStatus = async () => {
            const isOnline = await apiService.healthCheck();
            setServerStatus(isOnline ? 'online' : 'offline');
        };
        checkServerStatus();
        const interval = setInterval(checkServerStatus, 30000);
        return () => clearInterval(interval);
    }, []);

    // -------------------- 渲染 --------------------
    return (
        <div style={{
            width: '100vw', height: '100vh', backgroundColor: '#1a1a2e', color: 'white', display: 'flex', flexDirection: 'column'
        }}>
            {/* 顶部工具栏 */}
            <div style={{ padding: 15, backgroundColor: '#2a2a3e', borderBottom: '2px solid #4a4a6e', display: 'flex', alignItems: 'center', gap: 15, flexWrap: 'wrap', flexShrink: 0 }}>
                <h2 style={{ margin: 0 }}>🎨 Interactive Forest 控制台</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', backgroundColor: serverStatus === 'online' ? '#4CAF50' : serverStatus === 'offline' ? '#f44336' : '#FF9800', borderRadius: 15, fontSize: 12 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'white' }} />
                    {serverStatus === 'checking' ? '检查中...' : serverStatus === 'online' ? 'SAM在线' : 'SAM离线'}
                </div>
                <div style={{ display: 'flex', gap: 10, marginLeft: 'auto' }}>
                    {['upload', 'roi_selection', 'segmentation', 'candidates', 'optimization', 'integration'].map((step, index) => (
                        <div key={step} style={{ padding: '4px 12px', borderRadius: 15, fontSize: 11, backgroundColor: currentStep === step ? '#2196F3' : '#555', border: currentStep === step ? '2px solid #64B5F6' : '1px solid #777' }}>
                            {index + 1}. {step === 'upload' ? '上传' : step === 'roi_selection' ? 'ROI选择' : step === 'segmentation' ? '分割' : step === 'candidates' ? '候选' : step === 'optimization' ? '优化' : '集成'}
                        </div>
                    ))}
                </div>
            </div>
            {/* 主体区域 */}
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
                {/* 左侧画布 */}
                <div style={{ width: '55%', padding: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a2e' }}>
                    <div style={{ position: 'relative' }}>
                        <canvas
                            ref={canvasRef}
                            // 动态尺寸：初次挂载后用JS设置真实像素尺寸以获得清晰绘制
                            width={600}
                            height={420}
                            onMouseDown={isRefining ? handleBrushMouseDown : handleCanvasMouseDown}
                            onMouseMove={isRefining ? handleBrushMouseMove : handleCanvasMouseMove}
                            onMouseUp={isRefining ? handleBrushMouseUp : handleCanvasMouseUp}
                            onContextMenu={(e) => e.preventDefault()}
                            style={{
                                border: '2px solid #666', borderRadius: 8, backgroundColor: '#2a2a3e', cursor: isRefining ? 'crosshair' : currentStep === 'roi_selection' ? 'crosshair' : currentStep === 'segmentation' ? 'pointer' : 'default'
                            }}
                        />
                        {currentStep === 'upload' && (
                            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
                                <div style={{ fontSize: 24, marginBottom: 10 }}>📁</div>
                                <div>拖拽图片到这里或点击上传</div>
                            </div>
                        )}
                    </div>
                </div>
                {/* 中间控制面板 */}
                <div style={{ width: '45%', backgroundColor: '#2a2a3e', borderLeft: '2px solid #4a4a6e', display: 'flex', flexDirection: 'column', minWidth: 400, overflow: 'hidden' }}>
                    <div style={{ padding: 15, borderBottom: '1px solid #4a4a6e', flexShrink: 0 }}>
                        <input ref={fileInputRef} type='file' accept='image/*' onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])} style={{ display: 'none' }} />
                        <button onClick={() => fileInputRef.current?.click()} style={{ width: '100%', padding: 12, backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}>📁 选择图片</button>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                        {/* ROI管理 */}
                        {roiBoxes.length > 0 && (
                            <div style={{ padding: 15, borderBottom: '1px solid #4a4a6e' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                    <h4>📦 ROI区域管理</h4>
                                    <button onClick={resetWorkflow} style={{ padding: '4px 8px', backgroundColor: '#f44336', color: 'white', border: 'none', borderRadius: 4, fontSize: 10, cursor: 'pointer' }}>🔄 重置</button>
                                </div>
                                <div style={{ marginBottom: 10 }}>
                                    <span>当前区域: {currentROIIndex + 1}/{roiBoxes.length}</span>
                                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                        <button onClick={prevROI} disabled={currentROIIndex === 0} style={{ padding: '6px 12px', backgroundColor: currentROIIndex === 0 ? '#666' : '#2196F3', color: 'white', border: 'none', borderRadius: 4, cursor: currentROIIndex === 0 ? 'not-allowed' : 'pointer', fontSize: 12 }}>⬅️ 上一个</button>
                                        <button onClick={nextROI} disabled={currentROIIndex === roiBoxes.length - 1} style={{ padding: '6px 12px', backgroundColor: currentROIIndex === roiBoxes.length - 1 ? '#666' : '#2196F3', color: 'white', border: 'none', borderRadius: 4, cursor: currentROIIndex === roiBoxes.length - 1 ? 'not-allowed' : 'pointer', fontSize: 12 }}>下一个 ➡️</button>
                                        {currentStep === 'segmentation' && (
                                            <button onClick={() => setCurrentStep('roi_selection')} style={{ padding: '6px 12px', backgroundColor: '#FF9800', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>➕ 添加ROI</button>
                                        )}
                                    </div>
                                </div>
                                <div style={{ maxHeight: 120, overflowY: 'auto' }}>
                                    {roiBoxes.map((roi, index) => (
                                        <div key={roi.id} onClick={() => setCurrentROIIndex(index)} style={{ padding: 8, margin: '4px 0', backgroundColor: index === currentROIIndex ? '#4CAF50' : roi.processed ? '#2196F3' : '#666', borderRadius: 4, fontSize: 12, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span>{index + 1}. {roi.label} ({Math.round(roi.width)}×{Math.round(roi.height)}) {roi.processed && '✅'}</span>
                                            <button onClick={(e) => { e.stopPropagation(); deleteROI(index); }} style={{ background: 'rgba(244,67,54,0.8)', border: 'none', color: 'white', padding: '2px 6px', borderRadius: 3, fontSize: 10, cursor: 'pointer' }}>🗑️</button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {/* 分割控制 */}
                        {currentStep === 'segmentation' && (
                            <div style={{ padding: 15, borderBottom: '1px solid #4a4a6e' }}>
                                <h4>✂️ 分割控制</h4>
                                <p style={{ fontSize: 12, color: '#ccc', marginBottom: 10 }}>左键: 正向点 ✅ | 右键: 负向点 ❌<br />标注点数: {points.length} | 正向: {points.filter(p => p.type === 'positive').length} | 负向: {points.filter(p => p.type === 'negative').length}</p>
                                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                                    <button onClick={performSegmentation} disabled={points.length === 0 || isLoading || serverStatus !== 'online'} style={{ flex: 1, padding: 10, backgroundColor: points.length > 0 && serverStatus === 'online' ? '#4CAF50' : '#666', color: 'white', border: 'none', borderRadius: 4, cursor: points.length > 0 && serverStatus === 'online' ? 'pointer' : 'not-allowed', fontWeight: 'bold' }}>{isLoading ? '🔄 处理中...' : '✂️ 开始分割'}</button>
                                    <button onClick={() => setPoints([])} disabled={points.length === 0} style={{ padding: 10, backgroundColor: points.length > 0 ? '#FF9800' : '#666', color: 'white', border: 'none', borderRadius: 4, cursor: points.length > 0 ? 'pointer' : 'not-allowed' }}>🗑️</button>
                                </div>
                                {points.length > 0 && (
                                    <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                                        <button onClick={() => setPoints(prev => prev.slice(0, -1))} style={{ flex: 1, padding: '6px 12px', backgroundColor: '#FF5722', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>↶ 撤销最后一个点</button>
                                    </div>
                                )}
                                <div style={{ fontSize: 10, color: '#aaa', backgroundColor: 'rgba(255,255,255,0.05)', padding: 8, borderRadius: 4, marginTop: 8 }}>💡 分割技巧：<br />• 在目标物体内部添加正向点<br />• 在背景区域添加负向点<br />• 边界不清晰时多添加几个点</div>
                            </div>
                        )}
                        {/* 候选结果 */}
                        {candidates.length > 0 && (
                            <div style={{ padding: 15, borderBottom: '1px solid #4a4a6e' }}>
                                <h4>🎯 分割候选结果</h4>
                                {candidates.map((candidate, index) => (
                                    <div key={candidate.id} onClick={() => setSelectedCandidate(candidate.id)} style={{ padding: 10, margin: '8px 0', backgroundColor: selectedCandidate === candidate.id ? '#4CAF50' : '#444', borderRadius: 6, cursor: 'pointer', border: selectedCandidate === candidate.id ? '2px solid #66BB6A' : '1px solid #666' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                            <span style={{ fontWeight: 'bold' }}>候选 {index + 1}</span>
                                            {selectedCandidate === candidate.id && <span style={{ color: '#66BB6A' }}>✓ 已选择</span>}
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#ccc', marginBottom: 6 }}>
                                            <span>置信度: {(candidate.score * 100).toFixed(1)}%</span>
                                            <span>边界: [{candidate.bbox.map(b => Math.round(b)).join(',')}]</span>
                                        </div>
                                        {candidate.mask && <CandidatePreview image={image} maskUrl={candidate.mask} points={points} currentROI={roiBoxes[currentROIIndex]} />}
                                    </div>
                                ))}
                                <div style={{ display: 'flex', gap: 8, marginTop: 15 }}>
                                    <button onClick={finishCurrentROI} disabled={!selectedCandidate} style={{ flex: 1, padding: 12, backgroundColor: selectedCandidate ? '#4CAF50' : '#666', color: 'white', border: 'none', borderRadius: 4, cursor: selectedCandidate ? 'pointer' : 'not-allowed', fontWeight: 'bold' }}>✅ 确认并添加到舞台</button>
                                    <button onClick={startRefining} disabled={!selectedCandidate} style={{ padding: 12, backgroundColor: selectedCandidate ? '#9C27B0' : '#666', color: 'white', border: 'none', borderRadius: 4, cursor: selectedCandidate ? 'pointer' : 'not-allowed' }}>🖌️ 画笔润色</button>
                                    <button onClick={() => setCurrentStep('segmentation')} style={{ padding: 12, backgroundColor: '#FF9800', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>🔄 重新分割</button>
                                </div>
                            </div>
                        )}
                        {/* 画笔润色 */}
                        {isRefining && (
                            <div style={{ padding: 15, borderBottom: '1px solid #4a4a6e', backgroundColor: '#2a2a3e' }}>
                                <h4>🖌️ 画笔润色工具</h4>
                                <div style={{ marginBottom: 15 }}>
                                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                                        <span style={{ fontSize: 12 }}>模式:</span>
                                        <button onClick={() => setBrushMode('add')} style={{ padding: '6px 12px', backgroundColor: brushMode === 'add' ? '#4CAF50' : '#666', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>➕ 添加</button>
                                        <button onClick={() => setBrushMode('erase')} style={{ padding: '6px 12px', backgroundColor: brushMode === 'erase' ? '#f44336' : '#666', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>✂️ 擦除</button>
                                    </div>
                                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                                        <span style={{ fontSize: 12 }}>画笔大小:</span>
                                        <input type='range' min='5' max='50' value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} style={{ flex: 1 }} />
                                        <span style={{ fontSize: 11, width: 30 }}>{brushSize}px</span>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                                    <button onClick={applyBrushRefinement} disabled={isLoading || brushStrokes.length === 0} style={{ flex: 1, padding: 8, backgroundColor: brushStrokes.length > 0 ? '#FF9800' : '#666', color: 'white', border: 'none', borderRadius: 4, cursor: brushStrokes.length > 0 ? 'pointer' : 'not-allowed', fontSize: 12 }}>🎯 应用删补 ({brushStrokes.length})</button>
                                    <button onClick={() => setBrushStrokes([])} disabled={brushStrokes.length === 0} style={{ padding: 8, backgroundColor: '#666', color: 'white', border: 'none', borderRadius: 4, cursor: brushStrokes.length > 0 ? 'pointer' : 'not-allowed', fontSize: 12 }}>🔄 清除</button>
                                </div>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button onClick={finishCurrentROI} style={{ flex: 1, padding: 10, backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold' }}>✅ 完成润色</button>
                                    <button onClick={stopRefining} style={{ padding: 10, backgroundColor: '#666', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>❌ 取消</button>
                                </div>
                                <div style={{ fontSize: 11, color: '#aaa', marginTop: 10 }}>💡 左键拖动添加区域，右键拖动擦除区域</div>
                            </div>
                        )}
                    </div>
                </div>
                {/* 右侧元素列表 */}
                <div style={{ width: '20%', backgroundColor: '#1f1f33', display: 'flex', flexDirection: 'column', minWidth: 260, overflow: 'hidden' }}>
                    <div style={{ padding: 15, borderBottom: '2px solid #4a4a6e', backgroundColor: '#2a2a3e', flexShrink: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h4 style={{ margin: 0 }}>🎭 舞台元素</h4>
                            {processedElements.length > 0 && (
                                <button onClick={() => { processedElements.forEach(el => sendProjectionMessage({ type: 'REMOVE_ELEMENT', data: { id: el.id } })); setProcessedElements([]); }} style={{ padding: '4px 8px', backgroundColor: '#f44336', color: 'white', border: 'none', borderRadius: 4, fontSize: 10, cursor: 'pointer' }}>🗑️ 清空舞台</button>
                            )}
                        </div>
                    </div>
                    <div style={{ flex: 1, padding: 15, overflowY: 'auto' }}>
                        {processedElements.length === 0 ? (
                            <div style={{ textAlign: 'center', color: '#666', fontSize: 12, padding: 20, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 6, border: '1px dashed #666' }}>
                                <div style={{ fontSize: 24, marginBottom: 10 }}>🎭</div>
                                <div>暂无舞台元素</div>
                                <div style={{ fontSize: 10, marginTop: 5 }}>完成图像分割后元素将出现在这里</div>
                            </div>
                        ) : (
                            <>
                                <div style={{ marginBottom: 15, padding: 10, backgroundColor: 'rgba(33,150,243,0.1)', borderRadius: 6, border: '1px solid #2196F3' }}>
                                    <div style={{ fontSize: 12, fontWeight: 'bold', marginBottom: 8 }}>🎮 全局控制</div>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button onClick={() => { processedElements.filter(el => el.published).forEach(el => sendProjectionMessage({ type: 'UPDATE_ELEMENT', data: { id: el.id, visible: true } })); setProcessedElements(prev => prev.map(el => el.published ? ({ ...el, visible: true }) : el)); }} style={{ flex: 1, padding: 6, fontSize: 10, backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: 3, cursor: 'pointer' }}>👁️ 全部显示(已上墙)</button>
                                        <button onClick={() => { processedElements.filter(el => el.published).forEach(el => sendProjectionMessage({ type: 'UPDATE_ELEMENT', data: { id: el.id, visible: false } })); setProcessedElements(prev => prev.map(el => el.published ? ({ ...el, visible: false }) : el)); }} style={{ flex: 1, padding: 6, fontSize: 10, backgroundColor: '#666', color: 'white', border: 'none', borderRadius: 3, cursor: 'pointer' }}>🙈 全部隐藏(已上墙)</button>
                                    </div>
                                </div>
                                {processedElements.map((element, index) => (
                                    <div key={element.id} style={{ padding: 10, margin: '8px 0', backgroundColor: '#444', borderRadius: 6, fontSize: 12, border: '1px solid #666' }}>
                                        <div style={{ display: 'flex', gap: 10 }}>
                                            <div style={{ width: 56, height: 56, background: '#222', border: '1px solid #555', borderRadius: 4, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                {element.image ? <img src={element.image} alt={element.name} style={{ width: '100%', height: '100%', objectFit: 'contain', opacity: element.visible ? 1 : 0.35 }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} /> : <span style={{ fontSize: 10, color: '#666' }}>No Img</span>}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                                        <div style={{ fontWeight: 'bold', color: element.visible ? '#4CAF50' : '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{index + 1}. {element.name}</div>
                                                        {/* 状态徽标 */}
                                                        {element.audio?.src ? (
                                                            <span title={element.audio.isPlaying ? '音效已设置并播放' : '音效已设置'} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 10, background: element.audio.isPlaying ? 'rgba(76,175,80,0.2)' : 'rgba(255,193,7,0.2)', border: `1px solid ${element.audio.isPlaying ? '#4CAF50' : '#FFC107'}`, color: element.audio.isPlaying ? '#4CAF50' : '#FFC107' }}>🎵</span>
                                                        ) : (
                                                            <span title="未设置音效" style={{ fontSize: 10, padding: '2px 6px', borderRadius: 10, background: 'rgba(158,158,158,0.15)', border: '1px solid #9E9E9E', color: '#BDBDBD' }}>—</span>
                                                        )}
                                                        {Array.isArray(element.trajectory?.keyframes) && element.trajectory!.keyframes.length >= 2 ? (
                                                            <span title={element.trajectory?.isAnimating ? '轨迹已设置并运行' : '轨迹已设置'} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 10, background: element.trajectory?.isAnimating ? 'rgba(33,150,243,0.15)' : 'rgba(255,193,7,0.15)', border: `1px solid ${element.trajectory?.isAnimating ? '#2196F3' : '#FFC107'}`, color: element.trajectory?.isAnimating ? '#2196F3' : '#FFC107' }}>📍</span>
                                                        ) : (
                                                            <span title="未设置轨迹" style={{ fontSize: 10, padding: '2px 6px', borderRadius: 10, background: 'rgba(158,158,158,0.15)', border: '1px solid #9E9E9E', color: '#BDBDBD' }}>—</span>
                                                        )}
                                                    </div>
                                                    <button onClick={() => { const updated = { ...element, visible: !element.visible }; sendProjectionMessage({ type: 'UPDATE_ELEMENT', data: { id: element.id, visible: updated.visible } }); setProcessedElements(prev => prev.map(el => el.id === element.id ? updated : el)); }} style={{ padding: '2px 6px', fontSize: 10, backgroundColor: element.visible ? '#4CAF50' : '#666', color: 'white', border: 'none', borderRadius: 3, cursor: 'pointer' }}>{element.visible ? '👁️' : '🙈'}</button>
                                                </div>
                                                <div style={{ fontSize: 10, color: '#ccc', marginBottom: 6, lineHeight: 1.3 }}>
                                                    <div>位置: ({element.position.x.toFixed(0)}, {element.position.y.toFixed(0)})</div>
                                                    <div>缩放: {(element.scale * 100).toFixed(0)}% | 旋转: {element.rotation.toFixed(1)}°</div>
                                                </div>
                                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                                    <button style={{ flex: 1, padding: 4, fontSize: 9, backgroundColor: '#9C27B0', color: 'white', border: 'none', borderRadius: 3, cursor: 'pointer' }} onClick={() => openAudioModal(element)}>🎵 音效</button>
                                                    <button style={{ flex: 1, padding: 4, fontSize: 9, backgroundColor: '#FF9800', color: 'white', border: 'none', borderRadius: 3, cursor: 'pointer' }} onClick={() => openTrajectoryModal(element)}>📍 轨迹</button>
                                                    {/* 手动播放音效（仅针对已上墙元素生效，避免混淆） */}
                                                    <button
                                                        style={{ flex: 1, padding: 4, fontSize: 9, backgroundColor: element.published && element.audio?.src ? '#3F51B5' : '#666', color: 'white', border: 'none', borderRadius: 3, cursor: element.published && element.audio?.src ? 'pointer' : 'not-allowed' }}
                                                        onClick={() => { if (element.published && element.audio?.src) { if (element.audio.isPlaying) return; sendProjectionMessage({ type: 'UPDATE_ELEMENT', data: { id: element.id, audio: { ...element.audio, isPlaying: true } } }); } }}
                                                    >▶️ 播放</button>
                                                    <button
                                                        style={{ flex: 1, padding: 4, fontSize: 9, backgroundColor: element.published && element.audio?.src ? '#607D8B' : '#666', color: 'white', border: 'none', borderRadius: 3, cursor: element.published && element.audio?.src ? 'pointer' : 'not-allowed' }}
                                                        onClick={() => { if (element.published && element.audio?.src) { if (!element.audio.isPlaying) return; sendProjectionMessage({ type: 'UPDATE_ELEMENT', data: { id: element.id, audio: { ...element.audio, isPlaying: false } } }); } }}
                                                    >⏸️ 停止</button>
                                                    {/* 上墙/下墙 */}
                                                    {element.published ? (
                                                        <button style={{ flex: 1, padding: 4, fontSize: 9, backgroundColor: '#795548', color: 'white', border: 'none', borderRadius: 3, cursor: 'pointer' }} onClick={() => { sendProjectionMessage({ type: 'REMOVE_ELEMENT', data: { id: element.id } }); setProcessedElements(prev => prev.map(el => el.id === element.id ? { ...el, published: false } : el)); }}>⬇️ 下墙</button>
                                                    ) : (
                                                        <button style={{ flex: 1, padding: 4, fontSize: 9, backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: 3, cursor: 'pointer' }} onClick={() => { const hasValidKeyframes = Array.isArray(element.trajectory?.keyframes) && (element.trajectory!.keyframes.length >= 2); const payload = { ...element, visible: true, opacity: 1, audio: element.audio ? { ...element.audio, isPlaying: true } : undefined, trajectory: element.trajectory ? { ...element.trajectory, isAnimating: hasValidKeyframes ? true : !!element.trajectory.isAnimating, startTime: hasValidKeyframes ? Date.now() : (element.trajectory.startTime || Date.now()) } : undefined }; sendProjectionMessage({ type: 'ADD_ELEMENT', data: payload }); setProcessedElements(prev => prev.map(el => el.id === element.id ? { ...el, published: true, visible: true, audio: payload.audio || el.audio, trajectory: payload.trajectory || el.trajectory } : el)); }}>⬆️ 上墙</button>
                                                    )}
                                                    <button style={{ flex: 1, padding: 4, fontSize: 9, backgroundColor: '#f44336', color: 'white', border: 'none', borderRadius: 3, cursor: 'pointer' }} onClick={() => { if (element.published) { sendProjectionMessage({ type: 'REMOVE_ELEMENT', data: { id: element.id } }); } setProcessedElements(prev => prev.filter(el => el.id !== element.id)); }}>🗑️ 删除</button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* 模态框 */}
            {audioModalOpen && selectedElementForModal && (
                <AudioControlModal
                    isOpen={audioModalOpen}
                    element={selectedElementForModal}
                    onClose={() => setAudioModalOpen(false)}
                    onUpdate={updateElementAudio}
                />
            )}
            {trajectoryModalOpen && selectedElementForModal && (
                <TrajectoryEditorModal
                    isOpen={trajectoryModalOpen}
                    element={selectedElementForModal}
                    onClose={() => setTrajectoryModalOpen(false)}
                    onUpdate={updateElementTrajectory}
                />
            )}
            {error && (
                <div style={{ position: 'fixed', top: 20, right: 20, background: 'rgba(244,67,54,0.9)', color: 'white', padding: 15, borderRadius: 8, zIndex: 1000, maxWidth: 400, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
                    ❌ {error}
                    <button onClick={() => setError(null)} style={{ marginLeft: 10, background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 16 }}>✕</button>
                </div>
            )}
        </div>
    );
}