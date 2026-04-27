# OTF-SVG Font Loader Notes

## Why this exists

Rivvon supports two different text-font sources:

- legacy SVG fonts that use `<font>` / `<glyph>` XML
- OpenType fonts that also embed skeletal glyph drawings in the OpenType `SVG ` table

For the isdaT single-line fonts, the OpenType `SVG ` table is the geometry we want to prefer for ribbon generation because it preserves the skeletal, centerline-style paths. The standard CFF outlines in the same `.otf` file are still useful as a fallback and for layout metrics, but they are not the preferred geometry source for ribbon rendering.

## Why we parse the `SVG ` table manually

We currently use `opentype.js` for OpenType parsing because it already gives us the parts of the font we still need:

- glyph mapping via `cmap`
- glyph ordering and glyph ids
- advance widths
- kerning / layout data
- outline fallback when no SVG glyph document is present

That is not enough on its own for OTF-SVG fonts. In the current version we use, `opentype.js` can parse the font successfully, but it does not expose the embedded `SVG ` table through a loader API we can directly consume for Rivvon's text-to-path pipeline. The library source also contains an explicit TODO around SVG glyph output rather than a finished public path for it.

Because of that, Rivvon reads the raw `SVG ` table bytes directly in [src/modules/viewer/textToSvg.js](../src/modules/viewer/textToSvg.js) and extracts glyph documents itself.

## Current assumptions

The manual parser is intentionally narrow and is based on the OpenType SVG table spec:

- the `SVG ` table header version is `0`
- `svgDocumentListOffset` is relative to the start of the `SVG ` table
- each `svgDocOffset` is relative to the start of the `SVGDocumentList`
- SVG documents are UTF-8 text and may be gzip-compressed
- each glyph description is identified by an element id of the form `glyph<glyphID>`
- OpenType layout still comes from the normal font tables; the `SVG ` table only replaces the glyph drawing source

Specification reference:

- https://learn.microsoft.com/en-us/typography/opentype/spec/svg

## What Rivvon extracts today

The current extractor is aimed at skeletal single-line fonts such as the isdaT OTF-SVG exports. It supports:

- `<path>`
- `<line>`
- `<polyline>`
- `<polygon>`
- `<rect>`
- `<circle>`
- `<ellipse>`
- `transform` attributes on ancestors and glyph containers
- `<use>` references for shared defs-based geometry
- `viewBox` scaling into font units
- gzip-compressed SVG documents inside the `SVG ` table

This is enough for the Relief and Mistral OTF-SVG single-line fonts currently in the repo.

## Fallback behavior

When an OpenType font has no usable embedded SVG glyph document for a glyph, Rivvon falls back to the standard OpenType outline path via `opentype.js`.

That means:

- layout and spacing still work even if the SVG table is missing for some glyphs
- skeletal rendering is preferred when the font actually supplies it
- outline rendering remains the safety net rather than the primary source

## Future simplification

If a future `opentype.js` release exposes sanitized / usable `SVG ` table access directly, Rivvon can simplify this loader and stop parsing the raw table itself. Until then, the manual parser is deliberate rather than accidental.
