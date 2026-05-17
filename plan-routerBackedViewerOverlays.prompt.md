## Plan: Router-Backed Viewer Overlays

Adopt a hybrid navigation model: use Vue Router as the source of truth for durable, page-like overlay surfaces while keeping Pinia as the source of truth for ephemeral viewer UI state and shared rendering state. Start with an About pilot that keeps the viewer mounted as the backdrop, preserves the current translucent panel presentation, and makes `/about` a stable deep link whose close action participates in browser history.

**Steps**
1. Phase 1 — Define the routing boundary and shell contract.
   Decide which surfaces are route-first versus store-first. Route-first surfaces are addressable, shareable, and back-button-aware (`about`, likely later `texture browser`, `create texture`, `drawings`). Store-first surfaces remain ephemeral (`tools`, `text`, `emoji`, `contour`, transient toggles). Document one invariant: the viewer stays mounted underneath routed overlays unless the route is explicitly outside the viewer shell.
2. Phase 2 — Introduce a persistent viewer shell layout. *depends on 1*
   Refactor the router so the Three.js viewer no longer lives only inside the current top-level `RibbonView` route. Move to a layout where the viewer shell remains mounted and routed overlay content changes above it. The cleanest target is a dedicated shell route/layout component with nested routes for overlay pages. Keep non-viewer flows like OAuth callback outside that shell. Evaluate whether `LocalTexturesView` stays outside the shell for now or becomes a later migration.
3. Phase 3 — Stabilize viewer lifecycle under persistent mounting. *depends on 2*
   Audit current mount/unmount assumptions in `RibbonView` and `ThreeCanvas`. Ensure the render loop, global listeners, and explicit teardown behavior are correct once the viewer remains mounted across route changes. Preserve the existing ability to release resources deliberately without relying on route unmount side effects.
4. Phase 4 — Pilot About as the first route-backed overlay. *depends on 2 and 3*
   Add a stable `/about` route inside the viewer shell. Keep the existing `AboutPanel` visual treatment, but derive its open/close behavior from route presence rather than only from a store boolean. Toolbar open should `router.push('/about')`; close should navigate back when the route created the overlay. Direct loads and refresh on `/about` should keep the URL and restore the panel.
5. Phase 5 — Add a reusable route-to-panel bridge. *depends on 4*
   Extract a small routing helper/composable for page-like overlays so each candidate surface does not reimplement the same open/close/history logic. The bridge should let routed overlays continue using existing panel components and most existing store actions while progressively moving durable visibility ownership to the router.
6. Phase 6 — Reclassify existing query-trigger routes. *depends on 5*
   Review current one-shot query patterns in `RibbonView` (`slyce`, `textures`, `realtime`, `local`) and separate them into two categories: durable route state versus one-time launch parameters. Preserve query params for true load-time modifiers and presets, but promote page-like destinations to named routes so they can be bookmarked without self-clearing.
7. Phase 7 — Expand the pattern selectively. *parallel after 5, separate follow-up PRs recommended*
   Apply the About pattern next to `Texture Browser`, `Create Texture / Slyce`, and `Drawings`, in that order unless implementation complexity suggests otherwise. Each migration should keep the viewer visible, preserve existing panel styling, and define explicit close/back behavior before changing code.
8. Phase 8 — Clean up ownership and naming. *depends on at least one successful pilot*
   Once at least one route-backed overlay is stable, tighten terminology and ownership: reserve “page” for router-owned durable destinations and “panel” for visual presentation. Keep the translucent panel look even when the architecture treats the surface as a routed page.

