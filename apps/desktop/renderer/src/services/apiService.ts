// API服务模块，处理与SAM后端的通信

export interface Point {
    x: number;
    y: number;
    type: 'positive' | 'negative';
}

export interface SegmentationRequest {
    file?: File; // 摄像头模式下不再需要文件
    points: Point[];
    sessionId?: string; // 已有会话（如摄像头截图）
    roiBox?: { x: number; y: number; width: number; height: number }; // ROI框坐标
}

export interface SegmentationResponse {
    success: boolean;
    data?: {
        masks: Array<{
            mask_id: string;
            score: number;
            path: string;
        }>;
        width: number;
        height: number;
        session_id: string;
    };
    error?: string;
}

export interface AssetsListResponse {
    success: boolean;
    data?: {
        files: string[];
        total: number;
    };
    error?: string;
}

export interface BrushStroke {
    x: number;
    y: number;
    brush_size: number;
    brush_mode: 'add' | 'erase';
}

export interface BrushRefinementRequest {
    sessionId: string;
    maskId: string;
    strokes: BrushStroke[];
    roiBox?: { x: number; y: number; width: number; height: number }; // ROI坐标信息
}

export interface BrushRefinementResponse {
    success: boolean;
    data?: {
        refined_mask_id: string;
        refined_mask_path: string;
        width: number;
        height: number;
    };
    error?: string;
}

class ApiService {
    private baseUrl: string;

    constructor(baseUrl: string = 'http://localhost:7001') {
        this.baseUrl = baseUrl;
    }

