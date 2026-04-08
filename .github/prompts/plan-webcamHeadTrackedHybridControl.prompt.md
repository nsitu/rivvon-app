## Plan: Webcam Head-Tracked Camera Control Mode

Implement a selectable viewer control mode that lazily loads MediaPipe face landmarking and lets the user choose between OrbitControls and Head Tracking from a toolbar menu select dropdown. In Head Tracking mode, only the camera moves: yaw, pitch, and roll map to camera pan, tilt, and roll plus orbit or tumble offsets around the active target, while the relative scale of the detected face drives camera dolly in or out as a zoom effect. Keep the two control modes mutually exclusive, suspend head tracking whenever realtime webcam capture or cinematic playback owns the interaction, and avoid ribbon transforms so the behavior stays directly analogous to OrbitControls.

**Steps**

1. Phase 1 — Define control contract and state
   - Extend viewer store with control-mode state: selected mode (`orbit` or `headTracking`), supported, active, calibrating, status or error message, suspended reason, and recenter action.
   - Lock the v1 mapping: capture a baseline camera pose and target when Head Tracking is enabled or re-centered. Yaw and pitch drive orbit or tumble offsets around that target plus the corresponding pan and tilt of the view, roll maps to camera roll around the forward axis, and face scale relative to a calibrated neutral pose drives camera dolly distance. Use conservative clamp ranges, dead zones, and smoothing to prevent nausea. OrbitControls must be disabled whenever Head Tracking mode is active.
   - Treat this as a viewer-only interaction. Head Tracking mode is mutually exclusive with realtime webcam texture capture, draw or walk capture, cinematic playback, and scene export. Switching back to OrbitControls should release the webcam and restore the baseline manual camera state.
2. Phase 2 — Add UI entry points and mode arbitration
   - Add a Viewer Controls select dropdown to the toolbar tools menu with `OrbitControls` and `Head Tracking` options. When `Head Tracking` is selected, show re-center and status UI nearby. Entering this mode should snapshot the current OrbitControls camera pose and target as the baseline for head-tracked motion. Add any required Material Symbols in main.js.
   - In RibbonView, orchestrate conflicts with existing modes using the already-imported realtime composable: if realtime camera is active, block the switch to Head Tracking or force the selector back to OrbitControls; if Head Tracking is active and the user enters realtime, cinematic, draw, walk, or export flows, switch away from Head Tracking first.
   - Surface permission-denied and unsupported-browser states without blocking the rest of the viewer.
3. Phase 3 — Build the tracking pipeline
   - Add a viewer-side composable plus non-reactive modules modeled after the inspiration repo split: stream manager, landmark detector, pose estimator, and control adapter.
   - Use @mediapipe/tasks-vision FaceLandmarker via dynamic import. Load WASM and model assets lazily on first enable; prefer CDN-hosted assets in v1 to avoid adding new binary assets to the repo.
   - Acquire the front camera only while `Head Tracking` is the selected control mode. Auto-calibrate a neutral pose after the first stable landmarks arrive and expose an explicit re-center action. Capture both neutral orientation and neutral face scale so the orbit and dolly effects have a stable baseline.
   - Estimate yaw, pitch, roll, and face scale from stable face landmarks and smooth them with existing filtering patterns such as the existing Kalman helpers or equivalent exponential smoothing. Feed these values into a control adapter that outputs camera position and orientation deltas relative to the saved baseline target and distance. Apply mirroring so the camera response feels like a mirror rather than a remote camera.
4. Phase 4 — Integrate with the Three.js viewer
   - Initialize and dispose the head-tracking subsystem from useThreeSetup and expose it through ThreeCanvas alongside the existing cinematic camera API and control-mode selection state.
   - Update useRenderLoop so the head-tracking tick runs instead of OrbitControls.update() when `Head Tracking` is selected. OrbitControls should only update when the selected mode is `OrbitControls`.
   - Preserve and reuse the current OrbitControls target as the head-tracking orbit pivot, with a custom camera controller that can orbit, roll, and dolly the camera without mutating scene objects.
   - Apply camera-only transforms each frame: yaw and pitch produce orbit or tumble offsets around the pivot plus matching pan and tilt, roll rotates the camera around its forward axis, and normalized face scale drives camera dolly closer or further along the viewing axis relative to the calibrated baseline. Do not transform the ribbon or other scene objects in this mode.
