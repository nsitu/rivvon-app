# Rivvon Migration Plan: Vanilla JS → Vue 3 + Tailwind + PrimeVue

## 🚀 Implementation Progress

> **Note:** The Vue 3 version is being built in a parallel `src-vue/` directory.
> The original vanilla JS version remains functional in `src/`.

### Running the Vue 3 Version

```bash
# From apps/rivvon directory:
pnpm run dev:vue     # Development server (opens http://localhost:5175/index-vue.html)
pnpm run build:vue   # Production build (outputs to dist-vue/)
pnpm run preview:vue # Preview production build
```

### Completed Items ✅

- [x] **package.json** - Added Vue 3, Tailwind, PrimeVue, Pinia, Vue Router dependencies
- [x] **vite.config.vue.mjs** - Vue 3 Vite configuration with Tailwind plugin
- [x] **tailwind.config.js** - Tailwind configuration for src-vue directory
- [x] **index-vue.html** - Entry HTML file for Vue 3 app
- [x] **src-vue/main.js** - Vue 3 entry point with Pinia, Router, PrimeVue
- [x] **src-vue/App.vue** - Root Vue component
- [x] **src-vue/stores/appStore.js** - Pinia store for global state
- [x] **src-vue/router/index.js** - Vue Router configuration
- [x] **src-vue/style.css** - Global styles with Tailwind imports
- [x] **Composables:**
  - [x] `useGoogleAuth.js` - Authentication
  - [x] `useThreeSetup.js` - Three.js initialization
  - [x] `useDrawing.js` - Drawing mode management
  - [x] `useTextToSvg.js` - Text to SVG conversion
- [x] **Components:**
  - [x] `AppHeader.vue` - Logo + auth controls
  - [x] `BottomToolbar.vue` - Action buttons
  - [x] `ThreeCanvas.vue` - Three.js container
  - [x] `DrawCanvas.vue` - Drawing overlay
  - [x] `FinishDrawingButton.vue` - Finish drawing button with countdown
  - [x] `TextInputPanel.vue` - Text to SVG modal
  - [x] `BetaModal.vue` - Beta access modal
  - [x] `RendererIndicator.vue` - Debug renderer indicator
- [x] **Views:**
  - [x] `RibbonView.vue` - Main 3D ribbon view
  - [x] `CallbackView.vue` - OAuth callback handler

### Remaining Items 📋

- [ ] **TextureBrowser.vue** - Texture gallery component (needs conversion from textureBrowser.js)
- [ ] Testing and debugging all features
- [ ] Final style polish and responsive adjustments
- [ ] Remove old vanilla code when ready to swap

---

## Overview

This document outlines the migration strategy for upgrading the rivvon app from vanilla JavaScript to Vue 3, following the architecture patterns established in the slyce app.

**Current State (rivvon):**

- Vanilla JS with direct DOM manipulation
- Vite for bundling
- Custom CSS styling
- Three.js for 3D rendering
- Manual DOM element references via `domElements.js`
- Event-driven state management in `main.js`

**Target State:**

- Vue 3 with Composition API
- Pinia for state management
- Vue Router for navigation
- Tailwind CSS v4 for styling
- PrimeVue for UI components
- Composables for reusable logic

---

## Phase 1: Project Setup & Dependencies

### 1.1 Update package.json

Add the following dependencies (matching slyce):

```json
{
  "dependencies": {
    "@primevue/themes": "^4.4.1",
    "@tailwindcss/vite": "^4.1.14",
    "@vitejs/plugin-vue": "^6.0.1",
    "@vueuse/core": "^13.9.0",
    "pinia": "^3.0.3",
    "primevue": "^4.4.1",
    "vue": "^3.5.22",
    "vue-router": "^4.6.4"
  },
  "devDependencies": {
    "autoprefixer": "^10.4.21",
    "tailwindcss": "^4.1.14",
    "vite-plugin-vue-devtools": "^8.0.3"
  }
}
```

**Keep existing dependencies:**

- `jszip` - ZIP file handling for texture packs
- `svgpath` - SVG path manipulation
- `three` - 3D rendering

### 1.2 Update vite.config.js → vite.config.mjs

```javascript
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueDevTools from "vite-plugin-vue-devtools";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/",
  build: {
    target: "esnext",
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "esnext",
    },
  },
  plugins: [tailwindcss(), vue(), vueDevTools()],
});
```

