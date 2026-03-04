import * as THREE from 'three';
import { CatmullRomCurve3 } from 'three';

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

        // Cached geometry data for efficient wave animation updates
        // Each entry contains: { basePositions, normals, binormals, tangents, arcLengths, width }
        this._segmentCache = [];
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
     * @param {object} options - { helixMode, helixRadius, helixPitch, helixStrandWidth }
     * @returns {Ribbon} this for chaining
     */
    setHelixOptions(options = {}) {
        if (options.helixMode !== undefined) this.helixMode = options.helixMode;
        if (options.helixRadius !== undefined) this.helixRadius = options.helixRadius;
        if (options.helixPitch !== undefined) this.helixPitch = options.helixPitch;
        if (options.helixStrandWidth !== undefined) this.helixStrandWidth = options.helixStrandWidth;
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

        // Calculate initial reference normal for consistency
        const initialTangent = curve.getTangent(0).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        let referenceNormal = up.cross(initialTangent).normalize();

        // If tangent is parallel to up vector, use a different reference
        if (referenceNormal.length() < 0.1) {
            const right = new THREE.Vector3(1, 0, 0);
            referenceNormal = right.cross(initialTangent).normalize();
        }

        // Pre-calculate all normals (and binormals for helix mode) for the entire path to ensure consistency
        const pointsPerSegment = 50;
        const totalPoints = segmentCount * pointsPerSegment + 1;
        const normalCache = [];
        let prevNormal = referenceNormal.clone();

        for (let i = 0; i < totalPoints; i++) {
            const t = i / (totalPoints - 1);
            const tangent = curve.getTangent(t).normalize();

            let normal;
            if (i === 0) {
                normal = prevNormal.clone();
            } else {
                // Use Frenet frame approach
                const binormal = tangent.clone().cross(prevNormal).normalize();
                normal = binormal.cross(tangent).normalize();

                // Ensure normal doesn't flip
                if (normal.dot(prevNormal) < 0) {
                    normal.negate();
                }

                // Smooth the transition
                normal = prevNormal.clone().lerp(normal, 0.1).normalize();
            }

            // Compute binormal for helix mode (perpendicular to both tangent and normal)
            const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();

            normalCache.push({ normal: normal.clone(), binormal: binormal.clone() });
            prevNormal = normal;
        }

        // console.log('[Ribbon] Normal cache computed', { totalPoints });

        // Build each segment using the pre-calculated normals
        for (let segIdx = 0; segIdx < segmentCount; segIdx++) {
            const startT = segIdx / segmentCount;
            const endT = (segIdx + 1) / segmentCount;
            const startPointIdx = segIdx * pointsPerSegment;

            // Strand A (or flat ribbon in non-helix mode)
            const segmentMesh = this.createRibbonSegmentWithCache(
                curve,
                startT,
                endT,
                width,
                time,
                segIdx,
                normalCache,
                startPointIdx,
                pointsPerSegment,
                0 // strandOffset = 0 for strand A
            );

            if (segmentMesh) {
                this.meshSegments.push(segmentMesh);
                this.scene.add(segmentMesh);
            }

            // Strand B (helix mode only — offset by π)
            if (this.helixMode) {
                const strandBTileManager = this.tileManagerB || this.tileManager;
                const segmentMeshB = this.createRibbonSegmentWithCache(
                    curve,
                    startT,
                    endT,
                    width,
                    time,
                    segIdx,
                    normalCache,
                    startPointIdx,
                    pointsPerSegment,
                    Math.PI, // strandOffset = π for strand B
                    strandBTileManager // use strand B's TileManager
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
     * Build an arc-length–parameterized curve from a polyline.
     *
     * The raw points may be very unevenly spaced (e.g. 64 samples per Bézier
     * but only 2 per line segment from SVGLoader).  A naïve vertex-index
     * parameterization would compress the texture where points are dense and
     * stretch it where points are sparse.
     *
     * We pre-compute cumulative arc lengths and remap every incoming `t`
     * (uniform in arc length) to the correct vertex-index position so that
     * equal `t` intervals always correspond to equal physical distances.
     */
    createCurveFromPoints(points) {
        // ── 1. Build cumulative arc-length table ──────────────────────
        const n = points.length;
        const arcLengths = new Float64Array(n);   // arcLengths[0] = 0
        for (let i = 1; i < n; i++) {
            arcLengths[i] = arcLengths[i - 1] + points[i].distanceTo(points[i - 1]);
        }
        const totalLength = arcLengths[n - 1];

        // Normalise to [0, 1]
        const normalised = new Float64Array(n);
        if (totalLength > 0) {
            for (let i = 0; i < n; i++) {
                normalised[i] = arcLengths[i] / totalLength;
            }
        } else {
            // Degenerate (all points coincide) – fall back to index-based
            for (let i = 0; i < n; i++) {
                normalised[i] = i / (n - 1);
            }
        }

        // ── 2. Remap t (arc-length fraction) → vertex-index fraction ─
        //    Binary-search + linear interpolation within the segment.
        const remapT = (t) => {
            // Clamp
            if (t <= 0) return 0;
            if (t >= 1) return 1;

            // Binary search for the segment that brackets `t`
            let lo = 0, hi = n - 1;
            while (hi - lo > 1) {
                const mid = (lo + hi) >>> 1;
                if (normalised[mid] <= t) lo = mid;
                else hi = mid;
            }

            // Linear interpolation within the segment [lo, hi]
            const segLen = normalised[hi] - normalised[lo];
            const frac = segLen > 0 ? (t - normalised[lo]) / segLen : 0;
            return (lo + frac) / (n - 1);
        };

        // ── 3. Build the curve using the remapped parameterization ────
        const curve = new THREE.Curve();

        // getPointRaw: index-based lookup (no remap) — used internally
        const getPointRaw = (u) => {
            const i = u * (n - 1);
            const a = Math.floor(i);
            const b = Math.min(Math.ceil(i), n - 1);
            return new THREE.Vector3().lerpVectors(points[a], points[b], i - a);
        };

        curve.getPoint = (t) => getPointRaw(remapT(t));

        curve.getTangent = (t) => {
            const delta = 0.001;
            const p1 = curve.getPoint(Math.max(t - delta, 0));
            const p2 = curve.getPoint(Math.min(t + delta, 1));
            return p2.clone().sub(p1).normalize();
        };

        return curve;
    }

    createRibbonSegmentWithCache(curve, startT, endT, width, time, segmentIndex, normalCache, startPointIdx, pointsPerSegment, strandOffset = 0, overrideTileManager = null) {
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const uvs = [];
        const indices = [];

        // Cache arrays for efficient animation updates
        const basePositions = [];  // Center points along the curve (spine points)
        const normals = [];        // Pre-rotated base normals
        const binormals = [];      // Binormals for helix perpendicular plane
        const tangents = [];       // Tangent vectors for axis rotation
        const arcLengths = [];     // Arc length at each point
        const globalTs = [];       // Global t values for helix angle computation

        const isHelix = this.helixMode;
        const helixRadius = this.helixRadius * width;  // Scale radius relative to ribbon width
        const helixPitch = this.helixPitch;
        const strandWidth = isHelix ? this.helixStrandWidth * width : width;

        for (let i = 0; i <= pointsPerSegment; i++) {
            const localT = i / pointsPerSegment;
            const globalT = startT + (endT - startT) * localT;
            const point = curve.getPoint(globalT);
            const tangent = curve.getTangent(globalT).normalize();

            // Get the pre-calculated normal and binormal from cache
            const cacheIdx = startPointIdx + i;
            const cachedFrame = normalCache[cacheIdx];
            const normal = cachedFrame.normal.clone();
            const binormal = cachedFrame.binormal.clone();

            // Calculate arc length at this point for wave animation
            const arcLength = globalT * this.pathLength;

            // Store base geometry for animation cache
            basePositions.push(point.clone());
            normals.push(normal.clone());
            binormals.push(binormal.clone());
            tangents.push(tangent.clone());
            arcLengths.push(arcLength);
            globalTs.push(globalT);

            let left, right;

            if (isHelix) {
                // ── Helix mode: displace vertices helically around the spine ──
                // Helix angle based on position along the full path + strand offset
                const helixAngle = globalT * helixPitch * Math.PI * 2 + strandOffset;

                // Wave animation modulates the helix angle for a spinning/undulating effect
                const wavePhase = Math.sin(
                    arcLength * this.waveFrequency * Math.PI * 2 + time * this.waveSpeed
                ) * this.waveAmplitude;
                const animatedAngle = helixAngle + wavePhase;

                // Compute helix center: offset from spine along normal/binormal plane
                const cosA = Math.cos(animatedAngle);
                const sinA = Math.sin(animatedAngle);
                const helixCenter = point.clone()
                    .addScaledVector(normal, cosA * helixRadius)
                    .addScaledVector(binormal, sinA * helixRadius);

                // Radial direction (outward from spine) for ribbon width
                const radialDir = helixCenter.clone().sub(point).normalize();

                // Across direction — perpendicular to both tangent and radial — for ribbon strip width
                const acrossDir = new THREE.Vector3().crossVectors(tangent, radialDir).normalize();

                left = helixCenter.clone().addScaledVector(acrossDir, -strandWidth / 2);
                right = helixCenter.clone().addScaledVector(acrossDir, strandWidth / 2);
            } else {
                // ── Flat ribbon mode (original behavior) ──
                const phase = Math.sin(
                    arcLength * this.waveFrequency * Math.PI * 2 + time * this.waveSpeed
                ) * this.waveAmplitude;

                const animatedNormal = normal.clone();
                animatedNormal.applyAxisAngle(tangent, phase);

                left = point.clone().addScaledVector(animatedNormal, -width / 2);
                right = point.clone().addScaledVector(animatedNormal, width / 2);
            }

            positions.push(left.x, left.y, left.z);
            positions.push(right.x, right.y, right.z);

            // UV mapping rotated 90 degrees for seamless tiling along ribbon direction
            uvs.push(localT, 0);  // left edge
            uvs.push(localT, 1);  // right edge

            if (i < pointsPerSegment) {
                const base = i * 2;
                indices.push(base, base + 1, base + 2);
                indices.push(base + 1, base + 3, base + 2);
            }
        }

        // Store cache for this segment
        // For helix mode strand B, store in _segmentCacheB
        const cacheTarget = (isHelix && strandOffset > 0) ? this._segmentCacheB : this._segmentCache;
        cacheTarget[segmentIndex] = {
            basePositions,
            normals,
            binormals,
            tangents,
            arcLengths,
            globalTs,
            width,
            strandOffset
        };

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        // Prefer KTX2 array material if available; fallback to JPG texture
        let material = null;
        const textureIndex = segmentIndex + this.segmentOffset; // Apply offset for RibbonSeries
        const activeTileManager = overrideTileManager || this.tileManager;
        if (activeTileManager && typeof activeTileManager.getMaterial === 'function') {
            material = activeTileManager.getMaterial(textureIndex) || null;
            // console.log('[Ribbon] Segment', segmentIndex, 'material from tileManager:', !!material);
        }

        if (!material) {
            const tileTexture = activeTileManager.getTile(textureIndex);
            material = new THREE.MeshBasicMaterial({
                map: tileTexture,
                side: THREE.DoubleSide
            });
            // console.log('[Ribbon] Segment', segmentIndex, 'using fallback JPG material');
        }

        const mesh = new THREE.Mesh(geometry, material);
        // console.log('[Ribbon] Segment', segmentIndex, 'mesh created', {
        //     positions: positions.length / 3,
        //     indices: indices.length
        // });

        return mesh;
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
     * Handles both flat ribbon and helix modes
     * @param {number} time - Current animation time
     */
    updateWaveAnimation(time) {
        if (this.meshSegments.length === 0 || this._segmentCache.length === 0) {
            return;
        }

        // Update strand A (flat ribbon or helix strand A)
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
        // Reusable vectors to avoid GC pressure
        const animatedNormal = new THREE.Vector3();
        const left = new THREE.Vector3();
        const right = new THREE.Vector3();
        const helixCenter = new THREE.Vector3();
        const radialDir = new THREE.Vector3();
        const acrossDir = new THREE.Vector3();

        const isHelix = this.helixMode;
        const helixPitch = this.helixPitch;

        for (let segIdx = 0; segIdx < meshes.length; segIdx++) {
            const mesh = meshes[segIdx];
            const segCache = cache[segIdx];

            if (!mesh || !segCache) continue;

            const positionAttr = mesh.geometry.attributes.position;
            const positions = positionAttr.array;
            const { basePositions, normals, binormals, tangents, arcLengths, globalTs, width, strandOffset } = segCache;

            const helixRadius = this.helixRadius * width;
            const strandWidth = isHelix ? this.helixStrandWidth * width : width;

            for (let i = 0; i < basePositions.length; i++) {
                const point = basePositions[i];
                const normal = normals[i];
                const tangent = tangents[i];
                const arcLength = arcLengths[i];

                if (isHelix) {
                    const binormal = binormals[i];
                    const globalT = globalTs[i];

                    // Helix angle + wave modulation
                    const helixAngle = globalT * helixPitch * Math.PI * 2 + (strandOffset || 0);
                    const wavePhase = Math.sin(
                        arcLength * this.waveFrequency * Math.PI * 2 + time * this.waveSpeed
                    ) * this.waveAmplitude;
                    const animatedAngle = helixAngle + wavePhase;

                    const cosA = Math.cos(animatedAngle);
                    const sinA = Math.sin(animatedAngle);

                    helixCenter.copy(point)
                        .addScaledVector(normal, cosA * helixRadius)
                        .addScaledVector(binormal, sinA * helixRadius);

                    radialDir.copy(helixCenter).sub(point).normalize();
                    acrossDir.crossVectors(tangent, radialDir).normalize();

                    left.copy(helixCenter).addScaledVector(acrossDir, -strandWidth / 2);
                    right.copy(helixCenter).addScaledVector(acrossDir, strandWidth / 2);
                } else {
                    // Flat ribbon mode (original behavior)
                    const phase = Math.sin(
                        arcLength * this.waveFrequency * Math.PI * 2 + time * this.waveSpeed
                    ) * this.waveAmplitude;

                    animatedNormal.copy(normal);
                    animatedNormal.applyAxisAngle(tangent, phase);

                    left.copy(point).addScaledVector(animatedNormal, -width / 2);
                    right.copy(point).addScaledVector(animatedNormal, width / 2);
                }

                // Update position buffer (2 vertices per point: left, right)
                const idx = i * 6; // 2 vertices * 3 components
                positions[idx] = left.x;
                positions[idx + 1] = left.y;
                positions[idx + 2] = left.z;
                positions[idx + 3] = right.x;
                positions[idx + 4] = right.y;
                positions[idx + 5] = right.z;
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