5. Phase 5 — Lifecycle, recovery, and verification
   - Tie tracker pause or resume into the existing visibility-change and viewer teardown or reinitialize lifecycle so camera tracks and landmarker instances are released cleanly on tab hide, device loss recovery, and unmount.
   - Ensure control-mode switches restore state cleanly: leaving Head Tracking should restore the baseline camera pose, clear temporary roll and dolly offsets, re-enable OrbitControls, and release the webcam if it is no longer needed. Cinematic playback should force `OrbitControls` mode before playback starts.
   - Verify with pnpm --filter rivvon build plus manual checks for mode selection, calibration, camera-only mirrored motion, smooth dolly zoom, realtime-camera conflict, draw or walk conflict, cinematic conflict, and graceful fallback on unsupported browsers or denied camera access.

**Relevant files**

- d:\rivvon-app\plans.md — existing product note for webcam-driven control
- d:\rivvon-app\apps\rivvon\package.json — add MediaPipe dependency if not loaded from a CDN-only flow
- d:\rivvon-app\apps\rivvon\src\main.js — register any new toolbar icons
- d:\rivvon-app\apps\rivvon\src\stores\viewerStore.js — control-mode state, head-tracking status, actions, and getters
- d:\rivvon-app\apps\rivvon\src\views\RibbonView.vue — control-mode switching and interaction conflict orchestration
- d:\rivvon-app\apps\rivvon\src\components\viewer\BottomToolbar.vue — toolbar menu select dropdown plus re-center and status UI
- d:\rivvon-app\apps\rivvon\src\components\viewer\ThreeCanvas.vue — expose the head-tracking controller to the view layer
- d:\rivvon-app\apps\rivvon\src\composables\viewer\useThreeSetup.js — create or dispose the subsystem, wire context, and store the active control mode
- d:\rivvon-app\apps\rivvon\src\composables\viewer\useRenderLoop.js — branch between orbit updates and head-tracking updates each frame
- d:\rivvon-app\apps\rivvon\src\composables\viewer\useCinematicCamera.js — suspend or resume coordination points
- d:\rivvon-app\apps\rivvon\src\modules\viewer\threeSetup-webgl.js — current OrbitControls baseline
- d:\rivvon-app\apps\rivvon\src\modules\viewer\threeSetup-webgpu.js — current OrbitControls baseline
- d:\rivvon-app\apps\rivvon\src\modules\viewer\cinematicCamera.js — reference for camera target, pose interpolation, and view-state conventions
- d:\rivvon-app\apps\rivvon\src\modules\viewer\kalmanFilter.js — reuse smoothing pattern for pose data
- d:\rivvon-app\apps\rivvon\src\composables\slyce\useRealtimeSlyce.js — existing camera ownership state used for mutual exclusion

**Verification**

1. Run pnpm --filter rivvon build from d:\rivvon-app.
2. In desktop Chrome or Edge on localhost or HTTPS, select `Head Tracking` from the toolbar dropdown, grant permission, wait for neutral calibration, and confirm mirrored yaw, pitch, and roll move only the camera, producing orbit, tumble, pan, tilt, and roll behavior around a stable target while moving closer or further from the webcam produces smooth dolly zoom without large jumps.
3. Switch the dropdown back to `OrbitControls` and confirm the webcam stops, the camera returns to its baseline manual state, and manual orbit resumes normally.
4. Start realtime webcam capture and confirm Head Tracking is unavailable or the selector automatically reverts while the realtime camera is active.
5. Toggle cinematic playback, draw mode, and walk mode while `Head Tracking` is selected and confirm the viewer exits that mode cleanly and restores default camera behavior.
6. Deny camera permission and confirm the tools panel reports the failure without breaking OrbitControls or the rest of the viewer.
7. Reload or trigger viewer reinitialization and confirm camera tracks stop and restart cleanly without orphaned webcam indicators.

**Decisions**

- Use an either-or control mode selector instead of letting Head Tracking coexist with OrbitControls.
- Map yaw, pitch, and roll to camera pan, tilt, roll, and orbit or tumble relative to the active target, and map face scale to camera dolly zoom.
- Do not apply transforms to the ribbon or other scene objects in v1.
- Treat head tracking as a viewer-only interaction and do not record live pose into cinematic timelines or export videos in v1.
- Prefer lazy-loaded FaceLandmarker over legacy FaceMesh wiring because it matches the inspiration architecture and keeps startup cost isolated.
- Keep realtime webcam texture capture and head tracking mutually exclusive instead of building a shared camera broker in this phase.
