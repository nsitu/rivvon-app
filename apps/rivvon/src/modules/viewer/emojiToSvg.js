// src/modules/viewer/emojiToSvg.js
// Non-reactive utility: fetch OpenMoji Black SVGs and convert their
// stroke-based centerline paths into point arrays for the ribbon pipeline.
//
// OpenMoji Black SVGs use stroke attributes (fill="none" stroke="#000"),
// so SVGLoader extracts the centerline curves directly — no skeleton
// extraction needed.

import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';

/** CDN base for individual OpenMoji Black SVGs (stroke-based line art) */
const OPENMOJI_SVG_CDN =
    'https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji/black/svg';

/** Returns the full CDN URL for a given OpenMoji hexcode */
export function openMojiSvgUrl(hexcode) {
    return `${OPENMOJI_SVG_CDN}/${hexcode}.svg`;
}

/** In-memory SVG text cache: URL → string|null */
const svgCache = new Map();

/** Loaded sprite documents: slug → Document */
const spriteCache = new Map();

/** In-flight sprite fetch promises: slug → Promise */
const spriteFetching = new Map();

/** Deduplicates concurrent loadCatalog() calls */
let catalogPromise = null;

/** Pretty group names for display */
const GROUP_LABELS = {
    'smileys-emotion': 'Smileys & Emotion',
    'people-body': 'People & Body',
    'animals-nature': 'Animals & Nature',
    'food-drink': 'Food & Drink',
    'travel-places': 'Travel & Places',
    'activities': 'Activities',
    'objects': 'Objects',
    'symbols': 'Symbols',
    'flags': 'Flags',
    'extras-openmoji': 'Extras — OpenMoji',
    'extras-unicode': 'Extras — Unicode',
};

// ─── Catalog ──────────────────────────────────────────────────────────

/**
 * @typedef {Object} OpenMojiEntry
 * @property {string} e - emoji character
 * @property {string} h - hexcode (e.g. "1F600")
 * @property {string} n - annotation / name
 */

/**
 * @typedef {Object} OpenMojiGroup
 * @property {string} name  - Human-readable group name
 * @property {string} slug  - Group slug key
 * @property {OpenMojiEntry[]} emojis
 */

/**
 * Load the compact OpenMoji index from `/openmoji-index.json`.
 * The file is generated at build-prep time and lives in `public/`.
 * Returns a grouped array ready for the picker UI.
 *
 * @returns {Promise<OpenMojiGroup[]>}
 */
export async function loadOpenMojiCatalog() {
    if (catalogPromise) return catalogPromise;

    catalogPromise = (async () => {
        const res = await fetch('/openmoji-index.json');
        if (!res.ok) throw new Error(`Failed to load OpenMoji index: ${res.status}`);

        /** @type {Array<{s: string, m: OpenMojiEntry[]}>} */
        const raw = await res.json();

        return raw.map(g => ({
            name: GROUP_LABELS[g.s] || g.s,
            slug: g.s,
            emojis: g.m,
        }));
    })();

    return catalogPromise;
}

// ─── Sprite loading ───────────────────────────────────────────────────

/**
 * Fetch a group's SVG spritemap from `/sprites/{slug}.svg`.
 * Returns the parsed Document. Deduplicates concurrent requests for the
 * same slug, and caches the result.
 *
 * @param {string} slug - Group slug (e.g. "smileys-emotion")
 * @returns {Promise<Document>}
 */
export async function loadGroupSprite(slug) {
    if (spriteCache.has(slug)) return spriteCache.get(slug);
    if (spriteFetching.has(slug)) return spriteFetching.get(slug);

    const promise = (async () => {
        const res = await fetch(`/sprites/${slug}.svg`);
        if (!res.ok) throw new Error(`Failed to load sprite: ${slug} (${res.status})`);
        const text = await res.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'image/svg+xml');
        spriteCache.set(slug, doc);
        spriteFetching.delete(slug);
        return doc;
    })();

    spriteFetching.set(slug, promise);
    return promise;
}

