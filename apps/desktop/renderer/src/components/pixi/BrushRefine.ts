import {useEffect, useRef, useState} from "react";
import * as PIXI from "pixi.js";
import {setupImageScene} from "./utils";

type ROI = { x1: number; y1: number; x2: number; y2: number };
export default function BrushRefine(props: {
    app: PIXI.Application; texture: PIXI.Texture; imageW: number; imageH: number; roi: ROI;
    baseMaskUrl: string; onExport: (maskPngB64: string) => void; onCancel: () => void;
}) {
    const {app, texture, imageW, imageH, roi, baseMaskUrl, onExport, onCancel} = props;
    const state = useRef({brushing: false, mode: 1 as 1 | 0, radius: 12});
    const [hint, setHint] = useState("L=补 R=删 [ / ] 调半径  Ctrl+E 导出  Esc 返回");

    useEffect(() => {
        const {
            container,
            imgSprite,
            toImgCoords,
            fromImgCoords,
            destroy
        } = setupImageScene(app, texture, imageW, imageH);

        // 用 Offscreen Canvas 做掩码编辑（易于导出 PNG）
        const canvas = document.createElement("canvas");
        canvas.width = imageW;
        canvas.height = imageH;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, imageW, imageH);

        // 载入基础候选掩码（黑白）
        const baseImg = new Image();
        baseImg.crossOrigin = "anonymous";
        baseImg.src = baseMaskUrl;
        baseImg.onload = () => {
            // 将 >0 的像素画成白色（保障为纯黑白）
            const tmp = document.createElement("canvas");
            tmp.width = imageW;
            tmp.height = imageH;
            const tctx = tmp.getContext("2d")!;
            tctx.drawImage(baseImg, 0, 0, imageW, imageH);
            const imgdat = tctx.getImageData(0, 0, imageW, imageH);
            const d = imgdat.data;
            for (let i = 0; i < d.length; i += 4) {
                const v = d[i] | d[i + 1] | d[i + 2] | d[i + 3];
                const w = v > 0 ? 255 : 0;
                d[i] = d[i + 1] = d[i + 2] = w;
                d[i + 3] = 255;
            }
            tctx.putImageData(imgdat, 0, 0);
            ctx.drawImage(tmp, 0, 0);
            baseTex.update();
        };

        // 把 canvas -> PIXI 纹理，用 sprite 叠加显示
        const baseTex = PIXI.Texture.from(canvas);
        const maskSprite = new PIXI.Sprite(baseTex);
        maskSprite.tint = 0xFFFF00;
        maskSprite.alpha = 0.45;
        maskSprite.position.set(imgSprite.position.x, imgSprite.position.y);
        maskSprite.scale.set(imgSprite.scale.x);
        container.addChild(maskSprite);

        function stamp(x: number, y: number, add: boolean) {
            ctx.globalCompositeOperation = add ? "source-over" : "destination-out";
            ctx.beginPath();
            ctx.arc(x, y, state.current.radius, 0, Math.PI * 2);
            ctx.closePath();
            ctx.fillStyle = add ? "white" : "black";
            ctx.fill();
            baseTex.update(); // 刷新纹理
        }

        const hit = new PIXI.Graphics();
        hit.beginFill(0, 0).drawRect(0, 0, app.renderer.width, app.renderer.height).endFill();
        hit.interactive = true;
        container.addChild(hit);

        let last: { x: number; y: number } | null = null;

        function onMove(e: any) {
            if (!state.current.brushing) return;
            const p = toImgCoords(e.global);
            // 只在 ROI 内编辑
            if (p.x < roi.x1 || p.x > roi.x2 || p.y < roi.y1 || p.y > roi.y2) {
                last = null;
                return;
            }
            const add = state.current.mode === 1;
            const r = state.current.radius;
            if (!last) {
                stamp(p.x, p.y, add);
                last = {x: p.x, y: p.y};
                return;
            }
            // 沿线盖章（半径一半步长）
            const dx = p.x - last.x, dy = p.y - last.y;
            const dist = Math.hypot(dx, dy);
            const step = Math.max(1, r * 0.5);
            const n = Math.ceil(dist / step);
            for (let i = 0; i <= n; i++) {
                const t = i / n;
                stamp(last.x + dx * t, last.y + dy * t, add);
            }
            last = {x: p.x, y: p.y};
        }

        hit.on("pointerdown", (e: any) => {
            state.current.brushing = true;
            state.current.mode = (e.data.originalEvent.button === 2) ? 0 : 1;
            onMove(e);
        });
        hit.on("pointermove", onMove);
        hit.on("pointerup", () => {
            state.current.brushing = false;
            last = null;
        });

        app.view.oncontextmenu = (ev) => ev.preventDefault();

        function exportNow() {
            // 导出整幅掩码 PNG（黑/白），大小与原图一致
            const png = canvas.toDataURL("image/png");
            onExport(png);
        }

        function key(ev: KeyboardEvent) {
            if (ev.key === "[") {
                state.current.radius = Math.max(1, state.current.radius - 1);
                setHint(`半径=${state.current.radius}`);
            }
            if (ev.key === "]") {
                state.current.radius = Math.min(128, state.current.radius + 1);
                setHint(`半径=${state.current.radius}`);
            }
            if (ev.key === "Escape") {
                onCancel();
            }
            if ((ev.ctrlKey || ev.metaKey) && (ev.key === "e" || ev.key === "E")) {
                exportNow();
            }
        }

        window.addEventListener("keydown", key);

        return () => {
            window.removeEventListener("keydown", key);
            destroy();
        };
    }, [app, texture, imageW, imageH, roi, baseMaskUrl, onExport, onCancel]);

    return null;
}
