import { useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import { samInitByFile, samInitByPath, samSegment, maskUrl, exportROIByMaskId, exportROIByMaskPngB64 } from "../api";
import type { InitResp, MaskInfo } from "../types";
import ROISelector from "../components/pixi/ROISelector";
import PointSelector from "../components/pixi/PointSelector";
import CandidatePreview from "../components/pixi/CandidatePreview";
import BrushRefine from "../components/pixi/BrushRefine";

type ROI = { x1:number;y1:number;x2:number;y2:number };

export default function Editor(){
  const holderRef = useRef<HTMLDivElement>(null);
  const [app, setApp] = useState<PIXI.Application>();
  const [imgTex, setImgTex] = useState<PIXI.Texture>();
  const [imgW, setImgW] = useState(0);
  const [imgH, setImgH] = useState(0);
  const [sess, setSess]   = useState<InitResp>();
  const [rois, setRois]   = useState<ROI[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [points, setPoints] = useState<{p:[number,number], l:0|1}[]>([]);
  const [cands, setCands] = useState<MaskInfo[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number>(0);
  const [roiCounter, setRoiCounter] = useState<number>(1);
  const [step, setStep] = useState<"roi"|"points"|"cands"|"brush"|"idle">("idle");
  const [message, setMessage] = useState<string>("");

  // init Pixi app
  useEffect(()=>{
    const app = new PIXI.Application({ resizeTo: window, backgroundColor:0x000000, antialias:true });
    setApp(app);
    if(holderRef.current) holderRef.current.appendChild(app.view as HTMLCanvasElement);
    return ()=>app.destroy(true);
  },[]);

  async function loadImageFromFile(f: File){
    const ir = await samInitByFile(f);
    setSess(ir); setImgW(ir.width); setImgH(ir.height);
    const tex = await PIXI.Assets.load({ src: (f as any).path ? `file://${(f as any).path}` : URL.createObjectURL(f) });
    setImgTex(tex as PIXI.Texture); setStep("roi"); setRois([]); setActiveIndex(-1); setPoints([]);
    setMessage(`Loaded ${ir.image_name} (${ir.width}x${ir.height})`);
  }
  async function loadImageFromPath(path: string){
    const ir = await samInitByPath(path);
    setSess(ir); setImgW(ir.width); setImgH(ir.height);
    // 让预览用后端的 /files 读取不现实，所以这里简单用 <img> 加载本地文件需要 file:// 协议；也可以用后端返回的缩略图
    const tex = await PIXI.Assets.load({ src: path });
    setImgTex(tex as PIXI.Texture); setStep("roi"); setRois([]); setActiveIndex(-1); setPoints([]);
    setMessage(`Loaded ${ir.image_name} (${ir.width}x${ir.height})`);
  }

  async function doSegmentForActiveROI(){
    if(!sess || activeIndex<0) return;
    const r = rois[activeIndex];
    const pts = points.map(x=>x.p);
    const labs = points.map(x=>x.l);
    setMessage("Segmenting...");
    const seg = await samSegment({
      session_id: sess.session_id,
      box: [r.x1,r.y1,r.x2,r.y2],
      points: pts, labels: labs, top_n: 3, multimask:true, smooth:true
    });
    setCands(seg.masks);
    setSelectedIdx(0);
    setStep("cands");
    setMessage(`Got ${seg.masks.length} candidates`);
  }

  async function exportByCandidate(){
    if(!sess) return;
    const cand = cands[selectedIdx];
    const out = await exportROIByMaskId({
      session_id: sess.session_id, mask_id: cand.mask_id, roi_index: roiCounter, feather_px: 6
    });
    setRoiCounter(v=>v+1);
    setMessage(`Exported: ${out.sprite_path}`);
  }

  async function exportByBrush(maskPngB64: string){
    if(!sess) return;
    const out = await exportROIByMaskPngB64({
      session_id: sess.session_id, mask_png_b64: maskPngB64, roi_index: roiCounter, feather_px: 6
    });
    setRoiCounter(v=>v+1);
    setMessage(`Exported: ${out.sprite_path}`);
  }

  return (
    <div className="page">
      <div className="sidebar">
        <div className="row">
          <input type="file" accept="image/*" onChange={e=>{ const f=e.target.files?.[0]; if(f) loadImageFromFile(f); }}/>
        </div>
        <div className="row">
          <label>或后端可读路径（image_path）</label>
          <input type="text" placeholder="assets/datasets/test/drawing_0030.png" id="p"/>
          <button className="btn" onClick={()=> {
            const p = (document.getElementById("p") as HTMLInputElement).value.trim();
            if(p) loadImageFromPath(p);
          }}>加载</button>
        </div>
        <hr/>
        <div className="row"><strong>Step:</strong> {step}</div>
        <div className="hint">{message}</div>
        {step==="roi" && <div className="hint">拖拽添加矩形；Backspace 删除最后；Enter 选中并进入点选</div>}
        {step==="points" && <div className="hint">左键前景，右键背景；按 <span className="kbd">S</span> 分割</div>}
        {step==="cands" && <div className="hint">按数字 1..N 选择；点击“进入画笔微调”可继续细化</div>}
        {step==="brush" && <div className="hint">左键补、右键删；[ ] 调刷子；Ctrl+E 导出</div>}

        {step==="cands" && <div className="row">
          <button className="btn" onClick={exportByCandidate}>直接导出该候选</button>
        </div>}
      </div>

      <div className="main">
        <div className="canvas-holder" ref={holderRef}/>
        {app && imgTex && step==="roi" && (
          <ROISelector app={app} texture={imgTex} imageW={imgW} imageH={imgH}
            rois={rois} onChange={setRois}
            onSelect={(idx)=>{ setActiveIndex(idx); setStep("points"); setPoints([]); setMessage(`ROI #${idx+1} selected`); }}
          />
        )}
        {app && imgTex && step==="points" && activeIndex>=0 && (
          <PointSelector app={app} texture={imgTex} imageW={imgW} imageH={imgH}
            roi={rois[activeIndex]}
            points={points} onChange={setPoints}
            onSubmit={doSegmentForActiveROI}
          />
        )}
        {app && imgTex && step==="cands" && activeIndex>=0 && (
          <CandidatePreview app={app} texture={imgTex} imageW={imgW} imageH={imgH}
            roi={rois[activeIndex]}
            candidates={cands}
            maskUrlOf={(m)=>maskUrl(sess!.session_id, m.mask_id)}
            selectedIndex={selectedIdx}
            onSelect={setSelectedIdx}
            onToBrush={()=> setStep("brush")}
          />
        )}
        {app && imgTex && step==="brush" && activeIndex>=0 && (
          <BrushRefine app={app} texture={imgTex} imageW={imgW} imageH={imgH}
            roi={rois[activeIndex]}
            baseMaskUrl={maskUrl(sess!.session_id, cands[selectedIdx].mask_id)}
            onExport={exportByBrush}
            onCancel={()=> setStep("cands")}
          />
        )}
      </div>
    </div>
  );
}
