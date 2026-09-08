<div align="center">
  <img src="assets/logo.svg" width="64" height="64" alt="SlottD Logo" />
  <h1>SlottD (*"Slotted"*)</h1>
  <p><strong>The ultra-lightweight, edge-native micro-CMS built for Cloudflare Workers, D1, and R2 — designed to slot directly into Astro and SlotWire.</strong></p>
</div>

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare D1](https://img.shields.io/badge/Cloudflare-D1_SQLite-F38020?logo=sqlite&logoColor=white)](https://developers.cloudflare.com/d1/)
[![Astro](https://img.shields.io/badge/Astro-Content_Layer-BC52EE?logo=astro&logoColor=white)](https://astro.build/)
[![SlotWire](https://img.shields.io/badge/SlotWire-In--Situ_Bridge-00D26A)](https://github.com/bmoelk/slotwire)

---

## 💡 What is SlottD?

**SlottD** is an edge-native data engine and micro-studio that provides the exact subset of capabilities needed to power modern headless websites built with **Astro** and edited in-context with **SlotWire**:

1. **Directus-Compatible REST Target**: Implements the filter/sort/pagination query syntax expected by standard `@directus/sdk` and SlotWire's `DirectusAdapter` — without the multi-gigabyte Docker monolith.
2. **Hybrid Storage Engine (D1 + SQLite Views)**: Stores universal routing columns (`slug`, `title`, `status`) physically for instant indexing and uniqueness guarantees, while keeping custom fields and composite slots in an indestructible JSON document store. Dynamic SQLite `VIEW`s surface clean relational SQL models with zero-downtime schema evolution.
3. **Kysely Query Engine**: Type-safe, parameterized dynamic query builder with zero SQL injection risk and sub-millisecond edge latency.
4. **Deep-Linkable Micro-Studio**: A lightweight, server-rendered single-document editor with embedded **Toast-UI** (Markdown), **Trix** (Rich Text), and **Composite Repeater** widgets that deep-link directly from SlotWire's visual badges.
5. **Bi-Directional Git Bridge**: Supports both D1-first live editing and Git-backed (Keystatic/Markdown) workflows, with automatic export to Git and one-command restoration (`slottd sync --from-git`).

---

## 🏗 System Architecture

```mermaid
flowchart LR
    subgraph Astro_Client ["Astro Application"]
        AstroBuild["Astro Build (Content Layer)"]
        AstroPreview["Astro SSR Live Preview (slotwire_preview=true)"]
        SlotWireHUD["SlotWire In-Situ Badges"]
    end

    subgraph SlottD_Edge ["SlottD (Cloudflare Worker)"]
        HonoRouter["Hono API Router"]
        KyselyEngine["Kysely Query Compiler"]
        MicroStudio["Micro-Studio Editor (/admin/content/...)"]
    end

    subgraph Cloudflare_Infra ["Cloudflare Infrastructure"]
        D1_DB[("Cloudflare D1 (Physical + Views)")]
        R2_Bucket[("Cloudflare R2 (Media)")]
    end

    AstroBuild -->|"readItems('posts', ...)"| HonoRouter
    AstroPreview -->|"readItems('posts', { status: 'draft' })"| HonoRouter
    SlotWireHUD -->|"Deep Link: /admin/content/posts/123"| MicroStudio

    HonoRouter --> KyselyEngine
    KyselyEngine --> D1_DB
    MicroStudio --> D1_DB
    MicroStudio --> R2_Bucket
```

---

## 📦 Storage Model: The Best of Both Worlds

Traditional headless CMSs on SQLite struggle with `ALTER TABLE` schema migrations. SlottD solves this with a hybrid architecture:

### 1. The Physical Table (`documents`)
Guarantees database-level uniqueness on slugs and blazing-fast index lookups:

```sql
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  collection TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'published' | 'archived'
  data JSON NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(collection, slug)
);

CREATE INDEX idx_docs_collection_slug ON documents(collection, slug);
CREATE INDEX idx_docs_collection_status ON documents(collection, status);
```

### 2. Dynamic Relational Views (`CREATE VIEW`)
AI or developers define model schemas as lightweight SQLite views. Adding or modifying columns never alters disk tables—it simply drops and recreates the view in `< 0.1ms`:

```sql
CREATE VIEW posts AS
SELECT 
  id,
  collection,
  slug,
  title,
  status,
  json_extract(data, '$.body') AS body,
  json_extract(data, '$.cover_image') AS cover_image,
  json_extract(data, '$.author_id') AS author_id,
  json_extract(data, '$.features') AS features,
  created_at,
  updated_at
FROM documents
WHERE collection = 'posts';
```

---

## 🔌 SlotWire & Astro Content Layer Integration

### 1. In Astro (`src/lib/cms.ts`)
Use the official `@directus/sdk` with zero modifications:

```typescript
import { createDirectus, rest, readItems } from '@directus/sdk';

export const cms = createDirectus(import.meta.env.SLOTTD_API_URL).with(rest());

// In Astro Content Layer Loader:
export async function getBlogPosts(preview = false) {
  return await cms.request(
    readItems('posts', {
      filter: {
        status: { _eq: preview ? 'draft' : 'published' },
      },
      sort: ['-created_at'],
    })
  );
}
```

### 2. SlotWire Contract Bridge
Configure SlotWire to use its built-in `directus` provider:

```typescript
import { defineConfig } from '@slotwire/core';

export default defineConfig({
  provider: 'directus',
  adminUrl: 'https://cms.yourdomain.com/admin',
  // SlotWire automatically routes in-situ clicks to:
  // https://cms.yourdomain.com/admin/content/:collection/:id
});
```

---

## 🔄 Universal Git Versioning & Synchronization Engine

SlottD bridges high-performance edge database querying (Cloudflare D1) with immutable Git version control. Unlike traditional CMS architectures that require proprietary third-party platform APIs or heavy Docker containers, SlottD runs a **universal dual-engine Git architecture**:

1. **Edge-Native Smart HTTP Engine (`isomorphic-git`)**:
   - Runs in-memory inside the Cloudflare Worker isolate using pure Smart HTTP over HTTPS and Web standard `fetch`.
   - Zero shell binaries, zero filesystem dependence, and zero vendor lock-in (works with GitHub, GitLab, Bitbucket, Gitea, or self-hosted Git repositories).
   - In-memory tag cloning, semantic diffing, release committing, and tagging via `memfs`.
2. **Workstation Native Engine (`NativeShellGitDriver`)**:
   - In local workstation / Briefcase environments with SSH URLs (`git@...`), SlottD leverages the developer's local Git CLI and `~/.ssh` keys/ssh-agent directly without requiring personal access tokens.
   - Safe isolated inspection via `git archive` into temporary scratch space, guaranteeing zero dirtying or clobbering of uncommitted working tree files.

### ⚙️ Configuring Git in SlottD

#### Option 1: Via SlottD Studio UI (Recommended)
1. Open the Studio dashboard and navigate to **Setup** (`/admin/setup`).
2. Enter your repository settings:
   - **Git Remote URL**: Standard HTTPS or SSH URL (e.g. `https://github.com/org/repo.git` or `git@github.com:org/repo.git`). SSH URLs are automatically normalized to HTTPS on the edge.
   - **Target Branch**: Default `main`.
   - **Access Token**: Personal access token (GitHub Fine-Grained/Classic token, GitLab project token, etc.). *Required for private repositories.* Sensitive tokens are encrypted using AES-256 before storage in D1 `system_settings`.
3. Click **Save Settings**.

#### Option 2: Via `wrangler.overrides.toml` & Secrets (CI/CD / Zero-Secrets)
In your local or deployment-specific `wrangler.overrides.toml` (git-ignored):
```toml
[vars]
GIT_REMOTE_URL = "https://github.com/org/repo.git"
GIT_BRANCH = "main"
```

For private repositories, securely provision the access token:
```bash
npx wrangler secret put GIT_TOKEN
```

---

### 📦 Repository Layout Support

SlottD automatically detects and supports both standard headless repository layouts:
- **Nested Content Layout**: `content/<collection>/<slug>.json` with optional companion `<slug>.md`.
- **Root-Level Collection Layout**: `<collection>/<slug>.json` (e.g. `blog_posts/`, `authors/`, `pages/` directly in repository root).

During ingestion and restoration, SlottD safely ignores non-content directories (`.git`, `node_modules`, `dist`, `src`, `public`, `scripts`, `tests`, `docs`, `packages`, etc.) and reconciles existing database rows by `(collection, slug)` to preserve primary keys and schema integrity.

---

### 🚀 Git Operations in Studio UI (`/admin/git`)

* **Fetch Remote Tags**: Queries remote Git references in real-time over Smart HTTP.
* **Preview Diff (Dry Run)**: Generates a complete semantic diff between active D1 database records and any historical Git release tag, detailing additions, deletions, and field-level modifications before applying changes.
* **Confirm & Load into D1**: Restores and hydrates D1 documents directly from the selected Git tag snapshot.
* **Create Release & Export**: Snapshots active D1 records into serialized `.json`/`.md` files, commits to Git, creates an annotated release tag, and pushes to origin.
* **Download JSON Backup**: Generates an instant offline `.json` backup of all documents and media registry records.

---

## 📊 Git-Backed vs. Pure Edge Feature Matrix

| SlottD Feature | Pure Edge D1 (Zero Git Required) | Git-Enhanced (`GIT_REMOTE_URL` Configured) |
| :--- | :--- | :--- |
| **Content Authoring & Editing** | ✅ Full SlottD Studio & View Editor | ✅ Full SlottD Studio & View Editor |
| **Dual-State Working Copies** | ✅ Instant `draft_data` storage in D1 | ✅ Instant `draft_data` storage in D1 |
| **SlotWire In-Situ Bridge** | ✅ Live in-situ badges on staging | ✅ Live in-situ badges on staging |
| **Concurrent Draft Bundles** | ✅ Stored in SQLite `bundles` table | ✅ Staged to dedicated Git branch / release tags |
| **Pre-Publish Verification Pipeline** | ✅ Runs explicit check pipeline in D1 | ✅ Attributed check audit stored with release |
| **Release Tagging & Publishing** | ✅ Promotes in D1 | ✅ Promotes in D1 + creates immutable Git release tag |
| **Semantic Diff Preview (Dry Run)** | — | ✅ Full line-by-line diff against any Git release tag |
| **Disaster Recovery / Rollback** | SQLite backups | ✅ 1-click restore from any historical Git tag |
| **Version History & Auditing** | SQLite `activity_log` table | **Dual History**: SQLite `activity_log` + Git commit history |

---

## 🛡 Standardized Lifecycle Hooks & Attributed Check Pipeline

SlottD standardizes the return type of all pre/post-publish hooks around a clean uniform contract:

```typescript
export interface HookResult<T = any> {
  status: 'ok' | 'warning' | 'error';
  message?: string;
  data?: T;
}
```

### Pre-Publish Verification Pipeline (`slottd.config.ts`):

```typescript
import { slotwireContractCheck, terminologyCheck } from 'slottd/checks';
import type { SlottdConfig } from 'slottd';

export const config: SlottdConfig = {
  hooks: {
    onBeforePublish: async (ctx) => {
      return runCheckPipeline([
        // Check A: SlotWire Schema Contracts
        slotwireContractCheck({
          endpoint: 'https://edit.brainendeavor.com/api/slotwire/validate',
        }),
        // Check B: Prohibited / Deprecated Terminology Linter
        terminologyCheck({
          flaggedTerms: ['badword', 'legacy-tool'],
          severity: 'error',
        }),
      ], ctx);
    },
  },
};
```

Aggregated errors and warnings preserve their originating check name prefix (e.g. `[SlotWire Schema Contracts] Slot 'hero' missing`). When published, full audit reports are recorded to `content/.audit/verification-report.json`.

---

## 🚀 Quick Start

```bash
# Clone and install
git clone https://github.com/bmoelk/slottD.git
cd slottD
npm install

# Apply initial D1 migration
npx wrangler d1 migrations apply DB --local

# Start development worker
npm run dev
```

---

## 📜 License

MIT License. Designed with ❤️ for the SlotWire and Astro communities.
