// This allowlist is the persisted artwork contract. Never add renderer quality,
// input devices, wake lock, panel visibility, or other personal preferences here.
export const SCENE_PRESET_VERSION = 1;
export const ARTWORK_DEFAULTS = Object.freeze({
    artworkMotionMode: 'none', viewerMotionLoopCount: 1,
    flowState: 'off', flowSpeed: 0.25, undulationEnabled: true,
    flowCycleAlignmentEnabled: true, textureAnimationEnabled: true,
    textureAnimationReversed: false, textureRepeatMode: 'mirrorTile',
    normalizeTextureOrientation: true, textureFlipVertical: false,
    animatedBackgroundEnabled: false, backgroundLayerIndex: 0,
    backgroundAnimationSyncEnabled: true, backgroundCycleDuration: 12,
    backgroundFlipVertical: false, backgroundFlowEnabled: false, backgroundFlowSpeed: 0.25,
    backgroundBlurEnabled: true, backgroundBlurAmount: 150,
    backgroundOverlayEnabled: false, backgroundOverlayColor: '#ffffff', backgroundOverlayOpacity: 0.35,
    backgroundTextureEnabled: false, backgroundTexture: 'card', backgroundBaseEnabled: true,
    backgroundSphericalLayersEnabled: false, backgroundCurvature: 0.6,
    backgroundWaterEnabled: false, backgroundWaterColor: '#66c7d8', backgroundWaterFlow: 35,
    backgroundWaterScale: 8, backgroundWaterSpeed: 1, backgroundWaterStrength: 0.28,
    peakTroughTransparencyEnabled: false, peakTroughBlurEnabled: false,
    peakTroughEffectType: 'transparency', peakTroughBlurAmount: 4,
    peakTroughGradientStart: 0.65, peakTroughGradientEnd: 1,
    renderFilterMode: 'none', transparentShadowsEnabled: false, overlapOnlyTransparencyEnabled: false,
    transparencyMethod: 'brightness', transparencyMode: 'shadows', transparencyReferenceColor: '#ffffff',
    transparentShadowsThresholdMin: 0.2, transparentShadowsThresholdMax: 0.5,
    edgeDriftEnabled: false, edgeNoiseTransparencyMax: 0.5, edgeNoisePatternLength: 0.5, edgeNoiseMirrored: false,
    filmstripStyleEnabled: false, filmstripMotionEnabled: false, filmstripMotionSpeed: 1,
    filmstripGapLength: 0.15, filmstripHoleLength: 0.1, filmstripAperture: 0.23, filmstripHoleRoundedness: 0.33,
    gradientMapStops: [{ position: 0, color: '#000000' }, { position: 0.5, color: '#ff7a00' }, { position: 1, color: '#ffffff' }],
    contrast: 1, saturation: 1, ribbonWidthScale: 1, ribbonPathAlignmentMode: 'center',
    surfaceMode: 'ribbon', tubeRadiusScale: 0.5, tubeRadialSegments: 8, tubeTextureJoinOffsetDegrees: 0,
    helixMode: false, helixRadius: 0.2, helixPitch: 9, helixStrandWidth: 0.5,
    capStyle: 'rounded', cornerNarrowingEnabled: false,
    sphericalProjectionEnabled: false, sphericalProjectionWrapDegrees: 100,
    sphericalProjectionLowerLatitudeDegrees: -50, sphericalProjectionUpperLatitudeDegrees: 50,
    sphericalProjectionVerticalWrapAuto: true, sphericalProjectionArtworkAspectRatio: 1,
    sceneLightingEnabled: false, sceneLightingIntensity: 1, sceneLightDistance: 10,
    sceneShadowPlaneDistance: 90, sceneColoredShadowsEnabled: false, sceneShadowOpacity: 0.25,
});

