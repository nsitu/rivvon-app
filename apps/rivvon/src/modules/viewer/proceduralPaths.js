import * as THREE from 'three';

export const PROCEDURAL_SOURCE_TYPES = Object.freeze(['sineWave', 'clock']);

export const DEFAULT_SINE_WAVE_SETTINGS = Object.freeze({
    amplitudeMin: 0.05,
    amplitudeMax: 1.1,
    frequencyMin: 0.25,
    frequencyMax: 3.2,
    domainWidth: 3.2,
    phaseSpeed: 1.6,
    amplitudeCycleSpeed: 0.45,
    frequencyCycleSpeed: 0.27,
    frequencyCyclePhase: Math.PI * 0.35,
    verticalOffset: 0,
    sampleCount: 220,
});

export const DEFAULT_CLOCK_SETTINGS = Object.freeze({
    hourHandLength: 0.52,
    minuteHandLength: 0.8,
    secondHandLength: 0.94,
    millisecondHandLength: 1.02,
});

const CLOCK_LAYOUT_RADIUS = 2.4;

const CLOCK_HAND_START_OFFSET_FACTORS = Object.freeze({
    hour: 0.1152,
    minute: 0.1472,
    second: 0.1888,
    millisecond: 0.08,
});

const CLOCK_CENTER_HUB_RADIUS_FACTOR = 0.055;

function clampNumber(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, parsed));
}

function oscillate(min, max, phase) {
    if (max <= min) {
        return min;
    }

    return min + (max - min) * (0.5 + 0.5 * Math.sin(phase));
}

function isKnownProceduralSourceType(type) {
    return PROCEDURAL_SOURCE_TYPES.includes(type);
}

function getClockHandAngle(turnFraction) {
    return Math.PI * 0.5 - turnFraction * Math.PI * 2;
}

function getClockHandSegmentBounds(reach, gapOffset) {
    const safeReach = Math.max(0, reach);
    const startRadius = Math.min(gapOffset, safeReach * 0.85);

    return {
        startRadius,
        endRadius: safeReach,
    };
}

function createClockHandPath(angle, reach, startOffset) {
    const direction = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
    const center = new THREE.Vector3(0, 0, 0);
    const { startRadius, endRadius } = getClockHandSegmentBounds(reach, startOffset);
    const start = center.clone().addScaledVector(direction, startRadius);
    const tip = center.clone().addScaledVector(direction, endRadius);

    return [start, tip];
}

function createCircularPath(radius, sampleCount = 96) {
    const samples = Math.max(12, Math.round(sampleCount));
    const points = [];

    for (let index = 0; index <= samples; index += 1) {
        const turn = index / samples;
        const angle = Math.PI * 0.5 - turn * Math.PI * 2;
        points.push(new THREE.Vector3(
            Math.cos(angle) * radius,
            Math.sin(angle) * radius,
            0,
        ));
    }

    return points;
}

function createClockTickPath(angle, innerRadius, outerRadius) {
    const direction = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
    const center = new THREE.Vector3(0, 0, 0);

    return [
        center.clone().addScaledVector(direction, innerRadius),
        center.clone().addScaledVector(direction, outerRadius),
    ];
}

function getClockBezelRadii(radius) {
    return {
        bezelRadius: radius * 1.08,
        tickInnerRadius: radius * 0.9,
        tickOuterRadius: radius * 1.02,
    };
}

function getClockHandStartOffsets(radius) {
    return {
        hour: radius * CLOCK_HAND_START_OFFSET_FACTORS.hour,
        minute: radius * CLOCK_HAND_START_OFFSET_FACTORS.minute,
        second: radius * CLOCK_HAND_START_OFFSET_FACTORS.second,
        millisecond: radius * CLOCK_HAND_START_OFFSET_FACTORS.millisecond,
    };
}

function getClockCenterHubRadius(radius) {
    return radius * CLOCK_CENTER_HUB_RADIUS_FACTOR;
}

function generateClockPathsFromParameters(params) {
    const { bezelRadius, tickInnerRadius, tickOuterRadius } = getClockBezelRadii(params.radius);
    const startOffsets = getClockHandStartOffsets(params.radius);
    const centerHubRadius = getClockCenterHubRadius(params.radius);

    return [
        createCircularPath(bezelRadius, 96),
        createClockTickPath(Math.PI * 0.5, tickInnerRadius, tickOuterRadius),
        createClockTickPath(0, tickInnerRadius, tickOuterRadius),
        createClockTickPath(-Math.PI * 0.5, tickInnerRadius, tickOuterRadius),
        createClockTickPath(Math.PI, tickInnerRadius, tickOuterRadius),
        createCircularPath(centerHubRadius, 36),
        createClockHandPath(params.hourAngle, params.radius * params.hourHandLength, startOffsets.hour),
        createClockHandPath(params.minuteAngle, params.radius * params.minuteHandLength, startOffsets.minute),
        createClockHandPath(params.secondAngle, params.radius * params.secondHandLength, startOffsets.second),
        createClockHandPath(params.millisecondAngle, params.radius * params.millisecondHandLength, startOffsets.millisecond),
    ];
}

