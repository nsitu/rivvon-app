import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { createPinia, setActivePinia } from 'pinia';
import { useSlyceStore } from '../../stores/slyceStore.js';
import { buildFileTextureSaveSource, saveProcessedTextureFamilyLocally } from './localTexturePersistence.js';
import { createLocalSaveState, createObjectLocalSaveController } from './localSaveController.js';
import { saveTextureSet } from '../../services/localStorage.js';
import { downloadAllAsZip } from './zipDownloader.js';

vi.mock('../../services/localStorage.js', () => ({ saveTextureSet: vi.fn(async () => 'local-root') }));
vi.mock('./textureVariantDerivation.js', () => ({ deriveKtx2TextureFamily: vi.fn(async () => ({ variants: [{ targetResolution: 256,
    result: { output: { tileCount: 1, pixelWidth: 256, layerCount: 2 }, outputBlobs: { 0: new Uint8Array([1]) } } }] })) }));
const provenance = { version: 1, provider: 'google-photos', mediaItemId: 'source-id', originalFilename: 'original.mov', downloadVariant: 'google-photos-dv-transcode' };

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });
describe('source provenance through processing and export', () => {
    it('retains provenance during processing resets and clears it for a new local file', async () => {
        setActivePinia(createPinia());
        const store = useSlyceStore();
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:video');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        expect(await store.beginFileWorkflowWithFile(new File(['video'], 'imported.mp4', { type: 'video/mp4' }), provenance)).toBe(true);
        store.resetProcessing();
        expect(store.sourceProvenance).toEqual(provenance);
        await store.beginFileWorkflowWithFile(new File(['video'], 'local.mp4', { type: 'video/mp4' }));
        expect(store.sourceProvenance).toBeNull();
        store.sourceProvenance = provenance;
        store.reset();
        expect(store.sourceProvenance).toBeNull();
    });
    it('saves source facts on the root and derived variants with measured metadata', async () => {
        const app = { sourceProvenance: provenance, fileInfo: { name: 'imported.mp4', width: 1920, height: 1080, duration: 4 },
            frameCount: 120, framesToSample: 120, effectiveFrameCount: 120, frameInterpolationFactor: 1,
            textureName: 'Imported', potResolution: 512, crossSectionCount: 2, autoDeriveResolutions: [256] };
        const state = createLocalSaveState();
        await saveProcessedTextureFamilyLocally(createObjectLocalSaveController(state), buildFileTextureSaveSource(app, { ktx2Blobs: { 0: new Uint8Array([1]) } }));
        expect(saveTextureSet).toHaveBeenCalledTimes(2);
        for (const [entry] of saveTextureSet.mock.calls) expect(entry.sourceMetadata).toMatchObject({ filename: 'imported.mp4', duration: 4, provenance });
    });
    it('includes source provenance in an actual processing ZIP metadata file', async () => {
        let exported;
        vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { exported = blob; return 'blob:zip'; });
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        vi.stubGlobal('document', { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } });
        await downloadAllAsZip({}, { name: 'imported.mp4' }, { extension: 'ktx2', mime: 'image/ktx2' }, { sourceProvenance: provenance });
        const archive = await JSZip.loadAsync(await exported.arrayBuffer());
        expect(JSON.parse(await archive.file('metadata.json').async('text')).video.provenance).toEqual(provenance);
    });
});
