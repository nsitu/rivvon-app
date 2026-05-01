/**
 * contourInference.js
 *
 * Coordinates U2Net inference (via Web Worker) and topology-based
 * marching-squares contour extraction to produce drawing paths.
 *
 * Public API:
 *   inferContours(imageData, options?) → Promise<{ paths, maskWidth, maskHeight }>
 *     paths: Array of Array of { x, y }  (normalised to [-1, 1] drawing space)
 *
 * Options:
 *   maskThreshold       number  0–255   default 160  – alpha threshold for binary mask
 *   minContourPoints    number          default 12   – drop contours shorter than this
 *   simplifyTolerance   number          default 0.35 – RDP epsilon in mask pixels
 */

// ---------------------------------------------------------------------------
// Lazy singleton worker
// ---------------------------------------------------------------------------

let workerInstance = null;
let pendingRequests = null; // Map<id, { resolve, reject }>
let nextId = 1;

function getWorker() {
    if (workerInstance) return { worker: workerInstance, pending: pendingRequests };

    pendingRequests = new Map();
    workerInstance = new Worker(
        new URL('../../workers/contourInferenceWorker.js', import.meta.url),
        { type: 'module' }
    );

    workerInstance.onmessage = (event) => {
        const { type, id, alpha, maskWidth, maskHeight, error, stage, message } = event.data;
        const entry = pendingRequests.get(id);
        if (!entry) return;

        if (type === 'preload-status') {
            if (typeof entry.onStatus === 'function') {
                entry.onStatus({ stage, message });
            }
            return;
        }

        pendingRequests.delete(id);

        if (type === 'infer-result') {
            entry.resolve({ alpha, maskWidth, maskHeight });
        } else if (type === 'preload-complete') {
            entry.resolve();
        } else {
            entry.reject(new Error(error || 'Inference worker error'));
        }
    };

    workerInstance.onerror = (err) => {
        for (const entry of pendingRequests.values()) {
            entry.reject(new Error(err.message || 'Worker crashed'));
        }
        pendingRequests.clear();
        workerInstance = null;
        pendingRequests = null;
    };

    return { worker: workerInstance, pending: pendingRequests };
}

function requestAlpha(imageData) {
    return new Promise((resolve, reject) => {
        const { worker, pending } = getWorker();
        const id = nextId++;
        pending.set(id, { resolve, reject });

        const dataCopy = new Uint8ClampedArray(imageData.data);
        worker.postMessage(
            { type: 'infer', id, imageData: { data: dataCopy, width: imageData.width, height: imageData.height } },
            [dataCopy.buffer]
        );
    });
}

/**
 * Preload the ONNX session and model without running inference.
 * Called when ContourPanel opens to have the model ready by the time user captures/uploads.
 * Returns a Promise that resolves when model is loaded.
 */
export function preloadModel(options = {}) {
    const { onStatus } = options;

    return new Promise((resolve, reject) => {
        const { worker, pending } = getWorker();
        const id = nextId++;
        pending.set(id, {
            resolve: () => resolve(),
            reject,
            onStatus
        });

        worker.postMessage({ type: 'preload', id });
    });
}

// ---------------------------------------------------------------------------
// Topology-based Marching Squares contour tracer
// Ported from https://github.com/nsitu/subject-contour (app.js)
// Traces contours by following neighbouring cells via edge connectivity,
// producing clean closed loops and open boundary-to-boundary paths.
// ---------------------------------------------------------------------------

/**
 * Segments encoded as pairs of edge indices [entryEdge, exitEdge].
 * Edges: 0 = top, 1 = right, 2 = bottom, 3 = left.
 * Case = TL<<3 | TR<<2 | BR<<1 | BL (corners above threshold = 1).
 */
const EDGE_TABLE = [
    [],                    // 0000
    [[3, 2]],              // 0001 BL
    [[2, 1]],              // 0010 BR
    [[3, 1]],              // 0011
    [[0, 1]],              // 0100 TR
    [[0, 1], [3, 2]],      // 0101 saddle
    [[0, 2]],              // 0110
    [[0, 3]],              // 0111
    [[0, 3]],              // 1000 TL
    [[0, 2]],              // 1001
    [[0, 3], [1, 2]],      // 1010 saddle
    [[0, 1]],              // 1011
    [[3, 1]],              // 1100
    [[2, 1]],              // 1101
    [[3, 2]],              // 1110
    [],                    // 1111
];