function resolveClockBaseTimeMs(runtimeState = {}, time = 0) {
    const existingBaseTimeMs = Number(runtimeState.baseTimeMs);
    if (Number.isFinite(existingBaseTimeMs)) {
        return existingBaseTimeMs;
    }

    const safeTime = Number.isFinite(time) ? time : 0;
    return Date.now() - safeTime * 1000;
}

export function normalizeProceduralSourceType(type, fallback = 'sineWave') {
    if (isKnownProceduralSourceType(type)) {
        return type;
    }

    return isKnownProceduralSourceType(fallback) ? fallback : 'sineWave';
}

export function normalizeSineWaveSettings(settings = {}) {
    const amplitudeMin = clampNumber(settings.amplitudeMin, DEFAULT_SINE_WAVE_SETTINGS.amplitudeMin, 0, 4);
    const amplitudeMax = clampNumber(settings.amplitudeMax, DEFAULT_SINE_WAVE_SETTINGS.amplitudeMax, amplitudeMin, 4);
    const frequencyMin = clampNumber(settings.frequencyMin, DEFAULT_SINE_WAVE_SETTINGS.frequencyMin, 0.05, 12);
    const frequencyMax = clampNumber(settings.frequencyMax, DEFAULT_SINE_WAVE_SETTINGS.frequencyMax, frequencyMin, 12);

    return {
        amplitudeMin,
        amplitudeMax,
        frequencyMin,
        frequencyMax,
        domainWidth: clampNumber(settings.domainWidth, DEFAULT_SINE_WAVE_SETTINGS.domainWidth, 0.5, 24),
        phaseSpeed: clampNumber(settings.phaseSpeed, DEFAULT_SINE_WAVE_SETTINGS.phaseSpeed, -12, 12),
        amplitudeCycleSpeed: clampNumber(settings.amplitudeCycleSpeed, DEFAULT_SINE_WAVE_SETTINGS.amplitudeCycleSpeed, 0, 4),
        frequencyCycleSpeed: clampNumber(settings.frequencyCycleSpeed, DEFAULT_SINE_WAVE_SETTINGS.frequencyCycleSpeed, 0, 4),
        frequencyCyclePhase: clampNumber(settings.frequencyCyclePhase, DEFAULT_SINE_WAVE_SETTINGS.frequencyCyclePhase, -Math.PI * 2, Math.PI * 2),
        verticalOffset: clampNumber(settings.verticalOffset, DEFAULT_SINE_WAVE_SETTINGS.verticalOffset, -8, 8),
        sampleCount: Math.round(clampNumber(settings.sampleCount, DEFAULT_SINE_WAVE_SETTINGS.sampleCount, 32, 720)),
    };
}

export function normalizeClockSettings(settings = {}) {
    return {
        hourHandLength: clampNumber(settings.hourHandLength, DEFAULT_CLOCK_SETTINGS.hourHandLength, 0.1, 1),
        minuteHandLength: clampNumber(settings.minuteHandLength, DEFAULT_CLOCK_SETTINGS.minuteHandLength, 0.1, 1.2),
        secondHandLength: clampNumber(settings.secondHandLength, DEFAULT_CLOCK_SETTINGS.secondHandLength, 0.1, 1.3),
        millisecondHandLength: clampNumber(settings.millisecondHandLength, DEFAULT_CLOCK_SETTINGS.millisecondHandLength, 0.1, 1.4),
    };
}

export function getSineWaveParametersAtTime(settings = {}, time = 0) {
    const normalized = normalizeSineWaveSettings(settings);
    const safeTime = Number.isFinite(time) ? time : 0;

    return {
        ...normalized,
        amplitude: oscillate(
            normalized.amplitudeMin,
            normalized.amplitudeMax,
            safeTime * normalized.amplitudeCycleSpeed * Math.PI * 2
        ),
        frequency: oscillate(
            normalized.frequencyMin,
            normalized.frequencyMax,
            safeTime * normalized.frequencyCycleSpeed * Math.PI * 2 + normalized.frequencyCyclePhase
        ),
    };
}

export function generateSineWavePoints(settings = {}, time = 0) {
    const params = getSineWaveParametersAtTime(settings, time);
    const points = [];
    const halfWidth = params.domainWidth * 0.5;
    const phase = time * params.phaseSpeed;

    for (let index = 0; index < params.sampleCount; index += 1) {
        const progress = params.sampleCount <= 1 ? 0 : index / (params.sampleCount - 1);
        const x = -halfWidth + progress * params.domainWidth;
        const y = params.verticalOffset + params.amplitude * Math.sin(progress * params.frequency * Math.PI * 2 + phase);
        points.push(new THREE.Vector3(x, y, 0));
    }

    return points;
}

