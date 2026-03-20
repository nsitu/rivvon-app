// src/modules/viewer/cinematicCamera.js
// Non-reactive cinematic camera system for Three.js
// Captures Regions of Interest (ROIs) from OrbitControls and generates
// smooth, loopable camera animations through them.

import { Vector3, Box3, CatmullRomCurve3, MathUtils } from 'three';

/**
 * @typedef {Object} ROI
 * @property {Vector3} position - Camera position
 * @property {Vector3} target   - OrbitControls look-at target
 * @property {number}  fov      - Camera field of view (degrees)
 */

// Speed-profile traversal constants
const TRANSIT_SPEED = 1.5;           // units per second (base traversal speed)
const SPEED_PROFILE_SAMPLES = 1000;  // lookup-table resolution
const DEFAULT_MIN_SPEED_RATIO = 0.08;  // minimum speed at ROI positions (fraction of max)
const DEFAULT_DWELL_RADIUS_FRACTION = 0.15; // radius around ROIs where speed ramps down

// Micro-motion: two incommensurate frequencies for organic feel
const MICRO_FREQ_RIGHT = 0.7;
const MICRO_FREQ_UP = 1.1;
const MICRO_PHASE_UP = 0.5;
const MICRO_AMPLITUDE_FACTOR = 0.005; // fraction of camera-target distance

// Look-at orchestration: asymmetric target lead
// Controls how much the gaze target leads the camera position through
// inter-ROI transitions. Higher values = more anticipatory gaze rotation
// on departure and earlier settling on arrival.  Must be < 3 for monotonicity.
const TARGET_LEAD_ALPHA = 1.5;

/**
 * Hermite smoothstep: 3t² − 2t³
 * @param {number} t - Value in [0, 1]
 * @returns {number}
 */
function smoothstep(t) {
    return t * t * (3 - 2 * t);
}

export class CinematicCamera {
    /**
     * @param {Object} opts
     * @param {import('three').PerspectiveCamera} opts.camera
     * @param {import('three').OrbitControls} opts.controls
     */
    constructor({ camera, controls }) {
        /** @type {import('three').PerspectiveCamera} */
        this._camera = camera;
        /** @type {import('three').OrbitControls} */
        this._controls = controls;

        /** @type {ROI[]} */
        this._rois = [];

        // Playback state
        this._playing = false;
        this._playbackTime = 0;        // normalized [0, 1]
        this._totalDuration = 0;       // seconds
        this._wallClock = 0;           // seconds, for micro-motion

        // Splines (closed CatmullRomCurve3)
        this._positionSpline = null;
        this._targetSpline = null;

        // Speed-profile (replaces dwell/transit timeline)
        this._roiArcPositions = [];    // arc-length u [0,1] for each ROI
        this._timeToArc = null;        // Float32Array lookup: normalized time → arc-length
        this._dwellRadius = 0;         // arc-length radius where speed ramps down
        this._targetRoiArcPositions = [];  // arc-length u [0,1] for each ROI on the target spline

        // Saved camera state before playback started
        this._savedPos = null;
        this._savedQuat = null;
        this._savedFov = null;
        this._savedControlsEnabled = true;

        // Config
        this.minSpeedRatio = DEFAULT_MIN_SPEED_RATIO;
        this.dwellRadiusFraction = DEFAULT_DWELL_RADIUS_FRACTION;
        this.microMotionEnabled = true;

        // Whether current ROIs were auto-generated (cleared on next manual capture)
        this._autoROIs = false;

        // Artwork plane constraint — camera must stay on one side.
        // Defined by a point on the plane and the outward-facing normal
        // (towards the camera / viewer side).
        this._planePoint = null;   // Vector3 — a point on the artwork plane
        this._planeNormal = null;  // Vector3 — unit normal pointing towards the viewer
        this._planeMinStandoff = 0.3; // minimum distance from plane (prevents grazing angles)

        // Bounding box of the ribbon artwork (set during ROI generation)
        this._artworkBBox = null;  // { min: Vector3, max: Vector3 }

        // Reusable temp vectors
        this._tmpPos = new Vector3();
        this._tmpTarget = new Vector3();
        this._tmpRight = new Vector3();
        this._tmpUp = new Vector3();
        this._tmpForward = new Vector3();

        // Telemetry: last-computed values for debug overlay
        this._telemetry = {
            u: 0,
            speed: 0,
            fov: 0,
            normalizedT: 0,
            elapsedSeconds: 0,
            position: new Vector3(),
            target: new Vector3()
        };
    }

    // ─── ROI management ────────────────────────────────────────────

