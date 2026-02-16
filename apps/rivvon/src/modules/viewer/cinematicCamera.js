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

/**
 * @typedef {Object} TimelineSegment
 * @property {'dwell'|'transit'} type
 * @property {number} tStart     - Normalized start time [0, 1]
 * @property {number} tEnd       - Normalized end time   [0, 1]
 * @property {number} roiIndex   - Index of the ROI for this segment
 * @property {number} [nextRoiIndex] - Next ROI index (transit only)
 */

// Dwell config defaults
const DEFAULT_DWELL_SECONDS = 2.0;
const MIN_TRANSIT_SECONDS = 2.0;
const TRANSIT_SPEED = 1.5; // units per second (3D distance → time)

// Micro-motion: two incommensurate frequencies for organic feel
const MICRO_FREQ_RIGHT = 0.7;
const MICRO_FREQ_UP = 1.1;
const MICRO_PHASE_UP = 0.5;
const MICRO_AMPLITUDE_FACTOR = 0.005; // fraction of camera-target distance

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

        // Timeline segments
        /** @type {TimelineSegment[]} */
        this._timeline = [];

        // Saved camera state before playback started
        this._savedPos = null;
        this._savedQuat = null;
        this._savedFov = null;
        this._savedControlsEnabled = true;

        // Config
        this.dwellSeconds = DEFAULT_DWELL_SECONDS;
        this.microMotionEnabled = true;

        // Whether current ROIs were auto-generated (cleared on next manual capture)
        this._autoROIs = false;

        // Artwork plane constraint — camera must stay on one side.
        // Defined by a point on the plane and the outward-facing normal
        // (towards the camera / viewer side).
        this._planePoint = null;   // Vector3 — a point on the artwork plane
        this._planeNormal = null;  // Vector3 — unit normal pointing towards the viewer
        this._planeMinStandoff = 0.3; // minimum distance from plane (prevents grazing angles)

        // Reusable temp vectors
        this._tmpPos = new Vector3();
        this._tmpTarget = new Vector3();
        this._tmpRight = new Vector3();
        this._tmpUp = new Vector3();
        this._tmpForward = new Vector3();
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

    // ─── Timeline construction ────────────────────────────────────

    /**
     * Build a normalized [0, 1] timeline with dwell and transit segments.
     * @private
     */
    _buildTimeline() {
        const n = this._rois.length;
        if (n === 0) return;

        // Special case: single ROI — one continuous dwell with micro-orbit
        if (n === 1) {
            this._totalDuration = this.dwellSeconds * 4; // 8s gentle orbit
            this._timeline = [{
                type: 'dwell', // behaves as a slow drift around the single ROI
                tStart: 0,
                tEnd: 1,
                roiIndex: 0
            }];
            return;
        }

        // Compute raw durations for each segment (dwell + transit)
        const rawSegments = [];
        let totalRawSeconds = 0;

        for (let i = 0; i < n; i++) {
            // Dwell at ROI i
            rawSegments.push({ type: 'dwell', seconds: this.dwellSeconds, roiIndex: i });
            totalRawSeconds += this.dwellSeconds;

            // Transit from ROI i → ROI (i+1) % n
            const nextIdx = (i + 1) % n;
            const dist = this._rois[i].position.distanceTo(this._rois[nextIdx].position);
            const transitSec = Math.max(MIN_TRANSIT_SECONDS, dist / TRANSIT_SPEED);
            rawSegments.push({ type: 'transit', seconds: transitSec, roiIndex: i, nextRoiIndex: nextIdx });
            totalRawSeconds += transitSec;
        }

        this._totalDuration = totalRawSeconds;

        // Normalize to [0, 1]
        let t = 0;
        this._timeline = rawSegments.map(seg => {
            const duration = seg.seconds / totalRawSeconds;
            const entry = {
                type: seg.type,
                tStart: t,
                tEnd: t + duration,
                roiIndex: seg.roiIndex,
                ...(seg.nextRoiIndex !== undefined ? { nextRoiIndex: seg.nextRoiIndex } : {})
            };
            t += duration;
            return entry;
        });
    }

    /**
     * Returns the auto-calculated total loop duration in seconds.
     * Call after building timeline, or it computes from current ROIs.
     * @returns {number}
     */
    getLoopDuration() {
        if (this._totalDuration > 0) return this._totalDuration;
        // Fallback: estimate without building
        const n = this._rois.length;
        if (n === 0) return 0;
        if (n === 1) return this.dwellSeconds * 4;

        let total = 0;
        for (let i = 0; i < n; i++) {
            total += this.dwellSeconds;
            const nextIdx = (i + 1) % n;
            const dist = this._rois[i].position.distanceTo(this._rois[nextIdx].position);
            total += Math.max(MIN_TRANSIT_SECONDS, dist / TRANSIT_SPEED);
        }
        return total;
    }

    // ─── Camera application (shared core) ─────────────────────────

    /**
     * Evaluate splines and timeline at a normalized time, apply to camera.
     *
     * Key design: position and target are ALWAYS read from the spline via
     * getPoint() (raw parameter, not arc-length). This guarantees that
     * getPoint(i/n) returns exactly control-point i, so dwell phases
     * (which hold the spline parameter at i/n) align perfectly with the
     * start/end of transit phases (which interpolate between i/n and j/n).
     * No snapping to stored ROI values → no discontinuity at boundaries.
     *
     * @param {number} normalizedT - Time in [0, 1]
     * @param {number} wallClock   - Wall-clock seconds (for micro-motion)
     * @private
     */
    _applyCamera(normalizedT, wallClock) {
        const n = this._rois.length;
        if (n === 0 || !this._positionSpline || !this._targetSpline) return;

        // Wrap normalizedT to [0, 1)
        let t = ((normalizedT % 1) + 1) % 1;

        // Find the current timeline segment
        let segment = null;
        for (let i = 0; i < this._timeline.length; i++) {
            const seg = this._timeline[i];
            if (t >= seg.tStart && t < seg.tEnd) {
                segment = seg;
                break;
            }
        }
        // Fallback to last segment if at exactly 1.0
        if (!segment) {
            segment = this._timeline[this._timeline.length - 1];
        }

        let splineParam, fov;

        if (n === 1) {
            // Single ROI: the spline is a tiny orbit, traverse it fully
            splineParam = t;
            fov = this._rois[0].fov;
        } else if (segment.type === 'dwell') {
            // Hold the spline parameter at this ROI's control-point parameter
            splineParam = segment.roiIndex / n;
            fov = this._rois[segment.roiIndex].fov;
        } else {
            // Transit: smoothstep the spline parameter from one ROI to the next
            const localT = (t - segment.tStart) / (segment.tEnd - segment.tStart);
            const easedT = smoothstep(localT);

            const fromParam = segment.roiIndex / n;
            let toParam = segment.nextRoiIndex / n;

            // Handle wrap-around (last ROI → first ROI)
            if (toParam <= fromParam) toParam += 1;

            splineParam = fromParam + (toParam - fromParam) * easedT;
            // Wrap back to [0, 1)
            splineParam = ((splineParam % 1) + 1) % 1;

            // Lerp FOV between the two ROIs
            const fromFov = this._rois[segment.roiIndex].fov;
            const toFov = this._rois[segment.nextRoiIndex].fov;
            fov = MathUtils.lerp(fromFov, toFov, easedT);
        }

        // Evaluate splines using RAW parameter (getPoint, NOT getPointAt).
        // getPoint(i/n) maps exactly to control-point i for a closed curve
        // with n control points, ensuring seamless dwell↔transit transitions.
        const pos = this._positionSpline.getPoint(splineParam, this._tmpPos);
        const target = this._targetSpline.getPoint(splineParam, this._tmpTarget);

        // ── Clamp camera position to front side of artwork plane ──
        this._clampToFrontSide(pos);

        // Apply micro-motion (subtle organic drift)
        if (this.microMotionEnabled) {
            const dist = pos.distanceTo(target);
            const amplitude = MICRO_AMPLITUDE_FACTOR * dist;

            // Reduce amplitude during transit to avoid disrupting interpolation
            const ampScale = (segment && segment.type === 'transit') ? 0.3 : 1.0;
            const a = amplitude * ampScale;

            // Build camera-local frame for micro-motion offset
            this._tmpForward.copy(target).sub(pos).normalize();
            const worldUp = new Vector3(0, 1, 0);
            this._tmpRight.crossVectors(this._tmpForward, worldUp).normalize();
            this._tmpUp.crossVectors(this._tmpRight, this._tmpForward).normalize();

            pos.addScaledVector(this._tmpRight, a * Math.sin(wallClock * MICRO_FREQ_RIGHT));
            pos.addScaledVector(this._tmpUp, a * Math.sin(wallClock * MICRO_FREQ_UP + MICRO_PHASE_UP));
        }

        // Apply to camera
        this._camera.position.copy(pos);
        this._camera.lookAt(target);

        // Apply FOV if changed
        if (Math.abs(this._camera.fov - fov) > 0.01) {
            this._camera.fov = fov;
            this._camera.updateProjectionMatrix();
        }
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
        this._buildTimeline();
        this._playbackTime = 0;
        this._wallClock = 0;
        this._playing = true;

        console.log(
            `[Cinematic] Playback started: ${this._rois.length} ROIs, ` +
            `${this._totalDuration.toFixed(1)}s loop, ` +
            `${this._timeline.length} segments`
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
        this._timeline = [];
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
        this._buildTimeline();
        console.log(
            `[Cinematic] Prepared for export: ${this._rois.length} ROIs, ` +
            `${this._totalDuration.toFixed(1)}s loop`
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
