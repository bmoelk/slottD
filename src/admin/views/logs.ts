import { html, raw } from 'hono/html';
import { renderLayout } from '../layout.js';

export function renderLogsView(
  logs: any[],
  user: { email: string; authMethod?: string }
) {
  const clientScript = `
    let activeActionFilter = 'all';
    let activeDateFilter = 'all';
    let highlightedLogIndex = -1;

    function getVisibleLogs() {
      const rows = Array.from(document.querySelectorAll('.log-row-wrapper'));
      return rows.filter(r => r.style.display !== 'none');
    }

    function updateLogHighlight() {
      const visible = getVisibleLogs();
      document.querySelectorAll('.log-row-wrapper').forEach(r => r.classList.remove('keyboard-highlight'));

      if (highlightedLogIndex >= 0 && highlightedLogIndex < visible.length) {
        visible[highlightedLogIndex].classList.add('keyboard-highlight');
        visible[highlightedLogIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }

    window.addEventListener('keydown', (e) => {
      const search = document.getElementById('logSearch');
      const isInputActive = document.activeElement === search || document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA';

      if (e.key === '/' && !isInputActive) {
        e.preventDefault();
        search?.focus();
        search?.select();
        return;
      }

      const visible = getVisibleLogs();
      if (visible.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (highlightedLogIndex < visible.length - 1) {
          highlightedLogIndex++;
        } else {
          highlightedLogIndex = 0;
        }
        updateLogHighlight();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (highlightedLogIndex > 0) {
          highlightedLogIndex--;
        } else {
          highlightedLogIndex = visible.length - 1;
        }
        updateLogHighlight();
      } else if (e.key === 'Enter') {
        if (highlightedLogIndex >= 0 && highlightedLogIndex < visible.length) {
          e.preventDefault();
          const inspectBtn = visible[highlightedLogIndex].querySelector('.btn-inspect-diff');
          if (inspectBtn) inspectBtn.click();
        }
      } else if (e.key === 'Escape') {
        highlightedLogIndex = -1;
        updateLogHighlight();
        closeDiffModal();
        if (document.activeElement === search) {
          search.blur();
        }
      }
    });

    document.getElementById('logSearch')?.addEventListener('input', applyLogFilters);

    function filterByAction(action, btn) {
      activeActionFilter = action;
      document.querySelectorAll('#actionFilterPills .pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyLogFilters();
    }

    function filterByDateRange(range) {
      activeDateFilter = range;
      applyLogFilters();
    }

    function applyLogFilters() {
      const query = (document.getElementById('logSearch')?.value || '').trim().toLowerCase();
      const rows = Array.from(document.querySelectorAll('.log-row-wrapper'));
      const now = Date.now();
      let visibleCount = 0;

      rows.forEach(row => {
        const action = row.dataset.action || '';
        const actor = row.dataset.actor || '';
        const col = row.dataset.collection || '';
        const title = row.dataset.title || '';
        const id = row.dataset.id || '';
        const timestamp = Number(row.dataset.timestamp) || 0;

        const matchesQuery = !query || action.includes(query) || actor.includes(query) || col.includes(query) || title.includes(query) || id.includes(query);
        const matchesAction = activeActionFilter === 'all' || action === activeActionFilter;

        let matchesDate = true;
        if (activeDateFilter === 'today') {
          const oneDayAgo = now - 24 * 60 * 60 * 1000;
          matchesDate = timestamp >= oneDayAgo;
        } else if (activeDateFilter === '7days') {
          const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
          matchesDate = timestamp >= sevenDaysAgo;
        } else if (activeDateFilter === '30days') {
          const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
          matchesDate = timestamp >= thirtyDaysAgo;
        }

        if (matchesQuery && matchesAction && matchesDate) {
          row.style.display = '';
          visibleCount++;
        } else {
          row.style.display = 'none';
        }
      });

      const countBadge = document.getElementById('logMatchCountBadge');
      if (countBadge) countBadge.innerText = visibleCount + ' Events';

      const noState = document.getElementById('noLogsState');
      if (noState) {
        noState.style.display = visibleCount === 0 && rows.length > 0 ? 'block' : 'none';
      }

      if (visibleCount === 1) {
        highlightedLogIndex = 0;
      } else {
        highlightedLogIndex = -1;
      }
      updateLogHighlight();
    }

    function inspectDiff(btn) {
      const rawDetails = btn.dataset.details || '{}';
      let formatted = rawDetails;
      try {
        formatted = JSON.stringify(JSON.parse(rawDetails), null, 2);
      } catch {}

      const modal = document.getElementById('diffModal');
      const content = document.getElementById('diffModalContent');
      if (modal && content) {
        content.innerText = formatted;
        modal.style.display = 'flex';
      }
    }

    function closeDiffModal() {
      const modal = document.getElementById('diffModal');
      if (modal) modal.style.display = 'none';
    }
  `;

  return renderLayout('Activity & Audit Logs — SlottD Studio', 'logs', user, html`
    <div class="header">
      <div>
        <h1>Activity & Audit Logs</h1>
        <p class="subtitle">Real-time append-only ledger of document mutations, media updates, and releases.</p>
      </div>
      <div class="header-stats">
        <span class="stat-pill" id="logMatchCountBadge">${logs.length} Events</span>
      </div>
    </div>

    <!-- Toolbar: Search, Actions, Date Range -->
    <div class="toolbar card">
      <div class="toolbar-search">
        <span class="search-icon">🔍</span>
        <input
          type="search"
          id="logSearch"
          class="input-search"
          placeholder="Filter activity... (Press / to focus, ↑/↓ to select, Enter to view diff)"
          autocomplete="off"
        />
      </div>

      <div class="toolbar-actions">
        <!-- Action Filter Pills -->
        <div class="filter-pills" id="actionFilterPills">
          <button type="button" class="pill-btn active" data-action="all" onclick="filterByAction('all', this)">
            All <span class="pill-count">${logs.length}</span>
          </button>
          <button type="button" class="pill-btn" data-action="create" onclick="filterByAction('create', this)">
            Create <span class="pill-count">${logs.filter(l => l.action === 'create').length}</span>
          </button>
          <button type="button" class="pill-btn" data-action="update" onclick="filterByAction('update', this)">
            Update <span class="pill-count">${logs.filter(l => l.action === 'update').length}</span>
          </button>
          <button type="button" class="pill-btn" data-action="delete" onclick="filterByAction('delete', this)">
            Delete <span class="pill-count">${logs.filter(l => l.action === 'delete').length}</span>
          </button>
        </div>

        <div class="toolbar-right-controls">
          <!-- Date Filter Dropdown -->
          <div class="custom-select-wrap">
            <select id="logDateFilterSelect" class="select-control" onchange="filterByDateRange(this.value)">
              <option value="all">Date: All Time</option>
              <option value="today">Date: Past 24 Hours</option>
              <option value="7days">Date: Past 7 Days</option>
              <option value="30days">Date: Past 30 Days</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <!-- Logs Table -->
    <div class="card" style="padding: 0; overflow: hidden;">
      ${logs.length === 0 ? html`
        <div class="empty-state" style="padding: 40px 20px;">
          <p class="empty-icon">📋</p>
          <h3>No activity recorded yet</h3>
          <p class="empty-subtitle">Document creations, edits, media changes, and releases will appear here.</p>
        </div>
      ` : html`
        <div class="log-table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 100px;">Action</th>
                <th style="width: 130px;">Collection</th>
                <th>Target Document / Entity</th>
                <th style="width: 160px;">Actor</th>
                <th style="width: 170px;">Timestamp</th>
                <th style="width: 80px; text-align: right;">Details</th>
              </tr>
            </thead>
            <tbody>
              ${logs.map((act) => {
                const dateStr = new Date(act.timestamp).toLocaleString();
                const actionColors: Record<string, string> = {
                  create: '#10b981',
                  update: '#3b82f6',
                  delete: '#ef4444',
                  release_tag: '#8b5cf6',
                  hydrate: '#f59e0b',
                };
                const color = actionColors[act.action] || '#6b7280';
                const hasDetails = Boolean(act.details && act.details !== '{}');

                return html`
                  <tr
                    class="log-row-wrapper"
                    data-action="${(act.action || '').toLowerCase()}"
                    data-collection="${(act.collection || '').toLowerCase()}"
                    data-actor="${(act.actor || '').toLowerCase()}"
                    data-title="${(act.document_title || '').toLowerCase()}"
                    data-id="${(act.document_id || '').toLowerCase()}"
                    data-timestamp="${act.timestamp || 0}"
                  >
                    <td>
                      <span class="action-badge" style="background: ${color}20; color: ${color}; border: 1px solid ${color}40;">
                        ${act.action}
                      </span>
                    </td>
                    <td>
                      ${act.collection ? html`<code>${act.collection}</code>` : html`<span class="text-muted">—</span>`}
                    </td>
                    <td>
                      <strong>${act.document_title || act.document_id}</strong>
                      ${act.document_id && act.document_title ? html`<br/><code style="font-size: 11px; color: var(--text-muted);">${act.document_id}</code>` : ''}
                    </td>
                    <td>
                      <span style="font-size: 12px; color: var(--text-muted);">${act.actor}</span>
                    </td>
                    <td>
                      <time style="font-size: 12px; color: var(--text-muted);" title="${dateStr}">${dateStr}</time>
                    </td>
                    <td style="text-align: right;">
                      ${hasDetails ? html`
                        <button
                          type="button"
                          class="btn-inspect-diff btn-copy"
                          data-details="${typeof act.details === 'string' ? act.details : JSON.stringify(act.details)}"
                          onclick="inspectDiff(this)"
                          title="Inspect mutation JSON details"
                        >
                          View
                        </button>
                      ` : html`
                        <span style="color: var(--text-muted); font-size: 12px;">—</span>
                      `}
                    </td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>
      `}
    </div>

    <!-- Empty Search State -->
    <div id="noLogsState" class="card empty-state" style="display: none; margin-top: 16px;">
      <p class="empty-icon">🔍</p>
      <h3>No matching activity records found</h3>
      <p class="empty-subtitle">Try adjusting your search query, action filter, or date range.</p>
    </div>

    <!-- Diff / Details Modal -->
    <div id="diffModal" class="modal-backdrop" style="display: none;" onclick="if (event.target === this) closeDiffModal()">
      <div class="modal-dialog" style="max-width: 600px;">
        <div class="modal-header">
          <h3>Mutation Payload / Diff Details</h3>
          <button type="button" class="btn-close" onclick="closeDiffModal()">✕</button>
        </div>
        <div class="modal-body">
          <pre id="diffModalContent" style="background: #090d16; padding: 16px; border-radius: 8px; font-size: 12px; color: #38bdf8; overflow-x: auto; max-height: 400px;"></pre>
        </div>
      </div>
    </div>

    <style>
      .log-table-container {
        overflow-x: auto;
      }
      .data-table {
        width: 100%;
        border-collapse: collapse;
        text-align: left;
        font-size: 13px;
      }
      .data-table th {
        padding: 12px 16px;
        background: rgba(0,0,0,0.2);
        color: var(--text-muted, #94a3b8);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));
      }
      .data-table td {
        padding: 12px 16px;
        border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.06));
        vertical-align: middle;
      }
      .log-row-wrapper:hover {
        background: rgba(255,255,255,0.02);
      }
      .log-row-wrapper.keyboard-highlight {
        background: rgba(99, 102, 241, 0.1) !important;
        outline: 1px solid #6366f1;
      }
      .action-badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 4px;
        font-weight: 600;
        font-size: 11px;
        text-transform: uppercase;
      }
    </style>

    <script>
      ${raw(clientScript)}
    </script>
  `);
}
