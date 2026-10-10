// Display-referred sRGB code values. Rows are aligned to even pixel boundaries so
// patch interiors have no 4:2:0 edge contamination. Static frames loop exactly.
export const COLOUR_CHART_ROWS = Object.freeze([
    [[255,255,255], [255,255,0], [0,255,255], [0,255,0], [255,0,255], [255,0,0], [0,0,255], [0,0,0]],
    [0,1,2,4,8,12,16,24].map(v => [v,v,v]),
    [231,235,239,243,247,251,254,255].map(v => [v,v,v]),
    [32,64,96,128,160,192,224,240].map(v => [v,v,v]),
]);

export function createColourChartRgba(width, height) {
    if (width % 16 || height % 12) throw new Error('Chart dimensions must be multiples of 16 × 12.');
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        const row = Math.floor(y * 6 / height);
        for (let x = 0; x < width; x++) {
            const level = Math.round(255 * x / (width - 1));
            const rgb = row < 4 ? COLOUR_CHART_ROWS[row][Math.floor(x * 8 / width)]
                : row === 4 ? [level,level,level]
                    : [level, Math.round(level / 4), 255 - level];
            const pixel = (y * width + x) * 4;
            rgba.set([...rgb, 255], pixel);
        }
    }
    return rgba;
}
