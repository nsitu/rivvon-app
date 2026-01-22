# Monorepo Migration Plan

## Overview

Merge `slyce`, `rivvon`, and `rivvon-api` into a single monorepo with selective Cloudflare deployment via GitHub Actions.

---

## Target Structure

```
rivvon-app/
├── .github/
│   └── workflows/
│       └── deploy.yml           # Selective deployment based on changes
├── apps/
│   ├── slyce/                   # Vue 3 + Vite frontend
│   │   ├── src/
│   │   ├── public/
│   │   ├── package.json
│   │   ├── vite.config.mjs
│   │   └── tsconfig.json
│   ├── rivvon/                  # Vue 3 + Vite frontend
│   │   ├── src/
│   │   ├── public/
│   │   ├── package.json
│   │   ├── vite.config.mjs
│   │   └── tsconfig.json
│   └── api/                     # Hono API on Cloudflare Workers
│       ├── src/
│       ├── package.json
│       ├── wrangler.toml
│       └── tsconfig.json
├── packages/                    # Shared code (future)
│   └── shared-types/            # TypeScript types shared across apps
│       ├── src/
│       └── package.json
├── .gitignore
├── .nvmrc
├── package.json                 # Root workspace config
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── turbo.json                   # Optional: Turborepo for build orchestration
└── README.md
```

---

## Technology Choices

| Tool | Purpose | Rationale |
|------|---------|-----------|
| **pnpm** | Package manager | Fast, disk-efficient, native workspace support |
| **Turborepo** | Build orchestration | Caching, parallel builds, change detection (optional) |
| **GitHub Actions** | CI/CD | Selective deploys, full control |
| **Wrangler** | Cloudflare CLI | Deploy Pages & Workers from CI |

---

## Step-by-Step Migration

### Phase 1: Create Monorepo Structure

#### 1.1 Create New Repository

```bash
# Create new directory
mkdir rivvon-app
cd rivvon-app
git init

# Create directory structure
mkdir -p apps/slyce apps/rivvon apps/api packages .github/workflows
```

#### 1.2 Root Configuration Files

**pnpm-workspace.yaml**
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

**package.json** (root)
```json
{
  "name": "rivvon-app",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "dev": "turbo dev",
    "dev:slyce": "pnpm --filter slyce dev",
    "dev:rivvon": "pnpm --filter rivvon dev",
    "dev:api": "pnpm --filter api dev",
    "build": "turbo build",
    "build:slyce": "pnpm --filter slyce build",
    "build:rivvon": "pnpm --filter rivvon build",
    "build:api": "pnpm --filter api build",
    "lint": "turbo lint",
    "clean": "turbo clean && rm -rf node_modules"
  },
  "devDependencies": {
    "turbo": "^2.3.0"
  }
}
```

**turbo.json**
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".output/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "clean": {
      "cache": false
    }
  }
}
```

**.nvmrc**
```
20
```

**.gitignore**
```gitignore
# Dependencies
node_modules/
.pnpm-store/

# Build outputs
dist/
.output/
.wrangler/

# Environment
.env
.env.local
.env.*.local
.dev.vars

