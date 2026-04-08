# Head Tracking MediaPipe Patch

## Overview

Rivvon uses `@mediapipe/tasks-vision` for face landmark detection in head tracking. The library works correctly, but its generated wasm loaders emit several native diagnostics through `console.warn` / `console.error` style paths even when nothing is actually wrong.

Those messages made the browser console look unhealthy during normal operation, especially because some of them included stack traces and `gl_context.cc` / `face_landmarker_graph.cc` prefixes that read like real faults.

The current patch keeps those messages visible, but downgrades a small set of known-benign diagnostics to ordinary `console.log` output.

## Why This Exists

We evaluated three approaches:

1. Do nothing.
2. Rebuild MediaPipe from source.
3. Patch the published npm package for one known version.

Option 2 is technically possible because MediaPipe's web tasks bundle is generated upstream, but it would effectively mean maintaining a custom MediaPipe build workflow just to change logging behavior. That is too much maintenance for this repo.

Option 3 is the chosen approach. The tradeoff is explicit: the patch is version-pinned, and when `@mediapipe/tasks-vision` changes, this patch must be revisited.

## Current Behavior

The patch downgrades these known-benign MediaPipe diagnostics to normal log output:

- `Created TensorFlow Lite XNNPACK delegate for CPU.`
- `Graph successfully started running.`
- `Graph finished closing successfully.`
- `OpenGL error checking is disabled.`
- `gl_context.cc:`
- `Sets FaceBlendshapesGraph acceleration to xnnpack by default.`

This is intentionally narrow. We are not trying to hide arbitrary MediaPipe warnings or errors.

## Files Involved

These files work together:

- `apps/rivvon/package.json`
  - Declares the frontend dependency version.
- `package.json`
  - Registers the pnpm `patchedDependencies` entry.
- `patches/@mediapipe__tasks-vision@0.10.34.patch`
  - Stores the actual generated patch artifact.
- `apps/rivvon/vite.config.mjs`
  - Copies MediaPipe wasm assets into the local build output.
- `apps/rivvon/src/modules/viewer/headTracking/faceLandmarkerDetector.js`
  - Points MediaPipe to the local copied wasm root instead of the CDN.

The local asset copy matters. If the app loads MediaPipe wasm from the CDN, the patch in `node_modules` has no effect in the browser.

## Current Version Examples

The examples below are taken from the current `0.10.34` implementation. They are meant to show the _kind_ of changes we made, not to serve as stable line-by-line references for future versions.

### 1. Root pnpm patch registration

The root workspace manifest explicitly pins the patch to one library version:

```json
{
  "pnpm": {
    "patchedDependencies": {
      "@mediapipe/tasks-vision@0.10.34": "patches/@mediapipe__tasks-vision@0.10.34.patch"
    }
  }
}
```

This is what makes the maintenance contract explicit. If the dependency version changes, this entry must change too.

### 2. Local wasm asset copy in Vite

We do not let the browser fetch MediaPipe wasm from a CDN. Instead, Vite copies the package's wasm assets into the app build:

```javascript
const TASKS_VISION_VERSION = "0.10.34";
const TASKS_VISION_WASM_SOURCE = normalizePath(
  resolve(__dirname, "node_modules/@mediapipe/tasks-vision/wasm/*"),
);
const TASKS_VISION_WASM_DEST = `vendor/mediapipe/tasks-vision/${TASKS_VISION_VERSION}/wasm`;

viteStaticCopy({
  targets: [
    {
      src: TASKS_VISION_WASM_SOURCE,
      dest: TASKS_VISION_WASM_DEST,
    },
  ],
});
```

Without this step, the patch would exist in the workspace but would not affect browser runtime behavior.

### 3. Face landmarker points at the local wasm root

The head-tracking detector is wired to use the copied local assets:

```javascript
const TASKS_VISION_VERSION = "0.10.34";
const TASKS_VISION_WASM_ROOT = `/vendor/mediapipe/tasks-vision/${TASKS_VISION_VERSION}/wasm`;

async function loadVisionRuntime() {
  if (!visionRuntimePromise) {
    visionRuntimePromise = loadTasksVisionModule().then(({ FilesetResolver }) =>
      FilesetResolver.forVisionTasks(TASKS_VISION_WASM_ROOT),
    );
  }

  return visionRuntimePromise;
}
```

