import type { InitResp, SegmentResp, ExportResp, AssetItem } from "./types";

const API_BASE = (window as any).__API_BASE__ || "http://localhost:7001";

export async function samInitByPath(image_path: string, image_name?: string): Promise<InitResp> {
  const r = await fetch(`${API_BASE}/sam/init`, {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ image_path, image_name })
  });
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function samInitByFile(file: File): Promise<InitResp> {
  const b64 = await fileToDataURL(file);
  const r = await fetch(`${API_BASE}/sam/init`, {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ image_b64: b64, image_name: file.name })
  });
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function samSegment(payload:{
  session_id:string; box:[number,number,number,number];
  points:[number,number][]; labels:number[];
  multimask?:boolean; top_n?:number; smooth?:boolean;
}): Promise<SegmentResp>{
  const r = await fetch(`${API_BASE}/sam/segment`, {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ multimask:true, top_n:3, smooth:true, ...payload })
  });
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}

export function maskUrl(session_id:string, mask_id:string){
  return `${API_BASE}/sam/mask/${session_id}/${mask_id}`;
}

export async function exportROIByMaskId(payload:{
  session_id:string; mask_id:string; roi_index:number; feather_px?:number;
}): Promise<ExportResp>{
  const r = await fetch(`${API_BASE}/sam/export-roi`, {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function exportROIByMaskPngB64(payload:{
  session_id:string; mask_png_b64:string; roi_index:number; feather_px?:number;
}): Promise<ExportResp>{
  const r = await fetch(`${API_BASE}/sam/export-roi`, {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function fetchAssets(): Promise<AssetItem[]> {
  const r = await fetch(`${API_BASE}/assets/list?pattern=seg_*.png`);
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}

async function fileToDataURL(file: File): Promise<string> {
  return await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

export { API_BASE };
