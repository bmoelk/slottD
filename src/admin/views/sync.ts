import { html } from 'hono/html';
import { renderLayout } from '../layout.js';

export interface SyncStats {
  documentCount: number;
  collectionCount: number;
  mediaCount: number;
  environment: string;
  collectionsBreakdown: { name: string; count: number }[];
}

export function renderSyncView(
  stats: SyncStats,
  user: { email: string; authMethod?: string },
  flashMessage?: { type: 'success' | 'error'; message: string }
) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '.');
  const timeStr = now.toTimeString().slice(0, 5).replace(/:/g, '');
  const defaultTag = `release-${dateStr}-${timeStr}`;

  return renderLayout('SlottD Studio - Sync & Releases', 'sync', user, html`
    <div class="header">
      <div>
        <h1>Git Sync & Releases</h1>
        <p class="subtitle">Snapshot your D1 content to Git, create versioned releases, and promote content across environments.</p>
      </div>
      <div class="header-stats">
        <span class="stat-pill">Env: ${stats.environment.toUpperCase()}</span>
        <span class="stat-pill">${stats.documentCount} Documents</span>
        <span class="stat-pill">${stats.mediaCount} Media Assets</span>
      </div>
    </div>

    ${flashMessage ? html`
      <div class="alert alert-${flashMessage.type}" style="margin: 0 0 1.5rem 0; padding: 1rem 1.25rem; border-radius: 8px; font-size: 14px; display: flex; align-items: center; gap: 8px; background: ${flashMessage.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'}; border: 1px solid ${flashMessage.type === 'success' ? '#10b981' : '#ef4444'}; color: ${flashMessage.type === 'success' ? '#34d399' : '#f87171'};">
        <span>${flashMessage.type === 'success' ? '✅' : '❌'}</span>
        <span>${flashMessage.message}</span>
      </div>
    ` : ''}

    <!-- 2-Step Local to Cloud Promotion Workflow Card -->
    <div class="card" style="margin-bottom: 1.5rem; background: linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(6, 182, 212, 0.04)); border: 1px solid rgba(16, 185, 129, 0.3);">
      <h3 style="margin-top: 0; color: #34d399; display: flex; align-items: center; gap: 8px;">
        <span>🧭</span> Seamless Local ➔ Cloud Promotion Workflow
      </h3>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; margin-top: 1rem;">
        <div style="background: #18181b; border: 1px solid #27272a; padding: 1rem; border-radius: 8px;">
          <strong style="color: #60a5fa; display: block; margin-bottom: 4px;">Step 1: Snapshot Locally</strong>
          <p style="font-size: 12px; color: #a1a1aa; margin: 0 0 8px 0;">
            Create a versioned release snapshot. SlottD serializes all D1 documents & models to clean <code>content/</code> files and Git tags.
          </p>
          <span style="font-size: 11px; background: #27272a; color: #e4e4e7; padding: 2px 6px; border-radius: 4px;">Local Studio ➔ Git</span>
        </div>
        <div style="background: #18181b; border: 1px solid #27272a; padding: 1rem; border-radius: 8px;">
          <strong style="color: #34d399; display: block; margin-bottom: 4px;">Step 2: Hydrate in Cloud</strong>
          <p style="font-size: 12px; color: #a1a1aa; margin: 0 0 8px 0;">
            In Remote SlottD Studio (or via deploy hooks), click "Hydrate from Git" to apply the release snapshot directly to Cloudflare D1.
          </p>
          <span style="font-size: 11px; background: rgba(16, 185, 129, 0.2); color: #34d399; padding: 2px 6px; border-radius: 4px;">Git ➔ Cloudflare D1</span>
        </div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 1.5rem;">
      <!-- Export & Snapshot Card -->
      <div class="card">
        <h3 style="margin-top: 0; display: flex; align-items: center; gap: 8px;">
          <span>📦</span> Create Release Snapshot (D1 ➔ Git)
        </h3>
        <p style="font-size: 13px; color: #a1a1aa;">
          Exports current database state into structured <code>.json</code> metadata and companion <code>.md</code> files.
        </p>

        <form method="POST" action="/admin/sync/export" style="display: flex; flex-direction: column; gap: 1rem; margin-top: 1rem;">
          <div class="form-group">
            <label for="tagName" style="font-size: 12px; font-weight: 600; color: #d4d4d8;">Release Tag Name</label>
            <input type="text" id="tagName" name="tagName" value="${defaultTag}" required class="input-text" style="width: 100%; font-family: monospace;" />
          </div>

          <div class="form-group">
            <label for="commitMessage" style="font-size: 12px; font-weight: 600; color: #d4d4d8;">Commit Message</label>
            <input type="text" id="commitMessage" name="commitMessage" value="Production Content Release: ${defaultTag}" required class="input-text" style="width: 100%;" />
          </div>

          <button type="submit" class="btn btn-primary" style="padding: 0.75rem 1rem; font-weight: 600; justify-content: center;">
            🚀 Export to Git & Create Release Snapshot
          </button>
        </form>

        <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #27272a; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 12px; color: #71717a;">Offline Backup:</span>
          <a href="/api/sync/export" target="_blank" class="btn btn-secondary" style="font-size: 12px; padding: 4px 8px;">
            ⬇️ Download JSON Bundle
          </a>
        </div>
      </div>

      <!-- Hydrate Database Card -->
      <div class="card">
        <h3 style="margin-top: 0; display: flex; align-items: center; gap: 8px;">
          <span>📥</span> Hydrate Database (Git ➔ D1)
        </h3>
        <p style="font-size: 13px; color: #a1a1aa;">
          Scans all files in the <code>content/</code> directory and restores or updates the documents table in D1.
        </p>

        <div style="background: #18181b; border: 1px solid #27272a; padding: 1rem; border-radius: 8px; margin: 1rem 0;">
          <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 6px;">
            <span style="color: #71717a;">Schema Version Support:</span>
            <strong style="color: #34d399;">v1 (Rule 5 Fail-Fast Validated)</strong>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 12px;">
            <span style="color: #71717a;">Target Database:</span>
            <strong style="color: #e4e4e7;">${stats.environment === 'development' ? 'Local SQLite (.wrangler)' : 'Remote Cloudflare D1'}</strong>
          </div>
        </div>

        <form method="POST" action="/admin/sync/hydrate" onsubmit="return confirm('Are you sure you want to hydrate D1 from Git content files? Existing matching documents will be updated.');">
          <button type="submit" class="btn btn-secondary" style="width: 100%; padding: 0.75rem 1rem; font-weight: 600; justify-content: center; border-color: #3f3f46;">
            📥 Hydrate D1 from Git Content Files
          </button>
        </form>

        <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #27272a;">
          <span style="font-size: 12px; color: #71717a; display: block; margin-bottom: 8px;">Active Collections in D1:</span>
          <div style="display: flex; flex-wrap: wrap; gap: 4px; max-height: 120px; overflow-y: auto;">
            ${stats.collectionsBreakdown.map((c) => html`
              <span style="font-size: 11px; background: #27272a; color: #d4d4d8; padding: 2px 6px; border-radius: 4px;">
                ${c.name}: <strong>${c.count}</strong>
              </span>
            `)}
          </div>
        </div>
      </div>
    </div>
  `);
}