/**
 * Check whether a group sprite is already loaded.
 * @param {string} slug
 * @returns {boolean}
 */
export function isGroupSpriteLoaded(slug) {
    return spriteCache.has(slug);
}

/**
 * Extract a standalone SVG string from a loaded sprite's <symbol> element.
 * Used to feed SVGLoader for ribbon generation without a CDN fetch.
 *
 * @param {string} hexcode - The OpenMoji hexcode (e.g. "1F600")
 * @returns {string|null} Complete SVG markup string, or null if not found
 */
export function extractSvgFromSprite(hexcode) {
    for (const doc of spriteCache.values()) {
        const symbol = doc.getElementById(hexcode);
        if (symbol) {
            const viewBox = symbol.getAttribute('viewBox') || '0 0 72 72';
            // Rebuild a standalone SVG from the symbol's inner content.
            // Replace currentColor back to #000 so SVGLoader parses strokes.
            const inner = symbol.innerHTML.replace(/currentColor/g, '#000000');
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${inner}</svg>`;
        }
    }
    return null;
}

// ─── SVG fetching (CDN fallback) ──────────────────────────────────────

/**
 * Fetch an OpenMoji Black SVG by hexcode from the jsDelivr CDN.
 * Results are cached in-memory.
 * Prefer extractSvgFromSprite() when the sprite is loaded.
 *
 * @param {string} hexcode - e.g. "1F600" or "1F468-200D-1F373"
 * @returns {Promise<string|null>} SVG markup, or null on 404
 */
export async function fetchOpenMojiSvg(hexcode) {
    // Try local sprite first
    const fromSprite = extractSvgFromSprite(hexcode);
    if (fromSprite) return fromSprite;

    const url = `${OPENMOJI_SVG_CDN}/${hexcode}.svg`;
    if (svgCache.has(url)) return svgCache.get(url);

    const res = await fetch(url);
    if (!res.ok) {
        svgCache.set(url, null);
        return null;
    }

    const text = await res.text();
    svgCache.set(url, text);
    return text;
}

// ─── SVG → point arrays ──────────────────────────────────────────────

/**
 * Parse an OpenMoji Black SVG string and extract ribbon-ready point arrays.
 *
 * Because the SVGs use stroked paths (not fills), SVGLoader gives us the
 * centerline curves directly from `subPath.getPoints()`.
 *
 * @param {string} svgString   - Raw SVG markup
 * @param {number} [divisions=64] - Curve sampling density
 * @param {number} [minLengthRatio=0.02] - Discard paths shorter than this
 *   fraction of the longest (removes tiny decoration artefacts)
 * @returns {Array<Array<THREE.Vector3>>} One point array per subpath
 */
export function parseOpenMojiSvgToPoints(svgString, divisions = 64, minLengthRatio = 0.02) {
    const loader = new SVGLoader();
    const data = loader.parse(svgString);
    const allSubPaths = [];

    for (const shapePath of data.paths) {
        for (const subPath of shapePath.subPaths) {
            const pts2d = subPath.getPoints(divisions);
            if (pts2d.length < 2) continue;

            // SVG Y-down → Three.js Y-up
            const pts3d = pts2d.map(p => new THREE.Vector3(p.x, -p.y, 0));
            allSubPaths.push(pts3d);
        }
    }

    if (allSubPaths.length === 0) return [];

    // Filter out tiny decorative fragments
    if (minLengthRatio > 0 && allSubPaths.length > 1) {
        const lengths = allSubPaths.map(pts => {
            let len = 0;
            for (let i = 1; i < pts.length; i++) {
                len += pts[i].distanceTo(pts[i - 1]);
            }
            return len;
        });

        const maxLen = Math.max(...lengths);
        const threshold = maxLen * minLengthRatio;
        const filtered = allSubPaths.filter((_, i) => lengths[i] >= threshold);
        return filtered.length > 0 ? filtered : allSubPaths;
    }

    return allSubPaths;
}