const ENUMS = {
    artworkMotionMode: ['none', 'circularTilt', 'circularOrbit', 'circularOrbitReverse', 'tumbleOrbit'],
    flowState: ['off', 'forward', 'backward'], textureRepeatMode: ['wrap', 'mirrorTile', 'bounce'],
    peakTroughEffectType: ['transparency', 'blur'], renderFilterMode: ['none', 'gradientMap'],
    transparencyMethod: ['brightness', 'color', 'saturation'], transparencyMode: ['shadows', 'highlights'],
    ribbonPathAlignmentMode: ['inside', 'center', 'outside'], surfaceMode: ['ribbon', 'tube'],
    capStyle: ['rounded', 'square', 'pointed', 'swallowtail'], backgroundTexture: ['card', 'textile'],
};
const COLOR = /^#[\da-f]{6}([\da-f]{2})?$/i;
const RANGES = {
    viewerMotionLoopCount: [0.125, 8], flowSpeed: [0, 10], backgroundLayerIndex: [0, 4095],
    backgroundCycleDuration: [0.25, 120],
    backgroundFlowSpeed: [0, 10], backgroundBlurAmount: [0, 200], backgroundOverlayOpacity: [0, 1],
    backgroundCurvature: [0, 1], backgroundWaterFlow: [0, 360], backgroundWaterScale: [0.01, 100],
    backgroundWaterSpeed: [0, 10], backgroundWaterStrength: [0, 1], peakTroughBlurAmount: [0, 32],
    peakTroughGradientStart: [0, 1], peakTroughGradientEnd: [0, 1], transparentShadowsThresholdMin: [0, 1],
    transparentShadowsThresholdMax: [0, 1], edgeNoiseTransparencyMax: [0, 1], edgeNoisePatternLength: [0.01, 10],
    filmstripMotionSpeed: [0, 10], filmstripGapLength: [0.01, 10], filmstripHoleLength: [0.01, 10],
    filmstripAperture: [0, 1], filmstripHoleRoundedness: [0, 1], contrast: [0, 2], saturation: [0, 2],
    ribbonWidthScale: [0.1, 2.5], tubeRadiusScale: [0.01, 10], tubeRadialSegments: [3, 64],
    tubeTextureJoinOffsetDegrees: [-360, 360], helixRadius: [0, 10], helixPitch: [0.01, 100], helixStrandWidth: [0.01, 10],
    sphericalProjectionWrapDegrees: [1, 360], sphericalProjectionLowerLatitudeDegrees: [-90, 90],
    sphericalProjectionUpperLatitudeDegrees: [-90, 90], sphericalProjectionArtworkAspectRatio: [0.001, 1000],
    sceneLightingIntensity: [0, 10], sceneLightDistance: [0.01, 100], sceneShadowPlaneDistance: [0.01, 200], sceneShadowOpacity: [0, 1],
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const finite = (value, name, min = -1e6, max = 1e6) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
        throw new Error(`Invalid ${name}`);
    }
    return value;
};
const text = (value, max = 500) => typeof value === 'string' ? value.slice(0, max) : '';

export function normalizeArtworkSettings(input = {}) {
    const result = {};
    for (const [key, fallback] of Object.entries(ARTWORK_DEFAULTS)) {
        const value = input[key] ?? clone(fallback);
        if (key === 'gradientMapStops') {
            if (!Array.isArray(value) || value.length < 2 || value.length > 8) throw new Error('Invalid gradient map');
            const ids = new Set();
            result[key] = value.map((stop, index) => {
                if (!COLOR.test(stop?.color)) throw new Error('Invalid gradient color');
                let id = text(stop.id, 64) || `stop-${index}`;
                while (ids.has(id)) id = `${id}-${index}`;
                ids.add(id);
                return { id, position: finite(stop.position, 'gradient position', 0, 1), color: stop.color };
            });
        } else if (ENUMS[key]) {
            if (!ENUMS[key].includes(value)) throw new Error(`Invalid ${key}`);
            result[key] = value;
        } else if (typeof fallback === 'number') {
            result[key] = finite(value, key, ...(RANGES[key] || [0, 1000]));
            if (['tubeRadialSegments', 'backgroundLayerIndex'].includes(key) && !Number.isInteger(value)) throw new Error(`Invalid ${key}`);
        } else if (typeof fallback === 'boolean') {
            if (typeof value !== 'boolean') throw new Error(`Invalid ${key}`);
            result[key] = value;
        } else {
            if (typeof value !== 'string' || value.length > 64 || (key.toLowerCase().includes('color') && !COLOR.test(value))) {
                throw new Error(`Invalid ${key}`);
            }
            result[key] = value;
        }
    }
    return result;
}

