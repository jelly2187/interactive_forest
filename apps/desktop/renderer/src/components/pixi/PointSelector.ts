import { useEffect } from "react";
import * as PIXI from "pixi.js";
import { setupImageScene } from "./utils";

type ROI = { x1:number;y1:number;x2:number;y2:number };
export default function PointSelector(props:{
  app: PIXI.Application; texture: PIXI.Texture; imageW:number; imageH:number;
  roi: ROI; points:{p:[number,number], l:0|1}[]; onChange:(v:any)=>void; onSubmit:()=>void;
}){
  const { app, texture, imageW, imageH, roi, points, onChange, onSubmit } = props;
  useEffect(()=>{
    const { container, imgSprite, toImgCoords, fromImgCoords, destroy } = setupImageScene(app, texture, imageW, imageH);
    const g = new PIXI.Graphics(); container.addChild(g);

    function redraw(){
      g.clear();
      // ROI 框
      const p = fromImgCoords({x:roi.x1,y:roi.y1});
      const q = fromImgCoords({x:roi.x2,y:roi.y2});
      g.lineStyle(3, 0x00E5FF, 1).drawRect(p.x, p.y, q.x-p.x, q.y-p.y);

      // 画点
      for(const it of points){
        const gp = fromImgCoords({x:it.p[0], y:it.p[1]});
        g.lineStyle(2, 0xffffff, 1).beginFill(it.l ? 0x00FF66 : 0xFF3355);
        // 小五角星改为小圆点，标注清晰、不遮挡
        g.drawCircle(gp.x, gp.y, 6).endFill();
      }
    }

    const hit = new PIXI.Graphics(); hit.beginFill(0,0).drawRect(0,0, app.renderer.width, app.renderer.height).endFill();
    hit.interactive = true; container.addChild(hit);

    hit.on("pointerdown", (e:any)=>{
      const p = toImgCoords(e.global);
      // 限制在 ROI 内
      if(p.x<roi.x1||p.x>roi.x2||p.y<roi.y1||p.y>roi.y2) return;
      const isRight = e.data.originalEvent.button === 2;
      const lab:0|1 = isRight ? 0 : 1;
      onChange([...points, { p:[p.x,p.y], l: lab }]);
    });
    // 允许右键
    app.view.oncontextmenu = (ev)=>ev.preventDefault();

    window.addEventListener("keydown",(ev)=>{
      if(ev.key==="s" || ev.key==="S") onSubmit();
      if(ev.key==="Backspace"){ const arr=[...points]; arr.pop(); onChange(arr); }
    });

    redraw();
    return ()=>{ destroy(); };
  },[app, texture, imageW, imageH, roi, points, onChange, onSubmit]);

  return null;
}
