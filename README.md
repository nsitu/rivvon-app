# Rivvon App Monorepo

A monorepo containing the Rivvon ecosystem of creative video texture applications.

## Apps

| App | Description | URL |
|-----|-------------|-----|
| **slyce** | Vue 3 texture encoder - derives animated cross-sections from videos | [slyce.rivvon.ca](https://slyce.rivvon.ca) |
| **rivvon** | Vue 3 texture renderer - renders video textures along paths | [rivvon.ca](https://rivvon.ca) |
| **api** | Hono API on Cloudflare Workers - backend for texture storage/delivery | [api.rivvon.ca](https://api.rivvon.ca) |

## Tech Stack

- **Package Manager**: pnpm (workspaces)
- **Build Orchestration**: Turborepo
- **Frontend**: Vue 3 + Vite
- **API**: Hono on Cloudflare Workers
- **Database**: Cloudflare D1
- **Storage**: Cloudflare R2
- **Deployment**: Cloudflare Pages & Workers via GitHub Actions

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9.15+

### Installation

```bash
# Install dependencies
pnpm install

# Start all apps in development mode
pnpm dev

# Or start individual apps
pnpm dev:slyce
pnpm dev:rivvon
pnpm dev:api
```

### Building

```bash
# Build all apps
pnpm build

# Build individual apps
pnpm build:slyce
pnpm build:rivvon
pnpm build:api
```

## Project Structure

```
rivvon-app/
├── .github/workflows/     # GitHub Actions for selective deployment
├── apps/
│   ├── slyce/             # Texture encoder frontend
│   ├── rivvon/            # Texture renderer frontend
│   └── api/               # Backend API
├── packages/
│   └── shared-types/      # Shared TypeScript types
├── package.json           # Root workspace config
├── pnpm-workspace.yaml    # pnpm workspace definition
└── turbo.json             # Turborepo configuration
```

## Deployment

Deployments are automated via GitHub Actions with selective deployment based on changed files:

- Changes to `apps/slyce/` → Deploy to Cloudflare Pages (slyce)
- Changes to `apps/rivvon/` → Deploy to Cloudflare Pages (rivvon)
- Changes to `apps/api/` → Deploy to Cloudflare Workers
- Changes to `packages/` → Redeploy all dependent apps

## License

ISC
