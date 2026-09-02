import { html, raw } from 'hono/html';
import { renderLayout } from '../layout.js';

export interface GitViewData {
  environment: string;
  d1DatabaseId: string;
  repoPath: string;
  hasRemote: boolean;
  remoteUrl: string;
  docCount: number;
  collectionCount: number;
  mediaCount: number;
  tags: string[];
}

export function renderGitView(
  data: GitViewData,
  user: { email: string; authMethod?: string }
) {
  const defaultTag = `release-${new Date().toISOString().slice(0, 10).replace(/-/g, '.')}-${new Date().getHours().toString().padStart(2, '0')}${new Date().getMinutes().toString().padStart(2, '0')}`;

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

    function copyRemoteSetupSnippet(btn) {
      const code = document.getElementById('remoteSetupSnippet')?.innerText || '';
      navigator.clipboard.writeText(code);
      const orig = btn.innerText;
      btn.innerText = 'Copied!';
      setTimeout(() => btn.innerText = orig, 1500);
    }

    async function fetchRemoteTags() {
      appendLog('$ git fetch --all --tags origin', 'command');
      try {
        const res = await fetch('/admin/git/fetch', { method: 'POST' });
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

    async function createGitRelease() {
      const tag = (document.getElementById('releaseTagName')?.value || '').trim();
      const msg = (document.getElementById('releaseCommitMsg')?.value || '').trim();
      const push = document.getElementById('pushToRemoteCheckbox')?.checked || false;

      if (!tag) {
        alert('Please specify a Git release tag name.');
        return;
      }

      appendLog('$ git add -A content/ && git commit -m "' + msg + '" && git tag -a ' + tag + (push ? ' && git push origin HEAD --tags' : ''), 'command');
      try {
        const res = await fetch('/admin/git/release', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag, message: msg, push })
        });
        const json = await res.json();
        if (res.ok) {
          appendLog('✅ ' + json.message, 'success');
          if (json.output) appendLog(json.output, 'info');
          setTimeout(() => window.location.reload(), 2000);
        } else {
          appendLog('❌ Release failed: ' + (json.error || res.statusText), 'error');
          if (json.output) appendLog(json.output, 'error');
        }
      } catch (e) {
        appendLog('❌ Release error: ' + e.message, 'error');
      }
    }

    async function previewGitDiff() {
      const tag = document.getElementById('tagSelect')?.value;
      if (!tag) {
        alert('No tag selected.');
        return;
      }

      appendLog('$ git diff --stat ' + tag + ' -- content/', 'command');
      try {
        const res = await fetch('/admin/git/diff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag })
        });
        const json = await res.json();
        if (res.ok) {
          appendLog('✅ Diff generated against tag \\'' + tag + '\\':', 'success');
          if (json.output) appendLog(json.output, 'info');

          const diffCard = document.getElementById('diffSummaryCard');
          const diffContent = document.getElementById('diffSummaryContent');
          const btnConfirm = document.getElementById('btnConfirmRestore');

          if (diffCard && diffContent) {
            diffCard.style.display = 'block';
            diffContent.textContent = json.summary || json.output || 'Working content matches tag exactly (0 changes).';
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
      if (!tag) return;

      const confirmed = confirm('Are you sure you want to load and restore D1 database content from Git tag \\'' + tag + '\\'?');
      if (!confirmed) return;

      appendLog('$ git checkout ' + tag + ' -- content/ (Restoring D1 records...)', 'command');
      try {
        const res = await fetch('/admin/git/load', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag })
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

    function downloadBackupJson() {
      appendLog('Generating direct JSON backup download attachment...', 'info');
      const downloadUrl = '/admin/git/backup';
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = 'slottd-backup-' + new Date().toISOString().slice(0,10) + '.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      appendLog('Backup download initiated.', 'success');
    }
  `;

  return renderLayout('Git Center — SlottD Studio', 'git', user, html`
    <div class="header">
      <div>
        <h1>Git Operations & Releases</h1>
        <p class="subtitle">Version-control your schema and content in Git, preview safe diffs, and deploy across environments.</p>
      </div>
      <div class="header-actions">
        <button type="button" class="btn btn-secondary" onclick="fetchRemoteTags()">
          🔄 Fetch Remote Tags
        </button>
        <button type="button" class="btn btn-secondary" onclick="downloadBackupJson()">
          ⬇️ Download JSON Backup
        </button>
      </div>
    </div>

    <!-- Remote Setup Warning Box (If No Remote) -->
    ${!data.hasRemote ? html`
      <div class="card" style="margin-bottom: 24px; padding: 18px 24px; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 10px;">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap;">
          <div>
            <h4 style="margin: 0 0 6px; color: #fbbf24; font-size: 14px; display: flex; align-items: center; gap: 6px;">
              <span>⚠️</span> No Git Remote Configured
            </h4>
            <p style="margin: 0; font-size: 12px; color: #fde68a;">
              To fetch or push releases to a central repository, configure a git remote origin in the deployment folder:
            </p>
          </div>
          <button type="button" class="btn btn-secondary" onclick="copyRemoteSetupSnippet(this)" style="font-size: 12px; background: rgba(245, 158, 11, 0.2); border-color: rgba(245, 158, 11, 0.4); color: #fef08a;">
            📋 Copy Setup Commands
          </button>
        </div>
        <pre id="remoteSetupSnippet" style="margin-top: 12px; margin-bottom: 0; background: #090d16; padding: 12px 14px; border-radius: 6px; font-size: 12px; color: #38bdf8; overflow-x: auto; font-family: ui-monospace, monospace;">cd ${data.repoPath}
git remote add origin git@github.com:bmoelk/brainendeavor.com.git
git branch -M main
git push -u origin main</pre>
      </div>
    ` : ''}

    <!-- Environment & Database Status Header -->
    <div class="card status-overview-card" style="margin-bottom: 24px; padding: 18px 24px; background: rgba(30, 41, 59, 0.5); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px;">
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
        <div>
          <span style="font-size: 11px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.5px; display: block; margin-bottom: 4px;">Environment</span>
          <span style="display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: #38bdf8; font-size: 14px;">
            <span style="width: 8px; height: 8px; border-radius: 50%; background: #38bdf8;"></span>
            ${data.environment.toUpperCase()}
          </span>
        </div>
        <div>
          <span style="font-size: 11px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.5px; display: block; margin-bottom: 4px;">D1 Database</span>
          <code style="font-size: 12px; color: #cbd5e1; background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px;">${data.d1DatabaseId}</code>
        </div>
        <div>
          <span style="font-size: 11px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.5px; display: block; margin-bottom: 4px;">Database Metrics</span>
          <span style="font-size: 13px; color: #f8fafc;">
            <strong>${data.docCount}</strong> Documents (${data.collectionCount} Collections) &bull; <strong>${data.mediaCount}</strong> R2 Assets
          </span>
        </div>
        <div>
          <span style="font-size: 11px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.5px; display: block; margin-bottom: 4px;">Deployment Repo Path</span>
          <code style="font-size: 11px; color: #94a3b8; word-break: break-all;">${data.repoPath}</code>
          ${data.hasRemote ? html`<div style="font-size: 11px; color: #34d399; margin-top: 2px;">Remote: <code>${data.remoteUrl}</code></div>` : ''}
        </div>
      </div>
    </div>

    <!-- Main Grid: Export/Commit vs Import/Diff -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 24px; margin-bottom: 24px;">
      
      <!-- Card 1: Git Commit & Tag Release -->
      <div class="card" style="padding: 24px; display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
            <span style="font-size: 24px;">🏷️</span>
            <div>
              <h3 style="margin: 0; font-size: 16px;">Git Commit & Tag Release</h3>
              <p style="margin: 0; font-size: 12px; color: #94a3b8;">Export active D1 database to <code>content/</code> and create an annotated Git tag.</p>
            </div>
          </div>

          <div style="margin-top: 18px; display: flex; flex-direction: column; gap: 12px;">
            <div>
              <label style="display: block; font-size: 12px; font-weight: 500; margin-bottom: 4px; color: #cbd5e1;">Git Release Tag</label>
              <input type="text" id="releaseTagName" class="input-search" value="${defaultTag}" style="width: 100%;" />
            </div>

            <div>
              <label style="display: block; font-size: 12px; font-weight: 500; margin-bottom: 4px; color: #cbd5e1;">Commit Message</label>
              <input type="text" id="releaseCommitMsg" class="input-search" placeholder="e.g. Content update release" value="chore(content): release snapshot ${defaultTag}" style="width: 100%;" />
            </div>

            <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
              <input type="checkbox" id="pushToRemoteCheckbox" style="cursor: pointer;" checked />
              <label for="pushToRemoteCheckbox" style="font-size: 12px; color: #cbd5e1; cursor: pointer;">
                Push commit & tag to Git remote (<code>origin</code>)
              </label>
            </div>
          </div>
        </div>

        <div style="margin-top: 24px;">
          <button type="button" class="btn btn-primary" style="width: 100%; justify-content: center;" onclick="createGitRelease()">
            🚀 Create Release & Export to Git
          </button>
        </div>
      </div>

      <!-- Card 2: Compare & Load Content from Git Tag -->
      <div class="card" style="padding: 24px; display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
            <span style="font-size: 24px;">🔄</span>
            <div>
              <h3 style="margin: 0; font-size: 16px;">Load Content from Git Tag</h3>
              <p style="margin: 0; font-size: 12px; color: #94a3b8;">Safe-by-default: preview file mutations before restoring records into D1.</p>
            </div>
          </div>

          <div style="margin-top: 18px; display: flex; flex-direction: column; gap: 12px;">
            <div>
              <label style="display: block; font-size: 12px; font-weight: 500; margin-bottom: 4px; color: #cbd5e1;">Select Git Tag to Restore</label>
              <select id="tagSelect" class="select-control" style="width: 100%; height: 38px;">
                ${data.tags.length === 0 ? html`
                  <option value="">No Git tags found (create one first)</option>
                ` : data.tags.map((t, idx) => html`
                  <option value="${t}" ${idx === 0 ? 'selected' : ''}>${t}</option>
                `)}
              </select>
            </div>

            <div id="diffSummaryCard" style="display: none; padding: 12px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; font-size: 12px;">
              <strong style="color: #38bdf8;">Preview Diff Summary:</strong>
              <div id="diffSummaryContent" style="margin-top: 6px; color: #e2e8f0; font-family: monospace;"></div>
            </div>
          </div>
        </div>

        <div style="margin-top: 24px; display: flex; gap: 8px;">
          <button type="button" class="btn btn-secondary" style="flex: 1; justify-content: center;" onclick="previewGitDiff()">
            🔍 Preview Diff (Dry Run)
          </button>
          <button type="button" id="btnConfirmRestore" class="btn btn-primary" style="flex: 1; justify-content: center; display: none; background: #10b981;" onclick="executeRestore()">
            ✓ Confirm & Load into D1
          </button>
        </div>
      </div>

    </div>

    <!-- Live Terminal / Activity Console -->
    <div class="card" style="padding: 16px 20px;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 16px;">💻</span>
          <h3 style="margin: 0; font-size: 14px; font-family: monospace; color: #cbd5e1;">Git & D1 Console Output</h3>
        </div>
        <button type="button" class="btn-copy" onclick="clearConsoleLog()">Clear Log</button>
      </div>

      <div id="consoleLogBox" style="height: 220px; overflow-y: auto; background: #0f172a; border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; line-height: 1.5; color: #94a3b8; white-space: pre-wrap;">
[Ready] SlottD Git operations initialized for ${data.repoPath}. Select an action above.
      </div>
    </div>

    <script>
      ${raw(clientScript)}
    </script>
  `);
}