    /**
     * Capture the current camera/controls state as an ROI.
     * @returns {{ roi: ROI, index: number }}
     */
    captureROI() {
        // If current ROIs are auto-generated, clear them on first manual capture
        if (this._autoROIs) {
            this._rois.length = 0;
            this._autoROIs = false;
            console.log('[Cinematic] Cleared auto-generated ROIs for manual authoring');
        }

        const roi = {
            position: this._camera.position.clone(),
            target: this._controls
                ? this._controls.target.clone()
                : new Vector3(0, 0, 0),
            fov: this._camera.fov
        };
        this._rois.push(roi);
        const index = this._rois.length - 1;
        console.log(
            `[Cinematic] ROI #${index} captured at ` +
            `(${roi.position.x.toFixed(2)}, ${roi.position.y.toFixed(2)}, ${roi.position.z.toFixed(2)}) → ` +
            `(${roi.target.x.toFixed(2)}, ${roi.target.y.toFixed(2)}, ${roi.target.z.toFixed(2)}), ` +
            `fov=${roi.fov.toFixed(1)}°`
        );
        return { roi, index };
    }

    /**
     * Remove an ROI by index.
     * @param {number} index
     */
    removeROI(index) {
        if (index >= 0 && index < this._rois.length) {
            this._rois.splice(index, 1);
        }
    }

    /** Clear all ROIs. */
    clearROIs() {
        const count = this._rois.length;
        this._rois.length = 0;
        this._autoROIs = false;
        this._planePoint = null;
        this._planeNormal = null;
        console.log(`[Cinematic] Cleared ${count} ROIs`);
    }

    /**
     * Invalidate auto-generated ROIs (e.g. when ribbon geometry changes).
     * Manual ROIs are preserved; auto-generated ones are discarded so they
     * will be regenerated from the new ribbon on next playback/export.
     */
    invalidateAutoROIs() {
        if (!this._autoROIs) return;
        const count = this._rois.length;
        this._rois.length = 0;
        this._autoROIs = false;
        this.stopPlayback();
        console.log(`[Cinematic] Invalidated ${count} auto-generated ROIs (ribbon geometry changed)`);
    }

    /** @returns {ROI[]} */
    getROIs() {
        return this._rois;
    }

    /** @returns {number} */
    get roiCount() {
        return this._rois.length;
    }

    /** @returns {boolean} */
    get hasROIs() {
        return this._rois.length > 0;
    }

    // ─── Auto-ROI generation from ribbon geometry ─────────────────

