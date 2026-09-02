import { html } from 'hono/html';
import { renderLayout } from '../layout.js';

export interface HomeDashboardData {
  environment: string;
  docCount: number;
  collectionCount: number;
  publishedCount: number;
  draftCount: number;
  mediaCount: number;
  mediaSizeBytes: number;
  modelCount: number;
  tagCount: number;
  recentActivity: any[];
}

export function renderHomeView(
  data: HomeDashboardData,
  user: { email: string; authMethod?: string }
) {
  const mediaMb = (data.mediaSizeBytes / (1024 * 1024)).toFixed(2);

  return renderLayout('Dashboard — SlottD Studio', 'home', user, html`
    <div class="header">
      <div>
        <h1>SlottD Studio Overview</h1>
        <p class="subtitle">Cloudflare Edge-Native Headless CMS &bull; Zero-Build Runtime &bull; Git Version Control</p>
      </div>
      <div class="header-actions">
        <a href="/admin" class="btn btn-primary">+ Manage Content</a>
        <a href="/admin/media" class="btn btn-secondary">+ Upload Asset</a>
      </div>
    </div>

    <!-- Overview Metrics Grid -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px;">
      
      <div class="card" style="padding: 20px; border-left: 4px solid #6366f1;">
        <span style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.5px; display: block; margin-bottom: 4px;">Content Records</span>
        <div style="font-size: 28px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">
          ${data.docCount}
        </div>
        <div style="font-size: 12px; color: var(--text-muted);">
          across <strong>${data.collectionCount}</strong> Collections (${data.publishedCount} published)
        </div>
      </div>

      <div class="card" style="padding: 20px; border-left: 4px solid #10b981;">
        <span style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.5px; display: block; margin-bottom: 4px;">Media & R2 Assets</span>
        <div style="font-size: 28px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">
          ${data.mediaCount}
        </div>
        <div style="font-size: 12px; color: var(--text-muted);">
          Descriptive R2 keys (~${mediaMb} MB total)
        </div>
      </div>

      <div class="card" style="padding: 20px; border-left: 4px solid #38bdf8;">
        <span style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.5px; display: block; margin-bottom: 4px;">Schema Models</span>
        <div style="font-size: 28px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">
          ${data.modelCount}
        </div>
        <div style="font-size: 12px; color: var(--text-muted);">
          Dynamic SQLite Views & Contracts
        </div>
      </div>

      <div class="card" style="padding: 20px; border-left: 4px solid #f59e0b;">
        <span style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.5px; display: block; margin-bottom: 4px;">Git Versioning</span>
        <div style="font-size: 28px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">
          ${data.tagCount} Tags
        </div>
        <div style="font-size: 12px; color: var(--text-muted);">
          Cross-environment snapshot engine
        </div>
      </div>

    </div>

    <!-- Quick Navigation & System Status Grid -->
    <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 24px; margin-bottom: 24px;">
      
      <!-- Quick Access Hub -->
      <div class="card" style="padding: 24px;">
        <h3 style="margin-top: 0; margin-bottom: 16px; font-size: 16px; display: flex; align-items: center; gap: 8px;">
          <span>⚡</span> Quick Action Hub
        </h3>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
          <a href="/admin" class="btn btn-secondary" style="padding: 14px; text-align: left; display: flex; flex-direction: column; gap: 4px; height: auto;">
            <strong style="color: #fff;">📁 Browse Collections</strong>
            <span style="font-size: 11px; color: var(--text-muted);">Edit, filter, and inspect documents</span>
          </a>

          <a href="/admin/media" class="btn btn-secondary" style="padding: 14px; text-align: left; display: flex; flex-direction: column; gap: 4px; height: auto;">
            <strong style="color: #fff;">🖼️ Media Library</strong>
            <span style="font-size: 11px; color: var(--text-muted);">Manage Cloudflare R2 images</span>
          </a>

          <a href="/admin/models" class="btn btn-secondary" style="padding: 14px; text-align: left; display: flex; flex-direction: column; gap: 4px; height: auto;">
            <strong style="color: #fff;">🧱 Model Registry</strong>
            <span style="font-size: 11px; color: var(--text-muted);">Inspect field types and contracts</span>
          </a>

          <a href="/admin/git" class="btn btn-secondary" style="padding: 14px; text-align: left; display: flex; flex-direction: column; gap: 4px; height: auto;">
            <strong style="color: #fff;">🚀 Git Release Center</strong>
            <span style="font-size: 11px; color: var(--text-muted);">Commit, tag, and dry-run diffs</span>
          </a>

          <a href="/admin/logs" class="btn btn-secondary" style="padding: 14px; text-align: left; display: flex; flex-direction: column; gap: 4px; height: auto;">
            <strong style="color: #fff;">📋 Activity & Audit Log</strong>
            <span style="font-size: 11px; color: var(--text-muted);">Track real-time mutations</span>
          </a>

          <a href="/admin/docs" class="btn btn-secondary" style="padding: 14px; text-align: left; display: flex; flex-direction: column; gap: 4px; height: auto;">
            <strong style="color: #fff;">📖 User Documentation</strong>
            <span style="font-size: 11px; color: var(--text-muted);">Architecture, guides & shortcuts</span>
          </a>
        </div>
      </div>

      <!-- Edge Architecture & Status Card -->
      <div class="card" style="padding: 24px;">
        <h3 style="margin-top: 0; margin-bottom: 16px; font-size: 16px; display: flex; align-items: center; gap: 8px;">
          <span>🌐</span> Edge Environment
        </h3>

        <div style="display: flex; flex-direction: column; gap: 12px; font-size: 13px;">
          <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--surface-border); padding-bottom: 8px;">
            <span style="color: var(--text-muted);">Status</span>
            <span style="color: #10b981; font-weight: 600;">● Online</span>
          </div>

          <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--surface-border); padding-bottom: 8px;">
            <span style="color: var(--text-muted);">Runtime</span>
            <span style="color: #fff; font-family: monospace;">Cloudflare Workers</span>
          </div>

          <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--surface-border); padding-bottom: 8px;">
            <span style="color: var(--text-muted);">Database</span>
            <span style="color: #fff; font-family: monospace;">Cloudflare D1</span>
          </div>

          <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--surface-border); padding-bottom: 8px;">
            <span style="color: var(--text-muted);">Storage</span>
            <span style="color: #fff; font-family: monospace;">Cloudflare R2</span>
          </div>

          <div style="display: flex; justify-content: space-between;">
            <span style="color: var(--text-muted);">REST API</span>
            <span style="color: #38bdf8; font-weight: 500;">Directus Compatible</span>
          </div>
        </div>
      </div>

    </div>

    <!-- Recent Activity Stream -->
    <div class="card" style="padding: 20px;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
        <h3 style="margin: 0; font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
          <span>📋</span> Recent Activity
        </h3>
        <a href="/admin/logs" class="btn-link">View All Logs &rarr;</a>
      </div>

      ${data.recentActivity.length === 0 ? html`
        <p style="font-size: 13px; color: var(--text-muted); margin: 0;">No activity recorded yet.</p>
      ` : html`
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${data.recentActivity.slice(0, 5).map((act) => {
            const dateStr = new Date(act.timestamp).toLocaleString();
            const actionColors: Record<string, string> = {
              create: '#10b981',
              update: '#3b82f6',
              delete: '#ef4444',
              release_tag: '#8b5cf6',
              hydrate: '#f59e0b',
            };
            const color = actionColors[act.action] || '#6b7280';
            return html`
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: rgba(255,255,255,0.02); border-radius: 6px; font-size: 13px; border: 1px solid rgba(255,255,255,0.06); flex-wrap: wrap; gap: 8px;">
                <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                  <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 11px; text-transform: uppercase; background: ${color}20; color: ${color}; border: 1px solid ${color}40;">
                    ${act.action}
                  </span>
                  <span style="font-weight: 500; color: var(--text-primary);">
                    ${act.collection ? html`<code style="font-size: 12px; color: var(--text-muted);">${act.collection}</code> / ` : ''}<strong>${act.document_title || act.document_id}</strong>
                  </span>
                  <span style="font-size: 12px; color: var(--text-muted);">by ${act.actor}</span>
                </div>
                <time style="font-size: 12px; color: var(--text-muted);" title="${dateStr}">${dateStr}</time>
              </div>
            `;
          })}
        </div>
      `}
    </div>
  `);
}
