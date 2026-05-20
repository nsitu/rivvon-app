import * as THREE from 'three';

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

export function calculatePolylineLength(points = []) {
    let length = 0;

    for (let index = 1; index < points.length; index += 1) {
        length += points[index].distanceTo(points[index - 1]);
    }

    return length;
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