    /**
     * Generate sensible default ROIs from a RibbonSeries when the user
     * hasn't defined any manual ROIs.
     *
     * Default sequence (3 ROIs, loops back to #0):
     *   0. Overview — centers the entire artwork, frontal view
     *   1. Close-up of the starting region of the first ribbon
     *      (angled to reveal surface relief)
     *   2. Close-up of the ending region of the last ribbon
     *      (angled from the opposite side)
     *
     * Future ideas for automatic ROI discovery (not yet implemented):
     *   - Regions of high curvature along the ribbon path
     *   - Regions of high normal rotation (twisting ribbon surface)
     *   - Near inflection points where curvature sign changes
     *   - Areas with strong silhouette variation (profile complexity)
     *
     * @param {import('./ribbonSeries').RibbonSeries} ribbonSeries
     * @returns {boolean} true if ROIs were generated
     */
    generateDefaultROIs(ribbonSeries) {
        if (!ribbonSeries || !ribbonSeries.ribbons || ribbonSeries.ribbons.length === 0) {
            console.warn('[Cinematic] Cannot generate default ROIs — no ribbons');
            return false;
        }

        const ribbons = ribbonSeries.ribbons;
        const firstRibbon = ribbons[0];
        const lastRibbon = ribbons[ribbons.length - 1];

        // ── Compute bounding box of the entire series ──────────────
        const bbox = new Box3();
        for (const ribbon of ribbons) {
            for (const pt of ribbon.lastPoints) {
                bbox.expandByPoint(pt);
            }
        }
        const center = bbox.getCenter(new Vector3());
        const size = bbox.getSize(new Vector3());
        const maxExtent = Math.max(size.x, size.y, size.z);

        // Store for overlay visualization
        this._artworkBBox = { min: bbox.min.clone(), max: bbox.max.clone() };

        // Camera FOV for all shots
        const fov = this._camera.fov;
        const halfFovRad = MathUtils.degToRad(fov / 2);

        // ── Determine the artwork plane ────────────────────────────
        // The artwork typically lives near z = center.z.  We pick the
        // side the camera is currently on as the "front".
        const camZ = this._camera.position.z;
        const viewingSide = camZ >= center.z ? 1 : -1; // +1 = front is +z

        this._planePoint = center.clone();
        this._planeNormal = new Vector3(0, 0, viewingSide);
        // Minimum standoff scales with artwork size so small artworks
        // aren't clipped too aggressively.
        this._planeMinStandoff = Math.max(0.3, maxExtent * 0.05);

        // ── ROI 0: Overview shot ───────────────────────────────────
        // Distance that fits the full artwork with ~15% padding
        const overviewDist = (maxExtent * 0.575) / Math.tan(halfFovRad);
        const overviewPos = new Vector3(
            center.x,
            center.y,
            center.z + overviewDist * viewingSide
        );

        // ── Helper: close-up from a ribbon endpoint ────────────────
        // Angular deviation from the frontal direction (degrees).
        // Increase for more dramatic angled views, decrease for flatter.
        const CLOSE_UP_ANGLE_DEG = 30;
        const lateralRatio = Math.tan(MathUtils.degToRad(CLOSE_UP_ANGLE_DEG));

        const makeCloseUpROI = (ribbon, atStart, sideSign, lookTowardPt) => {
            const pts = ribbon.lastPoints;
            if (!pts || pts.length < 2) return null;

            // Pick the endpoint and a nearby point to derive direction
            const endIdx = atStart ? 0 : pts.length - 1;
            const adjIdx = atStart ? Math.min(1, pts.length - 1) : Math.max(pts.length - 2, 0);
            const endPt = pts[endIdx];
            const adjPt = pts[adjIdx];

            // Tangent along the ribbon at this endpoint
            const tangent = new Vector3().subVectors(adjPt, endPt).normalize();
            if (tangent.lengthSq() < 0.001) tangent.set(1, 0, 0);

            // Close-up distance: fraction of the overview distance so the
            // zoom feels proportional to the artwork size regardless of
            // ribbon width.  50% of overview ≈ moderate zoom-in.
            const closeUpDist = overviewDist * 0.5;

            // Camera position: offset from the endpoint primarily along the
            // artwork plane normal (frontal view) with a lateral shift
            // along the tangent at CLOSE_UP_ANGLE_DEG from frontal.
            const pos = new Vector3()
                .copy(endPt)
                .addScaledVector(this._planeNormal, closeUpDist)
                .addScaledVector(tangent, closeUpDist * lateralRatio * sideSign);

            // Look-at: point toward the opposite endpoint so the ribbon
            // geometry between start and end is visible at an angle.
            const lookAt = lookTowardPt.clone();

            return { position: pos, target: lookAt, fov };
        };

        // Opposite endpoints: each close-up looks toward the other end
        const firstStart = firstRibbon.lastPoints[0];
        const lastEnd = lastRibbon.lastPoints[lastRibbon.lastPoints.length - 1];

        // ── ROI 1: Close-up of first ribbon's start, looking toward last ribbon's end
        const closeUpStart = makeCloseUpROI(firstRibbon, true, 1, lastEnd);

        // ── ROI 2: Close-up of last ribbon's end, looking toward first ribbon's start
        const closeUpEnd = makeCloseUpROI(lastRibbon, false, -1, firstStart);

        // ── Assemble ROIs ──────────────────────────────────────────
        // Clear any existing (auto or manual) ROIs
        this._rois.length = 0;

        this._rois.push({ position: overviewPos, target: center.clone(), fov });

        if (closeUpStart) {
            this._rois.push(closeUpStart);
        }
        if (closeUpEnd) {
            this._rois.push(closeUpEnd);
        }

        // ── Enforce plane constraint on all generated ROIs ─────────
        for (const roi of this._rois) {
            this._clampToFrontSide(roi.position);
        }

        this._autoROIs = true;

        console.log(
            `[Cinematic] Generated ${this._rois.length} default ROIs from ribbon geometry ` +
            `(bbox ${size.x.toFixed(1)}×${size.y.toFixed(1)}×${size.z.toFixed(1)}, ` +
            `${ribbons.length} ribbon(s))`
        );
        return true;
    }

    // ─── Spline construction ──────────────────────────────────────

