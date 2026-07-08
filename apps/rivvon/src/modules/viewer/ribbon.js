import * as THREE from 'three';
import { CatmullRomCurve3 } from 'three';
import {
    CAP_STYLE_POINTED,
    DEFAULT_CAP_STYLE,
    CAP_STYLE_ROUNDED,
    CAP_STYLE_SQUARE,
    CAP_STYLE_SWALLOWTAIL,
    normalizeCapStyle,
} from './capStyle.js';
import { reprojectPointToSphere } from './sphericalProjection.js';
import { buildRibbonTileIntervals, summarizeRibbonTileIntervals } from './ribbonTileLayout.js';

const CURVATURE_LOOKAHEAD_SAMPLES = 4;
const CURVATURE_SMOOTHING_RADIUS = 4;
const CURVATURE_NARROWING_START_ANGLE = 0.2;
const CURVATURE_NARROWING_FULL_ANGLE = 0.95;
const CURVATURE_NARROWING_MIN_WIDTH = 0.45;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_RIGHT = new THREE.Vector3(1, 0, 0);

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0, edge1, value) {
    if (edge1 <= edge0) {
        return value >= edge1 ? 1 : 0;
    }

    const t = clamp01((value - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
}

function angleBetweenVectors(a, b) {
    return Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
}

function averageSampleWindow(values, index, radius) {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length - 1, index + radius);
    let total = 0;
    let count = 0;

    for (let i = start; i <= end; i++) {
        total += values[i];
        count += 1;
    }

    return count > 0 ? total / count : 0;
}

let ribbonVariationCounter = 0;

export class Ribbon {
    constructor(scene) {
        this.scene = scene;
        this.meshSegments = [];
        this.tileManager = null;
        this.tileManagerB = null;
        this.lastPoints = [];
        this.lastWidth = 1;
        this.segmentOffset = 0;
        this.pathLength = 0;
        this.layoutMode = 'measuringTape';
        this.layoutMetadata = null;
        this.textureOrientationMirrorY = false;

        this.waveAmplitude = 0.075;
        this.waveFrequency = 0.25;
        this.waveSpeed = 2;
        this.undulationEnabled = true;

        this.helixMode = false;
        this.helixRadius = 0.20;
        this.helixPitch = 9.0;
        this.helixStrandWidth = 0.50;
        this.helixMeshSegmentsB = [];
        this._segmentCacheB = [];
        this._segmentCache = [];

        this.capStyle = DEFAULT_CAP_STYLE;
        this.roundedCaps = false;
        this.cornerNarrowingEnabled = false;
        this.ribbonPathAlignmentMode = 'center';
        this.sphericalProjectionEnabled = false;
        this.sphericalProjectionRadius = 1;
        this.sphericalProjectionCenter = new THREE.Vector3(0, 0, 0);
        this._variationId = ribbonVariationCounter++;
    }

    setTileManager(tileManager) {
        this.tileManager = tileManager;
        this.syncWaveSpeedToLayerCycle();
        return this;
    }

    setTileManagerB(tileManager) {
        this.tileManagerB = tileManager;
        return this;
    }

    syncWaveSpeedToLayerCycle() {
        if (!this.tileManager) return;

        const undulationPeriod = this.tileManager.getOptimalUndulationPeriod?.(3.0) || 3.0;
        this.waveSpeed = (2 * Math.PI) / undulationPeriod;
    }

    getUndulationPeriod() {
        return this.tileManager?.getOptimalUndulationPeriod?.(3.0) || 3.0;
    }

    setUndulationTime(timeSeconds) {
        if (!Number.isFinite(timeSeconds)) {
            return;
        }

        this.updateWaveAnimation(timeSeconds);
    }

    setSegmentOffset(offset) {
        this.segmentOffset = offset;
        return this;
    }

    setTextureOrientationMirrorY(mirrorY) {
        this.textureOrientationMirrorY = !!mirrorY;
        return this;
    }

    setHelixOptions(options = {}) {
        if (options.helixMode !== undefined) this.helixMode = options.helixMode;
        if (options.helixRadius !== undefined) this.helixRadius = options.helixRadius;
        if (options.helixPitch !== undefined) this.helixPitch = options.helixPitch;
        if (options.helixStrandWidth !== undefined) this.helixStrandWidth = options.helixStrandWidth;
        if (options.cornerNarrowingEnabled !== undefined) this.cornerNarrowingEnabled = !!options.cornerNarrowingEnabled;
        if (options.undulationEnabled !== undefined) this.undulationEnabled = !!options.undulationEnabled;
        if (options.ribbonPathAlignmentMode !== undefined) this.ribbonPathAlignmentMode = options.ribbonPathAlignmentMode || 'center';
        if (options.sphericalProjectionEnabled !== undefined) this.sphericalProjectionEnabled = !!options.sphericalProjectionEnabled;
        if (options.sphericalProjectionRadius !== undefined && Number.isFinite(options.sphericalProjectionRadius) && options.sphericalProjectionRadius > 0) {
            this.sphericalProjectionRadius = options.sphericalProjectionRadius;
        }
        if (options.capStyle !== undefined || options.roundedCaps !== undefined) {
            this.capStyle = normalizeCapStyle(
                options.capStyle,
                options.roundedCaps !== undefined ? options.roundedCaps : this.roundedCaps
            );
            this.roundedCaps = this.capStyle === CAP_STYLE_ROUNDED;
        }
        return this;
    }

    _getCapStyleCode() {
        if (this.capStyle === CAP_STYLE_ROUNDED) return 1;
        if (this.capStyle === CAP_STYLE_POINTED) return 2;
        if (this.capStyle === CAP_STYLE_SWALLOWTAIL) return 3;
        return 0;
    }

    _assignCapAttributesToMesh(mesh, options = {}) {
        const geometry = mesh?.geometry;
        const position = geometry?.attributes?.position;
        if (!geometry || !position) {
            return;
        }

        const vertexCount = position.count;
        const startStyle = options.start ? this._getCapStyleCode() : 0;
        const endStyle = options.end ? this._getCapStyleCode() : 0;
        const startValues = new Float32Array(vertexCount);
        const endValues = new Float32Array(vertexCount);

        if (startStyle !== 0) startValues.fill(startStyle);
        if (endStyle !== 0) endValues.fill(endStyle);

        geometry.setAttribute('capStartStyle', new THREE.BufferAttribute(startValues, 1));
        geometry.setAttribute('capEndStyle', new THREE.BufferAttribute(endValues, 1));
    }

    _getCapWorldLength(pathLength, width) {
        const visualCapLength = Math.max(0, width);

        if (!Number.isFinite(pathLength) || pathLength <= 0) {
            return visualCapLength;
        }

        return Math.min(visualCapLength, pathLength * 0.5);
    }

    _distanceToGlobalT(distance, pathLength) {
        if (!Number.isFinite(pathLength) || pathLength <= 0) {
            return 0;
        }

        return clamp01(distance / pathLength);
    }

    _assignIntervalMetadata(mesh, interval, pathLength, tileWorldLength, capWorldLength) {
        if (!mesh || !interval) return;

        const tapeTileIndex = this.segmentOffset + interval.tileIndex;
        mesh.userData.tapeTileIndex = tapeTileIndex;
        mesh.userData.localTapeTileIndex = interval.tileIndex;
        mesh.userData.tileStartDistance = interval.tileStartDistance;
        mesh.userData.tileEndDistance = interval.tileEndDistance;
        mesh.userData.visibleStartDistance = interval.visibleStartDistance;
        mesh.userData.visibleEndDistance = interval.visibleEndDistance;
        mesh.userData.uStart = interval.uStart;
        mesh.userData.uEnd = interval.uEnd;
        mesh.userData.pathLength = pathLength;
        mesh.userData.tileWorldLength = tileWorldLength;
        mesh.userData.capWorldLength = capWorldLength;
        mesh.userData.layoutMode = this.layoutMode;
    }

    _getIntervalCapOptions(interval, pathLength, capWorldLength) {
        const hasStyledCaps = this.capStyle !== CAP_STYLE_SQUARE && capWorldLength > 0 && interval.visible;

        if (!hasStyledCaps) {
            return { start: false, end: false };
        }

        return {
            start: interval.visibleStartDistance < capWorldLength,
            end: pathLength - interval.visibleEndDistance < capWorldLength,
        };
    }

    _setLayoutMetadata({ pathLength, tileWorldLength, intervals, capWorldLength }) {
        const summary = summarizeRibbonTileIntervals(intervals);
        const capSegmentsTouched = intervals.reduce((count, interval) => {
            const capOptions = this._getIntervalCapOptions(interval, pathLength, capWorldLength);
            return count + ((capOptions.start || capOptions.end) ? 1 : 0);
        }, 0);

        this.layoutMetadata = {
            layoutMode: this.layoutMode,
            pathLength,
            tileWorldLength,
            visibleTileCount: summary.visibleTileCount,
            totalAllocatedSegmentCount: summary.totalAllocatedSegmentCount,
            partialFinalTileU: summary.partialFinalTileU,
            capWorldLength,
            capSegmentsTouched,
        };

        return this.layoutMetadata;
    }

    _buildRibbonSegmentFromInterval({
        curve,
        interval,
        width,
        time,
        frameSamples,
        pointsPerSegment,
        capWorldLength,
        tileWorldLength,
        strandOffset = 0,
        overrideTileManager = null,
        widthScaleFn = null,
        masked = false,
    }) {
        const startT = this._distanceToGlobalT(interval.visibleStartDistance, this.pathLength);
        const endT = this._distanceToGlobalT(interval.visibleEndDistance, this.pathLength);
        const segmentIndex = interval.tileIndex;
        const geometryOptions = {
            uStart: interval.uStart,
            uEnd: interval.uEnd,
            capWorldLength,
            pathLength: this.pathLength,
            tileWorldLength,
        };

        const segmentMesh = masked
            ? this.createMaskedRibbonSegmentWithCache(
                curve,
                startT,
                endT,
                width,
                time,
                segmentIndex,
                frameSamples,
                pointsPerSegment,
                widthScaleFn,
                strandOffset,
                overrideTileManager,
                geometryOptions
            )
            : this.createStripRibbonSegmentWithCache(
                curve,
                startT,
                endT,
                width,
                time,
                segmentIndex,
                frameSamples,
                pointsPerSegment,
                strandOffset,
                overrideTileManager,
                widthScaleFn,
                geometryOptions
            );

        if (segmentMesh) {
            this._assignIntervalMetadata(segmentMesh, interval, this.pathLength, tileWorldLength, capWorldLength);
            this._assignCapAttributesToMesh(
                segmentMesh,
                this._getIntervalCapOptions(interval, this.pathLength, capWorldLength)
            );
        }

        return segmentMesh;
    }

    _updateRibbonSegmentFromInterval(mesh, {
        curve,
        interval,
        width,
        time,
        frameSamples,
        pointsPerSegment,
        capWorldLength,
        tileWorldLength,
    }) {
        const geometry = this.createStripRibbonSegmentGeometryWithCache(
            curve,
            this._distanceToGlobalT(interval.visibleStartDistance, this.pathLength),
            this._distanceToGlobalT(interval.visibleEndDistance, this.pathLength),
            width,
            time,
            interval.tileIndex,
            frameSamples,
            pointsPerSegment,
            0,
            null,
            {
                uStart: interval.uStart,
                uEnd: interval.uEnd,
                capWorldLength,
                pathLength: this.pathLength,
                tileWorldLength,
            }
        );

        mesh.geometry?.dispose?.();
        mesh.geometry = geometry;
        mesh.visible = interval.visible;
        this._assignIntervalMetadata(mesh, interval, this.pathLength, tileWorldLength, capWorldLength);
        this._assignCapAttributesToMesh(mesh, this._getIntervalCapOptions(interval, this.pathLength, capWorldLength));
    }

    _projectCurvePointOntoSphere(point, target = new THREE.Vector3()) {
        return reprojectPointToSphere(
            point,
            this.sphericalProjectionRadius,
            target,
            this.sphericalProjectionCenter
        );
    }

    _getFallbackSurfaceTangent(surfaceNormal, target = new THREE.Vector3()) {
        const axis = Math.abs(surfaceNormal.y) < 0.9 ? WORLD_UP : WORLD_RIGHT;
        target.crossVectors(axis, surfaceNormal);

        if (target.lengthSq() < 1e-10) {
            target.set(1, 0, 0);
        }

        return target.normalize();
    }

    _projectDirectionOntoSurface(direction, surfaceNormal, target = new THREE.Vector3()) {
        target.copy(direction).addScaledVector(surfaceNormal, -direction.dot(surfaceNormal));

        if (target.lengthSq() < 1e-10) {
            return this._getFallbackSurfaceTangent(surfaceNormal, target);
        }

        return target.normalize();
    }

    _computeSphericalSideVector(surfaceNormal, tangent, fallbackSideVector = null, target = new THREE.Vector3()) {
        target.crossVectors(surfaceNormal, tangent);

        if (target.lengthSq() < 1e-10 && fallbackSideVector) {
            target.copy(fallbackSideVector).addScaledVector(
                surfaceNormal,
                -fallbackSideVector.dot(surfaceNormal)
            );
        }

        if (target.lengthSq() < 1e-10) {
            this._getFallbackSurfaceTangent(surfaceNormal, target);
            target.crossVectors(surfaceNormal, target);
        }

        return target.normalize();
    }

    _sampleSphericalTangent(curve, globalT, frameSampleCount, surfaceNormal, target = new THREE.Vector3()) {
        const sampleDelta = 1 / Math.max(256, frameSampleCount * 8);
        const prevT = Math.max(0, globalT - sampleDelta);
        const nextT = Math.min(1, globalT + sampleDelta);
        const prevPoint = this._projectCurvePointOntoSphere(curve.getPoint(prevT), new THREE.Vector3());
        const nextPoint = this._projectCurvePointOntoSphere(curve.getPoint(nextT), new THREE.Vector3());

        target.copy(nextPoint).sub(prevPoint);

        if (target.lengthSq() < 1e-10) {
            target.copy(curve.getTangent(globalT));
        }

        return this._projectDirectionOntoSurface(target, surfaceNormal, target);
    }

    buildFromPoints(points, width = 1, time = 0) {
        if (points.length < 2) return;

        // console.log('[Ribbon] buildFromPoints called', {
        //     pointCount: points.length,
        //     width: width,
        //     time: time
        // });

        // Store for animation updates
        this.lastPoints = points.map(p => p.clone());
        this.lastWidth = width;

        const segments = this.buildSegmentedRibbon(points, width, time);

        // After building, automatically log any segments with very small bounds
        // to help diagnose degenerate geometry that may cause rendering issues
        if (segments && segments.length) {
            const tinyThreshold = 0.05;
            const tinySegments = [];

            segments.forEach((mesh, index) => {
                if (!mesh || !mesh.geometry) return;

                const geom = mesh.geometry;

                try {
                    geom.computeBoundingSphere();
                } catch (e) {
                    return;
                }

                const sphere = geom.boundingSphere;
                if (!sphere) return;

                if (sphere.radius < tinyThreshold) {
                    tinySegments.push({ index, radius: sphere.radius, center: sphere.center });
                }
            });

            if (tinySegments.length > 0) {
                console.log('[Ribbon] Tiny segments detected after buildFromPoints', {
                    tinyThreshold,
                    tinySegmentsCount: tinySegments.length,
                    tinySegments
                });
            }
        }

    }

    buildSegmentedRibbon(points, width, time) {
        const totalLength = this.calculatePathLength(points);
        this.pathLength = totalLength; // Store for use in wave calculations
        const tileWorldLength = Math.max(0.0001, width);
        const intervals = buildRibbonTileIntervals({
            pathLength: totalLength,
            tileWorldLength,
        });
        const segmentCount = intervals.length;
        const capWorldLength = this._getCapWorldLength(totalLength, width);
        this._setLayoutMetadata({
            pathLength: totalLength,
            tileWorldLength,
            intervals,
            capWorldLength,
        });

        // console.log('[Ribbon] buildSegmentedRibbon starting', {
        //     totalLength: totalLength.toFixed(2),
        //     segmentLength: segmentLength,
        //     segmentCount: segmentCount,
        //     tileManagerAvailable: !!this.tileManager
        // });

        // Clean up old segments
        this.cleanupOldMesh();

        // Create curve for the path
        const curve = this.createCurveFromPoints(points);
        // console.log('[Ribbon] Curve created from points');

        const pointsPerSegment = this._getBasePointsPerSegment();
        const frameSamples = this.createFrameSamples(
            curve,
            Math.max(2, segmentCount * pointsPerSegment + 1)
        );
        const useCornerNarrowing = this.cornerNarrowingEnabled && !this.helixMode;
        const cornerIntervalFn = useCornerNarrowing
            ? (localT, globalT, frame) => this._getCurvatureRetainedInterval(
                frame.curvature,
                1
            )
            : null;

        for (const interval of intervals) {
            if (!interval.visible) continue;

            const segmentMesh = this._buildRibbonSegmentFromInterval({
                curve,
                interval,
                width,
                time,
                frameSamples,
                pointsPerSegment,
                capWorldLength,
                tileWorldLength,
                strandOffset: 0,
                widthScaleFn: cornerIntervalFn,
                masked: useCornerNarrowing,
            });

            if (segmentMesh) {
                this.meshSegments.push(segmentMesh);
                this.scene.add(segmentMesh);
            }

            if (this.helixMode) {
                const strandBTileManager = this.tileManagerB || this.tileManager;
                const segmentMeshB = this._buildRibbonSegmentFromInterval({
                    curve,
                    interval,
                    width,
                    time,
                    frameSamples,
                    pointsPerSegment,
                    capWorldLength,
                    tileWorldLength,
                    strandOffset: Math.PI,
                    overrideTileManager: strandBTileManager,
                    widthScaleFn: null,
                    masked: false,
                });

                if (segmentMeshB) {
                    this.helixMeshSegmentsB.push(segmentMeshB);
                    this.scene.add(segmentMeshB);
                }
            }
        }

        // console.log('[Ribbon] All segments created and added to scene', {
        //     totalSegments: this.meshSegments.length
        // });

        return this.meshSegments;
    }

    buildPooledSegmentedRibbon(points, width, time, options = {}) {
        const maxSegmentCount = Math.max(1, Math.ceil(Number(options.maxSegmentCount) || 1));

        this.cleanupOldMesh();
        this.lastPoints = points.map(p => p.clone());
        this.lastWidth = width;
        this.pathLength = this.calculatePathLength(points);
        const tileWorldLength = Math.max(0.0001, width);
        const intervals = buildRibbonTileIntervals({
            pathLength: this.pathLength,
            tileWorldLength,
            maxSegmentCount,
        });
        const capWorldLength = this._getCapWorldLength(this.pathLength, width);
        this._setLayoutMetadata({
            pathLength: this.pathLength,
            tileWorldLength,
            intervals,
            capWorldLength,
        });

        const curve = this.createCurveFromPoints(points);
        const pointsPerSegment = this._getBasePointsPerSegment();
        const activeSegmentCount = Math.max(1, intervals.filter(interval => interval.visible).length);
        const frameSamples = this.createFrameSamples(
            curve,
            Math.max(2, activeSegmentCount * pointsPerSegment + 1)
        );

        for (const interval of intervals) {
            const geometry = this.createStripRibbonSegmentGeometryWithCache(
                curve,
                this._distanceToGlobalT(interval.visibleStartDistance, this.pathLength),
                this._distanceToGlobalT(interval.visibleEndDistance, this.pathLength),
                width,
                time,
                interval.tileIndex,
                frameSamples,
                pointsPerSegment,
                0,
                null,
                {
                    uStart: interval.uStart,
                    uEnd: interval.uEnd,
                    capWorldLength,
                    pathLength: this.pathLength,
                    tileWorldLength,
                }
            );
            const segmentMesh = this._createSegmentMesh(geometry, interval.tileIndex, null);

            segmentMesh.visible = interval.visible;
            this._assignIntervalMetadata(segmentMesh, interval, this.pathLength, tileWorldLength, capWorldLength);
            this._assignCapAttributesToMesh(segmentMesh, this._getIntervalCapOptions(interval, this.pathLength, capWorldLength));
            this.meshSegments.push(segmentMesh);
            this.scene.add(segmentMesh);
        }

        return this.meshSegments;
    }

    updatePooledSegmentedRibbon(points, width, time, options = {}) {
        const maxSegmentCount = Math.max(1, Math.ceil(Number(options.maxSegmentCount) || this.meshSegments.length || 1));
        if (this.meshSegments.length !== maxSegmentCount || this.helixMode) {
            return this.buildPooledSegmentedRibbon(points, width, time, {
                maxSegmentCount,
            });
        }

        this.lastPoints = points.map(p => p.clone());
        this.lastWidth = width;
        this.pathLength = this.calculatePathLength(points);
        const tileWorldLength = Math.max(0.0001, width);
        const intervals = buildRibbonTileIntervals({
            pathLength: this.pathLength,
            tileWorldLength,
            maxSegmentCount,
        });
        const capWorldLength = this._getCapWorldLength(this.pathLength, width);
        this._setLayoutMetadata({
            pathLength: this.pathLength,
            tileWorldLength,
            intervals,
            capWorldLength,
        });

        const curve = this.createCurveFromPoints(points);
        const pointsPerSegment = this._getBasePointsPerSegment();
        const activeSegmentCount = Math.max(1, intervals.filter(interval => interval.visible).length);
        const frameSamples = this.createFrameSamples(
            curve,
            Math.max(2, activeSegmentCount * pointsPerSegment + 1)
        );

        for (const interval of intervals) {
            const mesh = this.meshSegments[interval.tileIndex];
            if (!mesh) continue;

            this._updateRibbonSegmentFromInterval(mesh, {
                curve,
                interval,
                width,
                time,
                frameSamples,
                pointsPerSegment,
                capWorldLength,
                tileWorldLength,
            });
        }

        return this.meshSegments;
    }

    calculatePathLength(points) {
        let length = 0;
        for (let i = 1; i < points.length; i++) {
            length += points[i].distanceTo(points[i - 1]);
        }
        return length;
    }

    /**
     * Build a smooth arc-length–parameterized curve from a polyline.
     *
     * Uses CatmullRomCurve3 (centripetal) to produce a smooth spline with
     * continuous tangent vectors.  The built-in getPointAt / getTangentAt
     * methods provide arc-length-uniform sampling, which ensures equal t
     * intervals correspond to equal physical distances along the curve.
     *
     * Previous implementation used piecewise-linear interpolation, which
     * caused discontinuous tangent directions at source-point vertices.
     * In helix mode the normal/binormal frame is derived from the tangent,
     * so tangent jumps produced visible "steps" in the helix orbit plane.
     */
    createCurveFromPoints(points) {
        const n = points.length;

        // For very short paths, fall back to a simple linear curve
        if (n < 3) {
            const curve = new THREE.LineCurve3(
                points[0].clone(),
                points[n - 1].clone()
            );
            // LineCurve3 has getPoint / getTangent but not arc-length remap;
            // for 2 points it doesn't matter since it's a straight line.
            return curve;
        }

        // Build a smooth spline through all points.
        // "centripetal" parameterization prevents cusps and self-intersections
        // that can occur with uniform param on unevenly-spaced control points.
        const spline = new CatmullRomCurve3(points, false, 'centripetal');

        // Increase arc-length resolution for complex paths so that
        // getPointAt / getTangentAt produce accurate arc-length mapping.
        spline.arcLengthDivisions = Math.max(200, n * 2);

        // Wrap into the same API the rest of the code expects:
        //   curve.getPoint(t)   → arc-length-uniform position
        //   curve.getTangent(t) → arc-length-uniform tangent
        const curve = new THREE.Curve();

        curve.getPoint = (t) => {
            return spline.getPointAt(Math.max(0, Math.min(1, t)));
        };

        curve.getTangent = (t) => {
            return spline.getTangentAt(Math.max(0, Math.min(1, t)));
        };

        return curve;
    }

    _getBasePointsPerSegment() {
        const basePointsPerSegment = 50;
        return this.helixMode
            ? Math.max(basePointsPerSegment, Math.ceil(basePointsPerSegment * (1 + this.helixPitch / 4)))
            : basePointsPerSegment;
    }

    createFrameSamples(curve, sampleCount) {
        if (this.sphericalProjectionEnabled) {
            const samplePoints = [];
            const tangents = [];

            for (let i = 0; i < sampleCount; i++) {
                const t = i / (sampleCount - 1);
                samplePoints.push(this._projectCurvePointOntoSphere(curve.getPoint(t), new THREE.Vector3()));
            }

            for (let i = 0; i < sampleCount; i++) {
                const t = i / (sampleCount - 1);
                const point = samplePoints[i];
                const prevPoint = samplePoints[Math.max(0, i - 1)];
                const nextPoint = samplePoints[Math.min(sampleCount - 1, i + 1)];
                const surfaceNormal = point.clone().sub(this.sphericalProjectionCenter).normalize();
                const tangent = nextPoint.clone().sub(prevPoint);

                if (tangent.lengthSq() < 1e-10) {
                    tangent.copy(curve.getTangent(t));
                }

                tangents.push(this._projectDirectionOntoSurface(tangent, surfaceNormal, tangent));
            }

            const rawCurvatures = tangents.map((_, index) => {
                const leftIndex = Math.max(0, index - CURVATURE_LOOKAHEAD_SAMPLES);
                const rightIndex = Math.min(sampleCount - 1, index + CURVATURE_LOOKAHEAD_SAMPLES);

                if (leftIndex === rightIndex) {
                    return 0;
                }

                return angleBetweenVectors(tangents[leftIndex], tangents[rightIndex]);
            });

            const smoothedCurvatures = rawCurvatures.map((_, index) => (
                averageSampleWindow(rawCurvatures, index, CURVATURE_SMOOTHING_RADIUS)
            ));

            return samplePoints.map((point, index) => {
                const normal = point.clone().sub(this.sphericalProjectionCenter).normalize();
                const sideVector = this._computeSphericalSideVector(normal, tangents[index], null, new THREE.Vector3());

                return {
                    normal,
                    binormal: sideVector.clone(),
                    widthDirection: normal.clone(),
                    curvature: smoothedCurvatures[index] || 0,
                };
            });
        }

        const tangents = [];

        for (let i = 0; i < sampleCount; i++) {
            const t = i / (sampleCount - 1);
            tangents.push(curve.getTangent(t).normalize());
        }

        const rawCurvatures = tangents.map((_, index) => {
            const leftIndex = Math.max(0, index - CURVATURE_LOOKAHEAD_SAMPLES);
            const rightIndex = Math.min(sampleCount - 1, index + CURVATURE_LOOKAHEAD_SAMPLES);

            if (leftIndex === rightIndex) {
                return 0;
            }

            return angleBetweenVectors(tangents[leftIndex], tangents[rightIndex]);
        });

        const smoothedCurvatures = rawCurvatures.map((_, index) => (
            averageSampleWindow(rawCurvatures, index, CURVATURE_SMOOTHING_RADIUS)
        ));

        const initialTangent = tangents[0].clone();
        const up = new THREE.Vector3(0, 1, 0);
        let referenceNormal = up.cross(initialTangent).normalize();

        if (referenceNormal.length() < 0.1) {
            const right = new THREE.Vector3(1, 0, 0);
            referenceNormal = right.cross(initialTangent).normalize();
        }

        const frameSamples = [];
        let prevNormal = referenceNormal.clone();
        let prevTangent = initialTangent.clone();

        for (let i = 0; i < sampleCount; i++) {
            const tangent = tangents[i].clone();

            let normal;
            if (i === 0) {
                normal = prevNormal.clone();
            } else {
                const v1 = new THREE.Vector3().subVectors(tangent, prevTangent);
                const c1 = v1.dot(v1);

                if (c1 < 1e-10) {
                    normal = prevNormal.clone();
                } else {
                    const reflectedNormal = prevNormal.clone().addScaledVector(v1, (-2 / c1) * v1.dot(prevNormal));
                    const reflectedTangent = prevTangent.clone().addScaledVector(v1, (-2 / c1) * v1.dot(prevTangent));
                    const v2 = new THREE.Vector3().subVectors(tangent, reflectedTangent);
                    const c2 = v2.dot(v2);

                    normal = c2 < 1e-10
                        ? reflectedNormal
                        : reflectedNormal.addScaledVector(v2, (-2 / c2) * v2.dot(reflectedNormal));
                }

                normal.normalize();
            }

            const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();

            frameSamples.push({
                normal: normal.clone(),
                binormal: binormal.clone(),
                widthDirection: normal.clone(),
                curvature: smoothedCurvatures[i] || 0,
            });

            prevNormal = normal;
            prevTangent = tangent.clone();
        }

        return frameSamples;
    }

    _sampleFrame(curve, frameSamples, globalT) {
        const clampedT = Math.max(0, Math.min(1, globalT));
        const scaledIndex = clampedT * (frameSamples.length - 1);
        const lowerIndex = Math.floor(scaledIndex);
        const upperIndex = Math.min(frameSamples.length - 1, lowerIndex + 1);
        const alpha = scaledIndex - lowerIndex;

        if (this.sphericalProjectionEnabled) {
            const point = this._projectCurvePointOntoSphere(curve.getPoint(clampedT), new THREE.Vector3());
            const normal = point.clone().sub(this.sphericalProjectionCenter).normalize();
            const tangent = this._sampleSphericalTangent(curve, clampedT, frameSamples.length, normal, new THREE.Vector3());
            const fallbackSideVector = frameSamples[lowerIndex].binormal.clone()
                .lerp(frameSamples[upperIndex].binormal, alpha);
            const sideVector = this._computeSphericalSideVector(
                normal,
                tangent,
                fallbackSideVector,
                new THREE.Vector3()
            );

            return {
                point,
                tangent,
                normal,
                binormal: sideVector.clone(),
                widthDirection: normal.clone(),
                arcLength: clampedT * this.pathLength,
                globalT: clampedT,
                curvature: THREE.MathUtils.lerp(
                    frameSamples[lowerIndex].curvature || 0,
                    frameSamples[upperIndex].curvature || 0,
                    alpha
                ),
            };
        }

        const tangent = curve.getTangent(clampedT).normalize();
        const normal = frameSamples[lowerIndex].normal.clone()
            .lerp(frameSamples[upperIndex].normal, alpha)
            .normalize();
        const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();
        normal.crossVectors(binormal, tangent).normalize();

        return {
            point: curve.getPoint(clampedT),
            tangent,
            normal,
            binormal,
            widthDirection: normal.clone(),
            arcLength: clampedT * this.pathLength,
            globalT: clampedT,
            curvature: THREE.MathUtils.lerp(
                frameSamples[lowerIndex].curvature || 0,
                frameSamples[upperIndex].curvature || 0,
                alpha
            ),
        };
    }

    _createAnimationScratch() {
        return {
            animatedNormal: new THREE.Vector3(),
            helixCenter: new THREE.Vector3(),
            radialDir: new THREE.Vector3(),
            acrossDir: new THREE.Vector3(),
            widthDirection: new THREE.Vector3(),
        };
    }

    _getAlignedAcrossValue(acrossValue) {
        if (this.ribbonPathAlignmentMode === 'inside') {
            return acrossValue - 0.5;
        }

        if (this.ribbonPathAlignmentMode === 'outside') {
            return acrossValue + 0.5;
        }

        return acrossValue;
    }

    _setAnimatedVertexPosition(target, frame, width, acrossValue, widthScale, time, strandOffset = 0, scratch) {
        const scaledAcross = this._getAlignedAcrossValue(acrossValue) * widthScale;
        const wavePhase = this.undulationEnabled
            ? Math.sin(
                frame.arcLength * this.waveFrequency * Math.PI * 2 + time * this.waveSpeed
            ) * this.waveAmplitude
            : 0;

        if (this.helixMode) {
            const helixAngle = frame.globalT * this.helixPitch * Math.PI * 2 + strandOffset;
            const animatedAngle = helixAngle + wavePhase;
            const cosA = Math.cos(animatedAngle);
            const sinA = Math.sin(animatedAngle);
            const helixRadius = this.helixRadius * width;
            const strandWidth = this.helixStrandWidth * width;

            scratch.helixCenter.copy(frame.point)
                .addScaledVector(frame.normal, cosA * helixRadius)
                .addScaledVector(frame.binormal, sinA * helixRadius);

            scratch.radialDir.copy(scratch.helixCenter).sub(frame.point).normalize();
            scratch.acrossDir.crossVectors(frame.tangent, scratch.radialDir).normalize();

            target.copy(scratch.helixCenter).addScaledVector(scratch.acrossDir, scaledAcross * strandWidth);
            return target;
        }

        scratch.widthDirection.copy(frame.widthDirection || frame.normal);
        scratch.animatedNormal.copy(scratch.widthDirection);
        scratch.animatedNormal.applyAxisAngle(frame.tangent, wavePhase);
        target.copy(frame.point).addScaledVector(scratch.animatedNormal, scaledAcross * width);
        return target;
    }

    _createSegmentMesh(geometry, segmentIndex, overrideTileManager = null) {
        let material = null;
        const textureIndex = segmentIndex + this.segmentOffset;
        const activeTileManager = overrideTileManager || this.tileManager;

        if (activeTileManager && typeof activeTileManager.getMaterial === 'function') {
            material = activeTileManager.getMaterial(textureIndex, {
                orientationMirrorY: this.textureOrientationMirrorY,
            }) || null;
        }

        if (!material) {
            const tileTexture = activeTileManager.getTile(textureIndex);
            material = new THREE.MeshBasicMaterial({
                map: tileTexture,
                side: THREE.DoubleSide
            });
        }

        return new THREE.Mesh(geometry, material);
    }

    _getCurvatureRetainedInterval(curvature = 0, maxWidthScale = 1) {
        const clampedMaxWidthScale = clamp01(maxWidthScale);
        const narrowing = smoothstep(
            CURVATURE_NARROWING_START_ANGLE,
            CURVATURE_NARROWING_FULL_ANGLE,
            curvature
        );
        const curvatureWidth = 1 - narrowing * (1 - CURVATURE_NARROWING_MIN_WIDTH);
        const retainedWidth = clamp01(Math.min(clampedMaxWidthScale, curvatureWidth));
        const halfWidth = retainedWidth * 0.5;

        return [0.5 - halfWidth, 0.5 + halfWidth];
    }

    createStripRibbonSegmentWithCache(curve, startT, endT, width, time, segmentIndex, frameSamples, pointsPerSegment, strandOffset = 0, overrideTileManager = null, widthScaleFn = null, geometryOptions = {}) {
        const geometry = this.createStripRibbonSegmentGeometryWithCache(
            curve,
            startT,
            endT,
            width,
            time,
            segmentIndex,
            frameSamples,
            pointsPerSegment,
            strandOffset,
            widthScaleFn,
            geometryOptions
        );

        return this._createSegmentMesh(geometry, segmentIndex, overrideTileManager);
    }

    createStripRibbonSegmentGeometryWithCache(curve, startT, endT, width, time, segmentIndex, frameSamples, pointsPerSegment, strandOffset = 0, widthScaleFn = null, geometryOptions = {}) {
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const uvs = [];
        const edgeNoiseUs = [];
        const capStartUs = [];
        const capEndUs = [];
        const indices = [];
        const uStart = Number.isFinite(geometryOptions.uStart) ? geometryOptions.uStart : 0;
        const uEnd = Number.isFinite(geometryOptions.uEnd) ? geometryOptions.uEnd : 1;
        const capWorldLength = Math.max(0.0001, Number(geometryOptions.capWorldLength) || 0.0001);
        const pathLength = Math.max(0, Number(geometryOptions.pathLength) || this.pathLength || 0);
        const tileWorldLength = Math.max(0.0001, Number(geometryOptions.tileWorldLength) || width || 1);

        const basePositions = [];
        const normals = [];
        const binormals = [];
        const widthDirections = [];
        const tangents = [];
        const arcLengths = [];
        const globalTs = [];
        const acrossValues = [];
        const widthScales = [];
        const scratch = this._createAnimationScratch();
        const left = new THREE.Vector3();
        const right = new THREE.Vector3();

        for (let i = 0; i <= pointsPerSegment; i++) {
            const localT = i / pointsPerSegment;
            const globalT = startT + (endT - startT) * localT;
            const frame = this._sampleFrame(curve, frameSamples, globalT);
            const widthScale = widthScaleFn
                ? Math.max(0, Math.min(1, widthScaleFn(localT, globalT)))
                : 1;

            this._setAnimatedVertexPosition(left, frame, width, -0.5, widthScale, time, strandOffset, scratch);
            this._setAnimatedVertexPosition(right, frame, width, 0.5, widthScale, time, strandOffset, scratch);

            positions.push(left.x, left.y, left.z);
            positions.push(right.x, right.y, right.z);
            const sampleU = uStart + localT * (uEnd - uStart);
            const edgeNoiseU = this.segmentOffset + frame.arcLength / tileWorldLength;
            const capStartU = frame.arcLength / capWorldLength;
            const capEndU = (pathLength - frame.arcLength) / capWorldLength;
            uvs.push(sampleU, 0);
            uvs.push(sampleU, 1);
            edgeNoiseUs.push(edgeNoiseU);
            edgeNoiseUs.push(edgeNoiseU);
            capStartUs.push(capStartU);
            capStartUs.push(capStartU);
            capEndUs.push(capEndU);
            capEndUs.push(capEndU);

            for (const acrossValue of [-0.5, 0.5]) {
                basePositions.push(frame.point.clone());
                normals.push(frame.normal.clone());
                binormals.push(frame.binormal.clone());
                widthDirections.push((frame.widthDirection || frame.normal).clone());
                tangents.push(frame.tangent.clone());
                arcLengths.push(frame.arcLength);
                globalTs.push(frame.globalT);
                acrossValues.push(acrossValue);
                widthScales.push(widthScale);
            }

            if (i < pointsPerSegment) {
                const base = i * 2;
                indices.push(base, base + 1, base + 2);
                indices.push(base + 1, base + 3, base + 2);
            }
        }

        const cacheTarget = (this.helixMode && strandOffset > 0) ? this._segmentCacheB : this._segmentCache;
        cacheTarget[segmentIndex] = {
            basePositions,
            normals,
            binormals,
            widthDirections,
            tangents,
            arcLengths,
            globalTs,
            acrossValues,
            widthScales,
            width,
            strandOffset
        };

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setAttribute('edgeNoiseU', new THREE.Float32BufferAttribute(edgeNoiseUs, 1));
        geometry.setAttribute('capStartU', new THREE.Float32BufferAttribute(capStartUs, 1));
        geometry.setAttribute('capEndU', new THREE.Float32BufferAttribute(capEndUs, 1));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        return geometry;
    }

    createMaskedRibbonSegmentWithCache(curve, startT, endT, width, time, segmentIndex, frameSamples, pointsPerSegment, intervalFn, strandOffset = 0, overrideTileManager = null, geometryOptions = {}) {
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const uvs = [];
        const edgeNoiseUs = [];
        const capStartUs = [];
        const capEndUs = [];
        const indices = [];
        const uStart = Number.isFinite(geometryOptions.uStart) ? geometryOptions.uStart : 0;
        const uEnd = Number.isFinite(geometryOptions.uEnd) ? geometryOptions.uEnd : 1;
        const capWorldLength = Math.max(0.0001, Number(geometryOptions.capWorldLength) || 0.0001);
        const pathLength = Math.max(0, Number(geometryOptions.pathLength) || this.pathLength || 0);
        const tileWorldLength = Math.max(0.0001, Number(geometryOptions.tileWorldLength) || width || 1);

        const basePositions = [];
        const normals = [];
        const binormals = [];
        const widthDirections = [];
        const tangents = [];
        const arcLengths = [];
        const globalTs = [];
        const acrossValues = [];
        const widthScales = [];
        const scratch = this._createAnimationScratch();
        const left = new THREE.Vector3();
        const right = new THREE.Vector3();

        for (let i = 0; i <= pointsPerSegment; i++) {
            const localT = i / pointsPerSegment;
            const globalT = startT + (endT - startT) * localT;
            const frame = this._sampleFrame(curve, frameSamples, globalT);
            const [rawVStart, rawVEnd] = intervalFn
                ? intervalFn(localT, globalT, frame)
                : [0, 1];
            const vStart = clamp01(Math.min(rawVStart, rawVEnd));
            const vEnd = clamp01(Math.max(rawVStart, rawVEnd));
            const acrossStart = vStart - 0.5;
            const acrossEnd = vEnd - 0.5;

            this._setAnimatedVertexPosition(left, frame, width, acrossStart, 1, time, strandOffset, scratch);
            this._setAnimatedVertexPosition(right, frame, width, acrossEnd, 1, time, strandOffset, scratch);

            positions.push(left.x, left.y, left.z);
            positions.push(right.x, right.y, right.z);
            const sampleU = uStart + localT * (uEnd - uStart);
            const edgeNoiseU = this.segmentOffset + frame.arcLength / tileWorldLength;
            const capStartU = frame.arcLength / capWorldLength;
            const capEndU = (pathLength - frame.arcLength) / capWorldLength;
            uvs.push(sampleU, vStart);
            uvs.push(sampleU, vEnd);
            edgeNoiseUs.push(edgeNoiseU);
            edgeNoiseUs.push(edgeNoiseU);
            capStartUs.push(capStartU);
            capStartUs.push(capStartU);
            capEndUs.push(capEndU);
            capEndUs.push(capEndU);

            for (const acrossValue of [acrossStart, acrossEnd]) {
                basePositions.push(frame.point.clone());
                normals.push(frame.normal.clone());
                binormals.push(frame.binormal.clone());
                widthDirections.push((frame.widthDirection || frame.normal).clone());
                tangents.push(frame.tangent.clone());
                arcLengths.push(frame.arcLength);
                globalTs.push(frame.globalT);
                acrossValues.push(acrossValue);
                widthScales.push(1);
            }

            if (i < pointsPerSegment) {
                const base = i * 2;
                indices.push(base, base + 1, base + 2);
                indices.push(base + 1, base + 3, base + 2);
            }
        }

        const cacheTarget = (this.helixMode && strandOffset > 0) ? this._segmentCacheB : this._segmentCache;
        cacheTarget[segmentIndex] = {
            basePositions,
            normals,
            binormals,
            widthDirections,
            tangents,
            arcLengths,
            globalTs,
            acrossValues,
            widthScales,
            width,
            strandOffset
        };

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setAttribute('edgeNoiseU', new THREE.Float32BufferAttribute(edgeNoiseUs, 1));
        geometry.setAttribute('capStartU', new THREE.Float32BufferAttribute(capStartUs, 1));
        geometry.setAttribute('capEndU', new THREE.Float32BufferAttribute(capEndUs, 1));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        return this._createSegmentMesh(geometry, segmentIndex, overrideTileManager);
    }

    /**
     * Full rebuild update (expensive - recreates all geometry)
     * @deprecated Use updateWaveAnimation for efficient animation updates
     */
    update(time) {
        if (this.lastPoints.length >= 2) {
            this.buildFromPoints(this.lastPoints, this.lastWidth, time);
        }
    }

    /**
     * Efficient in-place wave animation update
     * Only modifies vertex positions without recreating geometry or materials
     * Handles both Standard Ribbon and helix modes
     * @param {number} time - Current animation time
     */
    updateWaveAnimation(time) {
        if (this.meshSegments.length === 0 || this._segmentCache.length === 0) {
            return;
        }

        if (!this.undulationEnabled) {
            return;
        }

        // Update strand A (Standard Ribbon or helix strand A)
        this._updateStrandAnimation(this.meshSegments, this._segmentCache, time);

        // Update strand B (helix mode only)
        if (this.helixMode && this.helixMeshSegmentsB.length > 0 && this._segmentCacheB.length > 0) {
            this._updateStrandAnimation(this.helixMeshSegmentsB, this._segmentCacheB, time);
        }

    }

    /**
     * Update vertex positions for a single strand (flat or helix)
     * @param {Array<THREE.Mesh>} meshes - The mesh segments to update
     * @param {Array} cache - The segment cache array
     * @param {number} time - Current animation time
     */
    _updateStrandAnimation(meshes, cache, time) {
        const vertexPosition = new THREE.Vector3();
        const scratch = this._createAnimationScratch();

        for (let segIdx = 0; segIdx < meshes.length; segIdx++) {
            const mesh = meshes[segIdx];
            const segCache = cache[segIdx];

            if (!mesh || !segCache) continue;

            const positionAttr = mesh.geometry.attributes.position;
            const positions = positionAttr.array;
            const {
                basePositions,
                normals,
                binormals,
                widthDirections,
                tangents,
                arcLengths,
                globalTs,
                acrossValues,
                widthScales,
                width,
                strandOffset
            } = segCache;

            for (let i = 0; i < basePositions.length; i++) {
                const frame = {
                    point: basePositions[i],
                    normal: normals[i],
                    binormal: binormals[i],
                    widthDirection: widthDirections[i],
                    tangent: tangents[i],
                    arcLength: arcLengths[i],
                    globalT: globalTs[i],
                };

                this._setAnimatedVertexPosition(
                    vertexPosition,
                    frame,
                    width,
                    acrossValues[i],
                    widthScales[i],
                    time,
                    strandOffset,
                    scratch
                );

                const idx = i * 3;
                positions[idx] = vertexPosition.x;
                positions[idx + 1] = vertexPosition.y;
                positions[idx + 2] = vertexPosition.z;
            }

            // Flag buffer as needing GPU upload
            positionAttr.needsUpdate = true;

            // Recompute vertex normals for correct lighting
            mesh.geometry.computeVertexNormals();
        }
    }

    cleanupOldMesh() {
        // Clean up strand A segmented meshes
        this.meshSegments.forEach(mesh => {
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
            this.scene.remove(mesh);
        });
        this.meshSegments = [];
        this._segmentCache = [];

        // Clean up strand B (helix mode)
        this.helixMeshSegmentsB.forEach(mesh => {
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
            this.scene.remove(mesh);
        });
        this.helixMeshSegmentsB = [];
        this._segmentCacheB = [];

    }

    dispose() {
        this.cleanupOldMesh();
        this.lastPoints = [];
    }

    // Utility methods for drawing-to-ribbon conversion
    normalizeDrawingPoints(points) {
        if (points.length < 2) return points;

        // Find bounds of the drawing
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        points.forEach(p => {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        });

        const width = maxX - minX;
        const height = maxY - minY;
        const centerX = minX + width / 2;
        const centerY = minY + height / 2;

        // Scale factor to normalize to [-4, 4] range
        const maxDimension = Math.max(width, height);
        const scale = maxDimension > 0 ? 8 / maxDimension : 1;

        // Normalize points to center and scale
        return points.map(p => ({
            x: (p.x - centerX) * scale,
            y: (p.y - centerY) * scale * -1 // Flip Y axis to match THREE.js coordinates
        }));
    }

    /**
     * Remove duplicate/near-duplicate points that could cause CatmullRom degeneracy
     * NOTE: if duplicate points slip through the capture filter (2px), they'll be caught here after normalization.
     * @param {Array<THREE.Vector3>} points - Array of 3D points
     * @param {number} minDist - Minimum distance between consecutive points
     * @returns {Array<THREE.Vector3>} Cleaned points array
     */
    sanitizePoints(points, minDist = 0.001) {
        if (points.length < 2) return points;

        const cleaned = [points[0]];
        for (let i = 1; i < points.length; i++) {
            const dist = points[i].distanceTo(cleaned[cleaned.length - 1]);
            if (dist >= minDist) {
                cleaned.push(points[i]);
            }
        }

        if (cleaned.length < 2) {
            console.warn('[Ribbon] After sanitization, not enough distinct points:', {
                original: points.length,
                cleaned: cleaned.length
            });
        }

        return cleaned;
    }

    smoothPoints(points, numSamples = 100) {
        if (points.length < 2) return points;

        const curve = new CatmullRomCurve3(points, false, 'centripetal');
        const smoothed = [];

        for (let i = 0; i < numSamples; i++) {
            smoothed.push(curve.getPoint(i / (numSamples - 1)));
        }

        return smoothed;
    }

    createRibbonFromDrawing(drawPoints) {
        if (drawPoints.length < 2) return;

        // console.log('[Ribbon] Starting createRibbonFromDrawing', {
        //     inputPoints: drawPoints.length
        // });

        // Convert 2D screen points to normalized coordinates
        const normalizedPoints = this.normalizeDrawingPoints(drawPoints);
        // console.log('[Ribbon] Normalized points', {
        //     count: normalizedPoints.length,
        //     sample: normalizedPoints.slice(0, 3)
        // });

        // Create 3D points from normalized 2D points (all with same Z value)
        const points3D = normalizedPoints.map(p => new THREE.Vector3(p.x, p.y, 0));
        // console.log('[Ribbon] Created 3D points', {
        //     count: points3D.length
        // });

        // Sanitize points to remove duplicates that could cause CatmullRom degeneracy
        const sanitizedPoints = this.sanitizePoints(points3D);

        // Apply smoothing
        const smoothedPoints = this.smoothPoints(sanitizedPoints, 150);
        // console.log('[Ribbon] Smoothed points', {
        //     count: smoothedPoints.length
        // });

        // Build ribbon
        // console.log('[Ribbon] Building ribbon from points...');
        const result = this.buildFromPoints(smoothedPoints, 1.2);
        // console.log('[Ribbon] Ribbon build complete', {
        //     segmentCount: this.meshSegments.length,
        //     result: result ? 'success' : 'no result'
        // });

        return result;
    }
}
