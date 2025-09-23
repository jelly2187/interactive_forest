import { useEffect, useRef, useState, useCallback } from "react";

interface ForestElement {
    id: string;
    type: 'tree' | 'flower' | 'rock' | 'butterfly';
    x: number;
    y: number;
    scale: number;
    rotation: number;
    color: number;
    interactive: boolean;
    vx?: number; // 速度
    vy?: number;
}

export default function InteractiveStage() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isLoaded, setIsLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [renderMode, setRenderMode] = useState<string>("initializing");
    const [forestElements, setForestElements] = useState<ForestElement[]>([]);
    const [selectedElement, setSelectedElement] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

    // 生成随机森林元素
    const generateForestElements = useCallback((): ForestElement[] => {
        const elements: ForestElement[] = [];

        // 添加树木
        for (let i = 0; i < 12; i++) {
            elements.push({
                id: `tree-${i}`,
                type: 'tree',
                x: Math.random() * 700 + 50,
                y: Math.random() * 350 + 150,
                scale: Math.random() * 0.8 + 0.5,
                rotation: Math.random() * 0.4 - 0.2,
                color: 0x228B22 + Math.floor(Math.random() * 0x333333),
                interactive: true
            });
        }

        // 添加花朵
        for (let i = 0; i < 25; i++) {
            elements.push({
                id: `flower-${i}`,
                type: 'flower',
                x: Math.random() * 600 + 100,
                y: Math.random() * 300 + 250,
                scale: Math.random() * 0.6 + 0.3,
                rotation: Math.random() * Math.PI * 2,
                color: Math.random() * 0xFFFFFF,
                interactive: true
            });
        }

        // 添加石头
        for (let i = 0; i < 8; i++) {
            elements.push({
                id: `rock-${i}`,
                type: 'rock',
                x: Math.random() * 600 + 100,
                y: Math.random() * 400 + 100,
                scale: Math.random() * 0.7 + 0.4,
                rotation: Math.random() * Math.PI,
                color: 0x696969 + Math.floor(Math.random() * 0x222222),
                interactive: true
            });
        }

        // 添加蝴蝶（会移动）
        for (let i = 0; i < 6; i++) {
            elements.push({
                id: `butterfly-${i}`,
                type: 'butterfly',
                x: Math.random() * 600 + 100,
                y: Math.random() * 200 + 50,
                scale: Math.random() * 0.4 + 0.2,
                rotation: 0,
                color: Math.random() * 0xFFFFFF,
                interactive: true,
                vx: (Math.random() - 0.5) * 2,
                vy: (Math.random() - 0.5) * 1
            });
        }

        return elements;
    }, []);

    // 绘制森林元素
    const drawForestElement = useCallback((ctx: CanvasRenderingContext2D, element: ForestElement) => {
        ctx.save();
        ctx.translate(element.x, element.y);
        ctx.rotate(element.rotation);
        ctx.scale(element.scale, element.scale);

        // 绘制选中状态的光环
        if (selectedElement === element.id) {
            ctx.beginPath();
            ctx.arc(0, 0, 40, 0, 2 * Math.PI);
            ctx.strokeStyle = '#FFD700';
            ctx.lineWidth = 3;
            ctx.stroke();
        }

        switch (element.type) {
            case 'tree':
                // 树干
                ctx.fillStyle = '#8B4513';
                ctx.fillRect(-8, 0, 16, 60);

                // 树冠
                ctx.fillStyle = `#${element.color.toString(16).padStart(6, '0')}`;
                ctx.beginPath();
                ctx.arc(0, -10, 35, 0, 2 * Math.PI);
                ctx.fill();

                // 树叶细节
                ctx.fillStyle = `#${(element.color + 0x111111).toString(16).padStart(6, '0')}`;
                ctx.beginPath();
                ctx.arc(-15, -15, 15, 0, 2 * Math.PI);
                ctx.fill();
                ctx.beginPath();
                ctx.arc(15, -15, 15, 0, 2 * Math.PI);
                ctx.fill();
                break;

            case 'flower':
                // 花茎
                ctx.strokeStyle = '#228B22';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(0, 20);
                ctx.stroke();

                // 花瓣
                ctx.fillStyle = `#${element.color.toString(16).padStart(6, '0')}`;
                for (let i = 0; i < 6; i++) {
                    ctx.save();
                    ctx.rotate((i * Math.PI) / 3);
                    ctx.beginPath();
                    ctx.ellipse(0, -12, 8, 4, 0, 0, 2 * Math.PI);
                    ctx.fill();
                    ctx.restore();
                }

                // 花心
                ctx.fillStyle = '#FFD700';
                ctx.beginPath();
                ctx.arc(0, 0, 4, 0, 2 * Math.PI);
                ctx.fill();
                break;

            case 'rock':
                ctx.fillStyle = `#${element.color.toString(16).padStart(6, '0')}`;
                ctx.beginPath();
                ctx.ellipse(0, 0, 25, 15, 0, 0, 2 * Math.PI);
                ctx.fill();

                // 阴影
                ctx.fillStyle = `#${(element.color - 0x222222).toString(16).padStart(6, '0')}`;
                ctx.beginPath();
                ctx.ellipse(0, 5, 20, 8, 0, 0, 2 * Math.PI);
                ctx.fill();
                break;

            case 'butterfly':
                // 身体
                ctx.fillStyle = '#8B4513';
                ctx.fillRect(-1, -8, 2, 16);

                // 翅膀
                ctx.fillStyle = `#${element.color.toString(16).padStart(6, '0')}`;

                // 左翅膀
                ctx.beginPath();
                ctx.ellipse(-8, -5, 8, 5, 0, 0, 2 * Math.PI);
                ctx.fill();
                ctx.beginPath();
                ctx.ellipse(-6, 2, 6, 4, 0, 0, 2 * Math.PI);
                ctx.fill();

                // 右翅膀
                ctx.beginPath();
                ctx.ellipse(8, -5, 8, 5, 0, 0, 2 * Math.PI);
                ctx.fill();
                ctx.beginPath();
                ctx.ellipse(6, 2, 6, 4, 0, 0, 2 * Math.PI);
                ctx.fill();

                // 翅膀花纹
                ctx.fillStyle = '#FFFFFF';
                ctx.beginPath();
                ctx.arc(-8, -5, 2, 0, 2 * Math.PI);
                ctx.fill();
                ctx.beginPath();
                ctx.arc(8, -5, 2, 0, 2 * Math.PI);
                ctx.fill();
                break;
        }

        ctx.restore();
    }, [selectedElement]);

    // 更新动画
    const updateAnimation = useCallback((elements: ForestElement[]): ForestElement[] => {
        return elements.map(element => {
            if (element.type === 'butterfly' && element.vx !== undefined && element.vy !== undefined) {
                let newX = element.x + element.vx;
                let newY = element.y + element.vy;
                let newVx = element.vx;
                let newVy = element.vy;

                // 边界反弹
                if (newX < 50 || newX > 750) {
                    newVx = -newVx;
                    newX = Math.max(50, Math.min(750, newX));
                }
                if (newY < 50 || newY > 200) {
                    newVy = -newVy;
                    newY = Math.max(50, Math.min(200, newY));
                }

                // 随机方向变化
                if (Math.random() < 0.02) {
                    newVx += (Math.random() - 0.5) * 0.5;
                    newVy += (Math.random() - 0.5) * 0.5;
                    newVx = Math.max(-3, Math.min(3, newVx));
                    newVy = Math.max(-2, Math.min(2, newVy));
                }

                return { ...element, x: newX, y: newY, vx: newVx, vy: newVy };
            }
            return element;
        });
    }, []);

    // 绘制完整场景
    const drawScene = useCallback((elements: ForestElement[]) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 清空画布
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 绘制渐变背景
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, '#87CEEB');  // 天空蓝
        gradient.addColorStop(0.7, '#98FB98'); // 浅绿
        gradient.addColorStop(1, '#228B22');   // 森林绿
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 绘制云朵
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        for (let i = 0; i < 4; i++) {
            const x = (i * 200 + 100) + Math.sin(Date.now() * 0.001 + i) * 20;
            const y = 80 + Math.sin(Date.now() * 0.0008 + i) * 10;

            ctx.beginPath();
            ctx.arc(x, y, 30, 0, 2 * Math.PI);
            ctx.arc(x + 25, y, 35, 0, 2 * Math.PI);
            ctx.arc(x + 50, y, 30, 0, 2 * Math.PI);
            ctx.fill();
        }

        // 绘制太阳
        const sunX = 700 + Math.sin(Date.now() * 0.0005) * 20;
        const sunY = 100 + Math.cos(Date.now() * 0.0005) * 10;
        ctx.fillStyle = '#FFD700';
        ctx.beginPath();
        ctx.arc(sunX, sunY, 40, 0, 2 * Math.PI);
        ctx.fill();

        // 太阳光芒
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 3;
        for (let i = 0; i < 8; i++) {
            const angle = (i * Math.PI) / 4 + Date.now() * 0.002;
            ctx.beginPath();
            ctx.moveTo(sunX + Math.cos(angle) * 50, sunY + Math.sin(angle) * 50);
            ctx.lineTo(sunX + Math.cos(angle) * 70, sunY + Math.sin(angle) * 70);
            ctx.stroke();
        }

        // 按类型分层绘制元素
        const layers = ['rock', 'tree', 'flower', 'butterfly'];
        layers.forEach(type => {
            elements
                .filter(el => el.type === type)
                .forEach(element => drawForestElement(ctx, element));
        });

        // 绘制标题
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.font = 'bold 28px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('🌲 Interactive Forest 🌸', canvas.width / 2, 40);

        // 绘制交互提示
        if (selectedElement) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(10, canvas.height - 60, 300, 50);
            ctx.fillStyle = '#FFD700';
            ctx.font = '16px Arial';
            ctx.textAlign = 'left';
            ctx.fillText(`选中: ${selectedElement}`, 20, canvas.height - 35);
            ctx.fillText('拖拽移动 | 双击删除', 20, canvas.height - 15);
        } else {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(10, canvas.height - 40, 280, 30);
            ctx.fillStyle = '#FFFFFF';
            ctx.font = '14px Arial';
            ctx.textAlign = 'left';
            ctx.fillText('点击选择元素 | 右键添加新元素', 20, canvas.height - 20);
        }
    }, [drawForestElement, selectedElement]);

    // 检测点击的元素
    const getElementAtPosition = useCallback((x: number, y: number): ForestElement | null => {
        // 反向查找（从上到下）
        for (let i = forestElements.length - 1; i >= 0; i--) {
            const element = forestElements[i];
            const dx = x - element.x;
            const dy = y - element.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            const hitRadius = element.type === 'tree' ? 35 :
                element.type === 'rock' ? 25 :
                    element.type === 'flower' ? 15 : 20;

            if (distance < hitRadius * element.scale) {
                return element;
            }
        }
        return null;
    }, [forestElements]);

    // 鼠标事件处理
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        setMousePos({ x, y });

        if (e.button === 2) { // 右键添加元素
            e.preventDefault();
            const types: ForestElement['type'][] = ['tree', 'flower', 'rock'];
            const randomType = types[Math.floor(Math.random() * types.length)];

            const newElement: ForestElement = {
                id: `${randomType}-${Date.now()}`,
                type: randomType,
                x,
                y,
                scale: Math.random() * 0.6 + 0.4,
                rotation: Math.random() * Math.PI * 2,
                color: Math.random() * 0xFFFFFF,
                interactive: true
            };

            setForestElements(prev => [...prev, newElement]);
            setSelectedElement(newElement.id);
            return;
        }

        const clickedElement = getElementAtPosition(x, y);

        if (clickedElement) {
            setSelectedElement(clickedElement.id);
            setIsDragging(true);
            setDragOffset({
                x: x - clickedElement.x,
                y: y - clickedElement.y
            });
        } else {
            setSelectedElement(null);
        }
    }, [getElementAtPosition]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        setMousePos({ x, y });

        if (isDragging && selectedElement) {
            setForestElements(prev => prev.map(element =>
                element.id === selectedElement
                    ? { ...element, x: x - dragOffset.x, y: y - dragOffset.y }
                    : element
            ));
        }
    }, [isDragging, selectedElement, dragOffset]);

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);

    const handleDoubleClick = useCallback((e: React.MouseEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const clickedElement = getElementAtPosition(x, y);

        if (clickedElement) {
            setForestElements(prev => prev.filter(el => el.id !== clickedElement.id));
            setSelectedElement(null);
        }
    }, [getElementAtPosition]);

    // 主渲染循环
    useEffect(() => {
        let animationId: number;

        const animate = () => {
            setForestElements(prev => {
                const updated = updateAnimation(prev);
                drawScene(updated);
                return updated;
            });
            animationId = requestAnimationFrame(animate);
        };

        // 初始化森林元素
        if (forestElements.length === 0) {
            const initialElements = generateForestElements();
            setForestElements(initialElements);
            setIsLoaded(true);
            setRenderMode("Interactive Canvas");
        }

        animate();

        return () => {
            if (animationId) {
                cancelAnimationFrame(animationId);
            }
        };
    }, [forestElements.length, updateAnimation, drawScene, generateForestElements]);

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
                        正在生成交互式森林...
                    </div>
                </div>
            )}

            <canvas
                ref={canvasRef}
                width={800}
                height={600}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onDoubleClick={handleDoubleClick}
                onContextMenu={(e) => e.preventDefault()}
                style={{
                    border: '3px solid #fff',
                    borderRadius: '12px',
                    display: isLoaded || error ? 'block' : 'none',
                    cursor: isDragging ? 'grabbing' : 'pointer'
                }}
            />

            {isLoaded && (
                <div style={{
                    color: '#00ff00',
                    fontSize: '16px',
                    marginTop: '20px',
                    textAlign: 'center'
                }}>
                    ✅ Interactive Forest 已就绪！
                    <div style={{ fontSize: '14px', color: '#aaa', marginTop: '5px' }}>
                        渲染模式: {renderMode} | 元素数量: {forestElements.length}
                    </div>
                    <div style={{ fontSize: '12px', color: '#ccc', marginTop: '5px' }}>
                        鼠标位置: ({mousePos.x}, {mousePos.y})
                    </div>
                </div>
            )}
        </div>
    );
}