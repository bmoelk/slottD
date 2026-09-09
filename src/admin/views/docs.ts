import { html, raw } from 'hono/html';
import { renderLayout } from '../layout.js';

export function renderDocsView(user: { email: string; authMethod?: string }) {
  const clientScript = `
    function copySnippet(btn, codeId) {
      const el = document.getElementById(codeId);
      if (!el) return;
      const text = el.innerText || el.textContent;
      navigator.clipboard.writeText(text).then(() => {
        const original = btn.innerHTML;
        btn.innerHTML = '✓ Copied!';
        btn.style.color = '#34d399';
        setTimeout(() => {
          btn.innerHTML = original;
          btn.style.color = '';
        }, 2000);
      }).catch(err => {
        console.error('Failed to copy', err);
      });
    }

    function filterDocs(query) {
      const q = (query || '').toLowerCase().trim();
      const sections = document.querySelectorAll('.docs-section');
      let matches = 0;

      sections.forEach(function(sec) {
        const text = sec.innerText.toLowerCase();
        if (!q || text.includes(q)) {
          sec.style.display = '';
          matches++;
        } else {
          sec.style.display = 'none';
        }
      });

      const countEl = document.getElementById('docsMatchCount');
      if (countEl) countEl.innerText = matches + ' Topics';
    }

    window.addEventListener('keydown', (e) => {
      const search = document.getElementById('docsSearch');
      if (e.key === '/' && document.activeElement !== search) {
        e.preventDefault();
        search?.focus();
        search?.select();
      }
    });

    // Track active nav link on scroll
    document.addEventListener('DOMContentLoaded', () => {
      const navLinks = document.querySelectorAll('.docs-nav-link');
      const sections = document.querySelectorAll('.docs-section');

      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            navLinks.forEach(link => {
              if (link.getAttribute('href') === '#' + id) {
                link.classList.add('active');
              } else {
                link.classList.remove('active');
              }
            });
          }
        });
      }, { rootMargin: '-20% 0px -70% 0px' });

      sections.forEach(s => observer.observe(s));
    });
  `;

  return renderLayout('Documentation & Recipes — SlottD Studio', 'docs', user, html`
    <div class="header">
      <div>
        <h1>SlottD Studio Guide & Recipes</h1>
        <p class="subtitle">Use-case driven guides for frontend querying, content modeling, SlotWire visual bridges, and edge deployment.</p>
      </div>
      <div class="header-stats">
        <span class="stat-pill" id="docsMatchCount">9 Topics</span>
      </div>
    </div>

    <!-- Search Bar -->
    <div class="toolbar card">
      <div class="toolbar-search">
        <span class="search-icon">🔍</span>
        <input
          type="search"
          id="docsSearch"
          class="input-search"
          placeholder="Search guides, recipes, endpoints, and shortcuts... (Press / to focus)"
          oninput="filterDocs(this.value)"
          autocomplete="off"
        />
      </div>
    </div>

    <!-- 2-Column Documentation Hub -->
    <div class="docs-layout" x-data="{ queryTab: 'sdk', modelTab: 'archetypes' }">

      <!-- Sticky Sidebar -->
      <aside class="docs-sidebar">
        <div>
          <div class="docs-nav-group-title">🚀 Getting Started</div>
          <ul class="docs-nav-list">
            <li><a href="#quickstart-querying" class="docs-nav-link active"><span>⚡</span> 1. Query & Live Previews</a></li>
            <li><a href="#standalone-directus" class="docs-nav-link"><span>🌐</span> 2. Standalone Directus CMS</a></li>
          </ul>
        </div>

        <div>
          <div class="docs-nav-group-title">🧱 Models & Architecture</div>
          <ul class="docs-nav-list">
            <li><a href="#models-archetypes" class="docs-nav-link"><span>📐</span> 3. Models & Archetypes</a></li>
            <li><a href="#validations-hooks" class="docs-nav-link"><span>🛡️</span> 4. Validations & Hooks</a></li>
            <li><a href="#media-r2" class="docs-nav-link"><span>🖼️</span> 5. Media & Descriptive R2</a></li>
          </ul>
        </div>

        <div>
          <div class="docs-nav-group-title">⚙️ Deployment & DevOps</div>
          <ul class="docs-nav-list">
            <li><a href="#git-releases" class="docs-nav-link"><span>📦</span> 6. Git Releases & D1 Sync</a></li>
            <li><a href="#production-security" class="docs-nav-link"><span>🔒</span> 7. Auth & Access Control</a></li>
          </ul>
        </div>

        <div>
          <div class="docs-nav-group-title">⚡ Reference & Cheats</div>
          <ul class="docs-nav-list">
            <li><a href="#directus-api-cheat" class="docs-nav-link"><span>📖</span> REST Query Cheat Sheet</a></li>
            <li><a href="#shortcuts-cheat" class="docs-nav-link"><span>⌨️</span> Keyboard Shortcuts</a></li>
          </ul>
        </div>
      </aside>

      <!-- Main Content Area -->
      <main class="docs-content">

        <!-- Topic 1: Query & Live Previews -->
        <section class="card docs-section" id="quickstart-querying" style="padding: 28px;">
          <h2 style="margin-top: 0; font-size: 20px; color: #38bdf8; display: flex; align-items: center; gap: 10px;">
            <span>⚡</span> 1. Connect Your Frontend & Query Content
          </h2>
          <p style="color: var(--text-muted); font-size: 14px; line-height: 1.6;">
            SlottD is completely compatible with standard Directus clients. You can query data using the official <strong>@directus/sdk</strong>, native Astro Content Layer loaders, or standard <code>fetch()</code> requests.
          </p>

          <div class="docs-callout docs-callout-slotwire">
            <strong>⚡ SlotWire Live Preview Synergy:</strong>
            When staging changes in your frontend, pass the cookie or query parameter <code>slotwire_preview=true</code>. Your frontend loader bypasses static build caches (<code>cache: 'no-store'</code>) and dynamically fetches live drafts from SlottD, rendering instant visual updates without redeploying.
          </div>

          <!-- Code Switcher Tabs -->
          <div class="code-tabs-wrapper">
            <div class="code-tabs-header">
              <div class="code-tabs-nav">
                <button type="button" class="code-tab-btn" :class="{ 'active': queryTab === 'sdk' }" @click="queryTab = 'sdk'">@directus/sdk</button>
                <button type="button" class="code-tab-btn" :class="{ 'active': queryTab === 'astro' }" @click="queryTab = 'astro'">Astro Content Loader</button>
                <button type="button" class="code-tab-btn" :class="{ 'active': queryTab === 'curl' }" @click="queryTab = 'curl'">cURL / Fetch</button>
              </div>
              <button type="button" class="btn-copy-code" onclick="copySnippet(this, 'snippetQuery')">📋 Copy</button>
            </div>

            <!-- Tab 1: @directus/sdk -->
            <div x-show="queryTab === 'sdk'">
              <pre class="code-block-content" id="snippetQuery"><code>import { createDirectus, rest, readItems } from '@directus/sdk';

// Initialize Directus client pointing directly to your SlottD Worker
const client = createDirectus('https://content.yourdomain.com').with(rest());

// Query published items with sorting and field selection
const posts = await client.request(
  readItems('blog_posts', {
    filter: { status: { _eq: 'published' } },
    sort: ['-date_created'],
    fields: ['id', 'title', 'slug', 'summary', 'hero_image', 'date_created'],
    limit: 10,
  })
);</code></pre>
            </div>

            <!-- Tab 2: Astro Loader -->
            <div x-show="queryTab === 'astro'" style="display: none;">
              <pre class="code-block-content"><code>// src/content.config.ts (Astro 5 Content Layer)
import { defineCollection } from 'astro:content';

export const collections = {
  sections: defineCollection({
    loader: async ({ context }) => {
      const isPreview = context?.cookies?.get('slotwire_preview')?.value === 'true';
      const url = new URL('https://content.yourdomain.com/items/page_sections');
      
      if (!isPreview) {
        url.searchParams.set('filter[status][_eq]', 'published');
      }
      
      const res = await fetch(url, {
        cache: isPreview ? 'no-store' : 'default',
      });
      const json = await res.json();
      return json.data.map(item => ({ id: item.slug, ...item }));
    }
  })
};</code></pre>
            </div>

            <!-- Tab 3: cURL / Fetch -->
            <div x-show="queryTab === 'curl'" style="display: none;">
              <pre class="code-block-content"><code># Query published feature cards sorted by display order
curl "https://content.yourdomain.com/items/feature_cards?\
filter\[status\]\[_eq\]=published&\
filter\[pageSlug\]\[_eq\]=home&\
sort=order&\
fields=title,slug,summary,icon,linkUrl" \
  -H "Accept: application/json"</code></pre>
            </div>
          </div>
        </section>

        <!-- Topic 2: Standalone Directus -->
        <section class="card docs-section" id="standalone-directus" style="padding: 28px;">
          <h2 style="margin-top: 0; font-size: 20px; color: #38bdf8; display: flex; align-items: center; gap: 10px;">
            <span>🌐</span> 2. Using SlottD as a Standalone Cloudflare Directus CMS
          </h2>
          <p style="color: var(--text-muted); font-size: 14px; line-height: 1.6;">
            SlottD was engineered to support SlotWire, but it also functions as a high-performance, standalone <strong>Directus headless CMS</strong>. If you love Directus's query protocol but don't want the weight of Docker, PostgreSQL, and continuous server hosting, SlottD gives you a zero-overhead replacement on Cloudflare Workers.
          </p>

          <table class="data-table" style="width: 100%; margin: 16px 0;">
            <thead>
              <tr>
                <th style="width: 180px;">Capability</th>
                <th>Traditional Directus Monolith</th>
                <th>SlottD Edge CMS</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Hosting & Cost</strong></td>
                <td>Docker container + Postgres ($15–$50/mo minimum)</td>
                <td><strong style="color: #34d399;">$0–$5/mo</strong> on Cloudflare Workers edge isolates</td>
              </tr>
              <tr>
                <td><strong>Global Latency</strong></td>
                <td>Single region container (100ms–300ms round trips)</td>
                <td><strong style="color: #34d399;">Sub-10ms</strong> across 300+ edge data centers worldwide</td>
              </tr>
              <tr>
                <td><strong>Storage Engine</strong></td>
                <td>PostgreSQL / MySQL with connection pools</td>
                <td>Cloudflare D1 (SQLite) + R2 Object Storage</td>
              </tr>
              <tr>
                <td><strong>Maintenance</strong></td>
                <td>OS patching, container restarts, Redis cache management</td>
                <td>Zero maintenance, pure serverless, auto-scaling</td>
              </tr>
              <tr>
                <td><strong>Client Ecosystem</strong></td>
                <td>@directus/sdk, REST, GraphQL</td>
                <td>100% Directus AST REST protocol & @directus/sdk compatible</td>
              </tr>
            </tbody>
          </table>

          <h3 style="font-size: 15px; color: #e2e8f0; margin-top: 20px; margin-bottom: 8px;">Supported Core Endpoints</h3>
          <ul style="color: #cbd5e1; font-size: 13px; line-height: 1.8; margin-left: 20px;">
            <li><code>GET /items/:collection</code>: List collection items with full AST query compiler (filters, sorting, searching, fields, pagination).</li>
            <li><code>GET /items/:collection/:idOrSlug</code>: Retrieve single record by unique UUID or URL slug.</li>
            <li><code>POST /items/:collection</code>: Create record (requires Cloudflare Access or <code>ADMIN_API_KEY</code>).</li>
            <li><code>PATCH /items/:collection/:idOrSlug</code>: Update record (creates audit log revision in D1).</li>
            <li><code>DELETE /items/:collection/:idOrSlug</code>: Delete record with cascade logging.</li>
            <li><code>GET /files</code> & <code>GET /files/:idOrKey</code>: Directus media metadata endpoint.</li>
            <li><code>GET /assets/:idOrKey</code> & <code>GET /media/:key</code>: Edge-streamed binary media assets.</li>
          </ul>
        </section>

        <!-- Topic 3: Models & SlotWire Archetypes -->
        <section class="card docs-section" id="models-archetypes" style="padding: 28px;">
          <h2 style="margin-top: 0; font-size: 20px; color: #38bdf8; display: flex; align-items: center; gap: 10px;">
            <span>📐</span> 3. Content Models & SlotWire Layout Archetypes
          </h2>
          <p style="color: var(--text-muted); font-size: 14px; line-height: 1.6;">
            In SlottD, schemas are governed by <strong>Model Packs</strong> (like <code>@slottd/pack-slotwire</code> or site-custom packs). When a pack is registered, SlottD automatically creates dynamic SQLite views (<code>v_collection_name</code>) in D1 to provide high-speed typed queries.
          </p>

          <div class="docs-callout docs-callout-slotwire">
            <strong>⚡ SlotWire Layout Archetypes:</strong>
            The collections in <code>@slottd/pack-slotwire</code> correspond directly to standard website layout patterns. SlotWire uses composite identifiers to link UI components directly to their SlottD records:
          </div>

          <table class="data-table" style="width: 100%; margin: 16px 0;">
            <thead>
              <tr>
                <th style="width: 130px;">Collection</th>
                <th style="width: 150px;">SlotWire Archetype</th>
                <th style="width: 160px;">Key Strategy</th>
                <th>UI Role & Mapping</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>pages</code></td>
                <td><strong>Page Container</strong></td>
                <td><code>slug</code></td>
                <td>Master page definitions (About, Philosophy, Legal) with body markdown, meta SEO tags, and hero badges.</td>
              </tr>
              <tr>
                <td><code>page_sections</code></td>
                <td><strong>Universal Slot</strong></td>
                <td><code>pageSlug</code> + <code>sectionKey</code></td>
                <td>Modular layout blocks (e.g. <code>pageSlug='home'</code> and <code>sectionKey='hero'</code>). Allows reordering and dynamic CTAs.</td>
              </tr>
              <tr>
                <td><code>feature_cards</code></td>
                <td><strong>Bento / Grid Slot</strong></td>
                <td><code>pageSlug</code> + <code>sectionKey</code></td>
                <td>Multi-column cards, bento highlights, and feature matrices with column span and icon pickers.</td>
              </tr>
              <tr>
                <td><code>gallery</code></td>
                <td><strong>Media Array</strong></td>
                <td><code>galleryKey</code> + <code>pageSlug</code></td>
                <td>Visual media carousels, photo galleries, and portfolio showcases backed by R2 descriptive keys.</td>
              </tr>
              <tr>
                <td><code>endorsements</code></td>
                <td><strong>Social Proof</strong></td>
                <td><code>kind</code> + <code>order</code></td>
                <td>Customer reviews, partner recommendations, press quotes, and star ratings.</td>
              </tr>
              <tr>
                <td><code>qa_items</code></td>
                <td><strong>FAQ Accordions</strong></td>
                <td><code>category</code> + <code>pageSlug</code></td>
                <td>Structured Q&A pairs formatted for frontend accordions and Schema.org FAQ SEO markup.</td>
              </tr>
              <tr>
                <td><code>site_navigation</code></td>
                <td><strong>Menu Hierarchy</strong></td>
                <td><code>menuKey</code> + <code>parentSlug</code></td>
                <td>Header navigation, nested dropdowns, and footer link trees with display ordering.</td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- Topic 4: Validations & Hooks -->
        <section class="card docs-section" id="validations-hooks" style="padding: 28px;">
          <h2 style="margin-top: 0; font-size: 20px; color: #38bdf8; display: flex; align-items: center; gap: 10px;">
            <span>🛡️</span> 4. Validations & Pre-Publish Pipeline
          </h2>
          <p style="color: var(--text-muted); font-size: 14px; line-height: 1.6;">
            SlottD implements a two-tier integrity system: <strong>Collection Lifecycle Hooks</strong> for individual record mutations, and an automated <strong>Pre-Publish Verification Pipeline</strong> before releasing content to Git.
          </p>

          <h3 style="font-size: 15px; color: #e2e8f0; margin-top: 18px; margin-bottom: 8px;">1. Collection Lifecycle Hooks</h3>
          <p style="color: var(--text-muted); font-size: 13px; line-height: 1.6;">
            Define hooks inside your SlottD configuration to validate data on write:
          </p>
          <pre class="code-block-content" style="border-radius: 6px; margin: 12px 0;"><code>export const postHooks: CollectionHooks = {
  beforeCreate: async (ctx) => {
    if (!ctx.data.title || ctx.data.title.trim().length &lt; 5) {
      return { status: 'error', message: 'Post title must be at least 5 characters.' };
    }
    return { status: 'ok', data: ctx.data };
  },
  beforeUpdate: async (ctx) => {
    // Prevent unpublishing critical homepage hero
    if (ctx.existing?.slug === 'section-home-hero' && ctx.data.status === 'archived') {
      return { status: 'error', message: 'Cannot archive the primary homepage hero section.' };
    }
    return { status: 'ok', data: ctx.data };
  }
};</code></pre>

          <h3 style="font-size: 15px; color: #e2e8f0; margin-top: 24px; margin-bottom: 8px;">2. Pre-Publish Verification Pipeline</h3>
          <p style="color: var(--text-muted); font-size: 13px; line-height: 1.6;">
            Before a Git release tag is created or records are exported, SlottD runs all configured <code>PublishCheck</code> audits. If any check fails, publication is blocked until issues are resolved.
          </p>

          <div class="docs-callout docs-callout-slotwire">
            <strong>⚡ SlotWire Contract Check (<code>slotwireContractCheck</code>):</strong>
            This check contacts your live frontend deployment (e.g. <code>https://yourdomain.com/api/slotwire/validate</code>) to verify that all slots defined in code have matching, valid content records in SlottD.
            Aggregated errors are clearly attributed with the check name prefix, e.g. <code>[SlotWire Schema Contracts] Slot 'hero' missing in page 'home'</code>.
          </div>
        </section>

        <!-- Topic 5: Media & Descriptive R2 -->
        <section class="card docs-section" id="media-r2" style="padding: 28px;">
          <h2 style="margin-top: 0; font-size: 20px; color: #38bdf8; display: flex; align-items: center; gap: 10px;">
            <span>🖼️</span> 5. Media & Descriptive R2 Storage
          </h2>
          <p style="color: var(--text-muted); font-size: 14px; line-height: 1.6;">
            Unlike traditional CMSs that store files under opaque UUID hashes (e.g. <code>5c29a8a-4d2...jpg</code>), SlottD enforces <strong>Human-Readable Descriptive Keys</strong> (e.g. <code>brian-avatar.jpg</code>, <code>project-freeformer.png</code>) directly inside Cloudflare R2.
          </p>

          <ul style="color: #cbd5e1; font-size: 13px; line-height: 1.8; margin-left: 20px;">
            <li><strong>Dual UUID $\leftrightarrow$ Key Resolution:</strong> SlottD maintains a bi-directional index in the D1 <code>media</code> table. You can fetch media using either its descriptive key (<code>/media/hero.png</code>) or its Directus UUID (<code>/files/uuid</code>).</li>
            <li><strong>Visual R2 Media Picker:</strong> When editing content, click <strong>"Browse R2"</strong> next to any media field to visually search and select assets with 1-click URL insertion.</li>
            <li><strong>Instant Uploads:</strong> Press <kbd>u</kbd> on the Media Library page or upload directly from the editor modal. Filenames are automatically sanitized to URL-safe slugs.</li>
          </ul>
        </section>

        <!-- Topic 6: Git Releases & Sync -->
        <section class="card docs-section" id="git-releases" style="padding: 28px;">
          <h2 style="margin-top: 0; font-size: 20px; color: #38bdf8; display: flex; align-items: center; gap: 10px;">
            <span>📦</span> 6. Git Releases, Dry-Run Diffs & D1 Hydration
          </h2>
          <p style="color: var(--text-muted); font-size: 14px; line-height: 1.6;">
            SlottD bridges live SQLite database records with Git version history without proprietary platform APIs. Remote Git operations run using pure <strong>Git Smart HTTP wire protocol</strong> via <code>isomorphic-git</code> directly inside Cloudflare Workers isolates.
          </p>

          <h3 style="font-size: 15px; color: #e2e8f0; margin-top: 18px; margin-bottom: 8px;">Release Workflow</h3>
          <ol style="color: #cbd5e1; font-size: 13px; line-height: 1.8; margin-left: 20px;">
            <li><strong>Export & Tag:</strong> Exports published D1 records into structured <code>content/</code> JSON and Markdown files, creating an annotated Git tag (e.g. <code>v1.0.4</code>).</li>
            <li><strong>Safe Diff (Dry Run):</strong> Before restoring any tag into D1, SlottD runs an in-memory semantic diff highlighting added, modified, and deleted records.</li>
            <li><strong>Confirm & Load into D1:</strong> Restores content from Git, reconciling records by <code>(collection, slug)</code> to preserve unique database keys and existing UUIDs.</li>
            <li><strong>Disaster Recovery Backups:</strong> Click <strong>"Download JSON Backup"</strong> on the Git page for an immediate offline archive of all records and media metadata.</li>
          </ol>
        </section>

        <!-- Topic 7: Auth & Security -->
        <section class="card docs-section" id="production-security" style="padding: 28px;">
          <h2 style="margin-top: 0; font-size: 20px; color: #38bdf8; display: flex; align-items: center; gap: 10px;">
            <span>🔒</span> 7. Production Security & Access Control
          </h2>
          <p style="color: var(--text-muted); font-size: 14px; line-height: 1.6;">
            SlottD secures content mutations and administration through zero-trust headers and bearer tokens.
          </p>

          <ul style="color: #cbd5e1; font-size: 13px; line-height: 1.8; margin-left: 20px;">
            <li><strong>Cloudflare Access (Zero Trust):</strong> SlottD reads the <code>Cf-Access-Authenticated-User-Email</code> header to grant operator privileges and log audit events.</li>
            <li><strong>Bearer API Key (<code>ADMIN_API_KEY</code>):</strong> For automated pipelines, CI/CD, or backend scripts, pass <code>Authorization: Bearer &lt;ADMIN_API_KEY&gt;</code>.</li>
            <li><strong>Encrypted Secret Storage:</strong> Git access tokens configured via the Setup UI are encrypted using AES-256 before being stored in the D1 <code>system_settings</code> table.</li>
            <li><strong>Setting Cloudflare Secrets:</strong> Use Wrangler CLI to store keys securely in Cloudflare KMS:
              <pre class="code-block-content" style="border-radius: 6px; margin-top: 8px;"><code>npx wrangler secret put ADMIN_API_KEY
npx wrangler secret put GIT_TOKEN</code></pre>
            </li>
          </ul>
        </section>

        <!-- Topic 8: REST Query Cheat Sheet -->
        <section class="card docs-section" id="directus-api-cheat" style="padding: 28px;">
          <h2 style="margin-top: 0; font-size: 20px; color: #a5b4fc; display: flex; align-items: center; gap: 10px;">
            <span>📖</span> Directus REST Query Cheat Sheet
          </h2>
          <p style="color: var(--text-muted); font-size: 14px; line-height: 1.6;">
            Quick reference for URL query parameters supported on <code>GET /items/:collection</code>.
          </p>

          <table class="data-table" style="width: 100%; margin-top: 16px;">
            <thead>
              <tr>
                <th style="width: 190px;">Parameter</th>
                <th style="width: 240px;">Example</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>filter[field][_eq]</code></td>
                <td><code>filter[status][_eq]=published</code></td>
                <td>Exact equality match.</td>
              </tr>
              <tr>
                <td><code>filter[field][_neq]</code></td>
                <td><code>filter[status][_neq]=archived</code></td>
                <td>Not equal.</td>
              </tr>
              <tr>
                <td><code>filter[field][_in]</code></td>
                <td><code>filter[kind][_in]=review,quote</code></td>
                <td>Matches any value in comma-separated list.</td>
              </tr>
              <tr>
                <td><code>filter[field][_contains]</code></td>
                <td><code>filter[title][_contains]=Astro</code></td>
                <td>Case-insensitive substring match.</td>
              </tr>
              <tr>
                <td><code>filter[field][_gt] / [_gte]</code></td>
                <td><code>filter[order][_gte]=10</code></td>
                <td>Numeric or date comparison.</td>
              </tr>
              <tr>
                <td><code>filter[field][_null]</code></td>
                <td><code>filter[deleted_at][_null]=true</code></td>
                <td>Checks whether field is NULL or NOT NULL.</td>
              </tr>
              <tr>
                <td><code>sort</code></td>
                <td><code>sort=-date_created,order</code></td>
                <td>Comma-separated sort keys (prefix with <code>-</code> for descending).</td>
              </tr>
              <tr>
                <td><code>fields</code></td>
                <td><code>fields=id,slug,title,heroImage</code></td>
                <td>Selects specific columns to return, reducing response size.</td>
              </tr>
              <tr>
                <td><code>limit</code> & <code>offset</code></td>
                <td><code>limit=25&offset=50</code></td>
                <td>Pagination controls.</td>
              </tr>
              <tr>
                <td><code>search</code></td>
                <td><code>search=documentation</code></td>
                <td>Full-text search across all text/markdown fields.</td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- Topic 9: Keyboard Shortcuts -->
        <section class="card docs-section" id="shortcuts-cheat" style="padding: 28px;">
          <h2 style="margin-top: 0; font-size: 20px; color: #a5b4fc; display: flex; align-items: center; gap: 10px;">
            <span>⌨️</span> Universal Studio Keyboard Shortcuts
          </h2>

          <table class="data-table" style="width: 100%; margin-top: 16px;">
            <thead>
              <tr>
                <th style="width: 180px;">Shortcut</th>
                <th style="width: 220px;">Scope</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><kbd>/</kbd></td>
                <td>Universal</td>
                <td>Focus search bar (Collections, Media, Models, Logs, Docs)</td>
              </tr>
              <tr>
                <td><kbd>Esc</kbd></td>
                <td>Universal</td>
                <td>Clear search focus / Dismiss modals & highlights</td>
              </tr>
              <tr>
                <td><kbd>n</kbd> or <kbd>c</kbd></td>
                <td>Dashboard & Tables</td>
                <td>Create new document record / New collection</td>
              </tr>
              <tr>
                <td><kbd>↑</kbd> / <kbd>↓</kbd> / <kbd>←</kbd> / <kbd>→</kbd></td>
                <td>Collections & Media</td>
                <td>Keyboard navigate cards, rows, and logs</td>
              </tr>
              <tr>
                <td><kbd>Enter</kbd></td>
                <td>Navigation & Modals</td>
                <td>Open highlighted collection, toggle accordion, or inspect log diff</td>
              </tr>
              <tr>
                <td><kbd>u</kbd></td>
                <td>Media Library</td>
                <td>Open file upload dialog</td>
              </tr>
              <tr>
                <td><kbd>Delete</kbd></td>
                <td>Media Library</td>
                <td>Delete highlighted asset from R2 storage</td>
              </tr>
            </tbody>
          </table>
        </section>

      </main>
    </div>

    <style>
      kbd {
        background: #1e293b;
        border: 1px solid #475569;
        border-radius: 4px;
        padding: 2px 6px;
        font-family: monospace;
        font-size: 11px;
        color: #38bdf8;
        box-shadow: 0 1px 2px rgba(0,0,0,0.4);
      }
    </style>

    <script>
      ${raw(clientScript)}
    </script>
  `);
}
