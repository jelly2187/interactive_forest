import { useEffect } from "react";
import * as PIXI from "pixi.js";
import { setupImageScene } from "./utils";

type ROI = { x1:number;y1:number;x2:number;y2:number };
export default function ROISelector(props:{
  app: PIXI.Application; texture: PIXI.Texture; imageW:number; imageH:number;
  rois: ROI[]; onChange:(v:ROI[])=>void; onSelect:(idx:number)=>void;
}){
  const { app, texture, imageW, imageH, rois, onChange, onSelect } = props;

  useEffect(()=>{
    const { container, imgSprite, toImgCoords, fromImgCoords, destroy } = setupImageScene(app, texture, imageW, imageH);
    const g = new PIXI.Graphics(); container.addChild(g);

    let drawing = false; let start = {x:0,y:0}; let current: ROI|undefined;

    function redraw(){
      g.clear();
      // 画已有 ROI
      for(let i=0;i<rois.length;i++){
        const r = rois[i];
        const p = fromImgCoords({x: r.x1, y:r.y1});
        const q = fromImgCoords({x: r.x2, y:r.y2});
        g.lineStyle(2, 0x00E5FF, 1).drawRect(p.x, p.y, q.x-p.x, q.y-p.y);
      }
      // 画当前
      if(current){
        const p = fromImgCoords({x: current.x1, y: current.y1});
        const q = fromImgCoords({x: current.x2, y: current.y2});
        g.lineStyle(2, 0x00FF00, 1).drawRect(p.x, p.y, q.x-p.x, q.y-p.y);
      }
    }

    const hit = new PIXI.Graphics(); hit.beginFill(0,0).drawRect(0,0, app.renderer.width, app.renderer.height).endFill();
    hit.interactive = true; container.addChild(hit);

    hit.on("pointerdown", (e: any)=>{
      const p = toImgCoords(e.global); drawing = true; start = {x: p.x, y: p.y};
      current = { x1:p.x, y1:p.y, x2:p.x, y2:p.y }; redraw();
    });
    hit.on("pointermove", (e:any)=>{
      if(!drawing) return;
      const p = toImgCoords(e.global);
      if(current){ current.x2 = p.x; current.y2 = p.y; } redraw();
    });
    hit.on("pointerup", ()=>{
      if(drawing && current){
        // 规范化
        const x1=Math.floor(Math.min(current.x1,current.x2));
        const y1=Math.floor(Math.min(current.y1,current.y2));
        const x2=Math.ceil(Math.max(current.x1,current.x2));
        const y2=Math.ceil(Math.max(current.y1,current.y2));
        if(x2-x1>5 && y2-y1>5){
          onChange([...rois, {x1,y1,x2,y2}]);
          onSelect(rois.length); // 选中刚刚创建的 ROI
        }
        current = undefined; drawing=false; redraw();
      }
    });

    window.addEventListener("keydown",(ev)=>{
      if(ev.key==="Backspace"){ // 删除最后一个
        const arr=[...rois]; arr.pop(); onChange(arr); redraw();
      }
    });

    redraw();
    return ()=>{ destroy(); };
  },[app, texture, imageW, imageH, rois, onChange, onSelect]);

  return null;
}