    /**
     * Build closed CatmullRomCurve3 splines for position and target.
     * Handles edge cases: 1 ROI (micro-orbit), 2 ROIs (padded).
     * @private
     */
    _buildSplines() {
        const n = this._rois.length;
        if (n === 0) return;

        let posPoints, tgtPoints;

        if (n === 1) {
            // Single ROI: create a tiny orbit around it
            const roi = this._rois[0];
            const dist = roi.position.distanceTo(roi.target);
            const radius = dist * 0.02; // 2% of camera distance

            // Build a camera-local frame
            const forward = this._tmpForward.copy(roi.target).sub(roi.position).normalize();
            const worldUp = new Vector3(0, 1, 0);
            const right = this._tmpRight.crossVectors(forward, worldUp).normalize();
            const up = this._tmpUp.crossVectors(right, forward).normalize();

            // 4 points in a circle around the ROI position
            posPoints = [
                roi.position.clone().addScaledVector(right, radius),
                roi.position.clone().addScaledVector(up, radius),
                roi.position.clone().addScaledVector(right, -radius),
                roi.position.clone().addScaledVector(up, -radius)
            ];
            // Target stays fixed for single ROI
            tgtPoints = [
                roi.target.clone(),
                roi.target.clone(),
                roi.target.clone(),
                roi.target.clone()
            ];
        } else if (n === 2) {
            // Two ROIs: duplicate each with slight offset for smooth closure
            const r0 = this._rois[0];
            const r1 = this._rois[1];

            // Mid-point offsets to create a wider path for the closed spline
            const midPos = new Vector3().addVectors(r0.position, r1.position).multiplyScalar(0.5);
            const midTgt = new Vector3().addVectors(r0.target, r1.target).multiplyScalar(0.5);

            // Create a perpendicular offset for the return path
            const dir = new Vector3().subVectors(r1.position, r0.position).normalize();
            const worldUp = new Vector3(0, 1, 0);
            const perp = new Vector3().crossVectors(dir, worldUp).normalize();
            const dist = r0.position.distanceTo(r1.position);
            const offset = dist * 0.15; // 15% of distance between ROIs

            posPoints = [
                r0.position.clone(),
                r1.position.clone(),
                midPos.clone().addScaledVector(perp, offset),
                midPos.clone().addScaledVector(perp, -offset)
            ];
            // Use a slightly smoothed version: duplicate the return path targets with offset
            tgtPoints = [
                r0.target.clone(),
                r1.target.clone(),
                midTgt.clone().addScaledVector(perp, offset * 0.3),
                midTgt.clone().addScaledVector(perp, -offset * 0.3)
            ];
        } else {
            // 3+ ROIs: use them directly
            posPoints = this._rois.map(r => r.position.clone());
            tgtPoints = this._rois.map(r => r.target.clone());
        }

        // Create closed centripetal CatmullRom splines
        this._positionSpline = new CatmullRomCurve3(posPoints, true, 'centripetal');
        this._targetSpline = new CatmullRomCurve3(tgtPoints, true, 'centripetal');
    }

    // ─── Speed-profile construction (replaces dwell/transit timeline) ──

    /**
     * Return a speed multiplier ∈ [minSpeedRatio, 1.0] at arc-length u.
     * Near an ROI the camera slows to a crawl; between ROIs it reaches full speed.
     * @param {number} u - Arc-length fraction [0, 1]
     * @returns {number}
     * @private
     */
    _speedAt(u) {
        if (this._roiArcPositions.length <= 1) return this.minSpeedRatio;

        // Minimum distance to any ROI (wrapping for closed spline)
        let minDist = Infinity;
        for (const roiU of this._roiArcPositions) {
            let d = Math.abs(u - roiU);
            if (d > 0.5) d = 1 - d;
            if (d < minDist) minDist = d;
        }

        if (minDist >= this._dwellRadius) return 1.0;

        // Smoothstep from minSpeedRatio (at ROI) to 1.0 (at dwell boundary)
        const t = minDist / this._dwellRadius;
        const s = smoothstep(t);
        return this.minSpeedRatio + (1.0 - this.minSpeedRatio) * s;
    }

    /**
     * Look up arc-length u for a given normalized time τ ∈ [0, 1].
     * @param {number} normalizedT
     * @returns {number}
     * @private
     */
    _lookupTimeToArc(normalizedT) {
        if (!this._timeToArc) return normalizedT;
        const idx = normalizedT * SPEED_PROFILE_SAMPLES;
        const lower = Math.floor(idx);
        const upper = Math.min(lower + 1, SPEED_PROFILE_SAMPLES);
        const frac = idx - lower;
        return this._timeToArc[lower] * (1 - frac) + this._timeToArc[upper] * frac;
    }

