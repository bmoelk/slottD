import { html } from 'hono/html';
import { renderLayout } from '../layout.js';
import { renderInfoBubble } from '../ui.js';
import type { SiteInfo } from '../sites.js';

export interface SitesViewProps {
  sites: SiteInfo[];
  activeSite: string;
  user: { email: string; authMethod?: string };
  message?: string;
  error?: string;
  metrics?: {
    docCount: number;
    collectionCount: number;
    publishedCount: number;
    mediaCount: number;
    modelCount: number;
    tagCount: number;
  };
}

export function renderSitesView({
  sites,
  activeSite,
  user,
  message,
  error,
  metrics,
}: SitesViewProps) {
  const availableSiteIds = sites.map((s) => s.site_id);

  return renderLayout(
    'Websites Hub — SlottD Studio',
    'sites',
    user,
    html`
      <div class="header">
        <div>
          <h1 style="display: flex; align-items: center; gap: 8px;">
            Websites & Domains (Sites Hub)
            ${renderInfoBubble(
              'Unified multi-website management in SlottD. Each site maintains isolated documents, media, versions, and Git repository bindings.',
              'multi-site'
            )}
          </h1>
          <p class="subtitle">
            Single-organization multi-website architecture &bull; Rigid slot isolation &bull; Delegated Git tenancy
          </p>
        </div>
        <div class="header-actions">
          <a href="#add-site" class="btn btn-primary">+ Register New Website</a>
        </div>
      </div>

      <!-- Flash Notices -->
      ${message ? html`
        <div style="background: rgba(16,185,129,0.12); border: 1px solid #10b981; color: #10b981; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between;">
          <span>✓ ${message}</span>
          <button onclick="this.parentElement.remove()" style="background:none; border:none; color:#10b981; cursor:pointer; font-size:16px;">&times;</button>
        </div>
      ` : ''}

      ${error ? html`
        <div style="background: rgba(239,68,68,0.12); border: 1px solid #ef4444; color: #ef4444; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between;">
          <span>⚠️ ${error}</span>
          <button onclick="this.parentElement.remove()" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:16px;">&times;</button>
        </div>
      ` : ''}

      <!-- Active Site Notice & Metrics Overview -->
      <div class="card" style="padding: 20px; margin-bottom: 24px; border-left: 4px solid #38bdf8; background: #0f172a;">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 16px;">
          <div>
            <span style="font-size: 11px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.5px; font-weight: 600;">Current Studio Context</span>
            <div style="font-size: 22px; font-weight: 700; color: #f8fafc; display: flex; align-items: center; gap: 8px; margin-top: 2px;">
              <span>🌐 ${activeSite}</span>
              <span style="font-size: 11px; background: rgba(56,189,248,0.15); color: #38bdf8; padding: 2px 8px; border-radius: 12px; font-weight: 500;">Active Partition</span>
            </div>
            <p style="font-size: 12px; color: #64748b; margin: 4px 0 0 0;">
              The Studio operates on <strong>one website at a time</strong>. All content tables, media assets, and versions reflect this domain.
            </p>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <select
              onchange="document.cookie='slottd_active_site='+encodeURIComponent(this.value)+'; path=/; max-age=31536000'; window.location.reload();"
              style="background: #1e293b; color: #f8fafc; border: 1px solid #334155; padding: 8px 12px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;"
            >
              ${availableSiteIds.map((id) => html`
                <option value="${id}" ${id === activeSite ? 'selected' : ''}>
                  Switch to: ${id}
                </option>
              `)}
            </select>
          </div>
        </div>

        ${metrics ? html`
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.08);">
            <div>
              <span style="font-size: 11px; text-transform: uppercase; color: #94a3b8; display: block; margin-bottom: 2px;">Documents</span>
              <span style="font-size: 20px; font-weight: 700; color: #f8fafc;">${metrics.docCount}</span>
              <span style="font-size: 11px; color: #64748b; display: block;">${metrics.publishedCount} published</span>
            </div>
            <div>
              <span style="font-size: 11px; text-transform: uppercase; color: #94a3b8; display: block; margin-bottom: 2px;">Collections</span>
              <span style="font-size: 20px; font-weight: 700; color: #f8fafc;">${metrics.collectionCount}</span>
              <span style="font-size: 11px; color: #64748b; display: block;">Active views</span>
            </div>
            <div>
              <span style="font-size: 11px; text-transform: uppercase; color: #94a3b8; display: block; margin-bottom: 2px;">R2 Media Assets</span>
              <span style="font-size: 20px; font-weight: 700; color: #f8fafc;">${metrics.mediaCount}</span>
              <span style="font-size: 11px; color: #64748b; display: block;">${activeSite}/...</span>
            </div>
            <div>
              <span style="font-size: 11px; text-transform: uppercase; color: #94a3b8; display: block; margin-bottom: 2px;">Git Releases</span>
              <span style="font-size: 20px; font-weight: 700; color: #f8fafc;">${metrics.tagCount}</span>
              <span style="font-size: 11px; color: #64748b; display: block;">Tags discovered</span>
            </div>
          </div>
        ` : ''}
      </div>

      <!-- Configured Sites Grid -->
      <h2 style="font-size: 16px; font-weight: 600; color: #f8fafc; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
        Registered Websites (${sites.length})
      </h2>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; margin-bottom: 32px;">
        ${sites.map((site) => {
          const isActive = site.site_id === activeSite;
          const updatedDate = new Date(site.updated_at).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });

          return html`
            <div class="card" style="padding: 20px; border: 1px solid ${isActive ? '#38bdf8' : 'rgba(255,255,255,0.08)'}; background: #131d2e;">
              <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 12px;">
                <div>
                  <div style="font-size: 16px; font-weight: 700; color: #f8fafc; display: flex; align-items: center; gap: 6px;">
                    🌐 ${site.site_id}
                    ${isActive ? html`<span style="font-size: 10px; background: #38bdf8; color: #0284c7; padding: 1px 6px; border-radius: 10px; font-weight: 700; color: #0f172a;">ACTIVE</span>` : ''}
                  </div>
                  <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Updated: ${updatedDate}</div>
                </div>
                ${!isActive ? html`
                  <button
                    onclick="document.cookie='slottd_active_site='+'${encodeURIComponent(site.site_id)}'+'; path=/; max-age=31536000'; window.location.reload();"
                    class="btn btn-secondary"
                    style="font-size: 11px; padding: 4px 8px;"
                  >
                    Select
                  </button>
                ` : ''}
              </div>

              <div style="font-size: 12px; color: #94a3b8; display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; background: #0b1120; padding: 10px; border-radius: 6px;">
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: #64748b;">Git Remote:</span>
                  <span style="font-family: monospace; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${site.git_remote_url || 'Not configured'}">
                    ${site.git_remote_url || '—'}
                  </span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: #64748b;">Local Clone:</span>
                  <span style="font-family: monospace; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${site.repo_path ? '#38bdf8' : '#94a3b8'};" title="${site.repo_path || 'Temp Location Mode'}">
                    ${site.repo_path ? site.repo_path : 'Temp Location Mode'}
                  </span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: #64748b;">Branch / Path:</span>
                  <span style="font-family: monospace;">${site.git_branch || 'main'} / ${site.content_path ? site.content_path : 'root (/)'}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: #64748b;">Deploy Hook:</span>
                  <span>${site.deploy_hook ? '✓ Configured' : '—'}</span>
                </div>
              </div>

              <div style="display: flex; gap: 8px;">
                <form action="/admin/sites/pull" method="POST" style="flex: 1;">
                  <input type="hidden" name="siteId" value="${site.site_id}" />
                  <button type="submit" class="btn btn-secondary" style="width: 100%; font-size: 12px; padding: 6px;" title="Pull and hydrate content from Git repository into D1">
                    ⬇ Pull Content
                  </button>
                </form>
                <button
                  type="button"
                  onclick="openRenameModal('${site.site_id}')"
                  class="btn btn-secondary"
                  style="font-size: 12px; padding: 6px 10px;"
                  title="Rename domain atomically"
                >
                  ✏ Rename
                </button>
              </div>
            </div>
          `;
        })}
      </div>

      <!-- Register New Website Panel -->
      <div class="card" id="add-site" style="padding: 24px; max-width: 720px; margin-bottom: 32px;">
        <h3 style="font-size: 16px; font-weight: 700; color: #f8fafc; margin-bottom: 4px;">
          + Register / Configure Website
        </h3>
        <p style="font-size: 12px; color: #94a3b8; margin-bottom: 16px;">
          Add a new domain partition and configure its dedicated Git repository, local Briefcase path, and build deploy hook.
        </p>

        <form action="/admin/sites/create" method="POST">
          <div style="margin-bottom: 12px;">
            <label style="display: block; font-size: 12px; font-weight: 600; color: #cbd5e1; margin-bottom: 4px;">Website Domain / Site ID</label>
            <input
              type="text"
              name="siteId"
              placeholder="e.g. spectragql.dev"
              required
              style="width: 100%; background: #0b1120; border: 1px solid #334155; color: #f8fafc; padding: 8px 12px; border-radius: 6px; font-size: 13px;"
            />
          </div>

          <div style="margin-bottom: 12px;">
            <label style="display: block; font-size: 12px; font-weight: 600; color: #cbd5e1; margin-bottom: 4px;">Git Remote Repository URL</label>
            <input
              type="text"
              name="git_remote_url"
              placeholder="e.g. git@github.com:brainendeavor/spectragql.dev.git"
              style="width: 100%; background: #0b1120; border: 1px solid #334155; color: #f8fafc; padding: 8px 12px; border-radius: 6px; font-size: 13px;"
            />
          </div>

          <div style="margin-bottom: 12px;">
            <label style="display: block; font-size: 12px; font-weight: 600; color: #cbd5e1; margin-bottom: 4px;">
              Local Repository Path (Briefcase / Native Git)
            </label>
            <input
              type="text"
              name="repo_path"
              placeholder="e.g. /Users/bmo/code/websites-git-repos/spectragql.dev"
              style="width: 100%; background: #0b1120; border: 1px solid #334155; color: #f8fafc; padding: 8px 12px; border-radius: 6px; font-size: 13px;"
            />
            <span style="font-size: 11px; color: #64748b; margin-top: 2px; display: block;">
              If specified, SlottD Briefcase will export, tag, and push directly in this working directory instead of creating a temporary clone.
            </span>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
            <div>
              <label style="display: block; font-size: 12px; font-weight: 600; color: #cbd5e1; margin-bottom: 4px;">Branch</label>
              <input
                type="text"
                name="git_branch"
                value="main"
                style="width: 100%; background: #0b1120; border: 1px solid #334155; color: #f8fafc; padding: 8px 12px; border-radius: 6px; font-size: 13px;"
              />
            </div>
            <div>
              <label style="display: block; font-size: 12px; font-weight: 600; color: #cbd5e1; margin-bottom: 4px;">Content Path</label>
              <input
                type="text"
                name="content_path"
                value=""
                placeholder="Leave blank for dedicated repository root"
                style="width: 100%; background: #0b1120; border: 1px solid #334155; color: #f8fafc; padding: 8px 12px; border-radius: 6px; font-size: 13px;"
              />
              <span style="font-size: 11px; color: #64748b; margin-top: 2px; display: block;">
                Use blank / empty string for dedicated repositories with root-level collections.
              </span>
            </div>
          </div>

          <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 12px; font-weight: 600; color: #cbd5e1; margin-bottom: 4px;">Production Deploy Hook URL (Optional)</label>
            <input
              type="url"
              name="deploy_hook"
              placeholder="https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/..."
              style="width: 100%; background: #0b1120; border: 1px solid #334155; color: #f8fafc; padding: 8px 12px; border-radius: 6px; font-size: 13px;"
            />
          </div>

          <button type="submit" class="btn btn-primary" style="width: 100%; justify-content: center;">
            Save & Register Website
          </button>
        </form>
      </div>

      <!-- Rename Site Modal Dialog (Popup) -->
      <div id="renameSiteModal" style="display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.75); backdrop-filter: blur(4px); z-index: 99999; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box;">
        <div style="background: #1e293b; border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; max-width: 480px; width: 100%; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); display: flex; flex-direction: column; color: #f8fafc;">
          <div style="padding: 18px 24px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 18px;">✏️</span>
              <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: #f8fafc;">Rename Site</h3>
              <span style="font-size: 12px; color: #94a3b8;">(Atomic Domain Rename)</span>
            </div>
            <button type="button" onclick="closeRenameModal()" style="background: none; border: none; color: #94a3b8; font-size: 20px; cursor: pointer; padding: 4px;">✕</button>
          </div>
          <form action="/admin/sites/rename" method="POST" onsubmit="return confirm('Are you sure you want to rename this site? This will update all partitioned database tables atomically.');">
            <div style="padding: 24px; display: flex; flex-direction: column; gap: 14px;">
              <p style="margin: 0; font-size: 13px; color: #cbd5e1; line-height: 1.5;">
                Atomically updates the site identifier across all partitioned documents, media keys, domain referrals, versions, and physical tables.
              </p>
              <div>
                <label style="display: block; font-size: 12px; font-weight: 600; color: #94a3b8; margin-bottom: 4px;">Current Site ID</label>
                <input type="text" name="oldSiteId" id="renameOldSiteId" readonly style="width: 100%; background: #0b1120; border: 1px solid #334155; color: #94a3b8; padding: 8px 12px; border-radius: 6px; font-size: 13px; font-family: monospace;" />
              </div>
              <div>
                <label style="display: block; font-size: 12px; font-weight: 600; color: #cbd5e1; margin-bottom: 4px;">New Canonical Domain</label>
                <input type="text" name="newSiteId" id="renameNewSiteId" placeholder="e.g. spectragql.dev" required style="width: 100%; background: #0b1120; border: 1px solid #38bdf8; color: #f8fafc; padding: 8px 12px; border-radius: 6px; font-size: 13px;" />
              </div>
            </div>
            <div style="padding: 16px 24px; border-top: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: flex-end; gap: 10px; background: rgba(0,0,0,0.2);">
              <button type="button" onclick="closeRenameModal()" class="btn btn-secondary">Cancel</button>
              <button type="submit" class="btn btn-primary">Rename Site</button>
            </div>
          </form>
        </div>
      </div>

      <script>
        function openRenameModal(siteId) {
          const modal = document.getElementById('renameSiteModal');
          const oldInput = document.getElementById('renameOldSiteId');
          const newInput = document.getElementById('renameNewSiteId');
          if (oldInput) oldInput.value = siteId;
          if (newInput) {
            newInput.value = '';
            setTimeout(() => newInput.focus(), 50);
          }
          if (modal) modal.style.display = 'flex';
        }

        function closeRenameModal() {
          const modal = document.getElementById('renameSiteModal');
          if (modal) modal.style.display = 'none';
        }

        document.addEventListener('keydown', function(e) {
          if (e.key === 'Escape') closeRenameModal();
        });
      </script>
    `,
    undefined,
    { activeSite, availableSites: availableSiteIds }
  );
}