This is the app-side half of the patch strategy.

### 4. Generated loader helper that downgrades benign diagnostics

Inside the generated MediaPipe loader files, the patch adds a small helper that reroutes selected messages to ordinary log output:

```javascript
function emitMediapipeDiagnostic(logger, text) {
  if (shouldDowngradeMediapipeDiagnostic(text)) {
    out(text);
    return;
  }

  logger(text);
}

function shouldDowngradeMediapipeDiagnostic(text) {
  if (typeof text !== "string") {
    return false;
  }

  return (
    text.indexOf("Created TensorFlow Lite XNNPACK delegate for CPU.") !== -1 ||
    text.indexOf("Graph successfully started running.") !== -1 ||
    text.indexOf("Graph finished closing successfully.") !== -1 ||
    text.indexOf("OpenGL error checking is disabled.") !== -1 ||
    text.indexOf("gl_context.cc:") !== -1 ||
    text.indexOf(
      "Sets FaceBlendshapesGraph acceleration to xnnpack by default.",
    ) !== -1
  );
}
```

This is the core behavior change in the current version.

### 5. Example of a patched debug hook

One of the generated logging paths is `custom_emscripten_dbgn(...)`. In the current patch, it now looks conceptually like this:

```javascript
function custom_emscripten_dbgn(str, len) {
  const text = UTF8ToString(str, len);
  if (shouldDowngradeMediapipeDiagnostic(text)) {
    out(text);
    return;
  }

  if (typeof dbg !== "undefined") {
    dbg(text);
  } else {
    if (typeof custom_dbg === "undefined") {
      function custom_dbg(text) {
        console.warn.apply(console, arguments);
      }
    }
    custom_dbg(text);
  }
}
```

This keeps the known-benign MediaPipe lines visible while preventing them from looking like actionable warnings.

### 6. Example of patched tty / direct output paths

The debug hook alone was not enough. Some messages were emitted through tty and direct Emscripten output paths, so those were patched too:

```javascript
var _emscripten_errn = (str, len) => emitMediapipeDiagnostic(err, UTF8ToString(str, len));
var _emscripten_outn = (str, len) => emitMediapipeDiagnostic(out, UTF8ToString(str, len));

put_char(tty, val) {
  if (val === null || val === 10) {
    emitMediapipeDiagnostic(err, UTF8ArrayToString(tty.output));
    tty.output = [];
  } else {
    if (val != 0) tty.output.push(val);
  }
}
```

That broader routing is why the current patch catches the log spam reliably.

## Diff Appendix

This appendix shows shortened before/after diffs for the main changes in the current version. These are representative hunks, not the full patch.

### A. Root workspace registers a version-pinned patch

```diff
diff --git a/package.json b/package.json
@@
   "devDependencies": {
     "turbo": "^2.3.0"
   },
+  "pnpm": {
+    "patchedDependencies": {
+      "@mediapipe/tasks-vision@0.10.34": "patches/@mediapipe__tasks-vision@0.10.34.patch"
+    }
+  }
 }
```

This is the root switch that tells pnpm to apply the generated patch file for this exact library version.

### B. Vite copies MediaPipe wasm into local build output

```diff
diff --git a/apps/rivvon/vite.config.mjs b/apps/rivvon/vite.config.mjs
@@
-import { defineConfig } from 'vite';
+import { defineConfig, normalizePath } from 'vite';
 import vue from '@vitejs/plugin-vue';
 import vueDevTools from 'vite-plugin-vue-devtools';
 import tailwindcss from '@tailwindcss/vite';
+import { viteStaticCopy } from 'vite-plugin-static-copy';
 import { resolve } from 'path';

+const TASKS_VISION_VERSION = '0.10.34';
+const TASKS_VISION_WASM_SOURCE = normalizePath(resolve(__dirname, 'node_modules/@mediapipe/tasks-vision/wasm/*'));
+const TASKS_VISION_WASM_DEST = `vendor/mediapipe/tasks-vision/${TASKS_VISION_VERSION}/wasm`;
@@
   plugins: [
+    viteStaticCopy({
+      targets: [
+        {
+          src: TASKS_VISION_WASM_SOURCE,
+          dest: TASKS_VISION_WASM_DEST,
+        },
+      ],
+    }),
     tailwindcss(),
     vue(),
```