    /**
     * Build the speed profile and time→arc-length lookup table.
     * Replaces the old _buildTimeline() — camera continuously moves,
     * slowing to a crawl near each ROI instead of stopping.
     * @private
     */
    _buildSpeedProfile() {
        const n = this._rois.length;
        if (n === 0) return;

        // Arc-length data from the position spline
        const arcLengths = this._positionSpline.getLengths(SPEED_PROFILE_SAMPLES);
        const totalArcLength = arcLengths[arcLengths.length - 1];

        this._roiArcPositions = [];

        if (n === 1) {
            // Single ROI: gentle orbit — uniform speed, fixed duration
            this._roiArcPositions = [0];
            this._targetRoiArcPositions = [0];
            this._dwellRadius = 0.25;
            this._totalDuration = (totalArcLength / TRANSIT_SPEED) / this.minSpeedRatio;

            // Linear mapping (uniform speed around tiny orbit)
            this._timeToArc = new Float32Array(SPEED_PROFILE_SAMPLES + 1);
            for (let i = 0; i <= SPEED_PROFILE_SAMPLES; i++) {
                this._timeToArc[i] = i / SPEED_PROFILE_SAMPLES;
            }
            return;
        }

        // Compute arc-length u for each ROI (raw parameter i/n → arc-length fraction)
        for (let i = 0; i < n; i++) {
            const rawT = i / n;
            const idx = rawT * SPEED_PROFILE_SAMPLES;
            const lo = Math.floor(idx);
            const hi = Math.min(Math.ceil(idx), SPEED_PROFILE_SAMPLES);
            const frac = idx - lo;
            const arcLen = arcLengths[lo] * (1 - frac) + arcLengths[hi] * frac;
            this._roiArcPositions.push(arcLen / totalArcLength);
        }

        // Compute ROI arc positions on the target spline (its own arc-length space)
        this._targetRoiArcPositions = [];
        const targetArcLengths = this._targetSpline.getLengths(SPEED_PROFILE_SAMPLES);
        const totalTargetArcLength = targetArcLengths[targetArcLengths.length - 1];
        for (let i = 0; i < n; i++) {
            const rawT = i / n;
            const idx = rawT * SPEED_PROFILE_SAMPLES;
            const lo = Math.floor(idx);
            const hi = Math.min(Math.ceil(idx), SPEED_PROFILE_SAMPLES);
            const frac = idx - lo;
            const arcLen = targetArcLengths[lo] * (1 - frac) + targetArcLengths[hi] * frac;
            this._targetRoiArcPositions.push(arcLen / totalTargetArcLength);
        }

        // Compute dwell radius from average inter-ROI spacing
        let totalSpacing = 0;
        for (let i = 0; i < n; i++) {
            const next = (i + 1) % n;
            let gap = this._roiArcPositions[next] - this._roiArcPositions[i];
            if (gap <= 0) gap += 1.0; // wrap for closed spline
            totalSpacing += gap;
        }
        this._dwellRadius = (totalSpacing / n) * this.dwellRadiusFraction;

        // Numerically integrate 1/speed(u) to get cumulative time cost
        const rawTime = new Float32Array(SPEED_PROFILE_SAMPLES + 1);
        rawTime[0] = 0;
        const du = 1 / SPEED_PROFILE_SAMPLES;
        for (let k = 1; k <= SPEED_PROFILE_SAMPLES; k++) {
            const u = k * du;
            const speed = this._speedAt(u - du * 0.5); // midpoint rule
            rawTime[k] = rawTime[k - 1] + du / speed;
        }

        const totalNormalizedTime = rawTime[SPEED_PROFILE_SAMPLES];

        // Total duration: base traversal time scaled by the integral
        this._totalDuration = (totalArcLength / TRANSIT_SPEED) * totalNormalizedTime;

        // Invert: build uniformly-spaced normalizedTime → arc-length lookup
        this._timeToArc = new Float32Array(SPEED_PROFILE_SAMPLES + 1);
        this._timeToArc[0] = 0;
        this._timeToArc[SPEED_PROFILE_SAMPLES] = 1;

        let searchIdx = 0;
        for (let j = 1; j < SPEED_PROFILE_SAMPLES; j++) {
            const targetTime = (j / SPEED_PROFILE_SAMPLES) * totalNormalizedTime;
            while (searchIdx < SPEED_PROFILE_SAMPLES && rawTime[searchIdx + 1] < targetTime) {
                searchIdx++;
            }
            const t0 = rawTime[searchIdx];
            const t1 = rawTime[searchIdx + 1];
            const frac = (t1 > t0) ? (targetTime - t0) / (t1 - t0) : 0;
            this._timeToArc[j] = (searchIdx + frac) / SPEED_PROFILE_SAMPLES;
        }
    }

    /**
     * Returns the auto-calculated total loop duration in seconds.
     * Call after building speed profile, or it estimates from current ROIs.
     * @returns {number}
     */
    getLoopDuration() {
        if (this._totalDuration > 0) return this._totalDuration;
        // Fallback: rough estimate without building
        const n = this._rois.length;
        if (n === 0) return 0;
        if (n === 1) return 8;

        // Sum inter-ROI distances; slow-crawl roughly doubles base time
        let totalDist = 0;
        for (let i = 0; i < n; i++) {
            const nextIdx = (i + 1) % n;
            totalDist += this._rois[i].position.distanceTo(this._rois[nextIdx].position);
        }
        return (totalDist / TRANSIT_SPEED) * 2;
    }

    // ─── Look-at orchestration (decoupled target timing) ──────────