function vector(value, size, name) {
    if (!Array.isArray(value) || value.length !== size) throw new Error(`Invalid ${name}`);
    return value.map((n) => finite(n, name));
}

// Only scene authoring metadata crosses the preset boundary.
const SOURCE_KEYS = new Set(['text', 'font', 'fontFamily', 'fontId', 'fontWeight', 'fontSize', 'letterSpacing', 'lineHeight',
    'hexcode', 'label', 'fileName', 'type', 'settings', 'radius', 'width', 'handedness', 'twistPhase',
    'amplitudeMin', 'amplitudeMax', 'frequencyMin', 'frequencyMax', 'domainWidth', 'phaseSpeed',
    'amplitudeCycleSpeed', 'frequencyCycleSpeed', 'frequencyCyclePhase', 'verticalOffset', 'sampleCount',
    'hourHandLength', 'minuteHandLength', 'secondHandLength', 'millisecondHandLength']);
function authoringMetadata(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const output = {};
    for (const [key, value] of Object.entries(input)) {
        if (!SOURCE_KEYS.has(key)) continue;
        if (key === 'settings') output[key] = authoringMetadata(value);
        else if (typeof value === 'number') output[key] = finite(value, key);
        else if (typeof value === 'string') output[key] = text(value, key === 'text' ? 10000 : 500);
    }
    return output;
}

