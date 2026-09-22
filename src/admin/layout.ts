import { html } from 'hono/html';
import { adminStyles } from './styles.js';

export type AdminTab = 'home' | 'content' | 'media' | 'models' | 'logs' | 'activity' | 'sync' | 'git' | 'setup' | 'docs' | 'help' | 'sites';

export function renderLayout(
  title: string,
  activeTab: AdminTab,
  user: { email: string; name?: string; authMethod?: string },
  content: any,
  editorConfig?: { format?: 'markdown' | 'richtext'; tier?: 'light' | 'heavy' },
  siteContext?: { activeSite?: string; availableSites?: string[] }
) {
  const tier = editorConfig?.tier || 'light';
  const format = editorConfig?.format || 'markdown';

  const isSystemActive = ['models', 'logs', 'activity', 'setup'].includes(activeTab);

  return html`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Crect width='512' height='512' rx='96' fill='%231e293b'/%3E%3Cpath d='M 160 128 H 210 V 384 H 160 Z' fill='%23FFD043'/%3E%3Cpath d='M 218 128 H 304 C 364 128 408 172 408 232 H 344 C 344 198 320 184 296 184 H 218 Z' fill='%23FF8A00'/%3E%3Cpath d='M 218 328 H 296 C 320 328 344 314 344 280 H 408 C 408 340 364 384 304 384 H 218 Z' fill='%23FFD043'/%3E%3Crect x='200' y='244' width='112' height='24' rx='4' fill='%23FFE082'/%3E%3C/svg%3E" />
      <!-- Editor Micro-Libraries & Styles -->
      ${tier === 'heavy' ? html`
        ${format === 'richtext' ? html`
          <link rel="stylesheet" href="https://unpkg.com/trix@2.0.8/dist/trix.css" />
          <script src="https://unpkg.com/trix@2.0.8/dist/trix.umd.min.js"></script>
        ` : html`
          <link rel="stylesheet" href="https://uicdn.toast.com/editor/latest/toastui-editor.min.css" />
          <script src="https://uicdn.toast.com/editor/latest/toastui-editor-all.min.js"></script>
        `}
      ` : html`
        <!-- Zero-CDN Offline-Native Vendor Assets -->
        <script defer src="/admin/vendor/markdown-toolbar.js?v=2"></script>
        <script defer src="/admin/vendor/pell.js?v=2"></script>
      `}
      <!-- Markdown & UI Micro-Libraries (Vendor-served from local worker isolate for 100% offline resilience) -->
      <script defer src="/admin/vendor/marked.js?v=2"></script>
      <script defer src="/admin/vendor/alpine.js"></script>
      <style>
        ${adminStyles}
      </style>
    </head>
    <body>
      <div class="topbar">
        <div style="display: flex; align-items: center; gap: 12px; margin-right: 28px;">
          <a href="/admin/sites" class="brand" style="text-decoration: none; color: inherit;">
            <svg viewBox="0 0 512 512" width="28" height="28">
              <rect width="512" height="512" rx="96" fill="#1e293b"/>
              <path d="M 160 128 H 210 V 384 H 160 Z" fill="#FFD043"/>
              <path d="M 218 128 H 304 C 364 128 408 172 408 232 H 344 C 344 198 320 184 296 184 H 218 Z" fill="#FF8A00"/>
              <path d="M 218 328 H 296 C 320 328 344 314 344 280 H 408 C 408 340 364 384 304 384 H 218 Z" fill="#FFD043"/>
              <rect x="200" y="244" width="112" height="24" rx="4" fill="#FFE082"/>
            </svg>
            <h1>SlottD Studio</h1>
          </a>
          <div class="site-switcher" style="display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.06); padding: 3px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.14);" title="Active Website Context">
            <span style="font-size: 13px;">🌐</span>
            <select onchange="document.cookie='slottd_active_site='+encodeURIComponent(this.value)+'; path=/; max-age=31536000'; window.location.reload();" style="background: transparent; color: #38bdf8; border: none; font-size: 12px; font-weight: 600; cursor: pointer; outline: none;">
              ${(siteContext?.availableSites && siteContext.availableSites.length > 0 ? siteContext.availableSites : [siteContext?.activeSite || 'default']).map(s => html`<option value="${s}" ${s === (siteContext?.activeSite || 'default') ? 'selected' : ''} style="background: #1e293b; color: #f8fafc;">${s}</option>`)}
            </select>
          </div>
        </div>
        <div class="nav-tabs">
          <a href="/admin/sites" class="nav-tab ${activeTab === 'sites' || activeTab === 'home' ? 'active' : ''}">Sites</a>
          <a href="/admin/content" class="nav-tab ${activeTab === 'content' ? 'active' : ''}">Content</a>
          <a href="/admin/media" class="nav-tab ${activeTab === 'media' ? 'active' : ''}">Media</a>
          <a href="/admin/git" class="nav-tab ${activeTab === 'git' || activeTab === 'sync' ? 'active' : ''}">Git</a>
          <div class="nav-dropdown">
            <button
              type="button"
              class="nav-tab ${isSystemActive ? 'active' : ''}"
              style="display: inline-flex; align-items: center; gap: 5px; cursor: pointer; background: ${isSystemActive ? 'var(--accent)' : 'transparent'}; border: none; font-family: inherit; font-size: 13px;"
            >
              <span>System</span>
              <span style="font-size: 9px; opacity: 0.7;">▼</span>
            </button>
            <div class="nav-dropdown-menu">
              <a href="/admin/models" class="nav-dropdown-item ${activeTab === 'models' ? 'active' : ''}">Models</a>
              <a href="/admin/logs" class="nav-dropdown-item ${activeTab === 'logs' || activeTab === 'activity' ? 'active' : ''}">Logs & Activity</a>
              <a href="/admin/setup" class="nav-dropdown-item ${activeTab === 'setup' ? 'active' : ''}">Setup</a>
            </div>
          </div>
          <a href="/admin/docs" class="nav-tab ${activeTab === 'docs' || activeTab === 'help' ? 'active' : ''}">Help</a>
        </div>
        <div class="nav-dropdown">
          <div class="user-badge" title="Operator: ${user?.email || 'dev@localhost'} (${user?.authMethod || 'local-briefcase'})">
            <span style="font-size: 8px; color: ${user?.authMethod === 'cloudflare-access' ? '#10b981' : '#38bdf8'};">●</span>
            <span style="max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${user?.name || user?.email || 'dev@localhost'}</span>
            ${user?.authMethod === 'local-briefcase' ? html`<span style="font-size: 9px; color: #38bdf8; font-weight: 700;">[Briefcase]</span>` : ''}
            <span style="font-size: 9px; opacity: 0.7; margin-left: 2px;">▼</span>
          </div>
          <div class="nav-dropdown-menu nav-dropdown-menu-right" style="min-width: 190px;">
            <div style="padding: 8px 12px; font-size: 11px; border-bottom: 1px solid #1e293b; margin-bottom: 4px;">
              <div style="font-weight: 600; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${user?.name || 'Operator'}</div>
              <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #94a3b8; font-size: 10px; margin-top: 2px;">${user?.email || 'dev@localhost'}</div>
            </div>
            <a href="/admin/logout" class="nav-dropdown-item danger">
              Sign Out
            </a>
          </div>
        </div>
      </div>
      ${content}
    </body>
    </html>
  `;
}
