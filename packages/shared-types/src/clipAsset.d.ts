export const MAX_CLIP_BYTES: number;
export const CLIP_UPLOAD_PART_BYTES: number;
export const MAX_CLIP_SINGLE_UPLOAD_BYTES: number;
export const MAX_CLIP_INSPECTION_BYTES: number;
export const MAX_CLIP_DURATION: number;
export const MAX_CLIP_SIDE: number;
export const MAX_CLIP_PIXELS: number;
export const MAX_CLIP_FPS: number;
export const CLIP_MIME_TYPE: string;
export interface ClipMetadata {
    width: number; height: number; duration: number; firstTimestamp: number;
    fps: number; codec: string; rotation: number; codedWidth: number; codedHeight: number;
}
export function validateClipAvc(description: ArrayBuffer | ArrayLike<number> | undefined): void;
export function inspectClipInput(input: { getVideoTracks(): Promise<any[]> }): Promise<ClipMetadata>;