# IDE
.vscode/*
!.vscode/extensions.json
!.vscode/settings.json
.idea/

# Logs
*.log
npm-debug.log*

# Turbo
.turbo/

# OS
.DS_Store
Thumbs.db

# Test
coverage/
```

---

### Phase 2: Migrate Each App

#### 2.1 Migrate Slyce (with git history)

```bash
# From the monorepo root
cd apps

# Clone slyce and filter to preserve history
git clone --no-checkout ../path/to/slyce slyce-temp
cd slyce-temp
git checkout main

# Move contents up (excluding .git)
cd ..
mv slyce-temp/* slyce/
mv slyce-temp/.* slyce/ 2>/dev/null || true
rm -rf slyce-temp

# Remove slyce's .git (history will be in monorepo)
rm -rf slyce/.git
```

**Update apps/slyce/package.json:**
```json
{
  "name": "slyce",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "lint": "eslint ."
  },
  "dependencies": {
    // ... existing dependencies
  }
}
```

#### 2.2 Migrate Rivvon

Same process as slyce:
```bash
cd apps
# ... same steps as above for rivvon
```

**Update apps/rivvon/package.json:**
```json
{
  "name": "rivvon",
  "private": true,
  // ... same structure as slyce
}
```

#### 2.3 Migrate Rivvon-API

```bash
cd apps
# ... same migration steps, but target 'api' folder
```

**Update apps/api/package.json:**
```json
{
  "name": "api",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "build": "wrangler deploy --dry-run",
    "deploy": "wrangler deploy",
    "lint": "eslint ."
  },
  "dependencies": {
    "hono": "^4.x.x"
    // ... existing dependencies
  }
}
```

**Update apps/api/wrangler.toml:**
```toml
name = "rivvon-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
# Environment variables (non-secret)

# Bindings are configured per-environment or in dashboard
```

---

### Phase 3: GitHub Actions Deployment

**.github/workflows/deploy.yml**
```yaml
name: Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  PNPM_VERSION: 9.15.0
  NODE_VERSION: 20

jobs:
  # Detect which apps have changes
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      slyce: ${{ steps.filter.outputs.slyce }}
      rivvon: ${{ steps.filter.outputs.rivvon }}
      api: ${{ steps.filter.outputs.api }}
      packages: ${{ steps.filter.outputs.packages }}
    steps:
      - uses: actions/checkout@v4
      
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            slyce:
              - 'apps/slyce/**'
            rivvon:
              - 'apps/rivvon/**'
            api:
              - 'apps/api/**'
            packages:
              - 'packages/**'

  # Deploy Slyce frontend
  deploy-slyce:
    needs: detect-changes
    if: |
      github.event_name == 'push' && 
      (needs.detect-changes.outputs.slyce == 'true' || 
       needs.detect-changes.outputs.packages == 'true')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}
      
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'
      
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      
      - name: Build Slyce
        run: pnpm --filter slyce build
        env:
          VITE_GOOGLE_CLIENT_ID: ${{ secrets.VITE_GOOGLE_CLIENT_ID }}
          VITE_API_URL: ${{ secrets.VITE_API_URL }}
      
      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: apps/slyce
          command: pages deploy dist --project-name=slyce --branch=main

  # Deploy Rivvon frontend
  deploy-rivvon:
    needs: detect-changes
    if: |
      github.event_name == 'push' && 
      (needs.detect-changes.outputs.rivvon == 'true' || 
       needs.detect-changes.outputs.packages == 'true')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}
      
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'
      
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      
      - name: Build Rivvon
        run: pnpm --filter rivvon build
        env:
          VITE_GOOGLE_CLIENT_ID: ${{ secrets.VITE_GOOGLE_CLIENT_ID }}
          VITE_API_URL: ${{ secrets.VITE_API_URL }}
      
      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: apps/rivvon
          command: pages deploy dist --project-name=rivvon --branch=main

  # Deploy API Worker
  deploy-api:
    needs: detect-changes
    if: |
      github.event_name == 'push' && 
      (needs.detect-changes.outputs.api == 'true' || 
       needs.detect-changes.outputs.packages == 'true')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}
      
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'
      
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      
      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: apps/api
          command: deploy
        env:
          # Secrets are configured in Cloudflare dashboard, not here
          # This is just for wrangler authentication

  # Preview deployments for PRs
  preview:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}
      
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'
      
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      
      - name: Build all
        run: pnpm build
        env:
          VITE_GOOGLE_CLIENT_ID: ${{ secrets.VITE_GOOGLE_CLIENT_ID }}
          VITE_API_URL: ${{ secrets.VITE_API_URL_PREVIEW }}
      
      - name: Deploy Slyce Preview
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: apps/slyce
          command: pages deploy dist --project-name=slyce --branch=${{ github.head_ref }}
```

---

### Phase 4: GitHub Secrets Configuration

Add these secrets in GitHub repository settings → Secrets and variables → Actions:

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | API token with Pages & Workers edit permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `VITE_API_URL` | Production API URL (https://api.rivvon.ca) |
| `VITE_API_URL_PREVIEW` | Preview API URL (if different) |

**Create Cloudflare API Token:**
1. Go to Cloudflare Dashboard → My Profile → API Tokens
2. Create Token → Custom token
3. Permissions:
   - Account: Cloudflare Pages: Edit
   - Account: Cloudflare Workers Scripts: Edit
   - Zone: (select your zone if needed)
4. Copy token to GitHub secrets

---

### Phase 5: Local Development Setup

#### 5.1 Install pnpm

```bash
# Using corepack (recommended)
corepack enable
corepack prepare pnpm@9.15.0 --activate

# Or via npm
npm install -g pnpm@9.15.0
```

#### 5.2 Install Dependencies

```bash
cd rivvon-app
pnpm install
```

#### 5.3 Environment Files

Each app needs its own `.env` or `.dev.vars`:

**apps/slyce/.env**
```env
VITE_GOOGLE_CLIENT_ID=your-client-id
VITE_API_URL=http://localhost:8787
```

**apps/rivvon/.env**
```env
VITE_GOOGLE_CLIENT_ID=your-client-id
VITE_API_URL=http://localhost:8787
```

**apps/api/.dev.vars**
```env
GOOGLE_CLIENT_SECRET=your-secret
DATABASE_URL=your-d1-or-turso-url
```

#### 5.4 Running Locally

```bash
# Run single app
pnpm dev:slyce
pnpm dev:rivvon
pnpm dev:api

# Run all apps (using Turbo)
pnpm dev

# Run specific combination
pnpm --filter slyce --filter api dev
```

---

### Phase 6: Cleanup Old Repos

After verifying the monorepo works:

1. **Disconnect Cloudflare integrations** from old repos
2. **Archive old repos** (don't delete immediately)
3. **Update any documentation** pointing to old repos
4. **Update local clones** to point to new repo

---

## Shared Code (Future Enhancement)

If you need to share code between apps:

**packages/shared-types/package.json**
```json
{
  "name": "@rivvon/shared-types",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

**Usage in apps:**
```json
// apps/slyce/package.json
{
  "dependencies": {
    "@rivvon/shared-types": "workspace:*"
  }
}
```

```typescript
// apps/slyce/src/something.ts
import { TextureMetadata } from '@rivvon/shared-types'
```

---

## VS Code Workspace Configuration

**.vscode/settings.json**
```json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "editor.formatOnSave": true,
  "eslint.workingDirectories": [
    { "directory": "apps/slyce", "changeProcessCWD": true },
    { "directory": "apps/rivvon", "changeProcessCWD": true },
    { "directory": "apps/api", "changeProcessCWD": true }
  ]
}
```

**.vscode/extensions.json**
```json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "vue.volar",
    "bradlc.vscode-tailwindcss"
  ]
}
```

---

## Checklist

### Phase 1: Setup
- [ ] Create new GitHub repository `rivvon-app`
- [ ] Clone locally
- [ ] Create directory structure
- [ ] Add root configuration files (package.json, pnpm-workspace.yaml, turbo.json)
- [ ] Add .gitignore, .nvmrc

### Phase 2: Migrate Apps
- [ ] Copy slyce into apps/slyce
- [ ] Update slyce package.json (name, remove workspace-specific configs)
- [ ] Copy rivvon into apps/rivvon
- [ ] Update rivvon package.json
- [ ] Copy rivvon-api into apps/api
- [ ] Update api package.json and wrangler.toml
- [ ] Run `pnpm install` from root
- [ ] Verify each app builds: `pnpm build`

### Phase 3: CI/CD
- [ ] Add .github/workflows/deploy.yml
- [ ] Create Cloudflare API token
- [ ] Add GitHub secrets
- [ ] Push to main branch
- [ ] Verify deployments succeed

### Phase 4: Local Development
- [ ] Create .env files for each app
- [ ] Verify `pnpm dev:slyce` works
- [ ] Verify `pnpm dev:api` works
- [ ] Test frontend → API connectivity

### Phase 5: Cleanup
- [ ] Disconnect old Cloudflare integrations
- [ ] Archive old repositories
- [ ] Update documentation

---

## Estimated Effort

| Task | Time |
|------|------|
| Repository setup | 30 min |
| Migrate apps | 1-2 hours |
| GitHub Actions setup | 1 hour |
| Testing & debugging | 1-2 hours |
| **Total** | **~4-5 hours** |

---

## Relationship to Google Drive Plan

This monorepo migration should be done **before** implementing the Google Drive integration because:

1. **Auth changes span frontend + API** - easier in one repo
2. **Shared types** - OAuth token types can be shared
3. **Atomic commits** - auth migration can be a single PR
4. **Easier testing** - run frontend + API locally together

Recommended order:
1. ✅ Monorepo migration (this plan)
2. ⏳ Google Drive integration (google-drive-plan.md)
