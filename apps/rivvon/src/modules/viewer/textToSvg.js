import SvgPath from 'svgpath';
import * as THREE from 'three';

/**
 * Parse an SVG font file and extract glyph data
 * @param {Document|Element} element - Parsed SVG document or font element
 * @param {number} size - Target font size in pixels
 * @returns {Object} Object with character keys and glyph data values
 */
export function parseFont(element, size = 24) {
    const result = {};

    const svgFont = element.getElementsByTagName('font')[0];
    const svgFontface = element.getElementsByTagName('font-face')[0];
    const svgGlyphs = element.getElementsByTagName('glyph');

    if (!svgFont || !svgFontface || !svgGlyphs) {
        console.error('[TextToSvg] Invalid SVG font structure');
        return result;
    }

    const fontHorizAdvX = svgFont.getAttribute('horiz-adv-x');
    const fontAscent = svgFontface.getAttribute('ascent');
    const fontUnitsPerEm = svgFontface.getAttribute('units-per-em') || 1000;

    const EM = size;
    const scale = EM / fontUnitsPerEm;

    for (let i = 0; i < svgGlyphs.length; i++) {
        const svgGlyph = svgGlyphs[i];
        const d = svgGlyph.getAttribute('d');
        const unicode = svgGlyph.getAttribute('unicode');
        const name = svgGlyph.getAttribute('glyph-name') || ('glyph' + unicode);
        const width = svgGlyph.getAttribute('horiz-adv-x') || fontHorizAdvX;

        if (unicode) {
            result[unicode] = {
                d: d ? new SvgPath(d)
                    .translate(0, -fontAscent)
                    .scale(scale, -scale)
                    .abs()
                    .rel()
                    .toString() : null,
                unicode,
                name,
                width: parseFloat(width * scale),
                height: EM,
            };
        }
    }
    return result;
}

/**
 * Measure line widths for text
 * @param {string} inputText - Text to measure
 * @param {Object} fontData - Parsed font data
 * @param {number} charSpacing - Character spacing
 * @returns {{lineWidths: number[], maxLineWidth: number}}
 */
export function measureLineWidths(inputText, fontData, charSpacing = 0) {
    const lineWidths = [];
    let width = 0;
    const chars = Array.from(inputText || '');
    chars.forEach((ch, idx) => {
        if (ch === '\n') {
            lineWidths.push(width);
            width = 0;
            return;
        }
        const g = fontData[ch];
        if (!g) return;
        width += g.width + charSpacing;
        if (idx + 1 === chars.length) {
            lineWidths.push(width);
        }
    });
    const maxLineWidth = lineWidths.length ? Math.max(...lineWidths) : 0;
    return { lineWidths, maxLineWidth };
}

/**
 * Create SVG path data for text
 * @param {string} inputText - Text to render
 * @param {Object} fontData - Parsed font data
 * @param {Object} opts - Options (alignment, charSpacing, lineHeight)
 * @returns {Array<{d: string}>} Array of path data objects
 */
export function createTextPaths(inputText, fontData, opts) {
    const { alignment = 'left', charSpacing = 0, lineHeight = 1 } = opts || {};
    const paths = [];

    const { lineWidths, maxLineWidth } = measureLineWidths(inputText, fontData, charSpacing);

    let originX = 0;
    let originY = 0;
    let lineIndex = 0;

    const characters = Array.from(inputText || '');

    const alignOffsetForLine = (i) => {
        if (alignment === 'center') return -(lineWidths[i] || 0) / 2;
        if (alignment === 'right') return -(lineWidths[i] || 0);
        return 0;
    };

    characters.forEach((character) => {
        if (character === '\n') {
            lineIndex += 1;
            originX = 0;
            // assume consistent size across glyphs
            const anyKey = Object.keys(fontData).find(k => fontData[k] && fontData[k].height);
            const lineSize = anyKey ? fontData[anyKey].height : 24;
            originY += lineSize * lineHeight;
            return;
        }
        const glyph = fontData[character];
        if (!glyph) return;
        if (glyph.d) {
            const characterX = originX + alignOffsetForLine(lineIndex);
            const d = new SvgPath(glyph.d)
                .translate(characterX, originY)
                .rel()
                .toString();
            paths.push({ d });
        }
        originX += glyph.width + charSpacing;
    });

    return paths;
}

/**
 * TextToSvg class for managing fonts and text rendering
 */
export class TextToSvg {
    constructor() {
        this.fonts = {};
        this.fontList = [];
        this.currentFont = null;
        this.fontSize = 100; // Default font size for rendering
    }

