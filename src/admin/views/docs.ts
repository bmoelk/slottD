import { html, raw } from 'hono/html';
import { renderLayout } from '../layout.js';

export function renderDocsView(user: { email: string; authMethod?: string }) {
  const clientScript = `
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
  `;

  return renderLayout('User Documentation & Guide — SlottD Studio', 'docs', user, html`
    <div class="header">
      <div>
        <h1>User Documentation & Guide</h1>
        <p class="subtitle">Complete reference for managing content, media assets, SlotWire live previews, and Git releases.</p>
      </div>
      <div class="header-stats">
        <span class="stat-pill" id="docsMatchCount">6 Guides</span>
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
          placeholder="Search user guide & keyboard shortcuts... (Press / to focus)"
          oninput="filterDocs(this.value)"
          autocomplete="off"
        />
      </div>
    </div>

    <div class="docs-container" style="display: flex; flex-direction: column; gap: 24px;">

      <!-- Guide 1: Architecture & Overview -->
      <div class="card docs-section" id="intro" style="padding: 24px;">
        <h2 style="margin-top: 0; font-size: 18px; color: #38bdf8; display: flex; align-items: center; gap: 8px;">
          <span>🌐</span> 1. SlottD Architecture & Philosophy
        </h2>
        <p style="color: var(--text-muted); font-size: 14px; line-height: 1.6;">
          SlottD is an edge-native, zero-build micro-CMS built directly into Cloudflare Workers isolates. It provides 100% Directus SDK and REST compatibility while maintaining bi-directional synchronization with Git repositories.
        </p>
        <ul style="color: #cbd5e1; font-size: 13px; line-height: 1.8; margin-left: 20px;">
          <li><strong>Zero-Build Studio:</strong> Rendered server-side on-demand via <code>hono/html</code> with zero client framework hydration bloat.</li>
          <li><strong>Cloudflare D1 & R2:</strong> Sub-millisecond global SQL querying on D1 and edge-cached asset streaming from Cloudflare R2.</li>
          <li><strong>Directus REST Compatible:</strong> Supports <code>GET /items/:collection</code>, <code>GET /files</code>, filtering, and sorting out of the box.</li>
        </ul>
      </div>

      <!-- Guide 2: Content & Collections -->
      <div class="card docs-section" id="content" style="padding: 24px;">
        <h2 style="margin-top: 0; font-size: 18px; color: #38bdf8; display: flex; align-items: center; gap: 8px;">
          <span>📁</span> 2. Managing Content & Collections
        </h2>
        <p style="color: var(--text-muted); font-size: 14px; line-height: 1.6;">
          A <strong>Collection</strong> is a table of documents governed by a <strong>Model Schema</strong>.
        </p>
        <ul style="color: #cbd5e1; font-size: 13px; line-height: 1.8; margin-left: 20px;">
          <li><strong>Creating Records:</strong> Press <kbd>n</kbd> or <kbd>c</kbd> anywhere on the Dashboard or Collection views to instantly create a new record.</li>
          <li><strong>Draft vs. Published:</strong> Documents can be set to <code>Draft</code>, <code>Published</code>, or <code>Archived</code>. Draft documents are visible in live preview mode but excluded from production builds.</li>
          <li><strong>Schema-Enforced Custom Fields:</strong> Custom fields (like <code>badgeText</code>, <code>ctaUrl</code>, <code>order</code>) are automatically validated and cast according to the Model definition.</li>
        </ul>
      </div>

      <!-- Guide 3: Media & R2 Storage -->
      <div class="card docs-section" id="media" style="padding: 24px;">
        <h2 style="margin-top: 0; font-size: 18px; color: #38bdf8; display: flex; align-items: center; gap: 8px;">
          <span>🖼️</span> 3. Media & Descriptive R2 Storage
        </h2>
        <p style="color: var(--text-muted); font-size: 14px; line-height: 1.6;">
          SlottD enforces <strong>Human-Readable Descriptive Keys</strong> (e.g. <code>hero-1.jpeg</code>, <code>pottery-1.jpg</code>) rather than opaque UUIDs.
        </p>
        <ul style="color: #cbd5e1; font-size: 13px; line-height: 1.8; margin-left: 20px;">
          <li><strong>Browse & Select:</strong> Click <strong>"Browse R2"</strong> next to any image field in the Content Editor to visually choose an asset with 1-click URL insertion.</li>
          <li><strong>Direct Upload:</strong> Press <kbd>u</kbd> on the Media page or upload directly from the Media Picker modal in the editor.</li>
          <li><strong>Dual URL Resolution:</strong> Files are accessible via relative URLs (<code>/media/filename.png</code>) and full CDN origin URLs.</li>
        </ul>
      </div>

      <!-- Guide 4: SlotWire Bridge -->
      <div class="card docs-section" id="slotwire" style="padding: 24px;">
        <h2 style="margin-top: 0; font-size: 18px; color: #38bdf8; display: flex; align-items: center; gap: 8px;">
          <span>⚡</span> 4. SlotWire In-Situ Bridge & Live Previews
        </h2>
        <p style="color: var(--text-muted); font-size: 14px; line-height: 1.6;">
          SlotWire connects Astro and frontend applications directly with SlottD Studio.
        </p>
        <ul style="color: #cbd5e1; font-size: 13px; line-height: 1.8; margin-left: 20px;">
          <li><strong>Live In-Situ Links:</strong> SlotWire overlays provide deep links straight to the exact document editor in SlottD Studio (e.g. <code>/admin/content/page_sections/section-home-hero</code>).</li>
          <li><strong>Preview Cookie Bypass:</strong> Setting the <code>slotwire_preview=true</code> cookie bypasses static build caches to render live draft changes in real time.</li>
        </ul>
      </div>

      <!-- Guide 5: Git Operations -->
      <div class="card docs-section" id="git" style="padding: 24px;">
        <h2 style="margin-top: 0; font-size: 18px; color: #38bdf8; display: flex; align-items: center; gap: 8px;">
          <span>🚀</span> 5. Git Releases & Cross-Environment Deployment
        </h2>
        <p style="color: var(--text-muted); font-size: 14px; line-height: 1.6;">
          SlottD maintains full Git version control of your database state in human-readable JSON/Markdown.
        </p>
        <ul style="color: #cbd5e1; font-size: 13px; line-height: 1.8; margin-left: 20px;">
          <li><strong>Export & Tag:</strong> Exports active D1 records into <code>content/</code> and creates an annotated release tag.</li>
          <li><strong>Safe Diff (Dry Run):</strong> Automatically runs <code>git diff --stat</code> before restoring tags so you can preview file additions, modifications, and deletions.</li>
          <li><strong>Direct Backups:</strong> Click <strong>"Download JSON Backup"</strong> to generate a complete offline JSON archive of all records and media metadata.</li>
        </ul>
      </div>

      <!-- Guide 6: Keyboard Shortcuts Cheat Sheet -->
      <div class="card docs-section" id="shortcuts" style="padding: 24px; border: 1px solid rgba(99, 102, 241, 0.4);">
        <h2 style="margin-top: 0; font-size: 18px; color: #a5b4fc; display: flex; align-items: center; gap: 8px;">
          <span>⌨️</span> 6. Universal Keyboard Shortcuts Cheat Sheet
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
              <td>Create new record / New collection</td>
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
      </div>

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
