/**
 * Grid Calculator Utility
 * Calculates optimal grid dimensions for tile layouts
 */

// TODO investigate whether there may be a simpler
// algorithm for this that doesn't require 
// scoring all combinations

/**
 * Calculate optimal grid dimensions for tile layout
 * @param {number} tileCount - Number of tiles to arrange
 * @param {string} flowDirection - 'horizontal' (left-to-right) or 'vertical' (top-to-bottom)
 * @param {{
 *   flowBias?: number,     // 0..2+; strength of orientation preference
 *   maxBreaks?: number,    // # of row/column breaks allowed before penalties
 *   minAspect?: number,    // minimum oriented aspect before penalty (e.g., 1.2)
 *   weights?: Partial<{
 *     efficiency: number,
 *     stragglers: number,
 *     balance: number,
 *     oriented: number,
 *     breaks: number,
 *     aspect: number,
 *     preferCols4: number
 *   }>
 * }} [options]
 * @returns {{ cols: number, rows: number }}
 */
export function calculateOptimalGrid(tileCount, flowDirection = 'horizontal', options = {}) {
    // Special cases
    if (tileCount === 0) return { cols: 0, rows: 0 };
    if (tileCount === 1) return { cols: 1, rows: 1 };

    const {
        flowBias = 1.0,   // increase to prefer stronger orientation
        maxBreaks = 2,    // acceptable line breaks (rows-1 for horizontal, cols-1 for vertical)
        minAspect = 1.2,  // minimal oriented aspect before penalty
        weights = {}
    } = options;

    // Default weights; tuned to preserve prior behavior while adding orientation preference
    const W = {
        efficiency: 100,  // maximize packed usage (dominant)
        stragglers: 10,   // penalize unused cells
        balance: 5,       // discourage extreme imbalance (kept as before)
        oriented: 6,      // reward oriented proportion
        breaks: 20,       // penalty per break past threshold
        aspect: 30,       // penalty per unit short of minAspect in oriented direction
        preferCols4: 2    // very light nudge toward ~4 columns
    };
    Object.assign(W, weights);

    // Find approximate square root to establish search range
    const sqrt = Math.sqrt(tileCount);
    const minDim = Math.max(1, Math.floor(sqrt) - 1);
    const maxDim = Math.ceil(sqrt) + 2;

    let bestGrid = null;
    let bestScore = -Infinity;

    // Try all reasonable combinations
    for (let cols = minDim; cols <= maxDim; cols++) {
        const rows = Math.ceil(tileCount / cols);
        const capacity = cols * rows;
        const stragglers = capacity - tileCount;
        const balance = Math.abs(cols - rows);
        const efficiency = tileCount / capacity;

        // Orientation-aware terms
        const orientedPref = (flowDirection === 'horizontal') ? (cols - rows) : (rows - cols);
        const breaks = (flowDirection === 'horizontal') ? (rows - 1) : (cols - 1);

        // Aspect in the oriented direction (>=1 is "oriented enough")
        const aspect = cols / rows;
        const orientedAspect = (flowDirection === 'horizontal') ? aspect : (1 / aspect);
        const aspectPenalty = orientedAspect >= minAspect ? 0 : (minAspect - orientedAspect) * W.aspect * flowBias;

        // Scoring function (weights can be tuned via options)
        const score = (
            efficiency * W.efficiency +                         // Maximize efficiency (dominant)
            -stragglers * W.stragglers +                        // Penalize stragglers heavily
            -balance * W.balance +                              // Penalize imbalance moderately
            orientedPref * W.oriented * flowBias +              // Reward oriented proportion
            -Math.max(0, breaks - maxBreaks) * W.breaks * flowBias + // Penalize too many line breaks
            -Math.abs(cols - 4) * W.preferCols4 -               // Slight preference for ~4 cols (good for most screens)
            aspectPenalty                                       // Enforce a soft minimum oriented aspect
        );

        if (score > bestScore) {
            bestScore = score;
            bestGrid = { cols, rows };
        }
    }

    console.log(`[grid-calculator] Optimal grid for ${tileCount} tiles (${flowDirection}):`, bestGrid, `score: ${bestScore.toFixed(2)}`);

    return bestGrid;
}

/**
 * Calculate positions for tiles in a grid
 * @param {number} tileCount - Number of tiles to position
 * @param {string} flowDirection - 'horizontal' or 'vertical'
 * @param {{ width: number, height: number }} tileSize - Size of each tile
 * @param {number} spacing - Spacing between tiles
 * @returns {{ positions: Array<{x: number, y: number}>, cols: number, rows: number }}
 */
export function calculateGridPositions(tileCount, flowDirection, tileSize, spacing = 0, options = {}) {
    const { cols, rows } = calculateOptimalGrid(tileCount, flowDirection, options);
    const positions = [];

    // Calculate cell dimensions (tile size + spacing between tiles)
    const cellWidth = tileSize.width + spacing;
    const cellHeight = tileSize.height + spacing;

    if (flowDirection === 'horizontal') {
        // Left-to-right, then top-to-bottom (columns mode)
        for (let i = 0; i < tileCount; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);

            // Center the grid around origin (0, 0)
            // Subtract half the grid width/height to center it
            positions.push({
                x: col * cellWidth - (cols - 1) * cellWidth / 2,
                y: (rows - 1) * cellHeight / 2 - row * cellHeight
            });
        }
    } else {
        // Top-to-bottom, then left-to-right (rows mode)
        for (let i = 0; i < tileCount; i++) {
            const col = Math.floor(i / rows);
            const row = i % rows;

            // Center the grid around origin (0, 0)
            positions.push({
                x: col * cellWidth - (cols - 1) * cellWidth / 2,
                y: (rows - 1) * cellHeight / 2 - row * cellHeight
            });
        }
    }

    return { positions, cols, rows };
}
