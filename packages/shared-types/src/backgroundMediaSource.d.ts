export type BackgroundMediaSource = { kind: 'builtin' | 'image' | 'clip'; id: string };
export const BUILTIN_BACKGROUND_IDS: string[];
export function normalizeBackgroundSource(value?: unknown, legacy?: string): BackgroundMediaSource;
