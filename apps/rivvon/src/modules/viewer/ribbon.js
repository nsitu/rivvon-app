import * as THREE from 'three';
import { CatmullRomCurve3 } from 'three';
import {
    DEFAULT_CAP_STYLE,
    CAP_STYLE_ROUNDED,
    getCapProfile,
    normalizeCapStyle,
    sampleCapIntervals,
} from './capProfiles.js';

export class Ribbon {
    constructor(scene) {
        this.scene = scene;
        this.meshSegments = [];
        this.tileManager = null;
        this.tileManagerB = null; // Secondary TileManager for helix strand B (multi-texture)
        this.lastPoints = [];
        this.lastWidth = 1;
        this.segmentOffset = 0; // Offset for texture indexing (used in RibbonSeries)

        // Path geometry
        this.pathLength = 0; // Total arc length of the path
        
        //=====
        // Undulation Customisation
        // Animation parameters
        //=====
        this.waveAmplitude = 0.075;
        this.waveFrequency = 0.25;  // Waves per unit length (not per path)
        this.waveSpeed = 2;

        // Helix mode parameters
        this.helixMode = false;
        this.helixRadius = 0.4;       // Distance each strand sits from the spine
        this.helixPitch = 4;          // Full turns along the ribbon length
        this.helixStrandWidth = 0.3;  // Width of each helical strip (fraction of original width)
        this.helixMeshSegmentsB = []; // Second strand meshes
        this._segmentCacheB = [];     // Cache for strand B animation

        // Cached geometry data for efficient wave animation updates.
        // Each entry contains per-vertex frame data and a normalized across-width offset.
        this._segmentCache = [];

        // End-cap style controls how ribbon width tapers at the endpoints.
        this.capStyle = DEFAULT_CAP_STYLE;
        this.roundedCaps = false;
    }

    setTileManager(tileManager) {
        this.tileManager = tileManager;
        // Sync wave speed to layer cycling period
        this.syncWaveSpeedToLayerCycle();
        return this;
    }

    /**
     * Set a secondary TileManager for helix strand B.
     * When set, strand B will use its own texture set.
     * @param {TileManager} tileManager - The tile manager for strand B
     * @returns {Ribbon} this for chaining
     */
    setTileManagerB(tileManager) {
        this.tileManagerB = tileManager;
        return this;
    }

    /**
     * Sync wave animation speed to align with texture layer cycling.
     * Uses an aesthetically pleasing target period (~3s) and finds the
     * nearest multiple of the layer cycle period to ensure sync.
     */
    syncWaveSpeedToLayerCycle() {
        if (!this.tileManager) return;
        
        // Get optimal period (nearest multiple of layer cycle to ~3 seconds)
        const undulationPeriod = this.tileManager.getOptimalUndulationPeriod?.(3.0) || 3.0;
        
        // Wave should complete one full cycle (2π) in undulationPeriod seconds
        // sin(waveSpeed * time) completes one cycle when waveSpeed * time = 2π
        // So waveSpeed = 2π / undulationPeriod
        this.waveSpeed = (2 * Math.PI) / undulationPeriod;
    }

    /**
     * Set the segment offset for texture indexing
     * Used by RibbonSeries for continuous texture tiling across multiple ribbons
     * @param {number} offset - The segment offset
     * @returns {Ribbon} this for chaining
     */
    setSegmentOffset(offset) {
        this.segmentOffset = offset;
        return this;
    }

