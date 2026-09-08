# SlottD Agent Guidelines & Operating Directives (AGENTS.md)

This file defines coding standards, repository policies, and architectural guardrails for AI coding assistants and human contributors working on **SlottD**.

---

## 🔒 Zero-Secrets Public Repository Policy
1. **Generic `wrangler.toml`**:
   - `wrangler.toml` MUST remain 100% generic with default placeholders (`ALLOWED_ORIGINS = "*"`, `local-d1-placeholder`).
   - Never commit private email addresses, custom domain route patterns (`pattern = "..."`), or production account UUIDs to `wrangler.toml`.
2. **Private Deployments (`wrangler.overrides.toml`)**:
   - Account-specific production bindings (D1 UUIDs, R2 bucket names, and private routes) MUST be specified in `wrangler.overrides.toml` (git-ignored).
   - Deploy using:
     ```bash
     npm run deploy:prod # wrangler deploy -c wrangler.overrides.toml
     ```

---

## 🖼 Media Storage & Resolution Directives (Descriptive R2 + Dual Mapping)

1. **Descriptive R2 Object Keys (Strict Requirement)**:
   - When media is uploaded, files MUST be stored in the Cloudflare R2 bucket with **human-readable, descriptive keys** (e.g. `hero-banner.png`, `brian-avatar.jpg`, `project-freeformer.png`) instead of opaque UUIDs.
   - Filenames are sanitized to lowercase URL-safe slugs (`[a-z0-9_-]`). If a collision occurs, a deterministic or short timestamp suffix is appended (`hero-banner-4x9a.png`).

2. **Bi-Directional UUID $\leftrightarrow$ Descriptive Mapping in D1**:
   - The D1 `media` table maintains the index:
     - `id`: Unique UUID (for Directus SDK / REST compatibility)
     - `key`: Human-readable R2 storage key (for direct CDN/media fetching)
     - `filename`: Original upload filename
     - `mime_type`: Content-Type
     - `size`: Byte count
   - Directus and SlotWire API consumers can query or request files by **either UUID or descriptive key** (`GET /files/:idOrKey` or `GET /assets/:idOrKey`). SlottD transparently resolves the UUID to the descriptive R2 key and streams the media.

---

## ⚡ Lean JS & Zero-Build Architecture Directive (SlottD Studio UI)

1. **Zero-Build & Lean Frontend**:
   - The SlottD Studio UI MUST remain lightweight, blazing fast, and dependency-lean.
   - **NO heavy client frameworks**: Do NOT introduce React, Vue, Angular, Svelte client-side runtimes, or hydration bundles into SlottD.
   - **NO frontend bundler pipelines**: The UI is server-rendered on-demand via `hono/html` directly inside the Cloudflare Worker isolate.
2. **Vanilla, Web Components & Micro-Libraries**:
   - Prefer plain vanilla JavaScript and native HTML5/DOM APIs.
   - Native Web Components, custom elements, and lightweight libraries (like **HTMX** or **Alpine.js**) are welcome when progressive enhancement is needed.
3. **Graceful Fallbacks & Resilience**:
   - Third-party CDN widgets (e.g. rich text / markdown editors) MUST have robust error handling and immediate graceful fallbacks to standard semantic HTML elements (e.g. standard `<textarea>`) so the UI never breaks or renders blank voids if a CDN fails or is blocked.

---

## 🧭 Directus API Compatibility & `/ext/*` Namespacing Directives

1. **Directus AST REST Standard (`/items`, `/files`, `/versions`, `/activity`, `/revisions`)**:
   - Core CRUD operations MUST strictly mirror Directus REST protocol specifications.
   - Public read access is permitted for `status = 'published'` records only.
   - Querying drafts (`status = 'draft'` or `version=...`), mutation operations (`POST`, `PATCH`, `DELETE`), and versioning endpoints require authentication via Cloudflare Access or Bearer API token (`ADMIN_API_KEY`).

2. **SlottD Extended Engine (`/ext/*`)**:
   - Custom SlottD orchestration tools, deployment hooks, Git sync, and briefcase endpoints MUST live under `/ext/*` (`/ext/release/publish`, `/ext/sync/hydrate`, `/ext/sync/export`, `/ext/briefcase/status`, `/ext/bundle/validate`).
   - Backward compatibility aliases for `/api/*` routes are preserved.

3. **Standardized Lifecycle Hooks (`HookResult<T>`)**:
   - All lifecycle checks return uniform `HookResult<T>` (`status: 'ok' | 'warning' | 'error'`, `message?: string`, `data?: T`).
   - Aggregated check errors and warnings must preserve their origin attribution prefix: `[CheckName] Message`.

---

## 🔄 Git Synchronization & Universal Driver Directives

1. **Pure Smart HTTP Protocol (`isomorphic-git`)**:
   - In Cloudflare Workers edge isolates, all remote Git operations MUST use the pure Git Smart HTTP wire protocol over HTTPS via `isomorphic-git` and in-memory `memfs`.
   - **Zero Vendor Platform APIs**: NEVER introduce proprietary vendor APIs (e.g. GitHub REST/GraphQL) for core Git operations. The engine must remain universally compatible with GitHub, GitLab, Bitbucket, Gitea, and self-hosted Git repositories.
2. **Dual-Engine Architectural Parity**:
   - Workstation / Briefcase environments support native Git CLI (`NativeShellGitDriver`) and local `~/.ssh` agent keys when SSH URLs (`git@...`) are used.
   - Cloudflare Workers isolates automatically normalize SSH URLs to HTTPS (`normalizeGitUrl`) and authenticate using the configured personal access token.
3. **Zero Working Tree Contamination**:
   - In workstation mode, inspecting or loading tags MUST extract files into an isolated temporary scratch folder (`git archive "${tag}" | tar -x -C "${tempDir}"`) and clean it up in a `finally` block.
   - NEVER execute checkout commands (`git checkout <tag> -- ...`) that could mutate or discard uncommitted developer working tree files.
4. **Multi-Layout Repository Ingestion**:
   - Tag loaders MUST dynamically detect whether collections reside inside a `/content/` subfolder or directly at repository root (`authors/`, `blog_posts/`, etc.).
   - Code and build artifacts (`.git`, `node_modules`, `dist`, `src`, `public`, `scripts`, `tests`, `docs`, `packages`) must be strictly ignored.
5. **D1 Hydration Integrity (`hydrateFromGit`)**:
   - When restoring records from Git, always reconcile against D1 by `(collection, slug)` before insert/update. This guarantees SQLite `UNIQUE(collection, slug)` integrity and preserves existing record UUIDs.

