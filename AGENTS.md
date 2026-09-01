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
