const MIN_CLOSURE_DURATION = 0.4;
const MAX_CLOSURE_DURATION = 5;
const CLOSURE_DURATION_FRACTION = 0.4;
const STATE_EPSILON = 0.001;

function finiteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function vectorFrom(value, fallback = [0, 0, 0]) {
    if (!Array.isArray(value) || value.length < 3) {
        return [...fallback];
    }

    return [
        finiteNumber(value[0]),
        finiteNumber(value[1]),
        finiteNumber(value[2]),
    ];
}

function quaternionFrom(value) {
    if (!Array.isArray(value) || value.length < 4) {
        return [0, 0, 0, 1];
    }

    return [
        finiteNumber(value[0]),
        finiteNumber(value[1]),
        finiteNumber(value[2]),
        finiteNumber(value[3], 1),
    ];
}

function normalizeSample(sample, index) {
    return {
        t: Math.max(0, finiteNumber(sample?.t, index / 30)),
        position: vectorFrom(sample?.position),
        target: vectorFrom(sample?.target),
        quaternion: quaternionFrom(sample?.quaternion),
        fov: finiteNumber(sample?.fov, 45),
    };
}

function distance(a, b) {
    const x = a[0] - b[0];
    const y = a[1] - b[1];
    const z = a[2] - b[2];
    return Math.hypot(x, y, z);
}