This is what makes the patched package assets available to the browser during dev and build.

### C. Head tracking stops using a CDN wasm root

```diff
diff --git a/apps/rivvon/src/modules/viewer/headTracking/faceLandmarkerDetector.js b/apps/rivvon/src/modules/viewer/headTracking/faceLandmarkerDetector.js
@@
+const TASKS_VISION_VERSION = '0.10.34';
+const TASKS_VISION_WASM_ROOT = `/vendor/mediapipe/tasks-vision/${TASKS_VISION_VERSION}/wasm`;
 const FACE_LANDMARKER_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
@@
 async function loadVisionRuntime() {
   if (!visionRuntimePromise) {
-    visionRuntimePromise = loadTasksVisionModule().then(({ FilesetResolver }) => FilesetResolver.forVisionTasks(/* remote wasm root */));
+    visionRuntimePromise = loadTasksVisionModule().then(({ FilesetResolver }) => (
+      FilesetResolver.forVisionTasks(TASKS_VISION_WASM_ROOT)
+    ));
   }
```

The important change is not the exact syntax. The important change is that MediaPipe is resolved from the app's own local asset path instead of a remote package CDN.

### D. Generated loader adds a downgrade helper

```diff
diff --git a/wasm/vision_wasm_internal.js b/wasm/vision_wasm_internal.js
@@
 var out = console.log.bind(console);
 var err = console.error.bind(console);

+function emitMediapipeDiagnostic(logger, text) {
+  if (shouldDowngradeMediapipeDiagnostic(text)) {
+    out(text);
+    return;
+  }
+
+  logger(text);
+}
@@
+function shouldDowngradeMediapipeDiagnostic(text) {
+  if (typeof text !== "string") {
+    return false;
+  }
+
+  return text.indexOf("Created TensorFlow Lite XNNPACK delegate for CPU.") !== -1
+    || text.indexOf("Graph successfully started running.") !== -1
+    || text.indexOf("Graph finished closing successfully.") !== -1
+    || text.indexOf("OpenGL error checking is disabled.") !== -1
+    || text.indexOf("gl_context.cc:") !== -1
+    || text.indexOf("Sets FaceBlendshapesGraph acceleration to xnnpack by default.") !== -1;
+}
```

This hunk is the key runtime behavior change: known-benign diagnostics are downgraded to ordinary log output.

### E. The debug hook is patched to stop surfacing benign lines as warnings

```diff
diff --git a/wasm/vision_wasm_internal.js b/wasm/vision_wasm_internal.js
@@
 function custom_emscripten_dbgn(str, len) {
+  const text = UTF8ToString(str, len);
+  if (shouldDowngradeMediapipeDiagnostic(text)) {
+    out(text);
+    return;
+  }
+
   if (typeof (dbg) !== "undefined") {
-    dbg(UTF8ToString(str, len));
+    dbg(text);
   } else {
     if (typeof (custom_dbg) === "undefined") {
       function custom_dbg(text) {
         console.warn.apply(console, arguments);
       }
     }
-    custom_dbg(UTF8ToString(str, len));
+    custom_dbg(text);
   }
 }
```

This was the first major interception point we patched.

### F. TTY and direct output paths are patched too

```diff
diff --git a/wasm/vision_wasm_internal.js b/wasm/vision_wasm_internal.js
@@
-var _emscripten_errn = (str, len) => err(UTF8ToString(str, len));
-var _emscripten_outn = (str, len) => out(UTF8ToString(str, len));
+var _emscripten_errn = (str, len) => emitMediapipeDiagnostic(err, UTF8ToString(str, len));
+var _emscripten_outn = (str, len) => emitMediapipeDiagnostic(out, UTF8ToString(str, len));
@@
   put_char(tty, val) {
     if (val === null || val === 10) {
-      err(UTF8ArrayToString(tty.output));
+      emitMediapipeDiagnostic(err, UTF8ArrayToString(tty.output));
       tty.output = [];
     } else {
       if (val != 0) tty.output.push(val);
     }
   }
```

