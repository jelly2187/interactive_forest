import { useEffect, useRef, useState, useCallback } from "react";
import { apiService, type Point, type SegmentationResponse } from "../services/apiService";

// interface SegmentationResult {
//   mask: string; // base64 encoded mask
//   bbox: [number, number, number, number];
//   score: number;
//   session_id: string;
// }

export default function Editor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // 将状态类型调整为 API 返回数据的 data 部分
  const [segmentationResult, setSegmentationResult] = useState<NonNullable<SegmentationResponse["data"]> | null>(null);
  // 新增：当前选中掩码索引
  const [selectedMaskIndex, setSelectedMaskIndex] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [canvasScale, setCanvasScale] = useState(1);
  const [canvasOffset, setCanvasOffset] = useState({ x: 0, y: 0 });
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking');

  // 绘制画布内容
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 清空画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 绘制图像
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

      // 按选中索引绘制分割结果
      if (segmentationResult && segmentationResult.masks && segmentationResult.masks.length > 0) {
        const masks = segmentationResult.masks;
        const selIdx = Math.min(Math.max(selectedMaskIndex, 0), masks.length - 1);
        const maskInfo = masks[selIdx];
        try {
          const maskImg = new Image();
          maskImg.crossOrigin = 'anonymous';
          maskImg.onload = () => {
            ctx.save();
            ctx.globalAlpha = 0.6;
            ctx.globalCompositeOperation = 'multiply';
            ctx.drawImage(maskImg, offsetX, offsetY, scaledWidth, scaledHeight);
            ctx.restore();
          };
          maskImg.src = maskInfo.path;
        } catch (error) {
          console.error('Error loading mask image:', error);
        }
      }

      // 绘制标注点
      points.forEach((point, index) => {
        const scaledX = offsetX + point.x * scale;
        const scaledY = offsetY + point.y * scale;

        ctx.beginPath();
        ctx.arc(scaledX, scaledY, 6, 0, 2 * Math.PI);
        ctx.fillStyle = point.type === 'positive' ? '#00ff00' : '#ff0000';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 绘制点的编号
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText((index + 1).toString(), scaledX, scaledY - 10);
      });
    } else {
      // 空状态提示
      ctx.fillStyle = '#666666';
      ctx.font = '24px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('点击上传图片或拖拽图片到这里', canvas.width / 2, canvas.height / 2);
    }
  }, [image, points, segmentationResult, selectedMaskIndex]);

  // 处理文件上传
  const handleFileSelect = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('请选择有效的图片文件');
      return;
    }

    setError(null);
    setImageFile(file);
    setPoints([]);
    setSegmentationResult(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        setImage(img);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

  // 处理画布点击
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!image) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 转换为图像坐标
    const imageX = (x - canvasOffset.x) / canvasScale;
    const imageY = (y - canvasOffset.y) / canvasScale;

    // 检查点击是否在图像范围内
    if (imageX < 0 || imageX > image.width || imageY < 0 || imageY > image.height) {
      return;
    }

    // 添加点（右键为负点，左键为正点）
    const pointType = e.button === 2 ? 'negative' : 'positive';
    const newPoint: Point = { x: imageX, y: imageY, type: pointType };

    setPoints(prev => [...prev, newPoint]);
  }, [image, canvasScale, canvasOffset]);

  // 发送分割请求
  const performSegmentation = useCallback(async () => {
    if (!imageFile || points.length === 0) {
      setError('请上传图片并添加至少一个标注点');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await apiService.performSegmentation({
        file: imageFile,
        points: points
      });

      if (response.success && response.data) {
        setSegmentationResult(response.data);
        setSelectedMaskIndex(0); // 新结果默认选择第一个
      } else {
        setError(response.error || '分割处理失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '分割处理失败');
    } finally {
      setIsLoading(false);
    }
  }, [imageFile, points]);

  // 清除所有标注
  const clearAnnotations = useCallback(() => {
    setPoints([]);
    setSegmentationResult(null);
    setSelectedMaskIndex(0); // 重置选择
  }, []);

  // 下载分割结果
  const downloadResult = useCallback(async () => {
    if (!segmentationResult || !segmentationResult.session_id) return;

    try {
      const success = await apiService.downloadSegmentationResult(
        segmentationResult.session_id,
        'segmentation_result.png'
      );

      if (!success) {
        setError('下载失败，请重试');
      }
    } catch (err) {
      setError('下载失败: ' + (err instanceof Error ? err.message : '未知错误'));
    }
  }, [segmentationResult]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  // 检查服务器状态
  useEffect(() => {
    const checkServerStatus = async () => {
      const isOnline = await apiService.healthCheck();
      setServerStatus(isOnline ? 'online' : 'offline');
    };

    checkServerStatus();
    // 每30秒检查一次服务器状态
    const interval = setInterval(checkServerStatus, 30000);

    return () => clearInterval(interval);
  }, []);

  // 处理拖拽
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  }, [handleFileSelect]);

  return (
    <div style={{
      width: "100vw",
      height: "100vh",
      backgroundColor: "#1a1a2e",
      color: "white",
      display: "flex",
      flexDirection: "column"
    }}>
      {/* 工具栏 */}
      <div style={{
        padding: "20px",
        backgroundColor: "#2a2a3e",
        borderBottom: "2px solid #4a4a6e",
        display: "flex",
        alignItems: "center",
        gap: "20px",
        flexWrap: "wrap"
      }}>
        <h2 style={{ margin: 0, color: "#ffffff" }}>🎨 SAM 图像分割编辑器</h2>

        {/* 服务器状态指示器 */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 12px",
          backgroundColor: serverStatus === 'online' ? "#4CAF50" : serverStatus === 'offline' ? "#f44336" : "#FF9800",
          borderRadius: "20px",
          fontSize: "12px"
        }}>
          <div style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            backgroundColor: "white"
          }} />
          {serverStatus === 'checking' ? '检查中...' :
            serverStatus === 'online' ? 'SAM服务在线' : 'SAM服务离线'}
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
            style={{ display: "none" }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: "10px 20px",
              backgroundColor: "#4CAF50",
              color: "white",
              border: "none",
              borderRadius: "5px",
              cursor: "pointer",
              fontSize: "14px"
            }}
          >
            📁 选择图片
          </button>

          <button
            onClick={performSegmentation}
            disabled={!image || points.length === 0 || isLoading || serverStatus !== 'online'}
            style={{
              padding: "10px 20px",
              backgroundColor: points.length > 0 && serverStatus === 'online' ? "#2196F3" : "#666",
              color: "white",
              border: "none",
              borderRadius: "5px",
              cursor: points.length > 0 && serverStatus === 'online' ? "pointer" : "not-allowed",
              fontSize: "14px"
            }}
          >
            {isLoading ? "🔄 处理中..." : serverStatus !== 'online' ? "⚠️ 服务离线" : "✂️ 开始分割"}
          </button>

          <button
            onClick={clearAnnotations}
            disabled={points.length === 0}
            style={{
              padding: "10px 20px",
              backgroundColor: points.length > 0 ? "#FF9800" : "#666",
              color: "white",
              border: "none",
              borderRadius: "5px",
              cursor: points.length > 0 ? "pointer" : "not-allowed",
              fontSize: "14px"
            }}
          >
            🗑️ 清除标注
          </button>

          {segmentationResult && (
            <button
              onClick={downloadResult}
              style={{
                padding: "10px 20px",
                backgroundColor: "#9C27B0",
                color: "white",
                border: "none",
                borderRadius: "5px",
                cursor: "pointer",
                fontSize: "14px"
              }}
            >
              💾 下载结果
            </button>
          )}
        </div>

        <div style={{ marginLeft: "auto", fontSize: "14px", color: "#cccccc" }}>
          标注点数: {points.length} |
          左键: 正向点 (绿) | 右键: 负向点 (红)
        </div>
      </div>

      {/* 主编辑区域 */}
      <div style={{
        flex: 1,
        display: "flex",
        position: "relative"
      }}>
        {/* 画布区域 */}
        <div style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px"
        }}>
          <canvas
            ref={canvasRef}
            width={800}
            height={600}
            onClick={handleCanvasClick}
            onContextMenu={(e) => {
              e.preventDefault();
              handleCanvasClick(e);
            }}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            style={{
              border: "2px dashed #666",
              borderRadius: "10px",
              backgroundColor: "#2a2a3e",
              cursor: image ? "crosshair" : "pointer",
              maxWidth: "100%",
              maxHeight: "100%"
            }}
          />
        </div>

        {/* 信息面板 */}
        <div style={{
          width: "300px",
          backgroundColor: "#2a2a3e",
          borderLeft: "2px solid #4a4a6e",
          padding: "20px",
          overflow: "auto"
        }}>
          <h3>📊 分割信息</h3>

          {error && (
            <div style={{
              padding: "10px",
              backgroundColor: "#f44336",
              color: "white",
              borderRadius: "5px",
              marginBottom: "15px"
            }}>
              ❌ {error}
            </div>
          )}

          {image && (
            <div style={{ marginBottom: "20px" }}>
              <h4>🖼️ 图像信息</h4>
              <p>尺寸: {image.width} × {image.height}</p>
              <p>文件: {imageFile?.name}</p>
            </div>
          )}

          {points.length > 0 && (
            <div style={{ marginBottom: "20px" }}>
              <h4>📍 标注点列表</h4>
              {points.map((point, index) => (
                <div key={index} style={{
                  padding: "5px 10px",
                  margin: "5px 0",
                  backgroundColor: point.type === 'positive' ? "#4CAF50" : "#f44336",
                  borderRadius: "3px",
                  fontSize: "12px"
                }}>
                  {index + 1}. ({Math.round(point.x)}, {Math.round(point.y)}) - {point.type === 'positive' ? '正向' : '负向'}
                </div>
              ))}
            </div>
          )}

          {segmentationResult && (
            <div style={{ marginBottom: "20px" }}>
              <h4>✂️ 分割结果</h4>
              <p>候选数量: {segmentationResult.masks.length}</p>

              {/* 候选列表选择 */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
                {segmentationResult.masks.map((m, idx) => (
                  <button
                    key={m.mask_id}
                    onClick={() => setSelectedMaskIndex(idx)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: '4px',
                      border: '1px solid #555',
                      backgroundColor: idx === selectedMaskIndex ? '#4a90e2' : '#333',
                      color: 'white',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                    title={`score=${(m.score * 100).toFixed(1)}%`}
                  >
                    #{idx + 1}
                  </button>
                ))}
              </div>

              {/* 当前选中信息与预览 */}
              {(() => {
                const masks = segmentationResult.masks;
                const selIdx = Math.min(Math.max(selectedMaskIndex, 0), masks.length - 1);
                const current = masks[selIdx];
                return (
                  <>
                    <p>当前选择: #{selIdx + 1} / {masks.length}</p>
                    <p>分数: {(current.score * 100).toFixed(1)}%</p>
                    <p>会话ID: {segmentationResult.session_id}</p>
                    <div style={{
                      width: "100%",
                      height: "100px",
                      backgroundColor: "#1a1a2e",
                      borderRadius: "5px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginTop: "10px"
                    }}>
                      <img
                        src={current.path}
                        alt="分割掩码"
                        style={{
                          maxWidth: "100%",
                          maxHeight: "100%",
                          borderRadius: "3px"
                        }}
                      />
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          <div style={{
            padding: "15px",
            backgroundColor: "#1a1a2e",
            borderRadius: "5px",
            fontSize: "12px",
            lineHeight: "1.5"
          }}>
            <h4>💡 使用说明</h4>
            <p>1. 点击"选择图片"或拖拽图片到画布</p>
            <p>2. 左键点击添加正向点（绿色）</p>
            <p>3. 右键点击添加负向点（红色）</p>
            <p>4. 点击"开始分割"处理图像</p>
            <p>5. 查看结果并下载</p>
          </div>
        </div>
      </div>
    </div>
  );
}