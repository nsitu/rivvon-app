import SvgPath from 'svgpath';
import * as THREE from 'three';
import { TEXT_FONT_INDEX, TEXT_FONT_INDEX_BY_ID } from './textFontIndex.js';

export { TEXT_FONT_INDEX };

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

function normalizeInputText(inputText, multiline = false) {
    const normalizedText = String(inputText ?? '').replace(/\r\n?/g, '\n');
    return multiline ? normalizedText : normalizedText.replace(/\n+/g, ' ');
}

let openTypeModulePromise = null;

async function loadOpenTypeModule() {
    if (!openTypeModulePromise) {
        openTypeModulePromise = import('opentype.js').then((module) => module.default || module);
    }

    return openTypeModulePromise;
}

function readOpenTypeTag(arrayBuffer, offset) {
    return String.fromCharCode(...new Uint8Array(arrayBuffer, offset, 4));
}

function findOpenTypeTable(arrayBuffer, tableTag) {
    const view = new DataView(arrayBuffer);
    const numTables = view.getUint16(4, false);

    for (let index = 0; index < numTables; index += 1) {
        const recordOffset = 12 + (index * 16);
        const tag = readOpenTypeTag(arrayBuffer, recordOffset);
        if (tag === tableTag) {
            return {
                offset: view.getUint32(recordOffset + 8, false),
                length: view.getUint32(recordOffset + 12, false),
            };
        }
    }

    return null;
}