    /**
     * Find which ROI-to-ROI segment contains the given arc-length u.
     * Returns the bounding ROI indices and the progress [0,1] through
     * that segment.
     * @param {number} u - Arc-length fraction [0, 1]
     * @returns {{ prevIdx: number, nextIdx: number, segmentProgress: number }}
     * @private
     */
    _findSegment(u) {
        const n = this._roiArcPositions.length;
        if (n <= 1) return { prevIdx: 0, nextIdx: 0, segmentProgress: 0 };

        // Find the last ROI arc position <= u
        let prevIdx = n - 1;
        for (let i = 0; i < n; i++) {
            if (this._roiArcPositions[i] > u) {
                prevIdx = (i - 1 + n) % n;
                break;
            }
        }
        const nextIdx = (prevIdx + 1) % n;

        const segStart = this._roiArcPositions[prevIdx];
        const segEnd = this._roiArcPositions[nextIdx];
        let segLen = segEnd - segStart;
        if (segLen <= 0) segLen += 1.0; // closed spline wrap

        let progress = u - segStart;
        if (progress < 0) progress += 1.0;

        return {
            prevIdx,
            nextIdx,
            segmentProgress: Math.max(0, Math.min(1, progress / segLen))
        };
    }

    /**
     * Asymmetric blend curve: maps segment progress p ∈ [0,1] to a
     * phase-shifted value that leads during departure and settles
     * before arrival.
     *
     * f(p) = p + α · p · (1−p)²
     *
     * Properties:
     *   f(0) = 0, f(1) = 1          — exact match at ROI boundaries
     *   f'(0) = 1 + α               — faster departure (gaze leads)
     *   f'(1) = 1                    — smooth arrival (gaze settled)
     *   Peak lead ≈ 4α/27 at p ≈ ⅓  — strongest mid-departure
     *   Monotonic for α < 3
     *
     * @param {number} p - Segment progress [0, 1]
     * @returns {number} Phase-shifted progress [0, 1]
     * @private
     */
    _targetBlendCurve(p) {
        const oneMinusP = 1 - p;
        return p + TARGET_LEAD_ALPHA * p * oneMinusP * oneMinusP;
    }

    /**
     * Compute the look-at target at arc-length u with decoupled timing.
     * Instead of evaluating the target spline at the same u as the
     * position spline, this maps u through a per-segment phase shift
     * so the gaze rotates toward the next ROI before the camera departs
     * (anticipation) and settles into the destination viewpoint before
     * the camera arrives (composure).
     *
     * @param {number} u - Position spline arc-length fraction [0, 1]
     * @param {Vector3} [optionalTarget] - Optional output vector
     * @returns {Vector3}
     * @private
     */
    _computeTargetAt(u, optionalTarget) {
        const n = this._rois.length;
        // For single-ROI orbits, no phase shift needed
        if (n <= 1) return this._targetSpline.getPointAt(u, optionalTarget);

        // Find which segment we're in on the position spline
        const { prevIdx, nextIdx, segmentProgress } = this._findSegment(u);

        // Remap progress: target leads position during departure,
        // settles before arrival
        const leadProgress = this._targetBlendCurve(segmentProgress);

        // Map the leading progress into the target spline's own
        // arc-length space (which differs from the position spline's)
        const tgtStart = this._targetRoiArcPositions[prevIdx];
        const tgtEnd = this._targetRoiArcPositions[nextIdx];
        let tgtSegLen = tgtEnd - tgtStart;
        if (tgtSegLen <= 0) tgtSegLen += 1.0; // closed spline wrap

        let uTarget = tgtStart + leadProgress * tgtSegLen;
        uTarget = ((uTarget % 1) + 1) % 1;

        return this._targetSpline.getPointAt(uTarget, optionalTarget);
    }

    // ─── Camera application (shared core) ─────────────────────────