**Relevant files**
- `d:\rivvon-app\apps\rivvon\src\App.vue` — current top-level `RouterView` placement; likely entry point for introducing a persistent viewer shell.
- `d:\rivvon-app\apps\rivvon\src\router\index.js` — current route table, existing redirect/query-entry patterns, and the main refactor point for nested viewer-shell routes.
- `d:\rivvon-app\apps\rivvon\src\views\RibbonView.vue` — current viewer orchestration, query-param watchers, overlay visibility logic, and the main source of route/store bridging behavior.
- `d:\rivvon-app\apps\rivvon\src\components\viewer\ThreeCanvas.vue` — render-loop and unmount behavior that must remain correct when the viewer persists across route changes.
- `d:\rivvon-app\apps\rivvon\src\composables\viewer\useThreeSetup.js` — explicit viewer teardown and recovery behavior that should remain deliberate rather than route-coupled.
- `d:\rivvon-app\apps\rivvon\src\stores\viewerStore.js` — panel visibility actions to retain for ephemeral UI and to adapt during router-backed migration.
- `d:\rivvon-app\apps\rivvon\src\modules\viewer\viewerPanels.js` — current panel registry; useful for separating route-first versus store-first surfaces.
- `d:\rivvon-app\apps\rivvon\src\modules\viewer\viewerHeaderContext.js` — active-context and close-handler logic that should be made route-aware for routed overlays.
- `d:\rivvon-app\apps\rivvon\src\components\viewer\BottomToolbar.vue` — open actions that should move from direct store mutation to named-route navigation for route-backed surfaces.
- `d:\rivvon-app\apps\rivvon\src\components\viewer\AppHeader.vue` — close behavior and title context that should align with route-owned overlay state.
- `d:\rivvon-app\apps\rivvon\src\components\viewer\AboutPanel.vue` — pilot surface; preserve visuals while changing navigation ownership.
- `d:\rivvon-app\apps\rivvon\src\views\LocalTexturesView.vue` — current example of a route outside the viewer overlay model; useful when defining the shell boundary.
- `d:\rivvon-app\apps\rivvon\src\views\ViewerShellLayout.vue` — new shell/layout component to introduce if nested routing is chosen.
- `d:\rivvon-app\apps\rivvon\src\composables\viewer\useViewerRouteState.js` — new routing helper/composable to centralize route-backed overlay behavior.

**Verification**
1. Direct navigation to `/about` mounts the app with the viewer visible underneath and the About surface open.
2. Refresh on `/about` preserves both the URL and the open About surface.
3. Opening About from the toolbar updates the URL to `/about` without reinitializing or duplicating the viewer canvas.
4. Closing About from its UI returns to the previous viewer route via router history, not just a store toggle.
5. Existing viewer-only routes such as `/` and `/texture/:textureId` still behave correctly.
6. Existing one-shot query entrypoints continue to work until they are explicitly migrated, especially `/slyce`, `/realtime`, and `?textures=` flows.
7. Moving between routed overlays does not leak canvases, duplicate render loops, or leave stale global listeners attached.
8. Non-viewer routes such as `/callback` still bypass the viewer shell cleanly.

**Decisions**
- Use Vue Router as the source of truth for durable, conceptually page-like overlay surfaces.
- Keep Pinia store ownership for ephemeral viewer controls and shared viewer/render state.
- Pilot with `About` first.
- `/about` should remain a stable URL on load, refresh, and share.
- Close/back behavior for routed overlays should participate in browser history.
- Likely next migrations after the pilot: `Texture Browser`, `Create Texture / Slyce`, and `Drawings`.
- Included in this plan: architecture direction, About pilot path, and selective rollout strategy.
- Excluded for now: converting all existing panels, redesigning panel visuals, changing SEO strategy, or moving every current query parameter into path routing.

**Further Considerations**
1. Prefer nested viewer-shell routes over a lighter redirect-to-query approach. The redirect approach matches current code but cannot preserve stable URLs or proper back-button semantics.
2. Treat route-backed overlays as a navigation layer, not as a visual redesign. The translucent panel look can remain unchanged while ownership moves to the router.
3. Consider leaving `LocalTexturesView` outside the persistent shell in the first pass unless there is a strong product reason to make it part of the backdrop model; it is currently a true standalone page rather than an overlay.
