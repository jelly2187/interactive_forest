import { useEffect, useRef } from "react";
import * as PIXI from "pixi.js";
import { fetchAssets, API_BASE } from "../api";

export default function Stage(){
  const ref = useRef<HTMLDivElement>(null);

  useEffect(()=>{
    const app = new PIXI.Application({ resizeTo: window, backgroundColor:0x000000, antialias:true });
    ref.current?.appendChild(app.view as HTMLCanvasElement);

    // 背景视频
    const video = document.createElement("video");
    video.src = "/video/forest.mp4";
    video.loop = true; video.muted = true; video.playsInline = true; video.autoplay = true;
    video.addEventListener("canplay", ()=>video.play().catch(()=>{}));
    const tex = PIXI.Texture.from(video);
    const bg = new PIXI.Sprite(tex); bg.anchor.set(0.5); app.stage.addChild(bg);

    function layout(){
      const W=window.innerWidth, H=window.innerHeight;
      const vw=video.videoWidth||1920, vh=video.videoHeight||1080;
      const s = Math.max(W/vw, H/vh); bg.position.set(W/2,H/2); bg.scale.set(s);
    }
    layout(); window.addEventListener("resize", layout);

    // 前景 PNG
    const layer = new PIXI.Container(); app.stage.addChild(layer);

    async function loadSprites(){
      layer.removeChildren();
      const assets = await fetchAssets();
      for(const a of assets){
        const t = await PIXI.Assets.load({ src: `${API_BASE}${a.url}`, crossOrigin:"anonymous" });
        const sp = new PIXI.Sprite(t as PIXI.Texture);
        sp.anchor.set(0.5);
        const W=window.innerWidth,H=window.innerHeight;
        sp.x = Math.random()*W; sp.y = Math.random()*H; sp.scale.set(Math.min(W,H)/1080*0.5);
        layer.addChild(sp);
        const baseY=sp.y, phase=Math.random()*Math.PI*2;
        app.ticker.add((tk)=>{ sp.y = baseY + Math.sin(phase + tk.lastTime/900)*8; });
      }
    }
    loadSprites().catch(console.error);

    return ()=>{ window.removeEventListener("resize", layout); app.destroy(true); };
  },[]);

  return <div className="page"><div className="main"><div className="canvas-holder" ref={ref}/></div></div>;
}
