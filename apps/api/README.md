# Rivvon API

A Cloudflare Worker-based backend API for the Rivvon ecosystem, enabling texture upload, storage, and delivery for creative video texture applications.

## Overview

This API serves as the central backend connecting:

- **Slyce** (texture encoder) - authenticated uploads
- **Rivvon** (texture renderer) - public consumption

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Framework**: Hono
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2 (Object Storage)
- **Auth**: Google OAuth + session cookies (HMAC-SHA256)

## Domains

- `api.rivvon.ca` - API endpoints
- `cdn.rivvon.ca` - R2 public bucket for texture delivery

## API Endpoints

### Public Routes

- `GET /textures` - List available textures
- `GET /textures/:id` - Get texture metadata and tile URLs

### Authenticated Routes (session cookie required)

- `POST /upload/texture-set` - Create texture set and get upload URLs
- `POST /upload/texture-set/:id/complete` - Mark upload as complete

## Development

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Deploy to Cloudflare
npm run deploy
```

## Database Migrations

Current approach:

- Migration files live in `db/migrations/`.
- The repo has been applying D1 changes by executing specific SQL files directly against the remote database, for example:

```bash
npx wrangler d1 execute rivvon-textures --remote --file=./db/migrations/004_drawings.sql
```

- This is the safe operational path for the current database because earlier schema changes were applied manually and are not recorded in Cloudflare's `d1_migrations` tracking table.
- Before running a new migration, verify the live schema and avoid replaying older migration files blindly.

Future opportunity:

- Reconcile the existing remote database with Wrangler's tracked migration system so future changes can use `wrangler d1 migrations list` and `wrangler d1 migrations apply` safely.
- That follow-up should include backfilling or otherwise aligning `d1_migrations` with the schema that already exists in production.

## Configuration

See `wrangler.toml` for Cloudflare configuration.
Secrets are managed via `wrangler secret put`.

## Related Repositories

- [Slyce](https://github.com/nsitu/slyce) - Texture encoder/creator
- [Rivvon](https://github.com/nsitu/rivvon) - Texture renderer/consumer

## License

ISC