### 1.3 Create Tailwind Configuration

Create `tailwind.config.js`:

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{vue,js,mjs,ts,jsx,tsx}"],
  theme: {},
  plugins: [],
};
```

---

## Phase 2: Create Vue 3 Application Structure

### 2.1 New Directory Structure

```
src/
├── App.vue                    # Root component
├── main.js                    # Vue app entry point
├── style.css                  # Global styles + Tailwind imports
├── components/
│   ├── AppHeader.vue          # Logo + auth controls
│   ├── AppFooter.vue          # Footer (if needed)
│   ├── BottomToolbar.vue      # Bottom right menu buttons
│   ├── FinishDrawingButton.vue
│   ├── TextInputPanel.vue     # Text to SVG modal
│   ├── BetaModal.vue          # Beta access modal
│   ├── TextureBrowser.vue     # Texture gallery overlay
│   ├── ThreeCanvas.vue        # Three.js container
│   ├── DrawCanvas.vue         # Drawing overlay canvas
│   ├── RendererIndicator.vue  # Debug renderer type indicator
│   └── AuthButton.vue         # Login/logout button
├── composables/
│   ├── useGoogleAuth.js       # From slyce (adapt for rivvon)
│   ├── useThreeSetup.js       # Three.js initialization logic
│   ├── useDrawing.js          # Drawing mode logic
│   ├── useRibbon.js           # Ribbon creation/management
│   ├── useTextures.js         # Texture loading/switching
│   └── useTextToSvg.js        # Text to SVG conversion
├── stores/
│   └── appStore.js            # Pinia store for global state
├── router/
│   └── index.js               # Vue Router configuration
├── views/
│   ├── RibbonView.vue         # Main 3D ribbon view
│   └── CallbackView.vue       # OAuth callback handler
├── modules/                   # Keep existing modules (minimal changes)
│   ├── iconLoader.js          # ✓ Keep as-is
│   ├── ribbon.js              # ✓ Keep as-is (class-based)
│   ├── ribbonSeries.js        # ✓ Keep as-is
│   ├── drawing.js             # ✓ Keep as-is (class-based)
│   ├── tileManager.js         # ✓ Keep as-is
│   ├── textureBrowser.js      # → Convert to Vue component
│   ├── textureService.js      # ✓ Keep as-is (API calls)
│   ├── textToSvg.js           # ✓ Keep as-is (class-based)
│   ├── svgPathToPoints.js     # ✓ Keep as-is (pure functions)
│   ├── threeSetup.js          # ✓ Keep as-is
│   ├── threeSetup-webgl.js    # ✓ Keep as-is
│   ├── threeSetup-webgpu.js   # ✓ Keep as-is
│   └── auth.js                # → Replace with composable
└── utils/
    └── renderer-utils.js      # ✓ Keep as-is
```

### 2.2 Create Entry Point (main.js)

```javascript
import { createPinia } from "pinia";
import { createApp } from "vue";
import PrimeVue from "primevue/config";
import Aura from "@primevue/themes/aura";
import App from "./App.vue";
import router from "./router";
import "./style.css";

// Material Icons
import { loadMaterialSymbols } from "./modules/iconLoader";
loadMaterialSymbols([
  "sprint",
  "upload",
  "grid_view",
  "text_fields",
  "fullscreen",
  "logout",
  "login",
]);

const app = createApp(App);

// Pinia store
const pinia = createPinia();
app.use(pinia);

// Vue Router
app.use(router);

// PrimeVue
app.use(PrimeVue, {
  theme: {
    preset: Aura,
  },
});

// PrimeVue directives
import Tooltip from "primevue/tooltip";
app.directive("tooltip", Tooltip);

app.mount("#app");
```

### 2.3 Update index.html

Simplify to Vue 3 mounting point:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no"
    />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,100..900;1,100..900&display=swap"
      rel="stylesheet"
    />
    <link
      href="https://fonts.googleapis.com/css2?family=Cascadia+Code:ital,wght@0,200..700;1,200..700&display=swap"
      rel="stylesheet"
    />
    <title>rivvon</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

---

## Phase 3: State Management with Pinia

### 3.1 Create appStore.js

```javascript
import { defineStore } from "pinia";

