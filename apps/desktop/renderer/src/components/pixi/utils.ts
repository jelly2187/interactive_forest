import * as PIXI from "pixi.js";

// 在窗口内以 contain 模式放置图片，返回 { container, imgSprite, scale, offset }
export function setupImageScene(app: PIXI.Application, tex: PIXI.Texture, W:number, H:number){
  const root = new PIXI.Container();
  app.stage.addChild(root);
  const img = new PIXI.Sprite(tex);
  img.anchor.set(0); root.addChild(img);

  function layout(){
    const sw = window.innerWidth, sh = window.innerHeight;
    const s = Math.min(sw/W, sh/H);
    img.scale.set(s);
    img.position.set((sw - W*s)/2, (sh - H*s)/2);
  }
  layout(); window.addEventListener("resize", layout);

  return {
    container: root, imgSprite: img,
    toImgCoords(g: PIXI.PointData){ // 全局坐标 -> 原图坐标
      const s = img.scale.x; const ox = img.position.x; const oy = img.position.y;
      return { x: (g.x - ox)/s, y: (g.y - oy)/s };
    },
    fromImgCoords(p:{x:number;y:number}){ // 原图坐标 -> 全局坐标
      const s = img.scale.x; const ox = img.position.x; const oy = img.position.y;
      return { x: p.x*s + ox, y: p.y*s + oy };
    },
    destroy(){ window.removeEventListener("resize", layout); root.destroy({children:true}); }
  };
}

// 把二值/灰度 mask 的 ImageBitmap 或 HTMLImageElement 叠加为半透明黄色预览
export async function makeMaskPreviewSprite(app: PIXI.Application, srcUrl: string, color=0xFFFF00, alpha=0.4){
  const tex = await PIXI.Assets.load({ src: srcUrl, crossOrigin:"anonymous" });
  const sp = new PIXI.Sprite(tex as PIXI.Texture);
  // 用 tint 显示为黄色，并通过 alpha 做半透明
  sp.tint = color; sp.alpha = alpha;
  return sp;
}