/** Neighbour cell reached by exiting each edge, and the entry edge in that cell. */
const NEIGHBOR = [
    { dx:  0, dy: -1, entry: 2 }, // exit top    → cell above,  enter bottom
    { dx:  1, dy:  0, entry: 3 }, // exit right  → cell right,  enter left
    { dx:  0, dy:  1, entry: 0 }, // exit bottom → cell below,  enter top
    { dx: -1, dy:  0, entry: 1 }, // exit left   → cell left,   enter right
];

/**
 * Compute the sub-pixel crossing point on a given edge of cell (cx, cy).
 * Uses linear interpolation for staircase-free sub-pixel accuracy.
 * Returns [x, y] in pixel space.
 */
function edgeCrossing(alpha, width, cx, cy, edge, threshold) {
    const tl = alpha[cy * width + cx];
    const tr = alpha[cy * width + cx + 1];
    const br = alpha[(cy + 1) * width + cx + 1];
    const bl = alpha[(cy + 1) * width + cx];
    const T  = threshold;

    switch (edge) {
        case 0: { const t = (tr !== tl) ? Math.max(0, Math.min(1, (T - tl) / (tr - tl))) : 0.5; return [cx + t, cy]; }
        case 1: { const t = (br !== tr) ? Math.max(0, Math.min(1, (T - tr) / (br - tr))) : 0.5; return [cx + 1, cy + t]; }
        case 2: { const t = (br !== bl) ? Math.max(0, Math.min(1, (T - bl) / (br - bl))) : 0.5; return [cx + t, cy + 1]; }
        case 3: { const t = (bl !== tl) ? Math.max(0, Math.min(1, (T - tl) / (bl - tl))) : 0.5; return [cx, cy + t]; }
        default: return [cx, cy];
    }
}

function marchingSquaresContours(alpha, width, height, threshold, minContourPoints) {
    const W = width - 1;
    const H = height - 1;

    // Pre-compute segment pairs for every cell
    const cellSegs = new Array(H * W);
    for (let cy = 0; cy < H; cy++) {
        for (let cx = 0; cx < W; cx++) {
            const tl = alpha[cy * width + cx]           >= threshold ? 1 : 0;
            const tr = alpha[cy * width + cx + 1]       >= threshold ? 1 : 0;
            const br = alpha[(cy + 1) * width + cx + 1] >= threshold ? 1 : 0;
            const bl = alpha[(cy + 1) * width + cx]     >= threshold ? 1 : 0;
            cellSegs[cy * W + cx] = EDGE_TABLE[tl * 8 + tr * 4 + br * 2 + bl];
        }
    }

    const vis0 = new Uint8Array(H * W);
    const vis1 = new Uint8Array(H * W);

    function isVisited(cx, cy, si) { return (si === 0 ? vis0 : vis1)[cy * W + cx] === 1; }
    function markVisited(cx, cy, si) { (si === 0 ? vis0 : vis1)[cy * W + cx] = 1; }
    function isFrameEdge(cx, cy, edge) {
        return (edge === 0 && cy === 0)
            || (edge === 1 && cx === W - 1)
            || (edge === 2 && cy === H - 1)
            || (edge === 3 && cx === 0);
    }

    function traceContour(startCx, startCy, startSi, initialEntryEdge) {
        const polyline = [];
        let closed = false;
        let curCx = startCx, curCy = startCy, curSi = startSi;
        let entryEdge = initialEntryEdge;
        let guard = W * H * 2;

        while (guard-- > 0) {
            if (isVisited(curCx, curCy, curSi)) break;
            markVisited(curCx, curCy, curSi);

            const seg = cellSegs[curCy * W + curCx][curSi];
            const exitEdge = (entryEdge === seg[0]) ? seg[1] : seg[0];
            polyline.push(edgeCrossing(alpha, width, curCx, curCy, exitEdge, threshold));

            const nb = NEIGHBOR[exitEdge];
            const nextCx = curCx + nb.dx;
            const nextCy = curCy + nb.dy;

            if (nextCx < 0 || nextCx >= W || nextCy < 0 || nextCy >= H) break;

            const nextSegs = cellSegs[nextCy * W + nextCx];
            const nextSi = nextSegs.findIndex(s => s[0] === nb.entry || s[1] === nb.entry);
            if (nextSi === -1) break;

            if (nextCx === startCx && nextCy === startCy && nextSi === startSi) {
                closed = true;
                break;
            }

            curCx = nextCx; curCy = nextCy; curSi = nextSi;
            entryEdge = nb.entry;
        }

        return { points: polyline, closed };
    }

    const polylines = [];

    // Pass 1: trace contours that touch the frame first (open, boundary-to-boundary)
    for (let cy = 0; cy < H; cy++) {
        for (let cx = 0; cx < W; cx++) {
            const segs = cellSegs[cy * W + cx];
            for (let si = 0; si < segs.length; si++) {
                if (isVisited(cx, cy, si)) continue;
                const seg = segs[si];
                const frameEdge = seg.find(e => isFrameEdge(cx, cy, e));
                if (frameEdge === undefined) continue;
                const traced = traceContour(cx, cy, si, frameEdge);
                if (traced.points.length >= minContourPoints) polylines.push(traced);
            }
        }
    }

    // Pass 2: trace remaining internal closed loops
    for (let cy = 0; cy < H; cy++) {
        for (let cx = 0; cx < W; cx++) {
            const segs = cellSegs[cy * W + cx];
            for (let si = 0; si < segs.length; si++) {
                if (isVisited(cx, cy, si)) continue;
                const traced = traceContour(cx, cy, si, -1);
                if (traced.points.length >= minContourPoints) polylines.push(traced);
            }
        }
    }

    return polylines;
}