export function getClockParametersAtTime(settings = {}, time = 0, runtimeState = {}) {
    const normalized = normalizeClockSettings(settings);
    const radius = CLOCK_LAYOUT_RADIUS;
    const safeTime = Number.isFinite(time) ? time : 0;
    const baseTimeMs = resolveClockBaseTimeMs(runtimeState, safeTime);
    const currentTimeMs = baseTimeMs + safeTime * 1000;
    const currentDate = new Date(currentTimeMs);
    const milliseconds = ((currentTimeMs % 1000) + 1000) % 1000;
    const seconds = currentDate.getSeconds() + milliseconds / 1000;
    const minutes = currentDate.getMinutes() + seconds / 60;
    const hours = (currentDate.getHours() % 12) + minutes / 60;

    return {
        ...normalized,
        radius,
        baseTimeMs,
        currentTimeMs,
        currentDate,
        milliseconds,
        hourAngle: getClockHandAngle(hours / 12),
        minuteAngle: getClockHandAngle(minutes / 60),
        secondAngle: getClockHandAngle(seconds / 60),
        millisecondAngle: getClockHandAngle(milliseconds / 1000),
    };
}

export function generateClockPaths(settings = {}, time = 0, runtimeState = {}) {
    const params = getClockParametersAtTime(settings, time, runtimeState);
    return generateClockPathsFromParameters(params);
}

export function calculatePolylineLength(points = []) {
    let length = 0;

    for (let index = 1; index < points.length; index += 1) {
        length += points[index].distanceTo(points[index - 1]);
    }

    return length;
}

export function calculatePolylineLengths(paths = []) {
    return paths.map((points) => calculatePolylineLength(points));
}

export function estimateMaxSineWavePathLength(settings = {}) {
    const normalized = normalizeSineWaveSettings(settings);
    const amplitudePeriod = normalized.amplitudeCycleSpeed > 0 ? 1 / normalized.amplitudeCycleSpeed : 1;
    const frequencyPeriod = normalized.frequencyCycleSpeed > 0 ? 1 / normalized.frequencyCycleSpeed : 1;
    const scanDuration = Math.min(24, Math.max(amplitudePeriod, frequencyPeriod, 1));
    const scanSteps = 240;
    let maxLength = 0;

    for (let step = 0; step <= scanSteps; step += 1) {
        const time = (step / scanSteps) * scanDuration;
        maxLength = Math.max(maxLength, calculatePolylineLength(generateSineWavePoints(normalized, time)));
    }

    return maxLength;
}

export function estimateClockPathLengths(settings = {}) {
    const normalized = normalizeClockSettings(settings);
    const radius = CLOCK_LAYOUT_RADIUS;
    const { bezelRadius, tickInnerRadius, tickOuterRadius } = getClockBezelRadii(radius);
    const centerHubRadius = getClockCenterHubRadius(radius);
    const tickLength = Math.max(0, tickOuterRadius - tickInnerRadius);
    const startOffsets = getClockHandStartOffsets(radius);
    const hourBounds = getClockHandSegmentBounds(radius * normalized.hourHandLength, startOffsets.hour);
    const minuteBounds = getClockHandSegmentBounds(radius * normalized.minuteHandLength, startOffsets.minute);
    const secondBounds = getClockHandSegmentBounds(radius * normalized.secondHandLength, startOffsets.second);
    const millisecondBounds = getClockHandSegmentBounds(radius * normalized.millisecondHandLength, startOffsets.millisecond);

    return [
        Math.PI * 2 * bezelRadius,
        tickLength,
        tickLength,
        tickLength,
        tickLength,
        Math.PI * 2 * centerHubRadius,
        hourBounds.endRadius - hourBounds.startRadius,
        minuteBounds.endRadius - minuteBounds.startRadius,
        secondBounds.endRadius - secondBounds.startRadius,
        millisecondBounds.endRadius - millisecondBounds.startRadius,
    ];
}

export function getProceduralSourceFrame(sourceConfig = {}, time = 0, runtimeState = {}) {
    const type = normalizeProceduralSourceType(sourceConfig.type);

    if (type === 'clock') {
        const settings = normalizeClockSettings(sourceConfig.settings || {});
        const params = getClockParametersAtTime(settings, time, runtimeState);
        const paths = generateClockPathsFromParameters(params);

        return {
            type,
            settings,
            paths,
            pathLengths: calculatePolylineLengths(paths),
            maxPathLengths: estimateClockPathLengths(settings),
            runtimeState: {
                ...runtimeState,
                baseTimeMs: params.baseTimeMs,
            },
            debug: {
                currentTimeMs: params.currentTimeMs,
                hourAngle: params.hourAngle,
                minuteAngle: params.minuteAngle,
                secondAngle: params.secondAngle,
                millisecondAngle: params.millisecondAngle,
            },
        };
    }

    const settings = normalizeSineWaveSettings(sourceConfig.settings || {});
    const points = generateSineWavePoints(settings, time);

    return {
        type: 'sineWave',
        settings,
        paths: [points],
        pathLengths: [calculatePolylineLength(points)],
        maxPathLengths: [estimateMaxSineWavePathLength(settings)],
        runtimeState,
        debug: null,
    };
}