    // 测试服务器连接
    async healthCheck(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/health`);
            return response.ok;
        } catch (error) {
            console.error('Health check failed:', error);
            return false;
        }
    }

    // 初始化会话
    async initSession(file: File): Promise<{ success: boolean, sessionId?: string, width?: number, height?: number, error?: string }> {
        try {
            // 将文件转换为base64
            const base64 = await this.fileToBase64(file);

            const response = await fetch(`${this.baseUrl}/sam/init`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    image_b64: base64,
                    image_name: file.name,
                    keep_session: true
                }),
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            return {
                success: true,
                sessionId: result.session_id,
                width: result.width,
                height: result.height
            };
        } catch (error) {
            console.error('Session init error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '初始化会话失败'
            };
        }
    }

    // 通过 base64 直接初始化会话（用于摄像头截图）
    async initSessionFromBase64(dataUrl: string, logicalName: string = 'camera_capture.png'): Promise<{ success: boolean, sessionId?: string, width?: number, height?: number, error?: string }> {
        try {
            const response = await fetch(`${this.baseUrl}/sam/init`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_b64: dataUrl, image_name: logicalName, keep_session: true })
            });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const result = await response.json();
            return { success: true, sessionId: result.session_id, width: result.width, height: result.height };
        } catch (error) {
            console.error('Session init (base64) error:', error);
            return { success: false, error: error instanceof Error ? error.message : '初始化会话失败' };
        }
    }

    // 将文件转换为base64
    private fileToBase64(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                resolve(result);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
    // 执行图像分割
    async performSegmentation(request: SegmentationRequest): Promise<SegmentationResponse> {
        try {
            // 如果没有提供sessionId，先初始化会话
            let sessionId = request.sessionId;
            if (!sessionId) {
                if (!request.file) {
                    return { success: false, error: '缺少会话：未提供文件且无 sessionId' };
                }
                const initResult = await this.initSession(request.file);
                if (!initResult.success) {
                    return { success: false, error: initResult.error || '初始化会话失败' };
                }
                sessionId = initResult.sessionId!;
            }

            // 转换点格式为后端期望的格式
            const points = request.points.map(p => [p.x, p.y]);
            const labels = request.points.map(p => p.type === 'positive' ? 1 : 0);

            // 构建ROI框坐标 - 转换为[x1, y1, x2, y2]格式
            let box = [0, 0, 0, 0];
            if (request.roiBox) {
                box = [
                    request.roiBox.x,
                    request.roiBox.y,
                    request.roiBox.x + request.roiBox.width,
                    request.roiBox.y + request.roiBox.height
                ];
            }

            // 构建请求数据 - 后端期望JSON格式
            const requestData = {
                session_id: sessionId,
                points: points,
                labels: labels,
                box: box, // 传递正确的ROI框坐标
                multimask: true,
                top_n: 3,
                smooth: true
            };

            const response = await fetch(`${this.baseUrl}/sam/segment`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestData),
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();

            // 返回成功结果
            return {
                success: true,
                data: {
                    masks: result.masks,
                    width: result.width,
                    height: result.height,
                    session_id: sessionId
                }
            };
        } catch (error) {
            console.error('Segmentation API error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '网络请求失败'
            };
        }
    }

    // 获取资源文件列表
    async getAssetsList(): Promise<AssetsListResponse> {
        try {
            const response = await fetch(`${this.baseUrl}/assets`);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            return {
                success: true,
                data: {
                    files: result.files || [],
                    total: result.total || 0
                }
            };
        } catch (error) {
            console.error('Assets API error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '获取资源列表失败'
            };
        }
    }

    // 下载分割结果
    async downloadSegmentationResult(sessionId: string, filename: string): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/assets/${sessionId}/${filename}`);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            URL.revokeObjectURL(url);
            return true;
        } catch (error) {
            console.error('Download error:', error);
            return false;
        }
    }

    // 导出ROI结果
    async exportROI(
        sessionId: string,
        maskId: string,
        roiIndex: number,
        maskPngB64?: string,
        roiBox?: { x: number; y: number; width: number; height: number }
    ): Promise<{ success: boolean, spritePath?: string, error?: string }> {
        try {
            const requestData = {
                session_id: sessionId,
                mask_id: maskId,
                roi_index: roiIndex,
                feather_px: 2, // 轻微柔化边缘
                mask_png_b64: maskPngB64, // 如果有画笔润色的结果
                roi_box: roiBox ? [roiBox.x, roiBox.y, roiBox.width, roiBox.height] : null
            };

            const response = await fetch(`${this.baseUrl}/sam/export-roi`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestData),
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            return {
                success: true,
                spritePath: result.sprite_path
            };
        } catch (error) {
            console.error('Export ROI error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '导出ROI失败'
            };
        }
    }

    // 获取服务器状态信息
    async getServerInfo(): Promise<any> {
        try {
            const response = await fetch(`${this.baseUrl}/`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error('Server info error:', error);
            return null;
        }
    }

    // 删除资产（png）
    async deleteAsset(name: string): Promise<{ success: boolean; error?: string }> {
        try {
            const response = await fetch(`${this.baseUrl}/assets/delete`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            if (!response.ok) {
                const txt = await response.text();
                return { success: false, error: `删除失败: ${response.status} ${txt}` };
            }
            return { success: true };
        } catch (e) {
            return { success: false, error: e instanceof Error ? e.message : '删除请求失败' };
        }
    }

    // 画笔删补接口
    async brushRefinement(request: BrushRefinementRequest): Promise<BrushRefinementResponse> {
        try {
            console.log('Sending brush refinement request:', request);

            const response = await fetch(`${this.baseUrl}/sam/brush-refinement`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    session_id: request.sessionId,
                    mask_id: request.maskId,
                    strokes: request.strokes.map(stroke => ({
                        x: stroke.x,
                        y: stroke.y,
                        brush_size: stroke.brush_size,
                        brush_mode: stroke.brush_mode
                    })),
                    roi_box: request.roiBox ? [request.roiBox.x, request.roiBox.y, request.roiBox.width, request.roiBox.height] : null
                })
            });

            if (!response.ok) {
                const errorData = await response.text();
                console.error('Brush refinement request failed:', errorData);
                return {
                    success: false,
                    error: `请求失败: ${response.status} ${errorData}`
                };
            }

            const data = await response.json();
            console.log('Brush refinement response:', data);

            return {
                success: true,
                data: {
                    refined_mask_id: data.refined_mask_id,
                    refined_mask_path: data.refined_mask_path,
                    width: data.width,
                    height: data.height
                }
            };

        } catch (error) {
            console.error('Brush refinement error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '未知错误'
            };
        }
    }
}

// 创建单例实例
export const apiService = new ApiService();

// 导出类型和服务
export default ApiService;