This second wave of changes is why the patch now catches the remaining native lines that did not go through `custom_emscripten_dbgn(...)`.

## What The Patch Changes

The patch edits the generated loader files inside the package's `wasm/` directory:

- `vision_wasm_internal.js`
- `vision_wasm_module_internal.js`
- `vision_wasm_nosimd_internal.js`

In those files, the patch routes multiple native logging paths through a shared helper:

- `custom_emscripten_dbgn(...)`
- `default_tty_ops.put_char(...)`
- `default_tty_ops.fsync(...)`
- `default_tty1_ops.put_char(...)`
- `default_tty1_ops.fsync(...)`
- `_emscripten_outn(...)`
- `_emscripten_errn(...)`

The helper downgrades only the selected known-benign messages to `console.log`.

## Important Boundary

This patch only changes MediaPipe's generated runtime logging.

It does **not** change app-owned warnings such as the GPU initialization fallback warning in `faceLandmarkerDetector.js`. That warning is still useful because it describes a real runtime fallback in Rivvon code.

## How The Patch Was Created

Do not hand-write this patch file.

An earlier manual patch attempt failed because pnpm expects a valid generated patch format. The reliable workflow is pnpm's native patch flow:

```powershell
pnpm patch @mediapipe/tasks-vision@0.10.34 --ignore-existing --edit-dir .pnpm-patch/tasks-vision
```

Edit the extracted package contents under:

```text
.pnpm-patch/tasks-vision/wasm/
```

Then generate the checked-in patch:

```powershell
pnpm patch-commit .pnpm-patch/tasks-vision --patches-dir patches
```

Reinstall so the workspace consumes the new patch:

```powershell
pnpm install
```

## Upgrade Workflow For A Future Version Bump

When upgrading `@mediapipe/tasks-vision`, use this process:

1. Update the dependency version in `apps/rivvon/package.json`.
2. Update the versioned patch reference in the root `package.json`.
3. Update the version constant in `apps/rivvon/src/modules/viewer/headTracking/faceLandmarkerDetector.js`.
4. Update the version constant in `apps/rivvon/vite.config.mjs`.
5. Run `pnpm install`.
6. Extract the new package with pnpm patch.
7. Reapply the same logging changes to all three generated loader files.
8. Commit the regenerated patch with `pnpm patch-commit`.
9. Run `pnpm install` again.
10. Build and test the frontend.

Suggested commands:

```powershell
pnpm install
pnpm patch @mediapipe/tasks-vision@NEW_VERSION --ignore-existing --edit-dir .pnpm-patch/tasks-vision
pnpm patch-commit .pnpm-patch/tasks-vision --patches-dir patches
pnpm install
pnpm --filter rivvon build
```

After that, manually verify head tracking in the browser.

## What To Verify After An Update

Check all of the following:

- Head tracking still initializes on the happy path.
- GPU-first startup still works, with CPU fallback still functional if GPU init fails.
- The browser loads MediaPipe from `/vendor/mediapipe/tasks-vision/<version>/wasm` rather than a CDN URL.
- The known benign MediaPipe diagnostics appear as ordinary logs, not warnings or errors.
- Unexpected warnings and real errors still surface normally.

## Failure Modes To Watch For

- The patch stops applying after a version bump because the generated files changed.
- The app points back to a CDN wasm root, which bypasses the patch entirely.
- MediaPipe moves logging behavior to a different generated function, which means the helper must be re-threaded through new paths.
- Upstream changes the wording of the benign messages, in which case the downgrade list needs to be updated.

## Practical Rule

Keep this patch as small and explicit as possible.

If a new MediaPipe line appears and it is clearly harmless, add that exact message to the downgrade list. If a message is ambiguous or actually indicates degraded behavior, leave it alone.