export const useAppStore = defineStore("appStore", {
  state: () => ({
    // Renderer state
    rendererType: "webgl", // 'webgl' | 'webgpu'

    // Drawing state
    isDrawingMode: false,
    strokeCount: 0,
    countdownSeconds: null,

    // Ribbon/3D state
    ribbon: null,
    ribbonSeries: null,
    flowEnabled: true,

    // Texture state
    currentTextureId: null,
    thumbnailUrl: null,

    // Text to SVG
    textPanelVisible: false,
    selectedFont: null,

    // Texture browser
    textureBrowserVisible: false,

    // Auth state
    isAuthenticated: false,
    user: null,

    // UI state
    betaModalVisible: false,
    debugMode: false,
  }),

  actions: {
    setDrawingMode(enabled) {
      this.isDrawingMode = enabled;
    },
    setUser(user) {
      this.user = user;
      this.isAuthenticated = !!user;
    },
    toggleFlow() {
      this.flowEnabled = !this.flowEnabled;
    },
    showBetaModal() {
      this.betaModalVisible = true;
    },
    hideBetaModal() {
      this.betaModalVisible = false;
    },
    // ... additional actions
  },

  getters: {
    userName: (state) => state.user?.name || state.user?.email || "User",
  },
});
```

---

## Phase 4: Create Vue Components

### 4.1 Component Migration Map

| Current (Vanilla)           | New (Vue Component)       | Complexity |
| --------------------------- | ------------------------- | ---------- |
| `index.html` auth section   | `AppHeader.vue`           | Low        |
| `#bottomRightMenu`          | `BottomToolbar.vue`       | Low        |
| `#finishDrawingBtn`         | `FinishDrawingButton.vue` | Low        |
| `#textInputPanel`           | `TextInputPanel.vue`      | Medium     |
| `#betaModal`                | `BetaModal.vue`           | Low        |
| `textureBrowser.js` (class) | `TextureBrowser.vue`      | High       |
| Three.js container          | `ThreeCanvas.vue`         | Medium     |
| `#drawCanvas`               | `DrawCanvas.vue`          | Medium     |

### 4.2 App.vue Structure

```vue
<script setup>
import { RouterView } from "vue-router";
import { onMounted } from "vue";
import { useAppStore } from "./stores/appStore";
import { chooseRenderer } from "./utils/renderer-utils";

const app = useAppStore();

onMounted(async () => {
  // Choose renderer type
  app.rendererType = await chooseRenderer();

  // Enable debug mode if #debug hash
  if (window.location.hash === "#debug") {
    app.debugMode = true;
  }
});
</script>

<template>
  <RouterView />
</template>
```

### 4.3 RibbonView.vue (Main View)

This will be the main view containing the 3D scene and all controls:

```vue
<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { useAppStore } from "../stores/appStore";
import { useThreeSetup } from "../composables/useThreeSetup";
import { useDrawing } from "../composables/useDrawing";
import { useGoogleAuth } from "../composables/useGoogleAuth";

import AppHeader from "../components/AppHeader.vue";
import BottomToolbar from "../components/BottomToolbar.vue";
import FinishDrawingButton from "../components/FinishDrawingButton.vue";
import TextInputPanel from "../components/TextInputPanel.vue";
import BetaModal from "../components/BetaModal.vue";
import TextureBrowser from "../components/TextureBrowser.vue";
import ThreeCanvas from "../components/ThreeCanvas.vue";
import DrawCanvas from "../components/DrawCanvas.vue";
import RendererIndicator from "../components/RendererIndicator.vue";

const app = useAppStore();
const { initThree, startRenderLoop, stopRenderLoop } = useThreeSetup();
const { initDrawing, setDrawingMode } = useDrawing();
const { initAuth, isAuthenticated, user } = useGoogleAuth();

onMounted(async () => {
  await initAuth();
  await initThree(app.rendererType);
  // ... initialization
});

onUnmounted(() => {
  stopRenderLoop();
});
</script>

<template>
  <div class="ribbon-view">
    <!-- Blurred background -->
    <div class="blurred-background" :style="backgroundStyle"></div>

    <!-- Renderer indicator (debug) -->
    <RendererIndicator v-if="app.debugMode" />

    <!-- Header with auth -->
    <AppHeader />

    <!-- Three.js canvas -->
    <ThreeCanvas ref="threeCanvas" />

    <!-- Drawing canvas overlay -->
    <DrawCanvas v-if="app.isDrawingMode" />

    <!-- Finish drawing button -->
    <FinishDrawingButton v-if="app.isDrawingMode" />

    <!-- Bottom toolbar -->
    <BottomToolbar />

    <!-- Modals -->
    <TextInputPanel v-model:visible="app.textPanelVisible" />
    <BetaModal v-model:visible="app.betaModalVisible" />
    <TextureBrowser v-model:visible="app.textureBrowserVisible" />
  </div>
</template>
```

