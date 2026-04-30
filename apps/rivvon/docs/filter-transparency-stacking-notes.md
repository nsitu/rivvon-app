# Filter Transparency and Cap Stacking Notes

## Context

When the black and white render filter is enabled, cap regions with SDF-based alpha can show two classes of artifacts:

1. Dark fill where transparent cap pixels should reveal scene/background.
2. Subtle depth ordering errors where low-alpha cap pixels mask nearby geometry.

These issues are most visible on rounded and swallowtail caps because they rely on smooth alpha transitions.

## Root Causes

1. Cap materials are designed for the normal path with alpha-to-coverage and non-transparent materials.
2. Post-processing passes sample offscreen render targets where alpha-to-coverage semantics do not always map cleanly to expected transparent compositing.
3. Premultiplied-alpha handling in the filter pass can darken edge pixels if luminance is computed directly from premultiplied RGB.
4. Depth writes from low-alpha cap pixels can still occlude nearby geometry, causing angle-dependent stacking artifacts.

## Resolution Strategy

### 1) Keep filter math alpha-safe

In apps/rivvon/src/composables/viewer/useRenderFilter.js:

1. Render to filter target with transparent clear color.
2. Explicitly clear the render target before drawing.
3. In filter shaders, compute luminance in unpremultiplied color space, then premultiply the filtered result by alpha.

This preserves transparency and avoids dark halos/fills.

### 2) Override cap material behavior only during the filter pass

In apps/rivvon/src/composables/viewer/useRenderFilter.js:

1. Traverse scene materials and target only materials marked with \_hasCapMask.
2. Temporarily switch those materials to filter-friendly settings:
   - transparent = true
   - alphaToCoverage = false
   - depthTest = true
   - depthWrite = true
   - alphaTest >= 0.05
3. Restore every overridden flag after the pass (including alphaTest).

Using alphaTest in this temporary path prevents very low-alpha cap pixels from writing depth and masking nearby geometry.

## Why this avoids conflicts

1. The normal renderer path keeps its original cap behavior and quality tuning.
2. Filter-specific behavior is scoped to the offscreen pass and fully restored each frame.
3. This reduces risk of regressions in non-filter rendering while fixing post-process transparency and stacking issues.

## Guardrails for future work

1. If adding new filters, preserve the same cap override and restore pattern for \_hasCapMask materials.
2. Keep the override restoration in a finally block so state is restored even on render errors.
3. Do not rely on alpha-to-coverage for post-process transparency correctness.
4. If depth artifacts reappear, tune alphaTest first (typical range 0.03 to 0.08).
5. Verify both WebGL and WebGPU paths after any filter shader or material-state change.

## Debug checklist

1. Toggle black and white filter on/off while orbiting around cap edges.
2. Check rounded and swallowtail caps specifically.
3. Confirm no dark fill in transparent cap regions.
4. Confirm no viewpoint-dependent masking of nearby geometry by transparent cap pixels.
5. Confirm behavior matches in WebGL and WebGPU.