    /**
     * Evaluate splines at a normalized time using arc-length parameterization
     * and the speed-profile lookup table. Apply result to camera.
     *
     * The camera continuously moves along the spline, slowing to a crawl
     * near each ROI instead of stopping. Arc-length evaluation (getPointAt)
     * ensures visually uniform speed between control points.
     *
     * @param {number} normalizedT - Time in [0, 1]
     * @param {number} wallClock   - Wall-clock seconds (for micro-motion)
     * @private
     */
    _applyCamera(normalizedT, wallClock) {
        const n = this._rois.length;
        if (n === 0 || !this._positionSpline || !this._targetSpline) return;

        // Wrap normalizedT to [0, 1)
        const t = ((normalizedT % 1) + 1) % 1;

        // Map time to arc-length via the speed-profile lookup table
        const u = this._lookupTimeToArc(t);

        // Evaluate position at arc-length u; target uses decoupled phase-shifted timing
        const pos = this._positionSpline.getPointAt(u, this._tmpPos);
        const target = this._computeTargetAt(u, this._tmpTarget);

        // Update telemetry
        this._telemetry.u = u;
        this._telemetry.speed = this._speedAt(u);
        this._telemetry.normalizedT = t;
        this._telemetry.elapsedSeconds = t * this._totalDuration;

        // Proximity-weighted FOV blend
        let fov;
        if (n === 1) {
            fov = this._rois[0].fov;
        } else {
            // Weighted average of all ROI FOVs based on proximity in arc-length space
            let totalWeight = 0;
            let weightedFov = 0;
            for (let i = 0; i < n; i++) {
                let d = Math.abs(u - this._roiArcPositions[i]);
                if (d > 0.5) d = 1 - d; // wrap for closed spline
                const sigma = this._dwellRadius * 2;
                const w = Math.exp(-(d * d) / (2 * sigma * sigma));
                weightedFov += this._rois[i].fov * w;
                totalWeight += w;
            }
            fov = totalWeight > 0 ? weightedFov / totalWeight : this._rois[0].fov;
        }

        // ── Clamp camera position to front side of artwork plane ──
        this._clampToFrontSide(pos);

        // Apply micro-motion (constant amplitude — no dwell/transit scaling)
        if (this.microMotionEnabled) {
            const dist = pos.distanceTo(target);
            const amplitude = MICRO_AMPLITUDE_FACTOR * dist;

            // Build camera-local frame for micro-motion offset
            this._tmpForward.copy(target).sub(pos).normalize();
            const worldUp = new Vector3(0, 1, 0);
            this._tmpRight.crossVectors(this._tmpForward, worldUp).normalize();
            this._tmpUp.crossVectors(this._tmpRight, this._tmpForward).normalize();

            pos.addScaledVector(this._tmpRight, amplitude * Math.sin(wallClock * MICRO_FREQ_RIGHT));
            pos.addScaledVector(this._tmpUp, amplitude * Math.sin(wallClock * MICRO_FREQ_UP + MICRO_PHASE_UP));
        }

        // Apply to camera
        this._camera.position.copy(pos);
        this._camera.lookAt(target);

        // Store final position/target in telemetry
        this._telemetry.position.copy(pos);
        this._telemetry.target.copy(target);

        // Apply FOV if changed
        if (Math.abs(this._camera.fov - fov) > 0.01) {
            this._camera.fov = fov;
            this._camera.updateProjectionMatrix();
        }
        this._telemetry.fov = fov;
    }

    // ─── Telemetry / debug overlay support ─────────────────────

    /**
     * Get current telemetry snapshot for the debug overlay.
     * @returns {Object|null}
     */
    getTelemetry() {
        if (!this._playing && this._totalDuration <= 0) return null;
        return {
            u: this._telemetry.u,
            speed: this._telemetry.speed,
            fov: this._telemetry.fov,
            normalizedT: this._telemetry.normalizedT,
            elapsedSeconds: this._telemetry.elapsedSeconds,
            totalDuration: this._totalDuration,
            roiCount: this._rois.length,
            position: this._telemetry.position,
            target: this._telemetry.target,
            dwellRadius: this._dwellRadius,
            minSpeedRatio: this.minSpeedRatio
        };
    }

    /**
     * Sample position and target at an arbitrary arc-length parameter u ∈ [0,1].
     * Used by the debug overlay to pre-compute the gaze trace.
     * @param {number} u
     * @returns {{ position: Vector3, target: Vector3 } | null}
     */
    getTelemetryAtU(u) {
        if (!this._positionSpline || !this._targetSpline) return null;
        return {
            position: this._positionSpline.getPointAt(u),
            target: this._computeTargetAt(u)
        };
    }

    /**
     * Sample the position spline at N evenly-spaced arc-length points.
     * Returns 3D points for the track, plus the ROI arc-length positions.
     * @param {number} [sampleCount=100]
     * @returns {{ trackPoints: Vector3[], roiArcPositions: number[] } | null}
     */
    getTrackGeometry(sampleCount = 100) {
        if (!this._positionSpline) return null;
        const points = [];
        for (let i = 0; i <= sampleCount; i++) {
            points.push(this._positionSpline.getPointAt(i / sampleCount).clone());
        }
        return {
            trackPoints: points,
            roiArcPositions: [...this._roiArcPositions],
            artworkBBox: this._artworkBBox   // { min, max } or null
        };
    }

    /**
     * Ensure a position vector stays on the viewer's side of the artwork
     * plane, with a minimum standoff distance. Mutates the vector.
     * @param {Vector3} pos
     * @private
     */
    _clampToFrontSide(pos) {
        if (!this._planeNormal || !this._planePoint) return;
        // Signed distance from the plane (positive = on the viewer side)
        const signedDist = pos.clone().sub(this._planePoint).dot(this._planeNormal);
        if (signedDist < this._planeMinStandoff) {
            // Push the position back to the minimum standoff
            pos.addScaledVector(this._planeNormal, this._planeMinStandoff - signedDist);
        }
    }

