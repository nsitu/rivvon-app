#!/usr/bin/env node
// scripts/build-emoji-sprites.mjs
//
// Generates SVG symbol spritemaps from the `openmoji` npm package.
// One output file per emoji group, placed in public/sprites/.
//
// Each SVG file contains <symbol> elements that can be referenced
// via <use href="#HEXCODE"/> at runtime.
//
// Usage:  node scripts/build-emoji-sprites.mjs
// Or:     pnpm generate:sprites

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const appRoot = resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// Resolve the openmoji package root via require.resolve
const openmojiPkg = dirname(require.resolve('openmoji/package.json'));
const svgDir = resolve(openmojiPkg, 'black', 'svg');
const indexPath = resolve(appRoot, 'public', 'openmoji-index.json');
const outDir = resolve(appRoot, 'public', 'sprites');

// ── Load the curated index ──────────────────────────────────────────
const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
console.log(`Loaded openmoji-index.json: ${index.length} groups`);

// ── Ensure output directory exists ──────────────────────────────────
mkdirSync(outDir, { recursive: true });

// ── Regex to extract inner content of the root <svg> element ────────
// Matches everything between <svg ...> and </svg>, capturing inner content.
const SVG_INNER_RE = /<svg[^>]*>([\s\S]*?)<\/svg>/i;

// Stroke color replacement: #000000 or #000 → currentColor
const STROKE_RE = /stroke="#(?:000000|000)"/g;

// Fill color replacement: fill="#000000" or fill="#000" → currentColor
const FILL_RE = /fill="#(?:000000|000)"/g;

// Catch-all for other color attributes (stop-color, flood-color, etc.)
const COLOR_ATTR_RE = /color="#(?:000000|000)"/g;

let totalEmoji = 0;
let missingCount = 0;

for (const group of index) {
    const slug = group.s;
    const emojis = group.m;
    const symbols = [];

    for (const entry of emojis) {
        const hex = entry.h;
        const svgPath = resolve(svgDir, `${hex}.svg`);

        if (!existsSync(svgPath)) {
            console.warn(`  ⚠ Missing SVG: ${hex} (${entry.n})`);
            missingCount++;
            continue;
        }

        let svgContent = readFileSync(svgPath, 'utf-8');

        // Extract inner content (inside root <svg> tag)
        const match = svgContent.match(SVG_INNER_RE);
        if (!match) {
            console.warn(`  ⚠ Could not parse SVG: ${hex}`);
            missingCount++;
            continue;
        }

        let inner = match[1];

        // Replace hardcoded black with currentColor in all color attributes
        inner = inner.replace(STROKE_RE, 'stroke="currentColor"');
        inner = inner.replace(FILL_RE, 'fill="currentColor"');
        inner = inner.replace(COLOR_ATTR_RE, 'color="currentColor"');

        // Fix elements with no fill and no stroke attributes.
        // SVG defaults fill to black when unspecified, so these render as
        // dark shapes. Add stroke="currentColor" + fill="none" so they
        // align with the stroke-based centerline approach used by ribbons.
        inner = inner.replace(
            /<(path|circle|ellipse|rect|polygon|polyline)\b([^>]*?)\/?>/gi,
            (match, tag, attrs) => {
                const hasFill = /\bfill\s*=/.test(match);
                const hasStroke = /\bstroke\s*=/.test(match);
                if (!hasFill && !hasStroke) {
                    // No fill, no stroke → treat as stroked outline.
                    // Strip any existing stroke-width first (e.g. stroke-width="0"
                    // on originally-filled shapes) to avoid duplicate attributes
                    // which produce invalid XML and break the parser.
                    let cleaned = match.replace(/\s*stroke-width="[^"]*"/g, '');
                    return cleaned.replace(`<${tag}`, `<${tag} fill="none" stroke="currentColor" stroke-width="2"`);
                }
                if (!hasFill && hasStroke) {
                    // Has stroke but no fill → would default-fill to black over the stroke
                    return match.replace(`<${tag}`, `<${tag} fill="none"`);
                }
                return match;
            }
        );

        symbols.push(`<symbol id="${hex}" viewBox="0 0 72 72">${inner}</symbol>`);
    }

    // Build the combined spritemap SVG
    const spriteSvg =
        `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n` +
        symbols.join('\n') +
        `\n</svg>\n`;

    const outPath = resolve(outDir, `${slug}.svg`);
    writeFileSync(outPath, spriteSvg, 'utf-8');

    const sizeKB = (Buffer.byteLength(spriteSvg, 'utf-8') / 1024).toFixed(1);
    console.log(`  ✓ ${slug}: ${symbols.length} emoji, ${sizeKB} KB`);
    totalEmoji += symbols.length;
}

console.log(`\nDone: ${totalEmoji} emoji across ${index.length} groups`);
if (missingCount > 0) {
    console.log(`  ${missingCount} missing/unparsed SVGs skipped`);
}
console.log(`Output: ${outDir}`);
