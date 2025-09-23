import { useEffect, useRef, useState } from "react";

interface ForestElement {
    id: string;
    type: 'tree' | 'flower' | 'rock' | 'butterfly';
    x: number;
    y: number;
    scale: number;
    rotation: number;
    color: number;
    interactive: boolean;
}

export default function Stage() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isLoaded, setIsLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [renderMode, setRenderMode] = useState<string>("initializing");
    const [forestElements, setForestElements] = useState<ForestElement[]>([]);
    const [selectedElement, setSelectedElement] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 }); useEffect(() => {
        let animationId: number;

        const initRendering = async () => {
            try {
                console.log("开始初始化渲染系统...");
                setRenderMode("检测 PIXI.js 支持...");

                // 首先尝试动态导入 PIXI.js
                let pixiAvailable = false;
                try {
                    const PIXI = await import("pixi.js");
                    console.log("PIXI.js 模块加载成功");

                    // 尝试创建 PIXI 应用
                    const app = new PIXI.Application();

                    try {
                        await app.init({
                            width: 800,
                            height: 600,
                            backgroundColor: 0x1a1a2e,
                            antialias: false,
                            preference: 'webgl',
                            hello: false
                        });

                        if (canvasRef.current?.parentElement && app.canvas) {
                            // 替换 Canvas 元素
                            const container = canvasRef.current.parentElement;
                            container.appendChild(app.canvas);
                            if (canvasRef.current) {
                                container.removeChild(canvasRef.current);
                            }

                            // 创建 PIXI 内容
                            const graphics = new PIXI.Graphics();
                            graphics.rect(100, 100, 200, 200);
                            graphics.fill(0x00ff00);
                            app.stage.addChild(graphics);

                            // 添加文本
                            const text = new PIXI.Text({
                                text: '🌲 PIXI.js Interactive Forest',
                                style: {
                                    fontSize: 28,
                                    fill: 0xffffff,
                                    fontFamily: 'Arial'
                                }
                            });
                            text.x = 200;
                            text.y = 50;
                            app.stage.addChild(text);

                            // 添加动画圆形
                            const circle = new PIXI.Graphics();
                            circle.circle(0, 0, 30);
                            circle.fill(0x0080ff);
                            circle.x = 400;
                            circle.y = 300;
                            app.stage.addChild(circle);

                            // 动画循环
                            let elapsed = 0;
                            const ticker = PIXI.Ticker.shared;
                            const tickerCallback = (time: any) => {
                                elapsed += time.deltaTime;
                                circle.x = 400 + Math.cos(elapsed * 0.05) * 100;
                                circle.y = 300 + Math.sin(elapsed * 0.05) * 50;
                            };
                            ticker.add(tickerCallback);

                            setRenderMode("PIXI.js WebGL");
                            setIsLoaded(true);
                            pixiAvailable = true;
                            console.log("PIXI.js 初始化成功！");

                            // 清理函数
                            return () => {
                                ticker.remove(tickerCallback);
                                app.destroy(true);
                            };
                        }
                    } catch (pixiError) {
                        console.warn("PIXI.js 初始化失败，降级到 Canvas:", pixiError);
                        if (app && typeof app.destroy === 'function') {
                            try {
                                app.destroy();
                            } catch (destroyError) {
                                console.warn("PIXI 销毁时出错:", destroyError);
                            }
                        }
                    }
                } catch (importError) {
                    console.warn("PIXI.js 模块导入失败:", importError);
                }

                // 如果 PIXI.js 不可用，使用 Canvas 2D 降级
                if (!pixiAvailable) {
                    setRenderMode("降级到 Canvas 2D...");
                    console.log("使用 Canvas 2D 降级渲染");

                    const canvas = canvasRef.current;
                    if (!canvas) return;

                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        setError("Canvas 2D 上下文获取失败");
                        return;
                    }

                    // 设置画布大小
                    canvas.width = 800;
                    canvas.height = 600;

                    // 初始绘制
                    const draw = (frame: number) => {
                        // 背景
                        ctx.fillStyle = '#1a1a2e';
                        ctx.fillRect(0, 0, 800, 600);

                        // 标题
                        ctx.fillStyle = '#ffffff';
                        ctx.font = 'bold 28px Arial';
                        ctx.textAlign = 'center';
                        ctx.fillText('🌲 Canvas 2D Interactive Forest', 400, 80);

                        // 绿色矩形
                        ctx.fillStyle = '#00ff00';
                        ctx.fillRect(100, 100, 200, 200);

                        // 动画蓝色圆形
                        ctx.fillStyle = '#0080ff';
                        const x = 400 + Math.cos(frame * 0.02) * 100;
                        const y = 300 + Math.sin(frame * 0.02) * 50;
                        ctx.beginPath();
                        ctx.arc(x, y, 30, 0, 2 * Math.PI);
                        ctx.fill();

                        // 状态信息
                        ctx.fillStyle = '#ffff00';
                        ctx.font = '16px Arial';
                        ctx.fillText('Canvas 2D 降级模式 - 渲染正常', 400, 500);
                    };

                    let frame = 0;
                    const animate = () => {
                        frame++;
                        draw(frame);
                        animationId = requestAnimationFrame(animate);
                    };

                    animate();
                    setRenderMode("Canvas 2D");
                    setIsLoaded(true);
                    console.log("Canvas 2D 渲染初始化成功！");
                }

            } catch (generalError) {
                console.error("渲染系统初始化失败:", generalError);
                setError(`渲染系统初始化失败: ${generalError instanceof Error ? generalError.message : "未知错误"}`);
            }
        };

        const cleanup = initRendering();

        return () => {
            if (animationId) {
                cancelAnimationFrame(animationId);
            }
            if (cleanup && typeof cleanup.then === 'function') {
                cleanup.then(cleanupFn => {
                    if (typeof cleanupFn === 'function') {
                        cleanupFn();
                    }
                });
            }
        };
    }, []);

    return (
        <div style={{
            position: "relative",
            width: "100vw",
            height: "100vh",
            overflow: "hidden",
            backgroundColor: "#0a0a0a",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center"
        }}>
            {error && (
                <div style={{
                    position: 'absolute',
                    top: 20,
                    left: 20,
                    background: 'rgba(255, 0, 0, 0.8)',
                    color: 'white',
                    padding: '15px',
                    borderRadius: '8px',
                    zIndex: 1000,
                    maxWidth: '400px'
                }}>
                    ❌ 错误: {error}
                </div>
            )}

            {!isLoaded && !error && (
                <div style={{
                    color: 'white',
                    fontSize: '18px',
                    marginBottom: '20px',
                    textAlign: 'center'
                }}>
                    🔄 {renderMode}
                    <div style={{ fontSize: '14px', marginTop: '10px', color: '#aaa' }}>
                        正在检测最佳渲染模式...
                    </div>
                </div>
            )}

            <canvas
                ref={canvasRef}
                style={{
                    border: '3px solid #fff',
                    borderRadius: '12px',
                    display: isLoaded || error ? 'block' : 'none'
                }}
            />

            {isLoaded && (
                <div style={{
                    color: '#00ff00',
                    fontSize: '16px',
                    marginTop: '20px',
                    textAlign: 'center'
                }}>
                    ✅ Interactive Forest 渲染成功！
                    <div style={{ fontSize: '14px', color: '#aaa', marginTop: '5px' }}>
                        渲染模式: {renderMode}
                    </div>
                </div>
            )}
        </div>
    );
}