---

## Phase 5: Create Composables

### 5.1 useThreeSetup.js

Extract Three.js initialization logic from `main.js`:

```javascript
import { ref, shallowRef } from "vue";
import { initThree as initThreeModule } from "../modules/threeSetup";
import { TileManager } from "../modules/tileManager";
import { useAppStore } from "../stores/appStore";

export function useThreeSetup() {
  const app = useAppStore();

  const scene = shallowRef(null);
  const camera = shallowRef(null);
  const renderer = shallowRef(null);
  const controls = shallowRef(null);
  const tileManager = shallowRef(null);

  let animationId = null;

  async function initThree(rendererType) {
    const ctx = await initThreeModule(rendererType);
    scene.value = ctx.scene;
    camera.value = ctx.camera;
    renderer.value = ctx.renderer;
    controls.value = ctx.controls;

    // Initialize tile manager
    tileManager.value = new TileManager({
      renderer: renderer.value,
      rendererType,
      rotate90: true,
      webgpuMaterialMode: "node",
    });
    await tileManager.value.loadAllTiles();

    return ctx;
  }

  function startRenderLoop() {
    // ... render loop logic
  }

  function stopRenderLoop() {
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
  }

  return {
    scene,
    camera,
    renderer,
    controls,
    tileManager,
    initThree,
    startRenderLoop,
    stopRenderLoop,
  };
}
```

### 5.2 useDrawing.js

```javascript
import { ref } from "vue";
import { DrawingManager } from "../modules/drawing";
import { useAppStore } from "../stores/appStore";

export function useDrawing(canvasRef) {
  const app = useAppStore();
  const drawingManager = ref(null);

  function initDrawing(canvas, onComplete, onStrokeChange) {
    drawingManager.value = new DrawingManager(
      canvas,
      onComplete,
      onStrokeChange,
    );
  }

  function setDrawingMode(enabled) {
    app.setDrawingMode(enabled);
    // Additional logic...
  }

  return {
    drawingManager,
    initDrawing,
    setDrawingMode,
  };
}
```

### 5.3 useGoogleAuth.js

Adapt from slyce's implementation, or create a rivvon-specific version:

```javascript
import { ref, computed } from "vue";
import {
  initAuth as initAuthModule,
  login,
  logout,
  onAuthStateChange,
} from "../modules/auth";

export function useGoogleAuth() {
  const user = ref(null);
  const isAuthenticated = computed(() => !!user.value);

  async function initAuth() {
    await initAuthModule();

    onAuthStateChange((authUser, authenticated) => {
      user.value = authenticated ? authUser : null;
    });
  }

  return {
    user,
    isAuthenticated,
    initAuth,
    login,
    logout,
  };
}
```

---

## Phase 6: Router Configuration

### 6.1 Create router/index.js

```javascript
import { createRouter, createWebHistory } from "vue-router";

const routes = [
  {
    path: "/",
    name: "home",
    component: () => import("../views/RibbonView.vue"),
  },
  {
    path: "/texture/:textureId",
    name: "texture",
    component: () => import("../views/RibbonView.vue"),
    props: true,
  },
  {
    path: "/callback",
    name: "callback",
    component: () => import("../views/CallbackView.vue"),
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
```

---

## Phase 7: Migrate Styles to Tailwind

### 7.1 Update style.css

```css
@import "tailwindcss";

/* Keep custom styles that can't be easily replaced with Tailwind */
/* Or gradually convert them to Tailwind utility classes */

/* Three.js canvas fullscreen */
#threeContainer canvas {
  @apply fixed inset-0 w-full h-full;
}

/* Blurred background */
.blurred-background {
  @apply fixed inset-0 bg-cover bg-center blur-3xl opacity-30;
  z-index: -1;
}

/* ... migrate other custom styles */
```

### 7.2 Convert Inline Styles

Replace manual CSS classes with Tailwind utilities in Vue templates:

```vue
<!-- Before (vanilla) -->
<button class="auth-btn login-btn">

<!-- After (Vue + Tailwind) -->
<button class="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors">
```

---

## Phase 8: Migration Execution Order

### Step-by-Step Implementation

1. **Week 1: Foundation**
   - [ ] Update `package.json` with Vue 3 dependencies
   - [ ] Create `vite.config.mjs` with Vue plugin
   - [ ] Set up Tailwind CSS
   - [ ] Create `App.vue` and `main.js` entry point
   - [ ] Update `index.html` for Vue mounting

2. **Week 2: State & Routing**
   - [ ] Create Pinia store (`appStore.js`)
   - [ ] Set up Vue Router with routes
   - [ ] Create `CallbackView.vue` for OAuth

3. **Week 3: Core Components**
   - [ ] Create `ThreeCanvas.vue` - Three.js integration
   - [ ] Create `DrawCanvas.vue` - Drawing overlay
   - [ ] Create `useThreeSetup.js` composable
   - [ ] Create `useDrawing.js` composable

4. **Week 4: UI Components**
   - [ ] Create `AppHeader.vue` with auth controls
   - [ ] Create `BottomToolbar.vue` with action buttons
   - [ ] Create `FinishDrawingButton.vue`
   - [ ] Create `TextInputPanel.vue`

5. **Week 5: Features**
   - [ ] Create `TextureBrowser.vue` component
   - [ ] Create `BetaModal.vue`
   - [ ] Create `useGoogleAuth.js` composable
   - [ ] Create `useTextures.js` composable

6. **Week 6: Integration & Polish**
   - [ ] Create `RibbonView.vue` main view
   - [ ] Migrate all styles to Tailwind
   - [ ] Test all functionality
   - [ ] Remove old vanilla JS code
   - [ ] Clean up unused files

---

## Phase 9: Files to Keep (Minimal Changes)

These modules are well-encapsulated and can remain largely unchanged:

| File                           | Changes Needed                  |
| ------------------------------ | ------------------------------- |
| `modules/ribbon.js`            | None - class-based, works as-is |
| `modules/ribbonSeries.js`      | None - class-based              |
| `modules/drawing.js`           | None - class-based              |
| `modules/tileManager.js`       | None - class-based              |
| `modules/textToSvg.js`         | None - class-based              |
| `modules/svgPathToPoints.js`   | None - pure functions           |
| `modules/textureService.js`    | None - API calls                |
| `modules/threeSetup.js`        | None - factory function         |
| `modules/threeSetup-webgl.js`  | None                            |
| `modules/threeSetup-webgpu.js` | None                            |
| `modules/iconLoader.js`        | None                            |
| `utils/renderer-utils.js`      | None                            |

## Phase 10: Files to Remove After Migration

After Vue 3 migration is complete, remove:

- [ ] `src/modules/domElements.js` - No longer needed
- [ ] `src/modules/textureBrowser.js` - Replaced by Vue component
- [ ] `src/modules/auth.js` - Replaced by composable (or keep as utility)
- [ ] Old `main.js` content - Replaced by Vue entry point

---

## Testing Checklist

- [ ] Three.js scene renders correctly
- [ ] Drawing mode works with multi-stroke support
- [ ] Ribbon creation from strokes works
- [ ] SVG import functionality works
- [ ] Text to SVG conversion works
- [ ] Texture loading from CDN works
- [ ] Texture switching works
- [ ] Flow animation toggle works
- [ ] Fullscreen toggle works
- [ ] Google OAuth login/logout works
- [ ] Deep linking to textures works (`/texture/:id`)
- [ ] Beta modal displays correctly
- [ ] Responsive layout on mobile
- [ ] WebGL and WebGPU renderers work

---

## Notes

- **Preserve Three.js Integration**: The Three.js modules are the core of rivvon's functionality. These should remain largely untouched, with Vue components wrapping them rather than rewriting them.

- **Incremental Migration**: Consider keeping the vanilla version running while building the Vue 3 version in a parallel `src-vue/` directory, then swap when ready.

- **Shared Code**: Consider extracting truly shared utilities (like `iconLoader.js`, `renderer-utils.js`) to the `packages/shared-types` or a new `packages/shared-utils` package.

- **PrimeVue Components**: Use PrimeVue for modals (`Dialog`), buttons (`Button`), tooltips (`Tooltip directive`), and form inputs where appropriate.