    /**
     * Load available fonts from the /public/fonts directory
     * @returns {Promise<string[]>} Array of font names
     */
    async loadAvailableFonts() {
        // Known fonts in the public/fonts directory
        const fontFiles = [
            'Custom-Script.svg',
            'CutlingsGeometricRound.svg',
            'EMS_Allure_Smooth.svg',
            'HersheyScript1smooth.svg'
        ];

        this.fontList = fontFiles.map(f => f.replace('.svg', ''));
        return this.fontList;
    }

    /**
     * Load and parse a specific font
     * @param {string} fontName - Name of the font (without .svg extension)
     * @returns {Promise<Object>} Parsed font data
     */
    async loadFont(fontName) {
        if (this.fonts[fontName]) {
            this.currentFont = fontName;
            return this.fonts[fontName];
        }

        try {
            const response = await fetch(`/fonts/${fontName}.svg`);
            if (!response.ok) {
                throw new Error(`Failed to load font: ${fontName}`);
            }
            const svgText = await response.text();
            const parser = new DOMParser();
            const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');

            const fontData = parseFont(svgDoc, this.fontSize);
            this.fonts[fontName] = fontData;
            this.currentFont = fontName;

            console.log(`[TextToSvg] Loaded font: ${fontName} with ${Object.keys(fontData).length} glyphs`);
            return fontData;
        } catch (error) {
            console.error(`[TextToSvg] Error loading font ${fontName}:`, error);
            throw error;
        }
    }

    /**
     * Get the current font data
     * @returns {Object|null} Font data or null
     */
    getCurrentFontData() {
        return this.currentFont ? this.fonts[this.currentFont] : null;
    }

    /**
     * Generate SVG path data from text
     * @param {string} text - Text to convert
     * @param {Object} options - Options for text layout
     * @returns {Array<{d: string}>} Array of path data
     */
    generatePaths(text, options = {}) {
        const fontData = this.getCurrentFontData();
        if (!fontData) {
            console.error('[TextToSvg] No font loaded');
            return [];
        }

        return createTextPaths(text, fontData, {
            alignment: options.alignment || 'left',
            charSpacing: options.charSpacing || 0,
            lineHeight: options.lineHeight || 1.2
        });
    }

    /**
     * Generate a complete SVG string from text
     * @param {string} text - Text to convert
     * @param {Object} options - Layout options
     * @returns {string} Complete SVG string
     */
    generateSvgString(text, options = {}) {
        const paths = this.generatePaths(text, options);
        if (paths.length === 0) {
            return null;
        }

        // Calculate bounds from all paths
        const allPathData = paths.map(p => p.d).join(' ');

        // Create a temporary SVG to measure bounds
        const svgNS = "http://www.w3.org/2000/svg";
        const tempSvg = document.createElementNS(svgNS, 'svg');
        tempSvg.setAttribute('xmlns', svgNS);

        const pathEl = document.createElementNS(svgNS, 'path');
        pathEl.setAttribute('d', allPathData);
        tempSvg.appendChild(pathEl);

        // Add to document temporarily to get bounding box
        document.body.appendChild(tempSvg);
        const bbox = pathEl.getBBox();
        document.body.removeChild(tempSvg);

        // Create SVG with proper viewBox
        const padding = 10;
        const viewBox = `${bbox.x - padding} ${bbox.y - padding} ${bbox.width + padding * 2} ${bbox.height + padding * 2}`;

        // Build SVG string with individual paths for multi-path support
        let pathsStr = paths.map(p =>
            `<path d="${p.d}" fill="none" stroke="black" stroke-width="1"/>`
        ).join('\n');

        return `<svg xmlns="${svgNS}" viewBox="${viewBox}">\n${pathsStr}\n</svg>`;
    }

    /**
     * Convert text to THREE.js Vector3 points for ribbon creation
     * @param {string} text - Text to convert
     * @param {number} numPoints - Points to sample per path
     * @param {Object} options - Layout options
     * @returns {Array<Array<THREE.Vector3>>} Array of point arrays (one per character/path)
     */
    textToPoints(text, numPoints = 100, options = {}) {
        const paths = this.generatePaths(text, options);
        if (paths.length === 0) {
            return [];
        }

        const svgNS = "http://www.w3.org/2000/svg";
        const pointArrays = [];

        paths.forEach((pathObj, index) => {
            if (!pathObj.d) return;

            // Create a path element to use browser's path API
            const pathEl = document.createElementNS(svgNS, 'path');
            pathEl.setAttribute('d', pathObj.d);

            const pathLength = pathEl.getTotalLength();
            if (pathLength < 1) return; // Skip very short paths

            const points = [];
            for (let i = 0; i < numPoints; i++) {
                const distance = (i / (numPoints - 1)) * pathLength;
                const point = pathEl.getPointAtLength(distance);
                points.push(new THREE.Vector3(point.x, -point.y, 0)); // Flip Y for THREE.js
            }

            if (points.length >= 2) {
                pointArrays.push(points);
            }
        });

        return pointArrays;
    }
}
