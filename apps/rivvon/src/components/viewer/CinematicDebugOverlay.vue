<script setup>
    import { ref, onUnmounted, watch, nextTick } from 'vue';
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    import DebugOverlayFrame from './DebugOverlayFrame.vue';

    const props = defineProps({
        cinematicCamera: { type: Object, default: null },
        visible: { type: Boolean, default: false }
    });

    const containerRef = ref(null);
    let animFrameId = null;
    let cachedTrack = null;

    // ─── 3D minimap scene ──────────────────────────────────────
    const MAP_SIZE = 360;

    let miniRenderer = null;
    let miniScene = null;
    let miniCamera = null;
    let miniControls = null;

    // Dynamic objects updated each frame
    let camMarker = null;       // cone showing camera position + direction
    let lookLine = null;        // line from camera to target
    let gazeDot = null;         // sphere showing current gaze hit on bbox

    // Reusable objects for ray-box intersection
    const _ray = new THREE.Ray();
    const _invDir = new THREE.Vector3();

    /**
     * Create a canvas-based text sprite for ROI labels.
     */
    function makeTextSprite(text, color = '#4fc3f7') {
        const canvas = document.createElement('canvas');
        const sz = 64;
        canvas.width = sz;
        canvas.height = sz;
        const ctx = canvas.getContext('2d');
        ctx.font = 'bold 40px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = color;
        ctx.fillText(text, sz / 2, sz / 2);

        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
        return new THREE.Sprite(mat);
    }

    /**
     * Intersect a ray with an axis-aligned bounding box.
     * Returns the hit point (Vector3) or null.
     */
    function rayBoxIntersect(origin, direction, bboxMin, bboxMax) {
        _ray.origin.copy(origin);
        _ray.direction.copy(direction).normalize();

        // Use Three.js Box3.intersectRay (returns null if no hit)
        const box = new THREE.Box3(
            new THREE.Vector3(bboxMin.x, bboxMin.y, bboxMin.z),
            new THREE.Vector3(bboxMax.x, bboxMax.y, bboxMax.z)
        );
        const hit = new THREE.Vector3();
        // Ray might originate inside the box — extend ray in both directions.
        // We want the point on the box surface closest to where the ray exits,
        // i.e. the point the camera is "looking at" on the box.
        // Strategy: cast from origin along direction; if origin is outside the
        // box, use the first intersection.  If inside, use the exit point.
        const result = _ray.intersectBox(box, hit);
        if (result) return hit;

        // Origin may be inside the box — cast negated ray to find back face,
        // then use the forward exit instead.
        // Manually compute slab intersection for the forward exit.
        const dir = _ray.direction;
        const o = _ray.origin;
        let tMin = -Infinity, tMax = Infinity;
        for (const axis of ['x', 'y', 'z']) {
            const invD = 1 / dir[axis];
            let t0 = (bboxMin[axis] - o[axis]) * invD;
            let t1 = (bboxMax[axis] - o[axis]) * invD;
            if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
            tMin = Math.max(tMin, t0);
            tMax = Math.min(tMax, t1);
        }
        if (tMax >= Math.max(tMin, 0)) {
            // Use the exit point (tMax) if origin is inside
            const t = tMax > 0 ? (tMin > 0 ? tMin : tMax) : null;
            if (t !== null) {
                return new THREE.Vector3(
                    o.x + dir.x * t,
                    o.y + dir.y * t,
                    o.z + dir.z * t
                );
            }
        }
        return null;
    }

    /**
     * Pre-compute the gaze trace: where the camera's line of sight
     * hits the artwork bounding box at each sample point along the path.
     */
    function computeGazeTrace(track) {
        if (!track.artworkBBox) return [];
        const cinematicCam = props.cinematicCamera;
        if (!cinematicCam) return [];

        const sampleCount = 200;
        const hits = [];
        const dir = new THREE.Vector3();

        for (let i = 0; i <= sampleCount; i++) {
            const u = i / sampleCount;
            // Use the same telemetry that the cinematic camera provides
            // but we need position + target at arbitrary u values.
            // We can sample the track spline for position, and the target spline for target.
            const telAtU = cinematicCam.getTelemetryAtU?.(u);
            if (!telAtU) continue;

            dir.subVectors(telAtU.target, telAtU.position).normalize();
            const hit = rayBoxIntersect(
                telAtU.position, dir,
                track.artworkBBox.min, track.artworkBBox.max
            );
            if (hit) hits.push(hit);
        }
        return hits;
    }

    /**
     * Build the static scene objects from track geometry.
     * Called once when playback starts.
     */
    function buildScene(track) {
        if (!miniScene) return;

        // Clear previous objects (keep lights/grid)
        while (miniScene.children.length) {
            const child = miniScene.children[0];
            miniScene.remove(child);
            child.geometry?.dispose();
            child.material?.dispose?.();
        }
        camMarker = null;
        lookLine = null;

        // Ambient light
        miniScene.add(new THREE.AmbientLight(0xffffff, 0.6));

        // ── Camera path line ───────────────────────────────────
        const pts = track.trackPoints;
        const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
        const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.5, transparent: true });
        miniScene.add(new THREE.Line(lineGeo, lineMat));

        // ── Artwork bounding box ───────────────────────────────
        if (track.artworkBBox) {
            const mn = track.artworkBBox.min;
            const mx = track.artworkBBox.max;
            const sz = new THREE.Vector3(mx.x - mn.x, mx.y - mn.y, mx.z - mn.z);
            const ct = new THREE.Vector3(
                (mn.x + mx.x) / 2, (mn.y + mx.y) / 2, (mn.z + mx.z) / 2
            );
            const boxGeo = new THREE.BoxGeometry(sz.x, sz.y, sz.z);
            const boxEdges = new THREE.EdgesGeometry(boxGeo);
            const boxLine = new THREE.LineSegments(
                boxEdges,
                new THREE.LineBasicMaterial({ color: 0x81c784, opacity: 0.6, transparent: true })
            );
            boxLine.position.copy(ct);
            miniScene.add(boxLine);
        }

        // ── ROI markers ────────────────────────────────────────
        const roiGeo = new THREE.SphereGeometry(1, 12, 8);
        const roiMat = new THREE.MeshBasicMaterial({ color: 0x4fc3f7 });
        for (let i = 0; i < track.roiArcPositions.length; i++) {
            const idx = Math.round(track.roiArcPositions[i] * (pts.length - 1));
            const pt = pts[idx];

            const sphere = new THREE.Mesh(roiGeo, roiMat);
            sphere.position.copy(pt);
            miniScene.add(sphere);

            const label = makeTextSprite(`R${i}`);
            label.position.copy(pt);
            miniScene.add(label);
        }

        // ── Camera marker (cone pointing in look direction) ────
        const coneGeo = new THREE.ConeGeometry(1, 2.5, 8);
        coneGeo.rotateX(Math.PI / 2); // point along +Z by default
        const coneMat = new THREE.MeshBasicMaterial({ color: 0xffd54f });
        camMarker = new THREE.Mesh(coneGeo, coneMat);
        miniScene.add(camMarker);

        // ── Look-direction line ────────────────────────────────
        const lookGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(), new THREE.Vector3()
        ]);
        const lookMat = new THREE.LineBasicMaterial({ color: 0xef5350, linewidth: 2 });
        lookLine = new THREE.Line(lookGeo, lookMat);
        miniScene.add(lookLine);

        // ── Gaze trace (line-of-sight path on bounding box) ────
        const gazeHits = computeGazeTrace(track);
        if (gazeHits.length > 1) {
            const gazeGeo = new THREE.BufferGeometry().setFromPoints(gazeHits);
            const gazeMat = new THREE.LineBasicMaterial({
                color: 0xce93d8, opacity: 0.7, transparent: true
            });
            miniScene.add(new THREE.Line(gazeGeo, gazeMat));
        }

        // ── Gaze dot (current intersection) ────────────────────
        const gazeDotGeo = new THREE.SphereGeometry(1, 10, 8);
        const gazeDotMat = new THREE.MeshBasicMaterial({ color: 0xce93d8 });
        gazeDot = new THREE.Mesh(gazeDotGeo, gazeDotMat);
        miniScene.add(gazeDot);

        // ── Fit minimap camera to scene ────────────────────────
        const sceneBBox = new THREE.Box3();
        for (const pt of pts) sceneBBox.expandByPoint(pt);
        if (track.artworkBBox) {
            sceneBBox.expandByPoint(track.artworkBBox.min);
            sceneBBox.expandByPoint(track.artworkBBox.max);
        }
        const center = sceneBBox.getCenter(new THREE.Vector3());
        const sizeVec = sceneBBox.getSize(new THREE.Vector3());
        const maxDim = Math.max(sizeVec.x, sizeVec.y, sizeVec.z) || 1;

        // Scale markers relative to scene size
        const markerScale = maxDim * 0.025;
        roiGeo.scale(markerScale, markerScale, markerScale);
        coneGeo.scale(markerScale, markerScale, markerScale);
        gazeDotGeo.scale(markerScale * 0.8, markerScale * 0.8, markerScale * 0.8);
        for (const child of miniScene.children) {
            if (child.isSprite) {
                child.scale.set(maxDim * 0.08, maxDim * 0.08, 1);
                child.position.y += maxDim * 0.04;
            }
        }

        miniCamera.position.set(
            center.x + maxDim * 0.8,
            center.y + maxDim * 0.6,
            center.z + maxDim * 0.8
        );
        miniCamera.lookAt(center);
        miniCamera.near = maxDim * 0.01;
        miniCamera.far = maxDim * 10;
        miniCamera.updateProjectionMatrix();

        if (miniControls) {
            miniControls.target.copy(center);
            miniControls.update();
        }
    }

    /**
     * Update the camera marker and look-direction line each frame.
     */
    function updateDynamicObjects(telemetry) {
        if (!telemetry) return;

        if (camMarker) {
            camMarker.position.set(
                telemetry.position.x,
                telemetry.position.y,
                telemetry.position.z
            );
            camMarker.lookAt(
                telemetry.target.x,
                telemetry.target.y,
                telemetry.target.z
            );
        }

        if (lookLine) {
            const positions = lookLine.geometry.attributes.position.array;
            positions[0] = telemetry.position.x;
            positions[1] = telemetry.position.y;
            positions[2] = telemetry.position.z;
            positions[3] = telemetry.target.x;
            positions[4] = telemetry.target.y;
            positions[5] = telemetry.target.z;
            lookLine.geometry.attributes.position.needsUpdate = true;
        }

        // Update gaze dot — raycast current look direction onto bbox
        if (gazeDot && cachedTrack?.artworkBBox) {
            const dir = new THREE.Vector3().subVectors(
                telemetry.target, telemetry.position
            ).normalize();
            const hit = rayBoxIntersect(
                telemetry.position, dir,
                cachedTrack.artworkBBox.min, cachedTrack.artworkBBox.max
            );
            if (hit) {
                gazeDot.position.copy(hit);
                gazeDot.visible = true;
            } else {
                gazeDot.visible = false;
            }
        }
    }

    /**
     * Initialize the Three.js renderer, scene, camera, and controls.
     */
    function initMiniRenderer() {
        const container = containerRef.value;
        if (!container || miniRenderer) return;

        const dpr = window.devicePixelRatio || 1;

        miniRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        miniRenderer.setPixelRatio(dpr);
        miniRenderer.setSize(MAP_SIZE, MAP_SIZE);
        miniRenderer.setClearColor(0x000000, 0.55);
        container.appendChild(miniRenderer.domElement);

        miniScene = new THREE.Scene();

        miniCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
        miniCamera.position.set(5, 5, 5);

        miniControls = new OrbitControls(miniCamera, miniRenderer.domElement);
        miniControls.enableDamping = true;
        miniControls.dampingFactor = 0.12;
        miniControls.enablePan = true;
        miniControls.enableZoom = true;
    }

    function disposeMiniRenderer() {
        if (miniControls) { miniControls.dispose(); miniControls = null; }
        if (miniRenderer) {
            miniRenderer.domElement.remove();
            miniRenderer.dispose();
            miniRenderer = null;
        }
        miniScene = null;
        miniCamera = null;
        camMarker = null;
        lookLine = null;
        gazeDot = null;
    }

    // ─── Telemetry text ────────────────────────────────────────
    const metricsText = ref('');

    function formatMetrics(t) {
        if (!t) return '';
        const pos = t.position;
        const tgt = t.target;
        return [
            `time  ${t.elapsedSeconds.toFixed(1)}s / ${t.totalDuration.toFixed(1)}s`,
            `u     ${t.u.toFixed(3)}`,
            `speed ${(t.speed * 100).toFixed(0)}%`,
            `fov   ${t.fov.toFixed(1)}°`,
            `pos   (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`,
            `tgt   (${tgt.x.toFixed(1)}, ${tgt.y.toFixed(1)}, ${tgt.z.toFixed(1)})`,
            `ROIs  ${t.roiCount}`,
            `dwell ${(t.dwellRadius * 100).toFixed(1)}% radius`
        ].join('\n');
    }

    // ─── Animation loop ────────────────────────────────────────
    function tick() {
        if (!props.visible || !props.cinematicCamera?.isPlaying?.value) {
            metricsText.value = '';
            return;
        }

        const telemetry = props.cinematicCamera.getTelemetry();
        metricsText.value = formatMetrics(telemetry);

        if (miniRenderer && miniScene && miniCamera && cachedTrack) {
            updateDynamicObjects(telemetry);
            if (miniControls) miniControls.update();
            miniRenderer.render(miniScene, miniCamera);
        }

        animFrameId = requestAnimationFrame(tick);
    }

    async function startLoop() {
        if (animFrameId) cancelAnimationFrame(animFrameId);
        cachedTrack = props.cinematicCamera?.getTrackGeometry?.(120) ?? null;

        await nextTick();
        initMiniRenderer();

        if (cachedTrack) buildScene(cachedTrack);
        animFrameId = requestAnimationFrame(tick);
    }

    function stopLoop() {
        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }
        metricsText.value = '';
        cachedTrack = null;
        disposeMiniRenderer();
    }

    watch(
        () => props.visible && props.cinematicCamera?.isPlaying?.value,
        (active) => {
            if (active) startLoop();
            else stopLoop();
        },
        { immediate: true }
    );

    onUnmounted(() => {
        stopLoop();
    });
</script>

<template>
    <DebugOverlayFrame
        :visible="visible && cinematicCamera?.isPlaying?.value"
        title="Cinematic Camera"
        :metrics-text="metricsText"
    >
        <div
            ref="containerRef"
            class="track-map"
        />
    </DebugOverlayFrame>
</template>

<style scoped>
    .track-map {
        width: 360px;
        height: 360px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 8px;
        overflow: hidden;
        background: rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(6px);
    }

    .track-map :deep(canvas) {
        display: block;
        border-radius: 8px;
    }
</style>
