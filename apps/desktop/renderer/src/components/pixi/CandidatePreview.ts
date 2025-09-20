import { useEffect, useState } from "react";
import * as PIXI from "pixi.js";
import { setupImageScene, makeMaskPreviewSprite } from "./utils";
import type { MaskInfo } from "../../types";

type ROI = { x1:number;y1:number;x2:number;y2:number };
export default function CandidatePreview(props:{
  app: PIXI.Application; texture: PIXI.Texture; imageW:number; imageH:number; roi: ROI;
  candidates: MaskInfo[]; maskUrlOf:(m:MaskInfo)=>string;
  selectedIndex:number; onSelect:(i:number)=>void; onToBrush:()=>void;
}){
  const { app, texture, imageW, imageH, roi, candidates, maskUrlOf, selectedIndex, onSelect, onToBrush } = props;
  const [ready, setReady] = useState(false);

  useEffect(()=>{
    const { container, imgSprite, toImgCoords, fromImgCoords, destroy } = setupImageScene(app, texture, imageW, imageH);
    const g = new PIXI.Graphics(); container.addChild(g);

    // ROI 框
    const p = fromImgCoords({x:roi.x1,y:roi.y1});
    const q = fromImgCoords({x:roi.x2,y:roi.y2});
    g.lineStyle(3, 0x00E5FF, 1).drawRect(p.x, p.y, q.x-p.x, q.y-p.y);

    // 显示当前选择的候选叠加
    (async ()=>{
      if(candidates.length===0) return;
      const sp = await makeMaskPreviewSprite(app, maskUrlOf(candidates[selectedIndex]), 0xFFFF00, 0.45);
      sp.position.set(imgSprite.position.x, imgSprite.position.y);
      sp.scale.set(imgSprite.scale.x); // 保持与底图同缩放
      container.addChild(sp);
      setReady(true);
      return ()=> sp.destroy();
    })();

    window.addEventListener("keydown",(ev)=>{
      if(ev.key>="1" && ev.key<="9"){
        const idx = Math.min(candidates.length, parseInt(ev.key,10)) - 1;
        if(idx>=0){ onSelect(idx); }
      }
      if(ev.key==="Enter") onToBrush();
    });

    return ()=>{ destroy(); };
  },[app, texture, imageW, imageH, roi, candidates, maskUrlOf, selectedIndex, onSelect, onToBrush]);

  return null;
}