async function decodeOpenTypeSvgDocument(encodedDocumentBytes) {
    let documentBytes = encodedDocumentBytes;

    if (
        documentBytes.length >= 3
        && documentBytes[0] === 0x1f
        && documentBytes[1] === 0x8b
        && documentBytes[2] === 0x08
    ) {
        if (typeof DecompressionStream !== 'function') {
            throw new Error('Compressed OpenType SVG documents require DecompressionStream support');
        }

        const gzipStream = new Blob([documentBytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        documentBytes = new Uint8Array(await new Response(gzipStream).arrayBuffer());
    }

    return new TextDecoder('utf-8').decode(documentBytes);
}

/**
 * opentype.js gives us cmap, glyph order, metrics, kerning and outline fallback,
 * but it does not currently expose OpenType SVG glyph documents through its public
 * API. Until that changes, OTF-SVG fonts that carry skeletal paths in the `SVG `
 * table must be read from the raw table bytes here.
 *
 * Assumptions are taken from the OpenType SVG table spec:
 * - header version 0
 * - svgDocumentListOffset is relative to the start of the `SVG ` table
 * - svgDocOffset is relative to the start of the SVGDocumentList
 * - documents are UTF-8 and may be gzip-compressed
 * - glyph descriptions are addressed by ids of the form `glyph<glyphID>`
 *
 * Spec reference: https://learn.microsoft.com/en-us/typography/opentype/spec/svg
 */
async function parseOpenTypeSvgDocuments(arrayBuffer) {
    const svgTable = findOpenTypeTable(arrayBuffer, 'SVG ');
    if (!svgTable) {
        return new Map();
    }

    const svgTableView = new DataView(arrayBuffer, svgTable.offset, svgTable.length);
    const svgDocumentListOffset = svgTableView.getUint32(2, false);
    if (!svgDocumentListOffset) {
        return new Map();
    }

    const numEntries = svgTableView.getUint16(svgDocumentListOffset, false);
    const documentRecordsOffset = svgDocumentListOffset + 2;
    const decodedDocumentCache = new Map();
    const glyphDocuments = new Map();

    for (let index = 0; index < numEntries; index += 1) {
        const recordOffset = documentRecordsOffset + (index * 12);
        const startGlyphId = svgTableView.getUint16(recordOffset, false);
        const endGlyphId = svgTableView.getUint16(recordOffset + 2, false);
        const svgDocOffset = svgTableView.getUint32(recordOffset + 4, false);
        const svgDocLength = svgTableView.getUint32(recordOffset + 8, false);
        if (!svgDocOffset || !svgDocLength) {
            continue;
        }

        const cacheKey = `${svgDocOffset}:${svgDocLength}`;
        let svgText = decodedDocumentCache.get(cacheKey);

        if (!svgText) {
            const absoluteDocOffset = svgTable.offset + svgDocumentListOffset + svgDocOffset;
            const encodedBytes = new Uint8Array(arrayBuffer, absoluteDocOffset, svgDocLength);
            svgText = await decodeOpenTypeSvgDocument(encodedBytes);
            decodedDocumentCache.set(cacheKey, svgText);
        }

        for (let glyphId = startGlyphId; glyphId <= endGlyphId; glyphId += 1) {
            glyphDocuments.set(glyphId, svgText);
        }
    }

    return glyphDocuments;
}

function getFontFormat(fontMeta) {
    if (typeof fontMeta?.format === 'string') {
        return fontMeta.format;
    }

    return /\.(otf|ttf|woff2?)$/i.test(fontMeta?.fileName || '') ? 'opentype' : 'svg-font';
}

function isOpenTypeFontData(fontData) {
    return fontData?.type === 'opentype';
}

function getSvgGlyphMap(fontData) {
    return fontData?.type === 'svg-font' ? fontData.glyphs : fontData;
}

function formatPathNumber(value) {
    return Number.parseFloat(Number(value || 0).toFixed(3)).toString();
}

function parseSvgNumericAttribute(element, attributeName, fallbackValue = 0) {
    const attributeValue = Number.parseFloat(element?.getAttribute(attributeName) || '');
    return Number.isFinite(attributeValue) ? attributeValue : fallbackValue;
}

function pathDataFromSvgShape(element) {
    const tagName = element?.tagName?.toLowerCase();
    if (!tagName) {
        return '';
    }

    if (tagName === 'path') {
        return element.getAttribute('d') || '';
    }

    if (tagName === 'line') {
        const x1 = parseSvgNumericAttribute(element, 'x1');
        const y1 = parseSvgNumericAttribute(element, 'y1');
        const x2 = parseSvgNumericAttribute(element, 'x2');
        const y2 = parseSvgNumericAttribute(element, 'y2');
        return `M${x1} ${y1}L${x2} ${y2}`;
    }

    if (tagName === 'polyline' || tagName === 'polygon') {
        const numericPoints = (element.getAttribute('points') || '')
            .trim()
            .split(/[\s,]+/)
            .map(Number)
            .filter(Number.isFinite);

        if (numericPoints.length < 4 || numericPoints.length % 2 !== 0) {
            return '';
        }

        let pathData = `M${numericPoints[0]} ${numericPoints[1]}`;
        for (let index = 2; index < numericPoints.length; index += 2) {
            pathData += `L${numericPoints[index]} ${numericPoints[index + 1]}`;
        }

        if (tagName === 'polygon') {
            pathData += 'Z';
        }

        return pathData;
    }

    if (tagName === 'rect') {
        const x = parseSvgNumericAttribute(element, 'x');
        const y = parseSvgNumericAttribute(element, 'y');
        const width = parseSvgNumericAttribute(element, 'width');
        const height = parseSvgNumericAttribute(element, 'height');
        if (!width || !height) {
            return '';
        }

        return `M${x} ${y}H${x + width}V${y + height}H${x}Z`;
    }

    if (tagName === 'circle' || tagName === 'ellipse') {
        const cx = parseSvgNumericAttribute(element, 'cx');
        const cy = parseSvgNumericAttribute(element, 'cy');
        const rx = tagName === 'circle'
            ? parseSvgNumericAttribute(element, 'r')
            : parseSvgNumericAttribute(element, 'rx');
        const ry = tagName === 'circle'
            ? parseSvgNumericAttribute(element, 'r')
            : parseSvgNumericAttribute(element, 'ry');

        if (!rx || !ry) {
            return '';
        }

        return [
            `M${cx + rx} ${cy}`,
            `A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`,
            `A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}`,
            'Z'
        ].join(' ');
    }

    return '';
}

function parseSvgViewBoxTransform(svgElement, unitsPerEm) {
    const viewBoxValue = svgElement?.getAttribute('viewBox');
    if (!viewBoxValue) {
        return null;
    }

    const viewBoxParts = viewBoxValue.trim().split(/[\s,]+/).map(Number);
    if (viewBoxParts.length !== 4 || viewBoxParts.some((part) => !Number.isFinite(part))) {
        return null;
    }

    const [minX, minY, width, height] = viewBoxParts;
    if (!width || !height) {
        return null;
    }

    return {
        minX,
        minY,
        scaleX: unitsPerEm / width,
        scaleY: unitsPerEm / height,
    };
}

function applyPathTransforms(pathData, transformSequence, viewBoxTransform) {
    if (!pathData) {
        return '';
    }

    let transformedPath = new SvgPath(pathData);

    transformSequence.forEach((transformValue) => {
        if (transformValue) {
            transformedPath = transformedPath.transform(transformValue);
        }
    });

    if (viewBoxTransform) {
        transformedPath = transformedPath.translate(-viewBoxTransform.minX, -viewBoxTransform.minY);
        transformedPath = transformedPath.scale(viewBoxTransform.scaleX, viewBoxTransform.scaleY);
    }

    return transformedPath.abs().round(3).toString();
}

function getUseReferenceId(element) {
    const hrefValue = element.getAttribute('href')
        || element.getAttribute('xlink:href')
        || element.getAttributeNS('http://www.w3.org/1999/xlink', 'href');

    return hrefValue?.startsWith('#') ? hrefValue.slice(1) : '';
}

function collectAncestorTransformSequence(targetElement, rootElement) {
    const transformSequence = [];
    let currentElement = targetElement?.parentElement || null;

    while (currentElement) {
        const transformValue = currentElement.getAttribute('transform');
        if (transformValue) {
            transformSequence.unshift(transformValue);
        }

        if (currentElement === rootElement) {
            break;
        }

        currentElement = currentElement.parentElement;
    }

    return transformSequence;
}

function collectSvgGlyphPathData(node, svgDoc, options, inheritedTransforms = [], visitedReferenceIds = new Set()) {
    const tagName = node?.tagName?.toLowerCase();
    if (!tagName) {
        return [];
    }

    if (tagName === 'defs') {
        return [];
    }

    if (tagName === 'use') {
        const referenceId = getUseReferenceId(node);
        if (!referenceId || visitedReferenceIds.has(referenceId)) {
            return [];
        }

        const referencedElement = svgDoc.getElementById(referenceId);
        if (!referencedElement) {
            return [];
        }

        const useTransforms = [...inheritedTransforms];
        const x = parseSvgNumericAttribute(node, 'x');
        const y = parseSvgNumericAttribute(node, 'y');
        if (x || y) {
            useTransforms.push(`translate(${x} ${y})`);
        }

        const useTransform = node.getAttribute('transform');
        if (useTransform) {
            useTransforms.push(useTransform);
        }

        const nextVisitedReferences = new Set(visitedReferenceIds);
        nextVisitedReferences.add(referenceId);
        return collectSvgGlyphPathData(referencedElement, svgDoc, options, useTransforms, nextVisitedReferences);
    }

    const nextTransforms = [...inheritedTransforms];
    const nodeTransform = node.getAttribute('transform');
    if (nodeTransform) {
        nextTransforms.push(nodeTransform);
    }

    const shapePathData = pathDataFromSvgShape(node);
    if (shapePathData) {
        const transformedPath = applyPathTransforms(shapePathData, nextTransforms, options.viewBoxTransform);
        return transformedPath ? [transformedPath] : [];
    }

    const childPathData = [];
    Array.from(node.children || []).forEach((childElement) => {
        childPathData.push(...collectSvgGlyphPathData(childElement, svgDoc, options, nextTransforms, visitedReferenceIds));
    });

    return childPathData;
}

function extractOpenTypeSvgGlyphPaths(svgDocumentText, glyphId, unitsPerEm) {
    if (!svgDocumentText) {
        return [];
    }

    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgDocumentText, 'image/svg+xml');
    const parserError = svgDoc.querySelector('parsererror');
    if (parserError) {
        console.error('[TextToSvg] Failed to parse SVG glyph document:', parserError.textContent || parserError);
        return [];
    }

    const svgElement = svgDoc.querySelector('svg');
    const glyphElement = svgDoc.getElementById(`glyph${glyphId}`) || svgElement;
    if (!svgElement || !glyphElement) {
        return [];
    }

    const viewBoxTransform = parseSvgViewBoxTransform(svgElement, unitsPerEm);
    const inheritedTransforms = glyphElement === svgElement
        ? []
        : collectAncestorTransformSequence(glyphElement, svgElement);

    return collectSvgGlyphPathData(
        glyphElement,
        svgDoc,
        { viewBoxTransform },
        inheritedTransforms,
    );
}

function getOpenTypeGlyphSkeletonPaths(fontData, glyph) {
    const glyphId = glyph?.index;
    if (!Number.isInteger(glyphId)) {
        return [];
    }

    if (fontData.svgPathCache.has(glyphId)) {
        return fontData.svgPathCache.get(glyphId);
    }

    const svgDocumentText = fontData.svgGlyphDocuments.get(glyphId);
    const skeletonPaths = svgDocumentText
        ? extractOpenTypeSvgGlyphPaths(svgDocumentText, glyphId, fontData.unitsPerEm)
        : [];

    fontData.svgPathCache.set(glyphId, skeletonPaths);
    return skeletonPaths;
}

function openTypePathToSvgData(path) {
    if (!path?.commands?.length) {
        return '';
    }

    const segments = [];

    for (const command of path.commands) {
        switch (command.type) {
            case 'M':
            case 'L':
                segments.push(`${command.type}${formatPathNumber(command.x)} ${formatPathNumber(command.y)}`);
                break;
            case 'C':
                segments.push(
                    `C${formatPathNumber(command.x1)} ${formatPathNumber(command.y1)} ${formatPathNumber(command.x2)} ${formatPathNumber(command.y2)} ${formatPathNumber(command.x)} ${formatPathNumber(command.y)}`
                );
                break;
            case 'Q':
                segments.push(
                    `Q${formatPathNumber(command.x1)} ${formatPathNumber(command.y1)} ${formatPathNumber(command.x)} ${formatPathNumber(command.y)}`
                );
                break;
            case 'Z':
                segments.push('Z');
                break;
            default:
                break;
        }
    }

    return segments.join(' ');
}

function measureOpenTypeLineWidth(line, fontData, charSpacing = 0) {
    const glyphs = fontData.font.stringToGlyphs(line);
    let width = 0;

    glyphs.forEach((glyph, index) => {
        width += (glyph?.advanceWidth || 0) * fontData.scale;

        const nextGlyph = glyphs[index + 1];
        if (glyph && nextGlyph) {
            width += fontData.font.getKerningValue(glyph, nextGlyph) * fontData.scale;
        }

        width += charSpacing;
    });

    return width;
}

function createOpenTypeLinePaths(line, fontData, originX, baselineY, charSpacing = 0) {
    const glyphs = fontData.font.stringToGlyphs(line);
    const paths = [];
    let cursorX = originX;

    glyphs.forEach((glyph, index) => {
        if (glyph) {
            const skeletonPaths = getOpenTypeGlyphSkeletonPaths(fontData, glyph);
            if (skeletonPaths.length > 0) {
                skeletonPaths.forEach((skeletonPathData) => {
                    const d = new SvgPath(skeletonPathData)
                        .scale(fontData.scale)
                        .translate(cursorX, baselineY)
                        .abs()
                        .round(3)
                        .toString();

                    if (d) {
                        paths.push({ d });
                    }
                });
            } else {
                const d = openTypePathToSvgData(glyph.getPath(cursorX, baselineY, fontData.fontSize));
                if (d) {
                    paths.push({ d });
                }
            }

            cursorX += (glyph.advanceWidth || 0) * fontData.scale;
        }

        const nextGlyph = glyphs[index + 1];
        if (glyph && nextGlyph) {
            cursorX += fontData.font.getKerningValue(glyph, nextGlyph) * fontData.scale;
        }

        cursorX += charSpacing;
    });

    return paths;
}

function getFontLineSize(fontData) {
    if (isOpenTypeFontData(fontData)) {
        return fontData.lineSize;
    }

    const glyphMap = getSvgGlyphMap(fontData);
    const glyph = Object.values(glyphMap).find(item => item && Number.isFinite(item.height));
    return glyph?.height || 24;
}

/**
 * Measure line widths for text
 * @param {string} inputText - Text to measure
 * @param {Object} fontData - Parsed font data
 * @param {number} charSpacing - Character spacing
 * @param {Object} opts - Layout options
 * @returns {{lines: string[], lineWidths: number[], maxLineWidth: number}}
 */
export function measureLineWidths(inputText, fontData, charSpacing = 0, opts = {}) {
    const layoutText = normalizeInputText(inputText, opts.multiline);
    const lines = opts.multiline ? layoutText.split('\n') : [layoutText];

    if (isOpenTypeFontData(fontData)) {
        const lineWidths = lines.map((line) => measureOpenTypeLineWidth(line, fontData, charSpacing));
        const maxLineWidth = lineWidths.length ? Math.max(...lineWidths) : 0;
        return { lines, lineWidths, maxLineWidth };
    }

    const glyphMap = getSvgGlyphMap(fontData);

    const lineWidths = lines.map((line) => {
        let width = 0;

        Array.from(line).forEach((character) => {
            const glyph = glyphMap[character];
            if (!glyph) return;
            width += glyph.width + charSpacing;
        });

        return width;
    });

    const maxLineWidth = lineWidths.length ? Math.max(...lineWidths) : 0;
    return { lines, lineWidths, maxLineWidth };
}

/**
 * Create SVG path data for text
 * @param {string} inputText - Text to render
 * @param {Object} fontData - Parsed font data
 * @param {Object} opts - Options (alignment, charSpacing, lineHeight)
 * @returns {Array<{d: string}>} Array of path data objects
 */
export function createTextPaths(inputText, fontData, opts) {
    const {
        alignment = 'left',
        charSpacing = 0,
        lineHeight = 1,
        multiline = false
    } = opts || {};
    const paths = [];

    const { lines, lineWidths } = measureLineWidths(inputText, fontData, charSpacing, { multiline });
    const lineSize = getFontLineSize(fontData);

    const alignOffsetForLine = (i) => {
        if (alignment === 'center') return -(lineWidths[i] || 0) / 2;
        if (alignment === 'right') return -(lineWidths[i] || 0);
        return 0;
    };

    if (isOpenTypeFontData(fontData)) {
        lines.forEach((line, lineIndex) => {
            const originX = alignOffsetForLine(lineIndex);
            const baselineY = lineIndex * lineSize * lineHeight;
            paths.push(...createOpenTypeLinePaths(line, fontData, originX, baselineY, charSpacing));
        });

        return paths;
    }

    const glyphMap = getSvgGlyphMap(fontData);

    lines.forEach((line, lineIndex) => {
        let originX = alignOffsetForLine(lineIndex);
        const originY = lineIndex * lineSize * lineHeight;

        Array.from(line).forEach((character) => {
            const glyph = glyphMap[character];
            if (!glyph) return;

            if (glyph.d) {
                const d = new SvgPath(glyph.d)
                    .translate(originX, originY)
                    .rel()
                    .toString();
                paths.push({ d });
            }

            originX += glyph.width + charSpacing;
        });
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
    * @returns {Promise<Array<{id: string, fileName: string, fontName: string}>>} Array of font metadata
     */
    async loadAvailableFonts() {
        this.fontList = TEXT_FONT_INDEX.map(font => ({ ...font }));
        return this.fontList;
    }

    /**
     * Load and parse a specific font
     * @param {string} fontName - Font id from TEXT_FONT_INDEX
     * @returns {Promise<Object>} Parsed font data
     */
    async loadFont(fontName) {
        const fontMeta = TEXT_FONT_INDEX_BY_ID.get(fontName);

        if (!fontMeta) {
            throw new Error(`Unknown font: ${fontName}`);
        }

        if (this.fonts[fontName]) {
            this.currentFont = fontName;
            return this.fonts[fontName];
        }

        try {
            const response = await fetch(`/fonts/${encodeURIComponent(fontMeta.fileName)}`);
            if (!response.ok) {
                throw new Error(`Failed to load font: ${fontName}`);
            }

            let fontData;
            if (getFontFormat(fontMeta) === 'opentype') {
                const opentype = await loadOpenTypeModule();
                const fontBuffer = await response.arrayBuffer();
                const font = opentype.parse(fontBuffer);

                if (!font?.supported) {
                    throw new Error(`Unsupported OpenType font: ${fontName}`);
                }

                const unitsPerEm = Number(font.unitsPerEm) || 1000;
                const scale = this.fontSize / unitsPerEm;
                const svgGlyphDocuments = await parseOpenTypeSvgDocuments(fontBuffer);
                fontData = {
                    type: 'opentype',
                    font,
                    fontSize: this.fontSize,
                    scale,
                    unitsPerEm,
                    lineSize: ((Number(font.ascender) || unitsPerEm) - (Number(font.descender) || 0)) * scale,
                    svgGlyphDocuments,
                    svgPathCache: new Map(),
                };
            } else {
                const svgText = await response.text();
                const parser = new DOMParser();
                const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
                fontData = {
                    type: 'svg-font',
                    glyphs: parseFont(svgDoc, this.fontSize),
                };
            }

            this.fonts[fontName] = fontData;
            this.currentFont = fontName;

            const glyphCount = isOpenTypeFontData(fontData)
                ? fontData.font.glyphs.length
                : Object.keys(fontData.glyphs).length;
            console.log(`[TextToSvg] Loaded font: ${fontName} with ${glyphCount} glyphs`);
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

        const multiline = options.multiline || false;

        return createTextPaths(text, fontData, {
            alignment: options.alignment || 'left',
            charSpacing: options.charSpacing || 0,
            lineHeight: options.lineHeight || (multiline ? 1.1 : 1.2),
            multiline
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

        const padding = Number.isFinite(options.padding) ? options.padding : 10;
        const strokeColor = options.strokeColor || 'black';
        const strokeWidth = Number.isFinite(options.strokeWidth) ? options.strokeWidth : 1;

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
        const viewBox = `${bbox.x - padding} ${bbox.y - padding} ${bbox.width + padding * 2} ${bbox.height + padding * 2}`;

        // Build SVG string with individual paths for multi-path support
        let pathsStr = paths.map(p =>
            `<path d="${p.d}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`
        ).join('\n');

        return `<svg xmlns="${svgNS}" viewBox="${viewBox}" preserveAspectRatio="xMinYMid meet">\n${pathsStr}\n</svg>`;
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
