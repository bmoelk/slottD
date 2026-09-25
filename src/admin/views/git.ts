import { html, raw } from 'hono/html';
import { renderLayout } from '../layout.js';
import { renderInfoBubble, renderFavicon } from '../ui.js';

export interface GitViewData {
  environment: string;
  d1DatabaseId: string;
  repoPath: string;
  hasRemote: boolean;
  remoteUrl: string;
  engineName?: string;
  docCount: number;
  collectionCount: number;
  mediaCount: number;
  tags: string[];
  isMonorepo?: boolean;
  contentPath?: string;
  contentSubpath?: string;
  gitTopLevel?: string;
}

export function renderGitView(
  data: GitViewData,
  user: { email: string; authMethod?: string },
  siteContext?: { activeSite?: string; availableSites?: string[]; activeFavicon?: string }
) {
  const defaultTag = `release-${new Date().toISOString().slice(0, 10).replace(/-/g, '.')}-${new Date().getHours().toString().padStart(2, '0')}${new Date().getMinutes().toString().padStart(2, '0')}`;
  const activeSite = siteContext?.activeSite || 'default';

  const clientScript = `
    function appendLog(msg, type = 'info') {
      const box = document.getElementById('consoleLogBox');
      if (!box) return;
      const timestamp = new Date().toLocaleTimeString();
      let color = '#94a3b8';
      if (type === 'success') color = '#4ade80';
      if (type === 'warn') color = '#fbbf24';
      if (type === 'error') color = '#f87171';
      if (type === 'command') color = '#38bdf8';

      const line = document.createElement('div');
      line.style.color = color;
      line.textContent = '[' + timestamp + '] ' + msg;
      box.appendChild(line);
      box.scrollTop = box.scrollHeight;
    }

    function clearConsoleLog() {
      const box = document.getElementById('consoleLogBox');
      if (box) box.innerHTML = '';
    }

    function toggleTagInputs(checked) {
      const group = document.getElementById('tagInputsGroup');
      if (group) {
        group.style.opacity = checked ? '1' : '0.45';
        group.style.pointerEvents = checked ? 'auto' : 'none';
      }
    }

    async function fetchRemoteTags() {
      appendLog('$ git fetch --all --tags origin', 'command');
      try {
        const res = await fetch('/admin/git/fetch?site_id=' + encodeURIComponent('${activeSite}'), { method: 'POST' });
        const json = await res.json();
        if (res.ok) {
          appendLog('✅ ' + (json.message || 'Remote tags successfully fetched.'), 'success');
          if (json.output) appendLog(json.output, 'info');
          if (json.tags && json.tags.length > 0) {
            const select = document.getElementById('tagSelect');
            if (select) {
              select.innerHTML = json.tags.map(t => '<option value="' + t + '">' + t + '</option>').join('');
            }
          }
        } else {
          appendLog('❌ Fetch failed: ' + (json.error || res.statusText), 'error');
          if (json.output) appendLog(json.output, 'error');
        }
      } catch (e) {
        appendLog('❌ Network error: ' + e.message, 'error');
      }
    }

    async function promptSetupLocalRepo() {
      const defaultPath = '${data.repoPath || `/Users/bmo/code/websites-git-repos/${activeSite}`}';
      const chosenPath = prompt("Enter local directory path to clone or adopt:", defaultPath);
      if (!chosenPath || !chosenPath.trim()) return;
      appendLog('$ git setup-repo --path ' + chosenPath.trim(), 'command');
      try {
        const res = await fetch('/admin/git/setup-repo?site_id=' + encodeURIComponent('${activeSite}'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ siteId: '${activeSite}', repoPath: chosenPath.trim() })
        });
        const json = await res.json();
        if (res.ok) {
          appendLog('✅ ' + json.message, 'success');
          setTimeout(() => window.location.reload(), 1500);
        } else {
          appendLog('❌ Failed to set up repository: ' + (json.error || res.statusText), 'error');
        }
      } catch (e) {
        appendLog('❌ Error: ' + e.message, 'error');
      }
    }

    function showVerificationSummaryModal(report, onOverride) {
      let modal = document.getElementById('slottdVerificationModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'slottdVerificationModal';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
        document.body.appendChild(modal);
      }

      const errors = report?.errors || [];
      const warnings = report?.warnings || [];
      const recommendations = [];

      if (report?.checks) {
        for (const c of report.checks) {
          if (c.metadata?.recommendations && Array.isArray(c.metadata.recommendations)) {
            recommendations.push(...c.metadata.recommendations);
          }
        }
      }

      const uniqueRecs = Array.from(new Set(recommendations));

      modal.innerHTML = \`
        <div style="background:#1e293b;border:1px solid rgba(255,255,255,0.15);border-radius:12px;max-width:620px;width:100%;max-height:85vh;overflow-y:auto;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);display:flex;flex-direction:column;color:#f8fafc;font-family:system-ui,-apple-system,sans-serif;">
          <div style="padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:space-between;">
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="font-size:22px;">⚠️</span>
              <h3 style="margin:0;font-size:18px;font-weight:600;color:#f8fafc;">Pre-Release Verification Summary</h3>
            </div>
            <button type="button" id="closeVerificationModal" style="background:none;border:none;color:#94a3b8;font-size:20px;cursor:pointer;padding:4px;">✕</button>
          </div>

          <div style="padding:24px;display:flex;flex-direction:column;gap:16px;font-size:13px;line-height:1.5;">
            <p style="margin:0;color:#cbd5e1;">
              Verification completed across all configured checks. The following items require your attention:
            </p>

            \${errors.length > 0 ? \`
              <div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:12px 16px;">
                <strong style="color:#f87171;display:block;margin-bottom:6px;">Issues Flagged (\${errors.length}):</strong>
                <ul style="margin:0;padding-left:18px;color:#fca5a5;display:flex;flex-direction:column;gap:4px;">
                  \${errors.map(e => \`<li>\${e}</li>\`).join('')}
                </ul>
              </div>
            \` : ''}

            \${warnings.length > 0 ? \`
              <div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:12px 16px;">
                <strong style="color:#fbbf24;display:block;margin-bottom:6px;">Warnings (\${warnings.length}):</strong>
                <ul style="margin:0;padding-left:18px;color:#fde68a;display:flex;flex-direction:column;gap:4px;">
                  \${warnings.map(w => \`<li>\${w}</li>\`).join('')}
                </ul>
              </div>
            \` : ''}

            \${uniqueRecs.length > 0 ? \`
              <div style="background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.3);border-radius:8px;padding:12px 16px;">
                <strong style="color:#38bdf8;display:block;margin-bottom:6px;">Actionable Recommendations:</strong>
                <ul style="margin:0;padding-left:18px;color:#bae6fd;display:flex;flex-direction:column;gap:4px;">
                  \${uniqueRecs.map(r => \`<li>👉 \${r}</li>\`).join('')}
                </ul>
              </div>
            \` : ''}
          </div>

          <div style="padding:16px 24px;border-top:1px solid rgba(255,255,255,0.1);display:flex;justify-content:flex-end;gap:12px;background:rgba(0,0,0,0.2);">
            <button type="button" id="btnCancelModal" style="padding:8px 16px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:transparent;color:#cbd5e1;cursor:pointer;font-size:13px;font-weight:500;">
              Review & Fix
            </button>
            <button type="button" id="btnOverridePublish" style="padding:8px 16px;border-radius:6px;border:none;background:#f59e0b;color:#0f172a;cursor:pointer;font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:6px;">
              ⚠️ Override & Execute Anyway
            </button>
          </div>
        </div>
      \`;

      modal.style.display = 'flex';

      const closeModal = () => { modal.style.display = 'none'; };
      document.getElementById('closeVerificationModal')?.addEventListener('click', closeModal);
      document.getElementById('btnCancelModal')?.addEventListener('click', closeModal);
      document.getElementById('btnOverridePublish')?.addEventListener('click', () => {
        closeModal();
        if (typeof onOverride === 'function') onOverride();
      });
    }

    async function runGitPipeline(dryRun = false, forcePublish = false) {
      const exportFiles = document.getElementById('opExportFiles')?.checked || false;
      const createTag = document.getElementById('opCreateTag')?.checked || false;
      const pushToRemote = document.getElementById('opPushRemote')?.checked || false;

      if (!exportFiles && !createTag && !pushToRemote) {
        alert('Please select at least one operation to execute.');
        return;
      }

      const tag = (document.getElementById('releaseTagName')?.value || '').trim();
      const msg = (document.getElementById('releaseCommitMsg')?.value || '').trim();

      if (createTag && !tag) {
        alert('Please specify a Git release tag name.');
        return;
      }

      const modeLabel = dryRun ? '[Dry Run / Preview]' : '[Execute]';
      const steps = [];
      if (exportFiles) steps.push('Export Files');
      if (createTag) steps.push('Commit & Tag (' + tag + ')');
      if (pushToRemote) steps.push('Push Remote');

      appendLog('$ pipeline ' + modeLabel + ' ' + steps.join(' -> '), 'command');

      try {
        const res = await fetch('/admin/git/release?site_id=' + encodeURIComponent('${activeSite}'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            siteId: '${activeSite}',
            exportFiles,
            createTag,
            pushToRemote,
            dryRun,
            tag,
            message: msg,
            forcePublish
          })
        });

        const json = await res.json();
        if (res.ok) {
          appendLog((dryRun ? '🔍 ' : '✅ ') + json.message, 'success');
          if (json.output) appendLog(json.output, 'info');
          if (json.plan) {
            appendLog('Execution Plan:\\n' + json.plan, 'info');
          }
          if (json.command) {
            appendLog('Terminal Equivalent:\\n' + json.command, 'command');
          }
        } else if (res.status === 422 && json.requiresConfirmation) {
          appendLog('⚠️ Pre-release verification reported findings: ' + (json.message || json.error), 'warn');
          showVerificationSummaryModal(json.report, () => runGitPipeline(dryRun, true));
        } else {
          appendLog('❌ Operation failed: ' + (json.error || res.statusText), 'error');
          if (json.output) appendLog(json.output, 'error');
        }
      } catch (e) {
        appendLog('❌ Execution error: ' + e.message, 'error');
      }
    }

    async function previewGitDiff() {
      const tag = document.getElementById('tagSelect')?.value;
      if (!tag) {
        alert('No tag selected.');
        return;
      }

      appendLog('$ git diff ' + tag + ' (Comparing active D1 against Git tag...)', 'command');
      try {
        const res = await fetch('/admin/git/diff?site_id=' + encodeURIComponent('${activeSite}'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ siteId: '${activeSite}', tag })
        });
        const json = await res.json();
        if (res.ok) {
          appendLog('✅ Diff generated against tag "' + tag + '":', 'success');
          if (json.output) appendLog(json.output, 'info');

          const diffCard = document.getElementById('diffSummaryCard');
          const diffContent = document.getElementById('diffSummaryContent');
          const btnConfirm = document.getElementById('btnConfirmRestore');

          if (diffCard && diffContent) {
            diffCard.style.display = 'block';
            diffContent.textContent = json.output || json.summary || 'Working content matches tag exactly (0 changes).';
          }
          if (btnConfirm) btnConfirm.style.display = 'flex';
        } else {
          appendLog('❌ Diff preview failed: ' + (json.error || res.statusText), 'error');
        }
      } catch (e) {
        appendLog('❌ Preview error: ' + e.message, 'error');
      }
    }

    async function executeRestore() {
      const tag = document.getElementById('tagSelect')?.value;
      if (!tag) {
        alert('Please select a Git release tag to import (or click Fetch Remote Tags first).');
        return;
      }

      const confirmed = confirm('Are you sure you want to load and restore D1 database content from Git tag "' + tag + '"?');
      if (!confirmed) return;

      appendLog('$ git checkout ' + tag + ' (Restoring D1 records from Git tag...)', 'command');
      try {
        const res = await fetch('/admin/git/load?site_id=' + encodeURIComponent('${activeSite}'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ siteId: '${activeSite}', tag })
        });
        const json = await res.json();
        if (res.ok) {
          appendLog('✅ ' + json.message, 'success');
          if (json.output) appendLog(json.output, 'info');
          setTimeout(() => window.location.reload(), 2000);
        } else {
          appendLog('❌ Restore failed: ' + (json.error || res.statusText), 'error');
        }
      } catch (e) {
        appendLog('❌ Restore error: ' + e.message, 'error');
      }
    }

    function exportFilesZip() {
      appendLog('Generating ZIP archive with serialized collections and README...', 'info');
      const downloadUrl = '/admin/git/export-zip?site_id=' + encodeURIComponent('${activeSite}');
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = '${activeSite}-content-' + new Date().toISOString().slice(0,10) + '.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      appendLog('ZIP download initiated for ' + '${activeSite}' + '.', 'success');
    }

    function downloadBackupJson() {
      appendLog('Generating JSON backup download for ' + '${activeSite}' + '...', 'info');
      const downloadUrl = '/admin/git/backup?site_id=' + encodeURIComponent('${activeSite}');
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = 'slottd-backup-' + '${activeSite}' + '-' + new Date().toISOString().slice(0,10) + '.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      appendLog('JSON backup download initiated.', 'success');
    }
  `;

  return renderLayout('Git Center — SlottD Studio', 'git', user, html`
    <div class="header">
      <div>
        <h1 style="display: flex; align-items: center; gap: 8px;">
          Git Center & Releases
          ${renderInfoBubble('Decoupled Git releases, dry-run simulations, and multi-format exports scoped to the active website.', 'git-releases')}
        </h1>
        <p class="subtitle">Decoupled export pipeline &bull; Dry-run simulation &bull; Cross-environment restore</p>
      </div>
    </div>

    <!-- Environment & Tenancy Context Bar -->
    <div class="card status-overview-card" style="margin-bottom: 20px; padding: 16px 20px; background: rgba(30, 41, 59, 0.5); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px;">
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px;">
        <div>
          <span style="font-size: 11px; text-transform: uppercase; color: #94a3b8; display: block; margin-bottom: 2px;">Active Site</span>
          <span style="display: inline-flex; align-items: center; gap: 6px; font-weight: 700; color: #38bdf8; font-size: 14px;">
            ${renderFavicon(activeSite, 16, siteContext?.activeFavicon)}
            <span>${activeSite}</span>
          </span>
        </div>
        <div>
          <span style="font-size: 11px; text-transform: uppercase; color: #94a3b8; display: block; margin-bottom: 2px;">Database Records</span>
          <span style="font-size: 13px; color: #f8fafc;">
            <strong>${data.docCount}</strong> Docs &bull; <strong>${data.collectionCount}</strong> Collections
          </span>
        </div>
        <div>
          <span style="font-size: 11px; text-transform: uppercase; color: #94a3b8; display: block; margin-bottom: 2px;">Git Remote</span>
          <span style="font-size: 12px; color: ${data.hasRemote ? '#34d399' : '#f59e0b'}; word-break: break-all; font-family: monospace;">
            ${data.hasRemote ? data.remoteUrl : 'Not configured'}
          </span>
        </div>
        <div>
          <span style="font-size: 11px; text-transform: uppercase; color: #94a3b8; display: block; margin-bottom: 2px;">Execution Strategy</span>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 12px; color: ${data.repoPath ? '#38bdf8' : '#fbbf24'}; font-family: monospace;">
              ${data.repoPath ? '📁 Local: ' + data.repoPath : '⚡ Ephemeral Scratch Clone'}
            </span>
            <button type="button" onclick="promptSetupLocalRepo()" style="background: rgba(56,189,248,0.15); border: 1px solid rgba(56,189,248,0.4); color: #38bdf8; font-size: 11px; padding: 2px 8px; border-radius: 4px; cursor: pointer;">
              ${data.repoPath ? 'Adopt / Relink' : 'Set Up Local Clone'}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Sub-Tabs: Export vs Import (Authentic Browser Tabs) -->
    <div x-data="{ gitTab: 'export' }" style="margin-bottom: 24px;">
      
      <!-- Tab Navigation -->
      <div class="git-tab-bar">
        <button
          type="button"
          class="git-tab-btn"
          :class="gitTab === 'export' ? 'active' : ''"
          @click="gitTab = 'export'"
        >
          Export & Releases
        </button>
        <button
          type="button"
          class="git-tab-btn"
          :class="gitTab === 'import' ? 'active' : ''"
          @click="gitTab = 'import'"
        >
          Import & Restore
        </button>
      </div>

      <!-- TAB 1: EXPORT & RELEASES -->
      <div x-show="gitTab === 'export'" x-cloak>
        <div style="display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap;">
          
          <!-- Primary Focus: Content Export & Release Pipeline -->
          <div class="card" style="flex: 1; min-width: 320px; padding: 24px; margin-bottom: 0;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 16px;">
              <div>
                <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: #f8fafc;">
                  Content Export & Release Pipeline
                </h3>
                <p style="margin: 2px 0 0 0; font-size: 12px; color: #94a3b8;">
                  Select operations to execute. Dry Run lets you inspect planned changes safely before modifying disk or remote state.
                </p>
              </div>
            </div>

            <!-- Decoupled Pipeline Checkboxes -->
            <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 16px; margin-bottom: 20px; display: flex; flex-direction: column; gap: 12px;">
              <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; color: #f8fafc; font-size: 13px; font-weight: 500;">
                <input type="checkbox" id="opExportFiles" checked style="cursor: pointer; width: 16px; height: 16px;" />
                <span>Export Files to Repository (<code>${data.contentSubpath || 'root (/)'}</code>) + Auto-Generate <code>README.md</code></span>
              </label>

              <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; color: #f8fafc; font-size: 13px; font-weight: 500;">
                <input type="checkbox" id="opCreateTag" checked onchange="toggleTagInputs(this.checked)" style="cursor: pointer; width: 16px; height: 16px;" />
                <span>Create Annotated Git Release Tag</span>
              </label>

              <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; color: #f8fafc; font-size: 13px; font-weight: 500;">
                <input type="checkbox" id="opPushRemote" ${data.hasRemote ? 'checked' : ''} ${!data.hasRemote ? 'disabled' : ''} style="cursor: pointer; width: 16px; height: 16px;" />
                <span>Push to Remote Repository (<code>${data.hasRemote ? data.remoteUrl : 'Remote not configured'}</code>)</span>
              </label>
            </div>

            <!-- Tag & Commit Message Inputs -->
            <div id="tagInputsGroup" style="display: flex; flex-direction: column; gap: 14px; margin-bottom: 24px; transition: opacity 0.2s;">
              <div>
                <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px; color: #cbd5e1;">Release Tag Name</label>
                <input type="text" id="releaseTagName" class="input-search" value="${defaultTag}" style="width: 100%; box-sizing: border-box;" />
              </div>

              <div>
                <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px; color: #cbd5e1;">Commit Message</label>
                <input type="text" id="releaseCommitMsg" class="input-search" value="chore(content): release snapshot ${defaultTag}" style="width: 100%; box-sizing: border-box;" />
              </div>
            </div>

            <!-- Action Buttons: Execute vs Dry Run -->
            <div style="display: flex; gap: 12px; align-items: center;">
              <button type="button" class="btn btn-primary" style="flex: 2; justify-content: center; font-size: 13px; padding: 10px 16px;" onclick="runGitPipeline(false)">
                Execute Operations
              </button>
              <button type="button" class="btn btn-secondary" style="flex: 1; justify-content: center; font-size: 13px; padding: 10px 16px;" onclick="runGitPipeline(true)">
                Dry Run (Preview)
              </button>
            </div>
          </div>

          <!-- Vertical Action Bar: À La Carte Downloads -->
          <div class="card" style="width: 260px; padding: 20px; background: #0c1322; border: 1px solid rgba(255,255,255,0.08); display: flex; flex-direction: column; gap: 14px; flex-shrink: 0; margin-bottom: 0;">
            <div>
              <span style="font-size: 11px; text-transform: uppercase; color: #38bdf8; font-weight: 700; letter-spacing: 0.5px; display: block;">À La Carte Downloads</span>
              <span style="font-size: 12px; color: #64748b; margin-top: 4px; display: block; line-height: 1.4;">
                Instant asset exports without Git commits or remote pushes.
              </span>
            </div>

            <div style="display: flex; flex-direction: column; gap: 10px;">
              <button
                type="button"
                class="btn btn-secondary"
                onclick="exportFilesZip()"
                style="width: 100%; justify-content: flex-start; padding: 10px 14px; font-size: 13px;"
                title="Download entire collection directory tree as a ZIP archive"
              >
                Export Files as ZIP
              </button>
              <button
                type="button"
                class="btn btn-secondary"
                onclick="downloadBackupJson()"
                style="width: 100%; justify-content: flex-start; padding: 10px 14px; font-size: 13px;"
                title="Download full JSON database dump for active site"
              >
                Export JSON Dump
              </button>
            </div>
          </div>

        </div>
      </div>

      <!-- TAB 2: IMPORT & RESTORE -->
      <div x-show="gitTab === 'import'" x-cloak>
        <div class="card" style="padding: 24px; max-width: 800px;">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 16px;">
            <div>
              <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: #f8fafc;">
                Compare & Restore Content from Git Tag
              </h3>
              <p style="margin: 2px 0 0 0; font-size: 12px; color: #94a3b8;">
                Safe-by-default: preview diffs against active D1 database records before restoring content into <code>${activeSite}</code>.
              </p>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 14px; margin-bottom: 20px;">
            <div>
              <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px; color: #cbd5e1;">Select Git Release Tag</label>
              <div style="display: flex; gap: 8px;">
                <select id="tagSelect" class="select-control" style="flex: 1; height: 38px; box-sizing: border-box; background: #0b1120; border: 1px solid #334155; color: #f8fafc; border-radius: 6px; padding: 0 10px;">
                  ${data.tags.length === 0 ? html`
                    <option value="">No Git tags found (click Fetch Remote Tags or create one)</option>
                  ` : data.tags.map((t, idx) => html`
                    <option value="${t}" ${idx === 0 ? 'selected' : ''}>${t}</option>
                  `)}
                </select>
                <button type="button" class="btn btn-secondary" style="font-size: 12px; padding: 6px 14px; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px;" onclick="fetchRemoteTags()" title="Query remote Git tags via Smart HTTP">
                  Fetch Remote Tags
                </button>
              </div>
            </div>

            <div id="diffSummaryCard" style="display: none; padding: 14px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; font-size: 12px;">
              <strong style="color: #38bdf8;">Diff Preview Summary:</strong>
              <pre id="diffSummaryContent" style="margin-top: 8px; color: #e2e8f0; font-family: monospace; font-size: 11px; white-space: pre-wrap; word-break: break-word; max-height: 240px; overflow-y: auto; background: rgba(0,0,0,0.5); padding: 10px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.06);"></pre>
            </div>
          </div>

          <div style="display: flex; gap: 12px; align-items: center;">
            <button type="button" class="btn btn-primary" style="flex: 2; justify-content: center; font-size: 13px; padding: 10px 16px; background: #10b981; border-color: #10b981; color: #0f172a; font-weight: 700; display: inline-flex; align-items: center; gap: 6px;" onclick="executeRestore()">
              Execute Import (Restore D1)
            </button>
            <button type="button" class="btn btn-secondary" style="flex: 1; justify-content: center; font-size: 13px; padding: 10px 16px; display: inline-flex; align-items: center; gap: 6px;" onclick="previewGitDiff()">
              Preview Diff (Dry Run)
            </button>
          </div>
        </div>
      </div>

    </div>

    <!-- Live Terminal / Activity Console -->
    <div class="card" style="padding: 16px 20px;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 16px;">💻</span>
          <h3 style="margin: 0; font-size: 14px; font-family: monospace; color: #cbd5e1;">Console & Execution Output</h3>
        </div>
        <button type="button" class="btn-copy" onclick="clearConsoleLog()">Clear Log</button>
      </div>

      <div id="consoleLogBox" style="height: 200px; overflow-y: auto; background: #0f172a; border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; line-height: 1.5; color: #94a3b8; white-space: pre-wrap;">
[Ready] SlottD Git operations initialized for ${activeSite}. Select an operation above.
      </div>
    </div>

    <script>
      ${raw(clientScript)}
    </script>
  `, undefined, siteContext);
}