/** Strictly validate before loading; unknown fields are discarded on both client and server. */
export function normalizeScenePreset(input) {
    if (!input || input.schemaVersion !== SCENE_PRESET_VERSION) throw new Error('This preset version is not supported.');
    const geometry = input.geometry;
    if (!geometry || !Array.isArray(geometry.paths) || geometry.paths.length > 2048) throw new Error('Invalid preset geometry');
    let pointCount = 0;
    const paths = geometry.paths.map((path) => {
        if (!Array.isArray(path) || path.length < 2) throw new Error('Invalid preset path');
        pointCount += path.length;
        if (pointCount > 100000) throw new Error('Preset geometry is too large');
        return path.map((point) => ({ x: finite(point.x, 'point'), y: finite(point.y, 'point'), z: finite(point.z, 'point') }));
    });
    const procedural = geometry.procedural;
    if (procedural && (!['sineWave', 'clock', 'mobius'].includes(procedural.type) || !procedural.settings || typeof procedural.settings !== 'object')) {
        throw new Error('Invalid procedural shape');
    }
    if (!paths.length && !procedural) throw new Error('This scene has no saved geometry');
    if (!Array.isArray(input.textures) || !input.textures.length || input.textures.length > 16) throw new Error('Invalid preset textures');
    let tileTotal = 0;
    const textures = input.textures.map((texture) => {
        const tileCount = finite(texture.tileCount, 'tile count', 1, 1024);
        tileTotal += tileCount;
        if (!Number.isInteger(tileCount) || tileTotal > 2048) throw new Error('Too many texture tiles');
        return {
            id: text(texture.id, 64), name: text(texture.name), tileCount,
            tileResolution: finite(texture.tileResolution, 'tile resolution', 1, 4096),
            layerCount: finite(texture.layerCount, 'layer count', 1, 4096),
            variant: texture.variant === 'planes' ? 'planes' : 'waves',
        };
    });
    const camera = input.camera;
    if (!camera) throw new Error('Missing preset camera');
    const rois = camera.cinematic?.rois || [];
    if (!Array.isArray(rois) || rois.length > 256) throw new Error('Too many camera points');
    const motion = camera.motion;
    if (motion && (!Array.isArray(motion.samples) || motion.samples.length < 2 || motion.samples.length > 18000
        || motion.samples.some((sample, index) => index > 0 && sample.t <= motion.samples[index - 1].t))) throw new Error('Invalid camera recording');
    const audio = input.audio;
    return {
        schemaVersion: SCENE_PRESET_VERSION,
        geometry: {
            paths, kind: text(geometry.kind, 32), title: text(geometry.title),
            // Source metadata is authoring data, never URLs or authentication state.
            source: authoringMetadata(geometry.source),
            width: finite(geometry.width ?? 1.2, 'ribbon width', 0.001, 100),
            procedural: procedural ? { type: procedural.type, settings: authoringMetadata(procedural.settings),
                baseTimeMs: procedural.baseTimeMs == null ? null : finite(procedural.baseTimeMs, 'clock base time', 0, 1e15) } : null,
        },
        artwork: normalizeArtworkSettings(input.artwork), textures,
        camera: {
            position: vector(camera.position, 3, 'camera position'), target: vector(camera.target, 3, 'camera target'),
            up: vector(camera.up ?? [0, 1, 0], 3, 'camera up'), quaternion: vector(camera.quaternion, 4, 'camera rotation'),
            fov: finite(camera.fov, 'field of view', 1, 179),
            cinematic: {
                rois: rois.map((roi) => ({ position: vector(roi.position, 3, 'camera point'), target: vector(roi.target, 3, 'camera target'), fov: finite(roi.fov, 'field of view', 1, 179) })),
                minSpeedRatio: finite(camera.cinematic?.minSpeedRatio ?? 0.2, 'camera speed', 0, 1),
                dwellRadiusFraction: finite(camera.cinematic?.dwellRadiusFraction ?? 0.3, 'dwell radius', 0, 10),
                microMotionEnabled: Boolean(camera.cinematic?.microMotionEnabled),
            },
            motion: motion ? {
                version: 1, closureDuration: finite(motion.closureDuration ?? 0, 'closure duration', 0, 600),
                samples: motion.samples.map((sample) => ({ t: finite(sample.t, 'sample time', 0, 3600), position: vector(sample.position, 3, 'camera position'), target: vector(sample.target, 3, 'camera target'), quaternion: vector(sample.quaternion, 4, 'camera rotation'), fov: finite(sample.fov, 'field of view', 1, 179) })),
            } : null,
        },
        animation: { time: finite(input.animation?.time ?? 0, 'animation time', 0, 1e9),
            backgroundLayerProgress: input.animation?.backgroundLayerProgress == null ? null
                : finite(input.animation.backgroundLayerProgress, 'background layer progress', 0, 1),
            motion: input.animation?.motion ? {
                elapsed: finite(input.animation.motion.elapsed, 'motion elapsed', 0, 1e9),
                position: vector(input.animation.motion.position, 3, 'motion position'),
                quaternion: vector(input.animation.motion.quaternion, 4, 'motion rotation'),
                pivot: vector(input.animation.motion.pivot, 3, 'motion pivot'),
                baseRight: vector(input.animation.motion.baseRight, 3, 'motion axis'),
                baseUp: vector(input.animation.motion.baseUp, 3, 'motion axis'),
            } : null,
            textures: textures.map((_, index) => ({
                layerProgress: finite(input.animation?.textures?.[index]?.layerProgress ?? 0, 'layer progress'),
                flowOffset: finite(input.animation?.textures?.[index]?.flowOffset ?? 0, 'flow offset'),
                tileFlowOffset: finite(input.animation?.textures?.[index]?.tileFlowOffset ?? 0, 'tile flow offset'),
                filmstripOffset: finite(input.animation?.textures?.[index]?.filmstripOffset ?? 0, 'filmstrip offset'),
            })),
        },
        audio: audio ? {
            assetId: text(audio.assetId, 64), sourcePresetId: text(audio.sourcePresetId, 64),
            loop: Boolean(audio.loop), reactiveEnabled: Boolean(audio.reactiveEnabled),
            sensitivity: finite(audio.sensitivity ?? 3, 'audio sensitivity', 0, 20), amount: finite(audio.amount ?? 0.2, 'audio amount', 0, 1),
        } : null,
    };
}
