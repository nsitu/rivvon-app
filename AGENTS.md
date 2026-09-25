# Project guidance

## Design system

When adding or changing UI, read [DESIGN.md](DESIGN.md) and follow its PrimeVue, layout, scroll-region, accessibility, and iconography rules. Prefer the shared UI primitives documented there over component-local implementations.

## Material Symbols

Whenever a new Material Symbols icon is added to the site, also add its exact icon name to the explicit `loadMaterialSymbols([...])` array in `apps/rivvon/src/main.js`. This keeps the icon available when the font is loaded with the curated icon set.
