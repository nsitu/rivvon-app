import { describe, expect, it } from 'vitest';
import { createDrawingPayload } from './drawingLibrary.js';
import {
    RENDER_SNAPSHOT_VERSION,
    createRenderSnapshot,
    parseRenderSnapshot,
} from './renderSnapshot.js';

describe('render snapshots', () => {
    it('uses the saved drawing payload shape for source paths', () => {
        const payload = createDrawingPayload({
            kind: 'gesture',
            name: 'Example',
            paths: [[
                { x: 0, y: 1, z: 0 },
                { x: 2, y: 3, z: 0 },
            ]],
            source: { strokeCount: 1 },
        });

        expect(payload).toMatchObject({
            version: 1,
            kind: 'gesture',
            pathCount: 1,
            pointCount: 2,
            paths: [[
                { x: 0, y: 1, z: 0 },
                { x: 2, y: 3, z: 0 },
            ]],
        });
    });

    it('round-trips a versioned snapshot without retaining mutable references', () => {
        const snapshot = createRenderSnapshot({
            source: { kind: 'gesture', pathCount: 1 },
            textures: [{ id: 'texture-1', assignmentIndex: 0 }],
            viewerSettings: { ribbonWidthScale: 1.5 },
            exportSettings: { width: 1080, height: 1080 },
            shareState: { kind: 'unshareable' },
        });

        expect(snapshot.schemaVersion).toBe(RENDER_SNAPSHOT_VERSION);
        expect(parseRenderSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
        expect(parseRenderSnapshot({ ...snapshot, schemaVersion: 99 })).toBeNull();
    });
});