function subtract(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function lerp(a, b, amount) {
    return [
        a[0] + (b[0] - a[0]) * amount,
        a[1] + (b[1] - a[1]) * amount,
        a[2] + (b[2] - a[2]) * amount,
    ];
}

function hermite(a, b, tangentA, tangentB, amount) {
    const t2 = amount * amount;
    const t3 = t2 * amount;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + amount;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    return [
        h00 * a[0] + h10 * tangentA[0] + h01 * b[0] + h11 * tangentB[0],
        h00 * a[1] + h10 * tangentA[1] + h01 * b[1] + h11 * tangentB[1],
        h00 * a[2] + h10 * tangentA[2] + h01 * b[2] + h11 * tangentB[2],
    ];
}

function hermiteScalar(a, b, tangentA, tangentB, amount) {
    const t2 = amount * amount;
    const t3 = t2 * amount;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + amount;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return h00 * a + h10 * tangentA + h01 * b + h11 * tangentB;
}

function smoothstep(amount) {
    return amount * amount * (3 - 2 * amount);
}

function quaternionSlerp(a, b, amount) {
    let ax = a[0];
    let ay = a[1];
    let az = a[2];
    let aw = a[3];
    let bx = b[0];
    let by = b[1];
    let bz = b[2];
    let bw = b[3];
    let dot = ax * bx + ay * by + az * bz + aw * bw;

    if (dot < 0) {
        dot = -dot;
        bx = -bx;
        by = -by;
        bz = -bz;
        bw = -bw;
    }

    if (dot > 0.9995) {
        const result = [
            ax + amount * (bx - ax),
            ay + amount * (by - ay),
            az + amount * (bz - az),
            aw + amount * (bw - aw),
        ];
        const length = Math.hypot(...result) || 1;
        return result.map((value) => value / length);
    }

    const theta = Math.acos(Math.min(1, Math.max(-1, dot)));
    const sinTheta = Math.sin(theta) || 1;
    const weightA = Math.sin((1 - amount) * theta) / sinTheta;
    const weightB = Math.sin(amount * theta) / sinTheta;

    return [
        ax * weightA + bx * weightB,
        ay * weightA + by * weightB,
        az * weightA + bz * weightB,
        aw * weightA + bw * weightB,
    ];
}

function interpolateSamples(a, b, amount) {
    return {
        position: lerp(a.position, b.position, amount),
        target: lerp(a.target, b.target, amount),
        quaternion: quaternionSlerp(a.quaternion, b.quaternion, amount),
        fov: a.fov + (b.fov - a.fov) * amount,
    };
}

function computeClosureDuration(samples, requestedDuration) {
    if (requestedDuration != null) {
        return Math.max(0, finiteNumber(requestedDuration));
    }

    const first = samples[0];
    const last = samples[samples.length - 1];
    const sourceDuration = Math.max(0.001, last.t);
    const closureDistance = distance(last.position, first.position)
        + distance(last.target, first.target) * 0.5
        + Math.abs(last.fov - first.fov) * 0.02;

    if (closureDistance <= STATE_EPSILON) {
        return 0;
    }

    let pathLength = 0;
    for (let index = 1; index < samples.length; index += 1) {
        pathLength += distance(samples[index - 1].position, samples[index].position);
        pathLength += distance(samples[index - 1].target, samples[index].target) * 0.5;
    }

    const averageSpeed = pathLength / sourceDuration;
    const fallbackDuration = sourceDuration * 0.2;
    const duration = averageSpeed > STATE_EPSILON
        ? closureDistance / averageSpeed
        : fallbackDuration;
    const maximum = Math.max(MIN_CLOSURE_DURATION, sourceDuration * CLOSURE_DURATION_FRACTION);

    // Keep the closure in the same visual tempo as the captured movement.
    return Math.min(MAX_CLOSURE_DURATION, Math.max(MIN_CLOSURE_DURATION, Math.min(duration, maximum)));
}

export class CameraMotionTrack {
    constructor(samples = [], options = {}) {
        this.samples = samples
            .map((sample, index) => normalizeSample(sample, index))
            .sort((a, b) => a.t - b.t);

        if (this.samples.length > 0) {
            const firstTime = this.samples[0].t;
            this.samples.forEach((sample) => {
                sample.t = Math.max(0, sample.t - firstTime);
            });
        }

        this.sourceDuration = this.samples.length > 1
            ? Math.max(0, this.samples[this.samples.length - 1].t)
            : 0;
        this.closureDuration = this.samples.length > 1
            ? computeClosureDuration(this.samples, options.closureDuration)
            : 0;
        this.duration = this.sourceDuration + this.closureDuration;
    }

    get sampleCount() {
        return this.samples.length;
    }

    get isValid() {
        return this.samples.length >= 2 && this.sourceDuration > 0;
    }

    sampleAt(seconds = 0) {
        if (this.samples.length === 0) return null;
        if (this.samples.length === 1 || !this.isValid) {
            return interpolateSamples(this.samples[0], this.samples[0], 0);
        }

        const totalDuration = Math.max(0.001, this.duration);
        const time = ((finiteNumber(seconds) % totalDuration) + totalDuration) % totalDuration;

        if (this.closureDuration > 0 && time > this.sourceDuration) {
            const amount = Math.min(1, Math.max(0, (time - this.sourceDuration) / this.closureDuration));
            const lastIndex = this.samples.length - 1;
            const previous = this.samples[Math.max(0, lastIndex - 1)];
            const first = this.samples[0];
            const next = this.samples[Math.min(lastIndex, 1)];
            const lastDelta = Math.max(0.001, this.samples[lastIndex].t - previous.t);
            const nextDelta = Math.max(0.001, next.t - first.t);
            const tangentA = this.closureDuration / lastDelta;
            const tangentB = this.closureDuration / nextDelta;
            const easedAmount = smoothstep(amount);

            return {
                position: hermite(
                    this.samples[lastIndex].position,
                    first.position,
                    subtract(this.samples[lastIndex].position, previous.position).map((value) => value * tangentA),
                    subtract(next.position, first.position).map((value) => value * tangentB),
                    amount,
                ),
                target: hermite(
                    this.samples[lastIndex].target,
                    first.target,
                    subtract(this.samples[lastIndex].target, previous.target).map((value) => value * tangentA),
                    subtract(next.target, first.target).map((value) => value * tangentB),
                    amount,
                ),
                quaternion: quaternionSlerp(this.samples[lastIndex].quaternion, first.quaternion, easedAmount),
                fov: hermiteScalar(
                    this.samples[lastIndex].fov,
                    first.fov,
                    (this.samples[lastIndex].fov - previous.fov) * tangentA,
                    (next.fov - first.fov) * tangentB,
                    amount,
                ),
            };
        }

        let nextIndex = 1;
        while (nextIndex < this.samples.length && this.samples[nextIndex].t < time) {
            nextIndex += 1;
        }

        if (nextIndex >= this.samples.length) {
            const last = this.samples[this.samples.length - 1];
            return interpolateSamples(last, last, 0);
        }

        const previous = this.samples[nextIndex - 1];
        const next = this.samples[nextIndex];
        const span = Math.max(0.001, next.t - previous.t);
        return interpolateSamples(previous, next, Math.min(1, Math.max(0, (time - previous.t) / span)));
    }

    toJSON() {
        return {
            version: 1,
            samples: this.samples.map((sample) => ({
                t: sample.t,
                position: [...sample.position],
                target: [...sample.target],
                quaternion: [...sample.quaternion],
                fov: sample.fov,
            })),
            sourceDuration: this.sourceDuration,
            closureDuration: this.closureDuration,
            duration: this.duration,
        };
    }
}

export function createCameraMotionTrack(samples, options = {}) {
    const track = new CameraMotionTrack(samples, options);
    return track.isValid ? track : null;
}
