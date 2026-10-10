# Scene presets

Browse → Presets contains My Presets and Public Presets. Save Current Ribbon captures
the scene and a thumbnail. Share → Share View URL saves an unlisted preset and
returns `/?preset=<id>`. Existing `?texture=`, text, and emoji links still load.

Version 1 captures source paths (including imported SVGs and drawn shapes),
procedural shape settings, ordered texture assignments, artwork settings,
camera position and orientation, cinematic views and recorded camera motion,
animation phases, published audio, and audio response settings. Renderer type,
pixel ratio, input mode, preferred texture resolution, wake lock, UI appearance,
microphone permission, and export preferences remain on the receiving device.
Audio loads paused; microphone access always requires the recipient's action.

Presets are immutable scenes. Metadata (name, description, visibility) can be
edited; saving changes to the artwork creates a new preset. Private presets
require the owner's session, unlisted presets are readable by anyone with their
link, and public presets also appear in Browse.

## Media references and deletion

Existing textures and audio are referenced by their library IDs. No media copies
are made. Local textures without a publication are uploaded once through the
existing texture uploader and then referenced; a browser cache records their
cloud IDs. The preset stores only JSON and its thumbnail in private R2 storage.

Reading a visible preset grants access to its registered media dependencies
through the API, including source media not separately listed publicly.
Derivative presets retain references to those same assets. Changing visibility
of the original media does not revoke existing preset links; deleting it does.
Drive-backed textures require their existing Drive files to remain readable.

Texture and audio deletion first lists linked presets. Cancel preserves both
media and presets. Confirming Delete Texture/Audio and Presets deletes the
reviewed presets and disables their links before removing the source media.
Deleting a texture family includes presets that reference its variants.
Dependencies are rechecked on the server; new links require renewed consent.
Database triggers prevent new references during deletion and roll back a
deletion transaction if additional dependencies appear after the check.
Other owners' private preset names are hidden in the dependency list.

Deleting a preset by itself removes its JSON, thumbnail, and dependency rows;
its source media stays in the library. Incomplete uploads stay out of Browse
and cannot be opened. Failed client uploads attempt to remove the pending preset.

## Deployment

The Worker configuration adds `PRESETS_BUCKET` pointing to `rivvon-presets`.
Before deploying this release:

1. Create that R2 bucket (`pnpm --filter api exec wrangler r2 bucket create rivvon-presets`).
   Keep r2.dev disabled and do not attach a public custom domain: preset reads
   must pass the API's access checks.
2. Apply D1 migration `012_scene_presets.sql` using the existing migration command:
   `pnpm --filter api db:migrations:apply:remote`.
3. Deploy the API, then the viewer. No new secrets are needed.

For local development use `db:migrations:apply:local`. API tests use Node's
built-in SQLite (Node 22.13+), the real schema and migration, and in-memory R2
fixtures to exercise permissions, reference reuse, cascade consent, family
deletion, and transaction races without touching production.

If a load or decode fails, restoration keeps the current ribbon and disposes
staged GPU assets. Animation settings resume on opening; camera playback and
audio playback require the recipient to press Play.
