export const MAX_CLIP_BYTES: number;
export const CLIP_UPLOAD_PART_BYTES: number;
export const MAX_CLIP_SINGLE_UPLOAD_BYTES: number;
export const MAX_CLIP_INSPECTION_BYTES: number;
export const MAX_CLIP_DURATION: number;
export const MAX_CLIP_SIDE: number;
export const MAX_CLIP_PIXELS: number;
export const MAX_CLIP_FPS: number;
export const CLIP_MIME_TYPE: string;
export const CLIP_MIME_TYPES: string[];
export const CLIP_FILE_ACCEPT: string;
export function getClipInputFormats<T extends { mimeType: string }>(formats: T[]): T[];
export interface ClipMetadata {
    mimeType: string; formatName: string; colorSpace: Record<string, unknown> | null;
    width: number; height: number; duration: number; firstTimestamp: number;
    fps: number; codec: string; rotation: number; codedWidth: number; codedHeight: number;
}
export function inspectClipInput(input: { canRead(): Promise<boolean>; getFormat(): Promise<{ mimeType: string; name: string }>; getPrimaryVideoTrack(): Promise<any> }): Promise<ClipMetadata>;
