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
pnpm install

# Run locally
pnpm dev

# Build/deploy the Worker locally when needed
pnpm build
pnpm deploy
```

## Deployment

Production deployment is handled by `.github/workflows/deploy.yml`. A push to `main` that changes the API or shared packages runs the following sequence:

1. Install dependencies with the locked pnpm version.
2. Apply any pending remote D1 migrations.
3. Deploy the API Worker.

The migration step must succeed before the Worker is deployed. GitHub Actions authenticates with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; the API token must have permission to edit D1 as well as deploy the Worker. The API job uses the protected `production` environment and serializes production API deployments.

Frontend and runtime-asset deployments run as separate jobs in the same workflow. Pull requests build frontend previews but do not modify the production D1 database.

## Database Migrations

Migration files live in `db/migrations/`, and `wrangler.toml` points Wrangler at that directory. The remote database's existing schema and `d1_migrations` history have been reconciled, so new changes should use Wrangler's tracked migration workflow.

From `apps/api/`:

```bash
# Create a new migration file
pnpm db:migrations:create add_description_here

# Check local or remote state
pnpm db:migrations:list:local
pnpm db:migrations:list:remote

# Apply locally while developing
pnpm db:migrations:apply:local

# Apply to production (requires Cloudflare authentication)
pnpm db:migrations:apply:remote
```

The API deployment workflow runs `db:migrations:apply:remote` before deploying the Worker. A migration failure stops the deployment. Wrangler captures a D1 backup when applying migrations, and failed migrations are rolled back. Applying migrations locally first is optional but recommended for validating a change before merging.

Do not edit an applied migration or apply `schema.sql` to an existing production database. Keep `schema.sql` as a reference/bootstrap snapshot; use the incremental migration files for all future schema changes.

For local remote-development isolation, create a separate preview D1 database and add its ID as `preview_database_id` under the D1 binding in `wrangler.toml` before using it. Until that resource is provisioned, use `db:migrations:apply:local` for local development and reserve `--remote` for the production database.

## Video gallery R2 uploads

Gallery videos upload directly from the browser to an authenticated, short-lived R2 presigned URL. The API requires an R2 API token scoped to Object Read & Write for the `rivvon-textures` bucket. Configure its credentials as Worker secrets:

```bash
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
```

`R2_ACCOUNT_ID` and `R2_BUCKET_NAME` are non-sensitive deployment variables configured in `wrangler.toml`.

Browser uploads also require the bucket CORS policy checked into `r2-cors.json`:

```bash
npx wrangler r2 bucket cors set rivvon-textures --file=./r2-cors.json
```

R2 CORS configuration is managed separately with Wrangler when it changes. D1 migrations are applied automatically by the GitHub Actions API deployment before the Worker is released. The API verifies the finished R2 object and its byte size before a video becomes visible in the gallery.

## Configuration

See `wrangler.toml` for Cloudflare configuration.
Secrets are managed via `wrangler secret put`.

## Related Repositories

- [Slyce](https://github.com/nsitu/slyce) - Texture encoder/creator
- [Rivvon](https://github.com/nsitu/rivvon) - Texture renderer/consumer

## License

ISC
