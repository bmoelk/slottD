import { html } from 'hono/html';
import { adminStyles } from './styles.js';

export type AdminTab = 'home' | 'content' | 'media' | 'models' | 'logs' | 'activity' | 'sync' | 'git' | 'setup' | 'docs' | 'help';

export function renderLayout(
  title: string,
  activeTab: AdminTab,
  user: { email: string; name?: string; authMethod?: string },
  content: any,
  editorConfig?: { format?: 'markdown' | 'richtext'; tier?: 'light' | 'heavy' }
) {
  const tier = editorConfig?.tier || 'light';
  const format = editorConfig?.format || 'markdown';

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
        <script defer src="/admin/vendor/markdown-toolbar.js"></script>
        <script defer src="/admin/vendor/pell.js"></script>
      `}
      <!-- Markdown & UI Micro-Libraries (Vendor-served from local worker isolate for 100% offline resilience) -->
      <script defer src="/admin/vendor/marked.js"></script>
      <script defer src="/admin/vendor/alpine.js"></script>
      <style>
        ${adminStyles}
      </style>
    </head>
    <body>
      <div class="topbar">
        <a href="/admin/home" class="brand" style="text-decoration: none; color: inherit;">
          <svg viewBox="0 0 512 512" width="28" height="28">
            <rect width="512" height="512" rx="96" fill="#1e293b"/>
            <path d="M 160 128 H 210 V 384 H 160 Z" fill="#FFD043"/>
            <path d="M 218 128 H 304 C 364 128 408 172 408 232 H 344 C 344 198 320 184 296 184 H 218 Z" fill="#FF8A00"/>
            <path d="M 218 328 H 296 C 320 328 344 314 344 280 H 408 C 408 340 364 384 304 384 H 218 Z" fill="#FFD043"/>
            <rect x="200" y="244" width="112" height="24" rx="4" fill="#FFE082"/>
          </svg>
          <h1>SlottD Studio</h1>
        </a>
        <div class="nav-tabs">
          <a href="/admin/home" class="nav-tab ${activeTab === 'home' ? 'active' : ''}">Home</a>
          <a href="/admin" class="nav-tab ${activeTab === 'content' ? 'active' : ''}">Content</a>
          <a href="/admin/media" class="nav-tab ${activeTab === 'media' ? 'active' : ''}">Media</a>
          <a href="/admin/models" class="nav-tab ${activeTab === 'models' ? 'active' : ''}">Models</a>
          <a href="/admin/logs" class="nav-tab ${activeTab === 'logs' || activeTab === 'activity' ? 'active' : ''}">Logs</a>
          <a href="/admin/git" class="nav-tab ${activeTab === 'git' ? 'active' : ''}">Git</a>
          <a href="/admin/setup" class="nav-tab ${activeTab === 'setup' ? 'active' : ''}">Setup</a>
          <a href="/admin/docs" class="nav-tab ${activeTab === 'docs' || activeTab === 'help' ? 'active' : ''}">Help</a>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <div class="user-badge" title="Operator: ${user?.email || 'dev@localhost'} (${user?.authMethod || 'local-briefcase'})">
            <span style="color: ${user?.authMethod === 'cloudflare-access' ? '#10b981' : '#38bdf8'};">●</span>
            <span>${user?.name || user?.email || 'dev@localhost'}</span>
            ${user?.authMethod === 'local-briefcase' ? html`<span style="font-size: 10px; color: #38bdf8; margin-left: 4px; font-weight: 700;">[Briefcase]</span>` : ''}
          </div>
          <a href="/admin/logout" class="btn btn-secondary" style="font-size: 11px; padding: 4px 8px; text-decoration: none; color: #94a3b8; display: inline-flex; align-items: center; gap: 4px; border-color: rgba(255,255,255,0.12);" title="Lock Studio Session & Sign Out">
            <span>🔒</span> Lock
          </a>
        </div>
      </div>
      ${content}
    </body>
    </html>
  `;
}