    // ─── Playback control ─────────────────────────────────────────

    /**
     * Start cinematic playback.
     * Builds splines and timeline, disables OrbitControls, begins animation.
     * If no manual ROIs exist and a ribbonSeries is provided, generates
     * sensible default ROIs from the ribbon geometry.
     *
     * @param {import('./ribbonSeries').RibbonSeries} [ribbonSeries]
     */
    startPlayback(ribbonSeries) {
        // Auto-generate ROIs if none defined and ribbon geometry is available
        if (this._rois.length === 0 && ribbonSeries) {
            this.generateDefaultROIs(ribbonSeries);
        }

        if (this._rois.length === 0) {
            console.warn('[Cinematic] Cannot start playback — no ROIs captured');
            return;
        }

        // Save current camera state
        this._savedPos = this._camera.position.clone();
        this._savedQuat = this._camera.quaternion.clone();
        this._savedFov = this._camera.fov;
        if (this._controls) {
            this._savedControlsEnabled = this._controls.enabled;
            this._controls.enabled = false;
        }

        // Build interpolation data
        this._buildSplines();
        this._buildSpeedProfile();
        this._playbackTime = 0;
        this._wallClock = 0;
        this._playing = true;

        console.log(
            `[Cinematic] Playback started: ${this._rois.length} ROIs, ` +
            `${this._totalDuration.toFixed(1)}s loop (slow-crawl)`
        );
    }

    /**
     * Stop cinematic playback and restore controls.
     */
    stopPlayback() {
        if (!this._playing) return;

        this._playing = false;

        // Restore camera state
        if (this._savedPos) {
            this._camera.position.copy(this._savedPos);
            this._camera.quaternion.copy(this._savedQuat);
            if (this._savedFov !== null) {
                this._camera.fov = this._savedFov;
                this._camera.updateProjectionMatrix();
            }
        }

        // Restore controls
        if (this._controls) {
            this._controls.enabled = this._savedControlsEnabled;
        }

        this._positionSpline = null;
        this._targetSpline = null;
        this._timeToArc = null;
        this._roiArcPositions = [];
        this._targetRoiArcPositions = [];
        this._totalDuration = 0;

        console.log('[Cinematic] Playback stopped');
    }

    /** @returns {boolean} */
    get isPlaying() {
        return this._playing;
    }

    // ─── Per-frame update (real-time) ─────────────────────────────

    /**
     * Advance playback by delta time. Call once per frame from render loop.
     * @param {number} deltaSeconds - Frame delta in seconds
     */
    update(deltaSeconds) {
        if (!this._playing || this._totalDuration <= 0) return;

        this._wallClock += deltaSeconds;
        this._playbackTime += deltaSeconds / this._totalDuration;

        // Wrap for seamless loop
        this._playbackTime = this._playbackTime % 1;

        this._applyCamera(this._playbackTime, this._wallClock);
    }

    // ─── Per-frame update (deterministic, for export) ─────────────

    /**
     * Set camera to the exact state at a given absolute time.
     * Used during frame-accurate video export. Does not advance internal clock.
     * @param {number} absoluteSeconds - Synthetic time from export loop
     */
    updateAtTime(absoluteSeconds) {
        if (this._totalDuration <= 0) return;

        const normalizedT = (absoluteSeconds % this._totalDuration) / this._totalDuration;
        this._applyCamera(normalizedT, absoluteSeconds);
    }

    // ─── Export helper ────────────────────────────────────────────

    /**
     * Prepare for deterministic export playback.
     * Builds splines/timeline without modifying camera or controls.
     * Call this before the export frame loop, then use updateAtTime() per frame.
     * If no manual ROIs exist and a ribbonSeries is provided, generates
     * sensible default ROIs from the ribbon geometry.
     *
     * @param {import('./ribbonSeries').RibbonSeries} [ribbonSeries]
     */
    prepareForExport(ribbonSeries) {
        // Auto-generate ROIs if none defined and ribbon geometry is available
        if (this._rois.length === 0 && ribbonSeries) {
            this.generateDefaultROIs(ribbonSeries);
        }

        if (this._rois.length === 0) {
            console.warn('[Cinematic] Cannot prepare for export — no ROIs');
            return false;
        }
        this._buildSplines();
        this._buildSpeedProfile();
        console.log(
            `[Cinematic] Prepared for export: ${this._rois.length} ROIs, ` +
            `${this._totalDuration.toFixed(1)}s loop (slow-crawl)`
        );
        return true;
    }

    // ─── Cleanup ──────────────────────────────────────────────────

    dispose() {
        this.stopPlayback();
        this._rois.length = 0;
        this._camera = null;
        this._controls = null;
    }
}
