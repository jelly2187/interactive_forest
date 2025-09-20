export type InitResp = { session_id: string; width: number; height: number; image_name: string };
export type MaskInfo = { mask_id: string; score: number; path: string };
export type SegmentResp = { masks: MaskInfo[]; width: number; height: number };
export type ExportResp = { sprite_path: string; bbox: { xmin:number;ymin:number;xmax:number;ymax:number } };
export type AssetItem = { name: string; url: string; size: number };
