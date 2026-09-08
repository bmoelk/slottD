import { html, raw } from 'hono/html';
import { renderLayout } from '../layout.js';

export interface SetupViewData {
  environment: string;
  operatorName: string;
  operatorEmail: string;
  docCount: number;
  draftCount: number;
  mediaCount: number;
  isDev: boolean;
  isPasswordProtected: boolean;
  gitRemoteUrl: string;
  gitBranch: string;
  gitProvider?: string;
  hasToken: boolean;
}

export function renderSetupView(
  data: SetupViewData,
  user: { email: string; name?: string; authMethod?: string }
) {
  const clientScript = `
    async function updatePassword(remove = false) {
      const currentPassword = document.getElementById('currentPassword')?.value || '';
      const newPassword = document.getElementById('newPassword')?.value || '';
      const confirmPassword = document.getElementById('confirmPassword')?.value || '';

      if (!remove) {
        if (!newPassword) {
          alert('Please enter a new password.');
          return;
        }
        if (newPassword !== confirmPassword) {
          alert('New passwords do not match. Please verify.');
          return;
        }
      } else {
        const confirmRemove = confirm('Are you sure you want to remove password protection and return to Zero-Barrier mode?');
        if (!confirmRemove) return;
      }

      const btn = document.getElementById(remove ? 'btnRemovePass' : 'btnSavePass');
      if (btn) btn.disabled = true;

      try {
        const res = await fetch('/admin/setup/password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword, newPassword, remove })
        });
        const json = await res.json();
        if (res.ok) {
          alert('✅ ' + json.message);
          window.location.reload();
        } else {
          alert('❌ ' + (json.error || json.message || 'Failed to update password.'));
        }
      } catch (err) {
        alert('Network error: ' + err.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    async function saveRemoteSettings() {
      const remoteUrl = document.getElementById('remoteUrl')?.value || '';
      const branch = document.getElementById('remoteBranch')?.value || 'main';
      const token = document.getElementById('remoteToken')?.value || '';

      const btn = document.getElementById('btnSaveRemote');
      if (btn) {
        btn.disabled = true;
        btn.innerText = '⏳ Saving...';
      }

      try {
        const res = await fetch('/admin/setup/remote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ remoteUrl, branch, token })
        });
        const json = await res.json();
        if (res.ok) {
          alert('✅ Remote configuration saved successfully!');
          window.location.reload();
        } else {
          alert('❌ Failed to save remote configuration: ' + (json.error || json.message));
        }
      } catch (err) {
        alert('Network error: ' + err.message);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerText = '💾 Save Remote Settings';
        }
      }
    }

    async function resetLocalDatabase() {
      const confirm1 = confirm('⚠️ WARNING: Are you sure you want to WIPE and RE-INITIALIZE the local database? All uncommitted local records will be deleted.');
      if (!confirm1) return;

      const confirm2 = prompt('Type RESET to confirm local database wipe:');
      if (confirm2 !== 'RESET') {
        alert('Reset cancelled.');
        return;
      }

      const btn = document.getElementById('btnResetDb');
      if (btn) {
        btn.disabled = true;
        btn.innerText = '⏳ Resetting Database...';
      }

      try {
        const res = await fetch('/admin/setup/reset-db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const json = await res.json();
        if (res.ok) {
          alert('✅ Local database wiped and re-seeded successfully!');
          window.location.reload();
        } else {
          alert('❌ Database reset failed: ' + (json.error || json.message || 'Unknown error'));
        }
      } catch (err) {
        alert('Network error: ' + err.message);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerText = '🗑️ Wipe & Re-seed Local Database';
        }
      }
    }
  `;

  return renderLayout('Setup & Briefcase — SlottD Studio', 'setup', user, html`
    <div class="header">
      <div class="breadcrumbs">
        <a href="/admin">Studio</a>
        <span>/</span>
        <span class="current">Setup & Briefcase</span>
      </div>
    </div>

    <!-- Top Grid: Operator Attribution & Security Status -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; margin-top: 16px;">
      
      <!-- Operator Profile Card -->
      <div class="card">
        <h2 style="font-size: 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
          <span>👤</span> Operator Profile & Attribution
        </h2>
        <p style="font-size: 13px; color: var(--text-muted); line-height: 1.5; margin-bottom: 16px;">
          Local edits, drafts, and audit logs in Briefcase mode are attributed to your operator identity.
        </p>
        <div style="display: flex; flex-direction: column; gap: 12px; font-size: 13px;">
          <div style="display: flex; justify-content: space-between; padding: 8px 12px; background: rgba(255,255,255,0.03); border-radius: 6px; border: 1px solid rgba(255,255,255,0.06);">
            <strong style="color: var(--text-muted);">Operator Name:</strong>
            <span style="color: #38bdf8; font-weight: 600;">${data.operatorName}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 8px 12px; background: rgba(255,255,255,0.03); border-radius: 6px; border: 1px solid rgba(255,255,255,0.06);">
            <strong style="color: var(--text-muted);">Operator Email:</strong>
            <span style="color: #cbd5e1; font-family: monospace;">${data.operatorEmail}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 8px 12px; background: rgba(255,255,255,0.03); border-radius: 6px; border: 1px solid rgba(255,255,255,0.06);">
            <strong style="color: var(--text-muted);">Access Mode:</strong>
            ${data.isPasswordProtected ? html`
              <span style="color: #f59e0b; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
                <span>🔒</span> Password Protected
              </span>
            ` : html`
              <span style="color: #34d399; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
                <span>⚡</span> Zero-Barrier (Dev)
              </span>
            `}
          </div>
        </div>
      </div>

      <!-- Password Security Management Card -->
      <div class="card">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
          <h2 style="font-size: 16px; margin: 0; display: flex; align-items: center; gap: 8px;">
            <span>🔑</span> Studio Password Management
          </h2>
          ${data.isPasswordProtected ? html`
            <span style="font-size: 11px; color: #fbbf24; background: rgba(245, 158, 11, 0.15); padding: 2px 8px; border-radius: 12px; border: 1px solid rgba(245, 158, 11, 0.3);">Active</span>
          ` : html`
            <span style="font-size: 11px; color: #94a3b8; background: rgba(255, 255, 255, 0.05); padding: 2px 8px; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.1);">Zero-Barrier</span>
          `}
        </div>
        <p style="font-size: 13px; color: var(--text-muted); line-height: 1.5; margin-bottom: 14px;">
          Set or change the local Briefcase password. Passwords are salted and encrypted at rest with HMAC-SHA256.
        </p>

        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${data.isPasswordProtected ? html`
            <div>
              <label style="display: block; font-size: 11px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px; font-weight: 600;">Current Password</label>
              <input type="password" id="currentPassword" class="input-search" placeholder="••••••••••••" style="width: 100%; box-sizing: border-box;" />
            </div>
          ` : ''}

          <div>
            <label style="display: block; font-size: 11px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px; font-weight: 600;">New Password</label>
            <input type="password" id="newPassword" class="input-search" placeholder="••••••••••••" style="width: 100%; box-sizing: border-box;" />
          </div>

          <div>
            <label style="display: block; font-size: 11px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px; font-weight: 600;">Confirm Password</label>
            <input type="password" id="confirmPassword" class="input-search" placeholder="••••••••••••" style="width: 100%; box-sizing: border-box;" />
          </div>

          <div style="display: flex; gap: 8px; margin-top: 6px;">
            <button type="button" id="btnSavePass" class="btn btn-primary" style="flex: 1; justify-content: center; font-size: 13px;" onclick="updatePassword(false)">
              💾 ${data.isPasswordProtected ? 'Update Password' : 'Set Password'}
            </button>
            ${data.isPasswordProtected ? html`
              <button type="button" id="btnRemovePass" class="btn btn-secondary" style="font-size: 13px; color: #fca5a5;" onclick="updatePassword(true)" title="Remove password challenge">
                Remove
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    </div>

    <!-- Universal Git Remote Repository Settings Card -->
    <div class="card" style="margin-top: 20px;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
        <h2 style="font-size: 16px; margin: 0; display: flex; align-items: center; gap: 8px;">
          <span>🌐</span> Git Remote Repository Configuration
        </h2>
        <span style="font-size: 12px; color: #38bdf8;">Universal Git Sync</span>
      </div>
      <p style="font-size: 13px; color: var(--text-muted); line-height: 1.5; margin-bottom: 16px;">
        Configure the central Git repository used for content snapshots, releases, and deployment hooks. Compatible with GitHub, GitLab, Gitea, or generic Git HTTPS servers.
      </p>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; margin-bottom: 16px;">
        <div>
          <label style="display: block; font-size: 11px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px; font-weight: 600;">Git Remote URL</label>
          <input
            type="text"
            id="remoteUrl"
            class="input-search"
            placeholder="git@github.com:org/repo.git or https://gitlab.com/..."
            value="${data.gitRemoteUrl || ''}"
            style="width: 100%; box-sizing: border-box;"
          />
        </div>

        <div>
          <label style="display: block; font-size: 11px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px; font-weight: 600;">Target Branch</label>
          <input
            type="text"
            id="remoteBranch"
            class="input-search"
            placeholder="main"
            value="${data.gitBranch || 'main'}"
            style="width: 100%; box-sizing: border-box;"
          />
        </div>

        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <label style="display: block; font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 600;">Access Token (Required for Private Repos)</label>
            ${data.hasToken ? html`
              <span style="font-size: 10px; color: #34d399; font-weight: 600;">● Token Configured (Encrypted)</span>
            ` : html`
              <span style="font-size: 10px; color: #94a3b8;">Not set</span>
            `}
          </div>
          <input
            type="password"
            id="remoteToken"
            class="input-search"
            placeholder="${data.hasToken ? '•••••••••••• (leave blank to keep current)' : 'Personal Access Token / Deploy Token'}"
            style="width: 100%; box-sizing: border-box;"
          />
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 10px;">
        <button type="button" id="btnSaveRemote" class="btn btn-primary" onclick="saveRemoteSettings()">
          💾 Save Remote Settings
        </button>
      </div>
    </div>

    <!-- Briefcase Operations & Database Management Card -->
    <div class="card" style="margin-top: 20px;">
      <h2 style="font-size: 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
        <span>🧰</span> Briefcase Operations & Database Management
      </h2>
      <p style="font-size: 13px; color: var(--text-muted); line-height: 1.5; margin-bottom: 16px;">
        Overview of your local database state. In development, you can wipe and re-seed the local database cleanly from serialized content files.
      </p>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px;">
        <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); padding: 12px; border-radius: 6px;">
          <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Documents</div>
          <div style="font-size: 24px; font-weight: 700; color: #f8fafc; margin-top: 4px;">${data.docCount}</div>
        </div>
        <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); padding: 12px; border-radius: 6px;">
          <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Working Drafts</div>
          <div style="font-size: 24px; font-weight: 700; color: #fb923c; margin-top: 4px;">${data.draftCount}</div>
        </div>
        <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); padding: 12px; border-radius: 6px;">
          <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Media Files</div>
          <div style="font-size: 24px; font-weight: 700; color: #a5b4fc; margin-top: 4px;">${data.mediaCount}</div>
        </div>
      </div>

      ${data.isDev ? html`
        <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 16px;">
          <h3 style="color: var(--danger); font-size: 14px; margin-bottom: 6px;">Danger Zone: Local Database Reset</h3>
          <p style="font-size: 12px; color: var(--text-muted); line-height: 1.5; margin-bottom: 12px;">
            Wipe all local D1 tables and restore baseline state. Only available in development mode (disabled in production).
          </p>
          <button
            type="button"
            id="btnResetDb"
            class="btn btn-danger-outline"
            style="font-size: 13px;"
            onclick="resetLocalDatabase()"
          >
            🗑️ Wipe & Re-seed Local Database
          </button>
        </div>
      ` : html`
        <div style="padding: 12px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; font-size: 12px; color: var(--text-muted);">
          ℹ️ Database reset is disabled in production environments.
        </div>
      `}
    </div>

    <script>
      ${raw(clientScript)}
    </script>
  `);
}
