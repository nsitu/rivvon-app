import * as THREE from 'three';
import { CatmullRomCurve3 } from 'three';

export class Ribbon {
    constructor(scene) {
        this.scene = scene;
        this.meshSegments = [];
        this.tileManager = null;
        this.lastPoints = [];
        this.lastWidth = 1;
        this.segmentOffset = 0; // Offset for texture indexing (used in RibbonSeries)

        // Path geometry
        this.pathLength = 0; // Total arc length of the path

        // Animation parameters
        this.waveAmplitude = 0.075;
        this.waveFrequency = 0.5;  // Waves per unit length (not per path)
        this.waveSpeed = 2;

        // Cached geometry data for efficient wave animation updates
        // Each entry contains: { basePositions, normals, tangents, arcLengths, width }
        this._segmentCache = [];
    }

    setTileManager(tileManager) {
        this.tileManager = tileManager;
        // Sync wave speed to layer cycling period
        this.syncWaveSpeedToLayerCycle();
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

        // Pre-calculate all normals for the entire path to ensure consistency
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

            normalCache.push(normal.clone());
            prevNormal = normal;
        }

        // console.log('[Ribbon] Normal cache computed', { totalPoints });

        // Build each segment using the pre-calculated normals
        for (let segIdx = 0; segIdx < segmentCount; segIdx++) {
            const startT = segIdx / segmentCount;
            const endT = (segIdx + 1) / segmentCount;
            const startPointIdx = segIdx * pointsPerSegment;

            const segmentMesh = this.createRibbonSegmentWithCache(
                curve,
                startT,
                endT,
                width,
                time,
                segIdx,
                normalCache,
                startPointIdx,
                pointsPerSegment
            );

            if (segmentMesh) {
                this.meshSegments.push(segmentMesh);
                this.scene.add(segmentMesh);
            } else {
                // console.warn('[Ribbon] Failed to create segment', segIdx);
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

    createCurveFromPoints(points) {
        const curve = new THREE.Curve();
        curve.getPoint = t => {
            const i = t * (points.length - 1);
            const a = Math.floor(i);
            const b = Math.min(Math.ceil(i), points.length - 1);
            const p1 = points[a];
            const p2 = points[b];
            return new THREE.Vector3().lerpVectors(p1, p2, i - a);
        };
        curve.getTangent = t => {
            const delta = 0.001;
            const p1 = curve.getPoint(Math.max(t - delta, 0));
            const p2 = curve.getPoint(Math.min(t + delta, 1));
            return p2.clone().sub(p1).normalize();
        };
        return curve;
    }

    createRibbonSegmentWithCache(curve, startT, endT, width, time, segmentIndex, normalCache, startPointIdx, pointsPerSegment) {
        // console.log('[Ribbon] Creating segment', segmentIndex, {
        //     startT: startT.toFixed(3),
        //     endT: endT.toFixed(3),
        //     hasTileManager: !!this.tileManager
        // });

        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const uvs = [];
        const indices = [];

        // Cache arrays for efficient animation updates
        const basePositions = [];  // Center points along the curve
        const normals = [];        // Pre-rotated base normals
        const tangents = [];       // Tangent vectors for axis rotation
        const arcLengths = [];     // Arc length at each point

        for (let i = 0; i <= pointsPerSegment; i++) {
            const localT = i / pointsPerSegment; // Note: still using pointsPerSegment for proper UV mapping
            const globalT = startT + (endT - startT) * localT;
            const point = curve.getPoint(globalT);
            const tangent = curve.getTangent(globalT).normalize();

            // Get the pre-calculated normal from cache
            const cacheIdx = startPointIdx + i;
            const normal = normalCache[cacheIdx].clone();

            // Calculate arc length at this point for wave animation
            // Using arc length instead of percentage ensures consistent wave density
            const arcLength = globalT * this.pathLength;

            // Store base geometry for animation cache
            basePositions.push(point.clone());
            normals.push(normal.clone());
            tangents.push(tangent.clone());
            arcLengths.push(arcLength);

            // Animate phase based on arc length (not percentage)
            // waveSpeed is synced to layer cycle period so wave completes one full 2π cycle
            // Phase: sin(arcLength * waveFrequency * 2π + time * waveSpeed)
            const phase = Math.sin(
                arcLength * this.waveFrequency * Math.PI * 2 + time * this.waveSpeed
            ) * this.waveAmplitude;

            const animatedNormal = normal.clone();
            animatedNormal.applyAxisAngle(tangent, phase);

            const left = point.clone().addScaledVector(animatedNormal, -width / 2);
            const right = point.clone().addScaledVector(animatedNormal, width / 2);

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

        // Store cache for this segment (indexed by segment position in this ribbon)
        this._segmentCache[segmentIndex] = {
            basePositions,
            normals,
            tangents,
            arcLengths,
            width
        };

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        // Prefer KTX2 array material if available; fallback to JPG texture
        let material = null;
        const textureIndex = segmentIndex + this.segmentOffset; // Apply offset for RibbonSeries
        if (this.tileManager && typeof this.tileManager.getMaterial === 'function') {
            material = this.tileManager.getMaterial(textureIndex) || null;
            // console.log('[Ribbon] Segment', segmentIndex, 'material from tileManager:', !!material);
        }

        if (!material) {
            const tileTexture = this.tileManager.getTile(textureIndex);
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
     * @param {number} time - Current animation time
     */
    updateWaveAnimation(time) {
        if (this.meshSegments.length === 0 || this._segmentCache.length === 0) {
            return;
        }

        // Reusable vectors to avoid GC pressure
        const animatedNormal = new THREE.Vector3();
        const left = new THREE.Vector3();
        const right = new THREE.Vector3();

        for (let segIdx = 0; segIdx < this.meshSegments.length; segIdx++) {
            const mesh = this.meshSegments[segIdx];
            const cache = this._segmentCache[segIdx];

            if (!mesh || !cache) continue;

            const positionAttr = mesh.geometry.attributes.position;
            const positions = positionAttr.array;
            const { basePositions, normals, tangents, arcLengths, width } = cache;

            for (let i = 0; i < basePositions.length; i++) {
                const point = basePositions[i];
                const normal = normals[i];
                const tangent = tangents[i];
                const arcLength = arcLengths[i];

                // Calculate wave phase (synced to layer cycle)
                const phase = Math.sin(
                    arcLength * this.waveFrequency * Math.PI * 2 + time * this.waveSpeed
                ) * this.waveAmplitude;

                // Apply rotation to normal
                animatedNormal.copy(normal);
                animatedNormal.applyAxisAngle(tangent, phase);

                // Calculate left and right edge positions
                left.copy(point).addScaledVector(animatedNormal, -width / 2);
                right.copy(point).addScaledVector(animatedNormal, width / 2);

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
        // console.log('[Ribbon] Cleaning up old meshes', {
        //     segmentCount: this.meshSegments.length
        // });
        // Clean up segmented meshes
        this.meshSegments.forEach(mesh => {
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
            this.scene.remove(mesh);
        });
        this.meshSegments = [];
        // Clear segment cache
        this._segmentCache = [];
        // console.log('[Ribbon] Cleanup complete');
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