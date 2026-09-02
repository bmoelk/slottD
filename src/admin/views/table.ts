import { html } from 'hono/html';
import { renderLayout } from '../layout.js';

export function renderTableView(
  collection: string,
  items: any[],
  user: { email: string; authMethod?: string },
  contextFilter?: { pageSlug?: string; sectionKey?: string }
) {
  const pageSlug = contextFilter?.pageSlug?.toLowerCase();
  const sectionKey = contextFilter?.sectionKey?.toLowerCase();

  const filteredItems = items.filter((item) => {
    let parsed: any = {};
    try {
      parsed = typeof item.data === 'string' ? JSON.parse(item.data) : item.data || {};
    } catch {}

    const itemPageSlug = (parsed.pageSlug || item.pageSlug || '').toLowerCase();
    const itemSectionKey = (parsed.sectionKey || item.sectionKey || parsed.galleryKey || item.galleryKey || '').toLowerCase();

    if (pageSlug && itemPageSlug && itemPageSlug !== pageSlug) {
      return false;
    }
    if (sectionKey && itemSectionKey && itemSectionKey !== sectionKey) {
      return false;
    }
    return true;
  });

  const displayItems = (pageSlug || sectionKey) ? filteredItems : items;

  return renderLayout(`${collection} — SlottD Studio`, 'content', user, html`
    <div class="header">
      <div class="breadcrumbs">
        <a href="/admin">Collections</a>
        <span>/</span>
        <span class="current">${collection}</span>
      </div>
      <div class="header-actions">
        <a href="/admin/content/${collection}/+${pageSlug ? `?pageSlug=${encodeURIComponent(pageSlug)}${sectionKey ? `&sectionKey=${encodeURIComponent(sectionKey)}` : ''}` : ''}" class="btn btn-primary">+ New ${collection.slice(0, -1) || 'Record'}</a>
      </div>
    </div>

    ${(pageSlug || sectionKey) ? html`
      <div class="card context-banner" style="display: flex; align-items: center; justify-content: space-between; background: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.3); padding: 10px 16px; margin-bottom: 16px; border-radius: 8px;">
        <div style="display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-primary); flex-wrap: wrap;">
          <span style="font-size: 16px;">🎯</span>
          <strong style="color: #a5b4fc;">Filtered by Context:</strong>
          ${pageSlug ? html`<span class="badge" style="background: rgba(99, 102, 241, 0.25); color: #c7d2fe; font-family: monospace; padding: 2px 8px; border-radius: 4px;">Page: ${pageSlug}</span>` : ''}
          ${sectionKey ? html`<span class="badge" style="background: rgba(99, 102, 241, 0.25); color: #c7d2fe; font-family: monospace; padding: 2px 8px; border-radius: 4px;">Section: ${sectionKey}</span>` : ''}
          <span style="color: var(--text-muted);">(${displayItems.length} of ${items.length} records)</span>
        </div>
        <a href="/admin/content/${collection}" class="btn btn-secondary" style="padding: 4px 12px; font-size: 12px; white-space: nowrap;">✕ Clear Filter (Show All)</a>
      </div>
    ` : ''}

    <!-- Table Filter & Search Toolbar -->
    <div class="toolbar card">
      <div class="toolbar-search">
        <span class="search-icon">🔍</span>
        <input
          type="search"
          id="itemSearch"
          class="input-search"
          placeholder="Filter records... (Press / to focus, ↑/↓ to select row, Enter to open)"
          autocomplete="off"
        />
      </div>
      <div class="toolbar-actions">
        <div class="filter-pills" id="statusFilterPills">
          <button type="button" class="pill-btn active" data-status="all" onclick="filterByStatus('all', this)">All</button>
          <button type="button" class="pill-btn" data-status="published" onclick="filterByStatus('published', this)">Published</button>
          <button type="button" class="pill-btn" data-status="draft" onclick="filterByStatus('draft', this)">Draft</button>
          <button type="button" class="pill-btn" data-status="archived" onclick="filterByStatus('archived', this)">Archived</button>
        </div>
        <span class="stat-pill" id="itemCountBadge">${displayItems.length} records</span>
      </div>
    </div>

    <div class="card table-card">
      <table class="table" id="itemsTable">
        <thead>
          <tr>
            <th style="width: 40px; text-align: center;">
              <input type="checkbox" id="selectAllCheckbox" onchange="toggleSelectAll(this)" title="Select all" />
            </th>
            <th onclick="sortTable(1)" class="sortable-th" title="Sort by Title">Title <span class="sort-indicator">↕</span></th>
            <th onclick="sortTable(2)" class="sortable-th" title="Sort by Slug">Slug <span class="sort-indicator">↕</span></th>
            <th onclick="sortTable(3)" class="sortable-th" title="Sort by Status">Status <span class="sort-indicator">↕</span></th>
            <th onclick="sortTable(4, 'date')" class="sortable-th" title="Sort by Date">Last Updated <span class="sort-indicator">↕</span></th>
            <th style="text-align: right;">Actions</th>
          </tr>
        </thead>
        <tbody id="itemsTableBody">
          ${displayItems.length === 0 ? html`
            <tr id="initialEmptyRow">
              <td colspan="6" class="empty-cell">No records matching context in this collection. Click "+ New" above to create one.</td>
            </tr>
          ` : displayItems.map((item) => html`
            <tr
              class="item-row"
              id="row_${item.id}"
              data-id="${item.id}"
              data-title="${(item.title || '').toLowerCase()}"
              data-slug="${(item.slug || '').toLowerCase()}"
              data-status="${(item.status || 'draft').toLowerCase()}"
              data-updated="${item.updated_at}"
            >
              <td style="text-align: center;">
                <input type="checkbox" class="row-checkbox" value="${item.id}" data-title="${item.title || item.slug}" onchange="updateSelection()" />
              </td>
              <td><strong><a href="/admin/content/${collection}/${item.id}">${item.title || '(Untitled)'}</a></strong></td>
              <td><code>${item.slug}</code></td>
              <td><span class="status-pill status-${item.status}">${item.status}</span></td>
              <td>${new Date(item.updated_at).toLocaleString()}</td>
              <td style="text-align: right; white-space: nowrap;">
                <a href="/admin/content/${collection}/${item.id}" class="btn-link">Edit</a>
                <span class="action-divider">|</span>
                <button type="button" class="btn-text text-danger" onclick="deleteSingleRecord('${collection}', '${item.id}', '${item.title || item.slug}')">Delete</button>
              </td>
            </tr>
          `)}
        </tbody>
      </table>

      <div id="noItemResultsState" class="empty-state" style="display: none; padding: 32px 16px;">
        <p>No records match the active filter criteria.</p>
      </div>
    </div>

    <!-- Floating Bulk Actions Toolbar -->
    <div id="bulkActionsToolbar" class="bulk-toolbar" style="display: none;">
      <span class="bulk-count"><strong id="selectedCountNumber">0</strong> selected</span>
      <div class="bulk-divider"></div>
      <button type="button" class="btn-bulk btn-bulk-publish" onclick="executeBulkStatus('${collection}', 'published')">🚀 Publish</button>
      <button type="button" class="btn-bulk btn-bulk-draft" onclick="executeBulkStatus('${collection}', 'draft')">📝 Draft</button>
      <button type="button" class="btn-bulk btn-bulk-archive" onclick="executeBulkStatus('${collection}', 'archived')">📦 Archive</button>
      <div class="bulk-divider"></div>
      <button type="button" class="btn-bulk btn-bulk-delete" onclick="executeBulkDelete('${collection}')">🗑️ Delete (Permanent)</button>
      <button type="button" class="btn-bulk-close" onclick="clearSelection()" title="Clear selection">✕</button>
    </div>

    <script>
      let activeStatusFilter = 'all';
      let sortDirections = {};
      let highlightedRowIndex = -1;
      const currentCollection = "${collection}";

      function getVisibleRows() {
        const tbody = document.getElementById('itemsTableBody');
        return Array.from(tbody.querySelectorAll('.item-row')).filter(r => r.style.display !== 'none');
      }

      function updateRowHighlight() {
        const visible = getVisibleRows();
        document.querySelectorAll('.item-row').forEach(r => r.classList.remove('keyboard-highlight'));

        if (highlightedRowIndex >= 0 && highlightedRowIndex < visible.length) {
          visible[highlightedRowIndex].classList.add('keyboard-highlight');
          visible[highlightedRowIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }

      window.addEventListener('keydown', (e) => {
        const search = document.getElementById('itemSearch');
        const isInputActive = document.activeElement === search;

        if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
          e.preventDefault();
          search?.focus();
          search?.select();
          return;
        }

        if ((e.key === 'n' || e.key === 'c') && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
          e.preventDefault();
          window.location.href = '/admin/content/' + currentCollection + '/new';
          return;
        }

        const visible = getVisibleRows();
        if (visible.length === 0) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (highlightedRowIndex < visible.length - 1) {
            highlightedRowIndex++;
          } else {
            highlightedRowIndex = 0;
          }
          updateRowHighlight();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (highlightedRowIndex > 0) {
            highlightedRowIndex--;
          } else {
            highlightedRowIndex = visible.length - 1;
          }
          updateRowHighlight();
        } else if (e.key === 'Enter') {
          if (highlightedRowIndex >= 0 && highlightedRowIndex < visible.length) {
            e.preventDefault();
            const link = visible[highlightedRowIndex].querySelector('a');
            if (link) window.location.href = link.href;
          } else if (visible.length === 1) {
            e.preventDefault();
            const link = visible[0].querySelector('a');
            if (link) window.location.href = link.href;
          }
        } else if (e.key === 'Escape') {
          highlightedRowIndex = -1;
          updateRowHighlight();
          if (isInputActive) {
            search.blur();
          }
        }
      });

      document.getElementById('itemSearch')?.addEventListener('input', applyItemFilters);

      function filterByStatus(status, btn) {
        activeStatusFilter = status;
        document.querySelectorAll('#statusFilterPills .pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyItemFilters();
      }

      function applyItemFilters() {
        const query = (document.getElementById('itemSearch')?.value || '').trim().toLowerCase();
        const rows = Array.from(document.querySelectorAll('#itemsTableBody .item-row'));
        let visibleCount = 0;

        rows.forEach(row => {
          const title = row.dataset.title || '';
          const slug = row.dataset.slug || '';
          const status = row.dataset.status || '';

          const matchesQuery = !query || title.includes(query) || slug.includes(query);
          const matchesStatus = activeStatusFilter === 'all' || status === activeStatusFilter;

          if (matchesQuery && matchesStatus) {
            row.style.display = '';
            visibleCount++;
          } else {
            row.style.display = 'none';
          }
        });

        if (visibleCount === 1) {
          highlightedRowIndex = 0;
        } else {
          highlightedRowIndex = -1;
        }
        updateRowHighlight();

        const noResults = document.getElementById('noItemResultsState');
        if (noResults) {
          noResults.style.display = visibleCount === 0 && rows.length > 0 ? 'block' : 'none';
        }

        const badge = document.getElementById('itemCountBadge');
        if (badge) {
          badge.innerText = visibleCount === rows.length ? \`\${rows.length} records\` : \`\${visibleCount} of \${rows.length} records\`;
        }
      }

      function sortTable(colIndex, type = 'text') {
        const tbody = document.getElementById('itemsTableBody');
        const rows = Array.from(tbody.querySelectorAll('.item-row'));
        const asc = !sortDirections[colIndex];
        sortDirections[colIndex] = asc;

        rows.sort((a, b) => {
          let valA = '';
          let valB = '';

          if (colIndex === 1) { valA = a.dataset.title; valB = b.dataset.title; }
          else if (colIndex === 2) { valA = a.dataset.slug; valB = b.dataset.slug; }
          else if (colIndex === 3) { valA = a.dataset.status; valB = b.dataset.status; }
          else if (colIndex === 4) {
            return asc
              ? Number(a.dataset.updated) - Number(b.dataset.updated)
              : Number(b.dataset.updated) - Number(a.dataset.updated);
          }

          return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
        });

        rows.forEach(r => tbody.appendChild(r));
      }

      // ── Bulk Selection & Actions ──────────────────────────────────────────
      function getSelectedCheckboxes() {
        return Array.from(document.querySelectorAll('.row-checkbox:checked'));
      }

      function updateSelection() {
        const checked = getSelectedCheckboxes();
        const toolbar = document.getElementById('bulkActionsToolbar');
        const countSpan = document.getElementById('selectedCountNumber');
        const selectAll = document.getElementById('selectAllCheckbox');

        document.querySelectorAll('.item-row').forEach(row => {
          const cb = row.querySelector('.row-checkbox');
          if (cb && cb.checked) {
            row.classList.add('row-selected');
          } else {
            row.classList.remove('row-selected');
          }
        });

        if (checked.length > 0) {
          toolbar.style.display = 'flex';
          countSpan.innerText = checked.length;
        } else {
          toolbar.style.display = 'none';
        }

        const allVisible = Array.from(document.querySelectorAll('.item-row')).filter(r => r.style.display !== 'none');
        if (selectAll) {
          selectAll.checked = allVisible.length > 0 && checked.length === allVisible.length;
        }
      }

      function toggleSelectAll(masterCb) {
        const visibleRows = Array.from(document.querySelectorAll('.item-row')).filter(r => r.style.display !== 'none');
        visibleRows.forEach(r => {
          const cb = r.querySelector('.row-checkbox');
          if (cb) cb.checked = masterCb.checked;
        });
        updateSelection();
      }

      function clearSelection() {
        document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = false);
        const master = document.getElementById('selectAllCheckbox');
        if (master) master.checked = false;
        updateSelection();
      }

      async function executeBulkStatus(col, targetStatus) {
        const checked = getSelectedCheckboxes();
        if (checked.length === 0) return;

        const ids = checked.map(c => c.value);
        try {
          await Promise.all(
            ids.map(id =>
              fetch(\`/items/\${col}/\${id}\`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: targetStatus })
              })
            )
          );
          window.location.reload();
        } catch (e) {
          alert('Bulk update failed: ' + e.message);
        }
      }

      async function executeBulkDelete(col) {
        const checked = getSelectedCheckboxes();
        if (checked.length === 0) return;

        const confirmed = confirm(\`Are you sure you want to PERMANENTLY delete \${checked.length} document(s) from \${col}? This cannot be undone.\`);
        if (!confirmed) return;

        const ids = checked.map(c => c.value);
        try {
          await Promise.all(
            ids.map(id =>
              fetch(\`/items/\${col}/\${id}\`, { method: 'DELETE' })
            )
          );
          window.location.reload();
        } catch (e) {
          alert('Bulk delete failed: ' + e.message);
        }
      }

      async function deleteSingleRecord(col, id, title) {
        const confirmed = confirm(\`Are you sure you want to PERMANENTLY delete "\${title}"? This cannot be undone.\`);
        if (!confirmed) return;

        try {
          const res = await fetch(\`/items/\${col}/\${id}\`, { method: 'DELETE' });
          if (res.ok || res.status === 204) {
            const row = document.getElementById(\`row_\${id}\`);
            if (row) row.remove();
            applyItemFilters();
          } else {
            alert('Failed to delete record: ' + (await res.text()));
          }
        } catch (e) {
          alert('Delete error: ' + e.message);
        }
      }
    </script>
  `);
}
