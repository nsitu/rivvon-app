# Copilot Instructions — Rivvon App Monorepo

## Architecture Overview

This is a **pnpm + Turborepo monorepo** with two apps:

| Path           | What                                                               | Runtime                     | Language                   |
| -------------- | ------------------------------------------------------------------ | --------------------------- | -------------------------- |
| `apps/rivvon/` | Vue 3 SPA — 3D texture viewer (Three.js) + texture encoder (Slyce) | Vite dev / Cloudflare Pages | JavaScript (`.js`, `.vue`) |
| `apps/api/`    | Hono REST API on Cloudflare Workers                                | `wrangler dev`              | TypeScript                 |

`packages/shared-types/` contains shared TS type definitions but is lightly used.

The frontend is a **unified Vue 3 SPA** with two integrated features: the **Viewer** (renders 3D textured ribbons via Three.js) and **Slyce** (encodes video cross-sections into KTX2 texture arrays). Slyce was previously a separate app and has been rolled into Rivvon. Code is separated by domain: `components/{viewer,slyce}`, `composables/{viewer,slyce,shared}`, `modules/{viewer,slyce,shared}`.

## Key Data Flow

1. **Slyce** (within the Rivvon SPA) processes a user's video → produces KTX2 tiles via Basis Universal WASM workers (lazy-loaded only when the Slyce feature is used — see `load_basis.js`)
2. Tiles are uploaded to **Google Drive** (user's own storage, default) or **Cloudflare R2** (admin-only option). Non-authenticated users can save textures to **IndexedDB** locally via `services/localStorage.js`
3. Tile metadata is registered with the **API** → stored in **Cloudflare D1** (SQLite)
4. Thumbnails always go to **R2** (`cdn.rivvon.ca`)
5. **Viewer** fetches texture metadata from API, loads KTX2 tiles, renders animated ribbons on a Three.js canvas

## Development Commands

```bash
pnpm install          # Install all workspace deps
pnpm dev              # Start all apps (turbo)
pnpm dev:rivvon       # Frontend only (Vite, localhost:5173+)
pnpm dev:api          # API only (wrangler dev, localhost:8787)
```

There are **no tests or linters configured** — `pnpm lint` stubs to `echo`. Deployment is via GitHub Actions (`.github/workflows/deploy.yml`) with selective deploys based on changed paths.

## Frontend Conventions (`apps/rivvon/`)

- **Vue 3 Composition API** with `<script setup>` in `.vue` files; plain `.js` elsewhere (no TypeScript in frontend)
- **Pinia stores** (`stores/`) hold global state; three stores: `authStore`, `viewerStore`, `slyceStore`
- **Composables** (`composables/`) are `use*()` functions that combine reactive state + logic; they may depend on stores
- **Modules** (`modules/`) are **non-reactive** utility classes/functions (e.g., `TileManager`, `Ribbon`, `videoProcessor`). They do NOT import Vue reactivity — composables bridge between modules and Vue
- **Services** (`services/`) wrap external APIs: `api.js` (`useRivvonAPI()` composable-style), `googleDrive.js`, `textureService.js`, `localStorage.js` (IndexedDB)
- **PrimeVue** is the UI component library (with Aura theme); **Tailwind CSS v4** for utility classes
- **Icons** are Google Material Symbols, loaded via a custom CDN loader (`modules/shared/iconLoader.js`). To use an icon, its name must be added to the `loadMaterialSymbols()` array in `main.js`
- **Three.js** canvas is appended to `document.body` at z-index 0; Vue `#app` sits above with `pointer-events: none` in viewer mode. Interactive UI elements opt back in with `pointer-events: auto` (see `RibbonView.vue`)
- WebGPU support exists alongside WebGL with fallback: `threeSetup-webgl.js` / `threeSetup-webgpu.js`
- `shallowRef` is used for Three.js objects to avoid deep reactivity overhead
- Routing: `/slyce` redirects to `/?slyce=true` (panel-based). Viewer is the default route; Slyce features appear as overlay panels controlled by query params

## API Conventions (`apps/api/`)

- **Hono** framework with typed `Bindings` for Cloudflare env (`DB`, `BUCKET`, `GOOGLE_CLIENT_ID`, etc.)
- Routes are modular: `routes/auth.ts`, `routes/textures.ts`, `routes/upload.ts` — mounted in `index.ts`
- **Session auth** (HTTP-only cookies) is the sole auth mechanism via `middleware/session.ts` (`verifySession`). Uses Google OAuth for login, then HMAC-SHA256 signed session cookies.
- Cross-origin cookies require `SameSite=None; Secure` in production but `SameSite=Lax` for localhost. See `utils/cookies.ts` for the `buildCookieString` helper
- D1 queries use **raw SQL** via `c.env.DB.prepare().bind().run/all/first()` — no ORM
- Schema lives in `db/schema.sql`; migrations in `db/migrations/` (applied manually via wrangler)
- IDs are generated with `nanoid`; timestamps are Unix epoch integers
- Secrets (`GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`) are managed via `wrangler secret put`, not in code

## Storage Model

Three storage options exist:

- **Google Drive** (default for authenticated users): Frontend uploads KTX2 tiles directly to user's Drive via Google Drive API, then registers metadata with API via `POST /texture-set/:id/tile/:index/metadata`
- **R2** (admin-only): Only visible to admin users in the UI (`DownloadArea.vue` gates on `isAdmin`). API generates R2 keys; frontend uploads via `PUT /texture-set/:id/tile/:index`. Served from `cdn.rivvon.ca`
- **IndexedDB** (local, non-authenticated): Users who aren't logged in can save textures locally via `services/localStorage.js`. Data stays in-browser only — not synced to the API

Google Drive and R2 both share the same D1 schema (`texture_sets` + `texture_tiles` tables), distinguished by the `storage_provider` column.

## Admin System

- Admin emails are configured via `ADMIN_USERS` env var in `wrangler.toml` (comma-separated)
- Backend: `utils/user.ts` → `isAdminUser()` checks against this list. Admins can delete any texture set (not just their own) — see `routes/upload.ts` DELETE handler
- Frontend: `useGoogleAuth()` exposes `isAdmin` ref, populated from `GET /api/auth/me` response. Used in `TextureBrowser.vue` (delete any texture) and `DownloadArea.vue` (R2 upload option)

## File Naming & Organization Patterns

- Vue components: PascalCase (`ResultsArea.vue`, `TextureBrowser.vue`)
- JS modules/composables: camelCase (`tileManager.js`, `useThreeSetup.js`)
- API TypeScript: camelCase (`cookies.ts`, `session.ts`)
- KTX2 tile files: numeric index (`0.ktx2`, `1.ktx2`, ...)
- Workers use `workerpool` for CPU-intensive encoding (`workers/`, `ktx2-worker-pool.js`)
