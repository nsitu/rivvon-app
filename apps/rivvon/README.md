# rivvon

This demo takes a folder of tile images each being 512px square, and renders them as textures along a path so as to form a segmented ribbon. The textures are arranged in a way that takes the flow of the ribbon into account vis-a-vis "which way is up", that is we calculate the normals up front for each segment.

## Pointer Events Architecture

The app uses a layered architecture where the Three.js canvas is appended directly to `document.body` at `z-index: 0`, while the Vue app (`#app`) sits above at `z-index: 1`.

To allow mouse/touch events to reach the Three.js canvas and OrbitControls:

1. **`#app:has(.viewer-mode)`** and **`.viewer-mode`** have `pointer-events: none` so events pass through to the canvas below
2. **Interactive UI elements** (header, toolbar, modals, panels) are given `pointer-events: auto` via scoped `:deep()` rules in `RibbonView.vue`
3. **Overlay canvases** like DrawCanvas use `pointer-events: none` by default, switching to `auto` only when active
4. **Teleported modals** (e.g., BetaModal) manage their own pointer-events with a `.visible` class toggle

This approach avoids broad selectors like `button, a, input { pointer-events: auto }` which can create invisible clickable areas that block the 3D scene.