    /**
     * Set helix mode parameters
     * @param {object} options - { helixMode, helixRadius, helixPitch, helixStrandWidth, capStyle }
     * @returns {Ribbon} this for chaining
     */
    setHelixOptions(options = {}) {
        if (options.helixMode !== undefined) this.helixMode = options.helixMode;
        if (options.helixRadius !== undefined) this.helixRadius = options.helixRadius;
        if (options.helixPitch !== undefined) this.helixPitch = options.helixPitch;
        if (options.helixStrandWidth !== undefined) this.helixStrandWidth = options.helixStrandWidth;
        if (options.capStyle !== undefined || options.roundedCaps !== undefined) {
            this.capStyle = normalizeCapStyle(
                options.capStyle,
                options.roundedCaps !== undefined ? options.roundedCaps : this.roundedCaps
            );
            this.roundedCaps = this.capStyle === CAP_STYLE_ROUNDED;
        }
        return this;
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
        // Calculate total path length to determine segment count
        const totalLength = this.calculatePathLength(points);
        this.pathLength = totalLength; // Store for use in wave calculations
        const segmentLength = width; // Each segment roughly square (width ≈ height)
        const segmentCount = Math.max(1, Math.ceil(totalLength / segmentLength));

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

        // Build each segment using the pre-calculated normals
        for (let segIdx = 0; segIdx < segmentCount; segIdx++) {
            const startT = segIdx / segmentCount;
            const endT = (segIdx + 1) / segmentCount;
            const isProfileCapSegment = segmentCount > 1 && (segIdx === 0 || segIdx === segmentCount - 1);
            const capSide = segIdx === 0 ? 'start' : 'end';

            // Strand A (or Standard Ribbon in non-helix mode)
            const segmentMesh = isProfileCapSegment
                ? this.createProfileRibbonSegmentWithCache(
                    curve,
                    startT,
                    endT,
                    width,
                    time,
                    segIdx,
                    frameSamples,
                    capSide,
                    0
                )
                : this.createStripRibbonSegmentWithCache(
                    curve,
                    startT,
                    endT,
                    width,
                    time,
                    segIdx,
                    frameSamples,
                    pointsPerSegment,
                    0,
                    null,
                    segmentCount === 1 ? (localT) => this._getSingleSegmentCapWidthScale(localT) : null
                );

            if (segmentMesh) {
                this.meshSegments.push(segmentMesh);
                this.scene.add(segmentMesh);
            }

            // Strand B (helix mode only — offset by π)
            if (this.helixMode) {
                const strandBTileManager = this.tileManagerB || this.tileManager;
                const segmentMeshB = isProfileCapSegment
                    ? this.createProfileRibbonSegmentWithCache(
                        curve,
                        startT,
                        endT,
                        width,
                        time,
                        segIdx,
                        frameSamples,
                        capSide,
                        Math.PI,
                        strandBTileManager
                    )
                    : this.createStripRibbonSegmentWithCache(
                        curve,
                        startT,
                        endT,
                        width,
                        time,
                        segIdx,
                        frameSamples,
                        pointsPerSegment,
                        Math.PI,
                        strandBTileManager,
                        segmentCount === 1 ? (localT) => this._getSingleSegmentCapWidthScale(localT) : null
                    );

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
        const initialTangent = curve.getTangent(0).normalize();
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
            const t = i / (sampleCount - 1);
            const tangent = curve.getTangent(t).normalize();

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
            arcLength: clampedT * this.pathLength,
            globalT: clampedT,
        };
    }

    _createAnimationScratch() {
        return {
            animatedNormal: new THREE.Vector3(),
            helixCenter: new THREE.Vector3(),
            radialDir: new THREE.Vector3(),
            acrossDir: new THREE.Vector3(),
        };
    }

    _setAnimatedVertexPosition(target, frame, width, acrossValue, widthScale, time, strandOffset = 0, scratch) {
        const scaledAcross = acrossValue * widthScale;

        if (this.helixMode) {
            const helixAngle = frame.globalT * this.helixPitch * Math.PI * 2 + strandOffset;
            const wavePhase = Math.sin(
                frame.arcLength * this.waveFrequency * Math.PI * 2 + time * this.waveSpeed
            ) * this.waveAmplitude;
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

        const phase = Math.sin(
            frame.arcLength * this.waveFrequency * Math.PI * 2 + time * this.waveSpeed
        ) * this.waveAmplitude;

        scratch.animatedNormal.copy(frame.normal);
        scratch.animatedNormal.applyAxisAngle(frame.tangent, phase);
        target.copy(frame.point).addScaledVector(scratch.animatedNormal, scaledAcross * width);
        return target;
    }

    _createSegmentMesh(geometry, segmentIndex, overrideTileManager = null) {
        let material = null;
        const textureIndex = segmentIndex + this.segmentOffset;
        const activeTileManager = overrideTileManager || this.tileManager;

        if (activeTileManager && typeof activeTileManager.getMaterial === 'function') {
            material = activeTileManager.getMaterial(textureIndex) || null;
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

    _getSingleSegmentCapWidthScale(localT) {
        const mirroredT = Math.min(localT, 1 - localT) * 2;

        if (this.capStyle === 'pointed') {
            return Math.max(0, Math.min(1, mirroredT));
        }

        if (this.capStyle === 'rounded') {
            return Math.sqrt(Math.max(0, 1 - (1 - mirroredT) * (1 - mirroredT)));
        }

        return 1;
    }

    _splitIntervalToMatch(interval, targetIntervals) {
        if (targetIntervals.length !== 2) {
            return [interval.slice()];
        }

        const split = Math.max(
            interval[0],
            Math.min(interval[1], (targetIntervals[0][1] + targetIntervals[1][0]) / 2)
        );

        return [
            [interval[0], split],
            [split, interval[1]],
        ];
    }

    _pairCapIntervals(leftIntervals, rightIntervals) {
        if (!leftIntervals.length || !rightIntervals.length) {
            return [];
        }

        let normalizedLeft = leftIntervals.map(([start, end]) => [start, end]);
        let normalizedRight = rightIntervals.map(([start, end]) => [start, end]);

        if (normalizedLeft.length !== normalizedRight.length) {
            if (normalizedLeft.length === 1 && normalizedRight.length === 2) {
                normalizedLeft = this._splitIntervalToMatch(normalizedLeft[0], normalizedRight);
            } else if (normalizedLeft.length === 2 && normalizedRight.length === 1) {
                normalizedRight = this._splitIntervalToMatch(normalizedRight[0], normalizedLeft);
            } else {
                return [];
            }
        }

        return normalizedLeft.map((interval, index) => ({
            left: interval,
            right: normalizedRight[index],
        }));
    }

    _getCapSlices(profile, capSide, sliceCount) {
        const slices = [];

        for (let index = 0; index <= sliceCount; index++) {
            const segmentLocalT = index / sliceCount;
            const profileU = capSide === 'start' ? segmentLocalT : 1 - segmentLocalT;
            slices.push({
                segmentLocalT,
                profileU,
                intervals: sampleCapIntervals(profile, profileU),
            });
        }

        return slices;
    }

    createStripRibbonSegmentWithCache(curve, startT, endT, width, time, segmentIndex, frameSamples, pointsPerSegment, strandOffset = 0, overrideTileManager = null, widthScaleFn = null) {
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const uvs = [];
        const indices = [];

        const basePositions = [];
        const normals = [];
        const binormals = [];
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
            uvs.push(localT, 0);
            uvs.push(localT, 1);

            for (const acrossValue of [-0.5, 0.5]) {
                basePositions.push(frame.point.clone());
                normals.push(frame.normal.clone());
                binormals.push(frame.binormal.clone());
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
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        return this._createSegmentMesh(geometry, segmentIndex, overrideTileManager);
    }

    createProfileRibbonSegmentWithCache(curve, startT, endT, width, time, segmentIndex, frameSamples, capSide, strandOffset = 0, overrideTileManager = null) {
        const profile = getCapProfile(this.capStyle, this.roundedCaps);
        if (!profile?.vertices?.length || !profile?.indices?.length) {
            return null;
        }

        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const uvs = [];
        const indices = [];
        const basePositions = [];
        const normals = [];
        const binormals = [];
        const tangents = [];
        const arcLengths = [];
        const globalTs = [];
        const acrossValues = [];
        const widthScales = [];
        const scratch = this._createAnimationScratch();
        const vertexPosition = new THREE.Vector3();
        const sliceCount = Math.max(this._getBasePointsPerSegment(), 32);
        const slices = this._getCapSlices(profile, capSide, sliceCount);

        for (let sliceIndex = 0; sliceIndex < slices.length - 1; sliceIndex++) {
            const leftSlice = slices[sliceIndex];
            const rightSlice = slices[sliceIndex + 1];
            const intervalPairs = this._pairCapIntervals(leftSlice.intervals, rightSlice.intervals);

            for (const pair of intervalPairs) {
                const quadVertices = [
                    { localT: leftSlice.segmentLocalT, v: pair.left[0] },
                    { localT: leftSlice.segmentLocalT, v: pair.left[1] },
                    { localT: rightSlice.segmentLocalT, v: pair.right[0] },
                    { localT: rightSlice.segmentLocalT, v: pair.right[1] },
                ];
                const baseIndex = positions.length / 3;

                for (const vertex of quadVertices) {
                    const globalT = startT + (endT - startT) * vertex.localT;
                    const frame = this._sampleFrame(curve, frameSamples, globalT);
                    const acrossValue = Math.max(-0.5, Math.min(0.5, vertex.v - 0.5));

                    this._setAnimatedVertexPosition(vertexPosition, frame, width, acrossValue, 1, time, strandOffset, scratch);

                    positions.push(vertexPosition.x, vertexPosition.y, vertexPosition.z);
                    uvs.push(vertex.localT, Math.max(0, Math.min(1, vertex.v)));
                    basePositions.push(frame.point.clone());
                    normals.push(frame.normal.clone());
                    binormals.push(frame.binormal.clone());
                    tangents.push(frame.tangent.clone());
                    arcLengths.push(frame.arcLength);
                    globalTs.push(frame.globalT);
                    acrossValues.push(acrossValue);
                    widthScales.push(1);
                }

                indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
                indices.push(baseIndex + 1, baseIndex + 3, baseIndex + 2);
            }
        }

        if (positions.length === 0) {
            return null;
        }

        const cacheTarget = (this.helixMode && strandOffset > 0) ? this._segmentCacheB : this._segmentCache;
        cacheTarget[segmentIndex] = {
            basePositions,
            normals,
            binormals,
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