// ---------------------------------------------------------------------------
// Ramer-Douglas-Peucker simplification (operates on [x,y] arrays)
// ---------------------------------------------------------------------------

function perpDist(point, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(point[0] - a[0], point[1] - a[1]);
    const t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len2;
    const px = a[0] + t * dx, py = a[1] + t * dy;
    return Math.hypot(point[0] - px, point[1] - py);
}

function simplifyPoints(points, start, end, tolerance, out) {
    if (end - start <= 1) return;
    let maxDist = 0, maxIdx = start;
    for (let i = start + 1; i < end; i++) {
        const d = perpDist(points[i], points[start], points[end]);
        if (d > maxDist) { maxDist = d; maxIdx = i; }
    }
    if (maxDist > tolerance) {
        simplifyPoints(points, start, maxIdx, tolerance, out);
        out.push(points[maxIdx]);
        simplifyPoints(points, maxIdx, end, tolerance, out);
    }
}

function rdpSimplify(points, tolerance) {
    if (points.length <= 2) return points;
    const out = [points[0]];
    simplifyPoints(points, 0, points.length - 1, tolerance, out);
    out.push(points[points.length - 1]);
    return out;
}

// ---------------------------------------------------------------------------
// Coordinate normalisation
// Map mask pixel coords [0..maskW] × [0..maskH] → [-1, 1] drawing space
// ---------------------------------------------------------------------------

function normaliseMaskCoord(px, py, maskW, maskH, outputAspect = maskW / maskH) {
    const aspect = outputAspect;
    const nx =  ((px / maskW) * 2 - 1) * (aspect >= 1 ? 1 : aspect);
    const ny = -((py / maskH) * 2 - 1) * (aspect >= 1 ? 1 / aspect : 1);
    return { x: nx, y: ny };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run U2Net inference on imageData and return drawing paths.
 *
 * @param {{ data: Uint8ClampedArray, width: number, height: number }} imageData
 * @param {{ maskThreshold?: number, minContourPoints?: number, simplifyTolerance?: number }} [options]
 * @returns {Promise<{ paths: Array<Array<{x,y}>>, maskWidth: number, maskHeight: number }>}
 */
export async function inferContours(imageData, options = {}) {
    const {
        maskThreshold     = 160,
        minContourPoints  = 12,
        simplifyTolerance = 0.35,
    } = options;

    const { alpha, maskWidth, maskHeight } = await requestAlpha(imageData);
    const sourceAspect = (Number(imageData?.width) > 0 && Number(imageData?.height) > 0)
        ? imageData.width / imageData.height
        : (maskWidth / maskHeight);

    const contours = marchingSquaresContours(alpha, maskWidth, maskHeight, maskThreshold, minContourPoints);

    const paths = contours
        .map(({ points }) => rdpSimplify(points, simplifyTolerance))
        .filter(pts => pts.length >= 2)
        .map(pts => pts.map(([x, y]) => normaliseMaskCoord(x, y, maskWidth, maskHeight, sourceAspect)));

    return { paths, maskWidth, maskHeight };
}
