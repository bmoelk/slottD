import { html, raw } from 'hono/html';
import { renderLayout } from '../layout.js';

export interface TableViewScopeOptions {
  scopeFilterDef?: {
    key: string;
    label: string;
    values: { value: string; label: string; count: number }[];
  } | null;
  activeScope?: {
    key: string;
    value: string;
    label: string;
  } | null;
  totalCount?: number;
  autoReorder?: boolean;
}

export function renderTableView(
  collection: string,
  items: any[],
  user: { email: string; authMethod?: string },
  contextFilter?: { pageSlug?: string; sectionKey?: string },
  orderField?: string,
  scopeOptions?: TableViewScopeOptions,
  siteContext?: { activeSite?: string; availableSites?: string[] }
) {
  const pageSlug = contextFilter?.pageSlug?.toLowerCase();
  const sectionKey = contextFilter?.sectionKey?.toLowerCase();
  const scopeFilterDef = scopeOptions?.scopeFilterDef;
  const activeScope = scopeOptions?.activeScope;
  const totalCount = scopeOptions?.totalCount ?? items.length;

  const isDirectMatch = Boolean(
    sectionKey && (
      sectionKey === collection.toLowerCase() ||
      sectionKey === collection.toLowerCase().replace(/s$/, '') ||
      collection.toLowerCase() === sectionKey.replace(/s$/, '')
    )
  );

  let displayItems = items;
  if (!isDirectMatch && !scopeFilterDef && (pageSlug || sectionKey)) {
    displayItems = items.filter((item) => {
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
  }

  const activeSite = siteContext?.activeSite;
  const siteQueryParam = activeSite ? `site_id=${encodeURIComponent(activeSite)}` : '';
  const siteQuery = activeSite ? `?site_id=${encodeURIComponent(activeSite)}` : '';

  // Construct query parameters for the "+ New Record" link
  const newRecordParts: string[] = [];
  if (activeSite) {
    newRecordParts.push(`site_id=${encodeURIComponent(activeSite)}`);
    newRecordParts.push(`site=${encodeURIComponent(activeSite)}`);
  }
  if (activeScope) {
    newRecordParts.push(`${encodeURIComponent(activeScope.key)}=${encodeURIComponent(activeScope.value)}`);
  }
  if (!isDirectMatch) {
    if (pageSlug && activeScope?.key !== 'pageSlug') {
      newRecordParts.push(`pageSlug=${encodeURIComponent(pageSlug)}`);
    }
    if (sectionKey && activeScope?.key !== 'sectionKey') {
      newRecordParts.push(`sectionKey=${encodeURIComponent(sectionKey)}`);
    }
  }
  const newRecordQuery = newRecordParts.length > 0 ? `?${newRecordParts.join('&')}` : '';

  const initialItemsData = displayItems.map((item, idx) => {
    let parsed: any = {};
    try {
      parsed = typeof item.data === 'string' ? JSON.parse(item.data) : (item.data || {});
    } catch {}
    const o = orderField ? parsed[orderField] : undefined;
    const num = (o !== undefined && o !== null && o !== '' && !isNaN(Number(o))) ? Number(o) : (idx + 1) * 10;
    return { id: String(item.id), order: num, initialOrder: num };
  });

  return renderLayout(`${collection} — SlottD Studio`, 'content', user, html`
    ${orderField ? html`
    <script>
      window.tableReorderApp = function() {
        return {
          isReorderMode: ${scopeOptions?.autoReorder ? 'true' : 'false'},
          hasScopeFilter: ${scopeFilterDef && scopeFilterDef.values.length > 1 && !activeScope ? 'true' : 'false'},
          showScopePrompt: false,
          isSaving: false,
          activeSite: ${raw(JSON.stringify(activeSite || ''))},
          orderField: ${raw(JSON.stringify(orderField))},
          collection: ${raw(JSON.stringify(collection))},
          items: ${raw(JSON.stringify(initialItemsData))},

          get dirtyCount() {
            return this.items.filter(i => Number(i.order) !== Number(i.initialOrder)).length;
          },

          isItemDirty(id) {
            const item = this.items.find(i => String(i.id) === String(id));
            return item ? Number(item.order) !== Number(item.initialOrder) : false;
          },

          getItemOrder(id) {
            const item = this.items.find(i => String(i.id) === String(id));
            return item ? item.order : '';
          },

          getVisibleRows() {
            const tbody = document.getElementById('itemsTableBody');
            return Array.from(tbody ? tbody.querySelectorAll('.item-row') : []).filter(r => r.style.display !== 'none');
          },

          toggleReorderMode() {
            this.isReorderMode = !this.isReorderMode;
            if (this.isReorderMode) {
              const search = document.getElementById('itemSearch');
              if (search && search.value) {
                search.value = '';
                if (typeof window.applyItemFilters === 'function') window.applyItemFilters();
              }
            }
          },

          updateItemOrder(id, value) {
            const num = Number(value);
            const item = this.items.find(i => String(i.id) === String(id));
            if (item && !isNaN(num)) {
              item.order = num;
              const row = document.getElementById('row_' + id);
              if (row) row.dataset.order = String(num);
              const badge = row?.querySelector('.order-badge');
              if (badge) badge.textContent = String(num);
              this.items = [...this.items];
            }
          },

          moveRow(id, direction) {
            const visibleRows = this.getVisibleRows();
            const currentIndex = visibleRows.findIndex(r => r.dataset.id === String(id));
            if (currentIndex === -1) return;
            const targetIndex = currentIndex + direction;
            if (targetIndex < 0 || targetIndex >= visibleRows.length) return;

            const currentRow = visibleRows[currentIndex];
            const targetRow = visibleRows[targetIndex];
            const tbody = document.getElementById('itemsTableBody');

            if (direction < 0) {
              tbody.insertBefore(currentRow, targetRow);
            } else {
              tbody.insertBefore(currentRow, targetRow.nextSibling);
            }

            this.autoSequence(10);
          },

          handleSort(itemEl, position) {
            this.autoSequence(10);
          },

          autoSequence(step = 10) {
            const rows = this.getVisibleRows();
            rows.forEach((row, index) => {
              const id = row.dataset.id;
              const newOrder = (index + 1) * step;
              row.dataset.order = String(newOrder);

              const input = row.querySelector('.reorder-input');
              if (input) input.value = String(newOrder);

              const badge = row.querySelector('.order-badge');
              if (badge) badge.textContent = String(newOrder);

              const item = this.items.find(i => String(i.id) === String(id));
              if (item) {
                item.order = newOrder;
              }
            });
            this.items = [...this.items];
          },

          resetOrders() {
            this.items.forEach(i => {
              i.order = i.initialOrder;
              const row = document.getElementById('row_' + i.id);
              if (row) {
                row.dataset.order = String(i.initialOrder);
                const input = row.querySelector('.reorder-input');
                if (input) input.value = String(i.initialOrder);
                const badge = row.querySelector('.order-badge');
                if (badge) badge.textContent = String(i.initialOrder);
              }
            });
            const tbody = document.getElementById('itemsTableBody');
            const sorted = [...this.items].sort((a, b) => a.initialOrder - b.initialOrder);
            sorted.forEach(i => {
              const row = document.getElementById('row_' + i.id);
              if (row) tbody.appendChild(row);
            });
            this.items = [...this.items];
          },

          async saveOrders() {
            const dirtyItems = this.items.filter(i => Number(i.order) !== Number(i.initialOrder));
            if (dirtyItems.length === 0) return;

            this.isSaving = true;
            try {
              const targetSite = this.activeSite || window.currentActiveSite || undefined;
              const payload = {
                orderField: this.orderField,
                site_id: targetSite,
                items: dirtyItems.map(i => ({ id: i.id, [this.orderField]: i.order }))
              };
              const reorderSiteQuery = targetSite ? '?site_id=' + encodeURIComponent(targetSite) : '';
              const res = await fetch('/admin/content/' + this.collection + '/reorder' + reorderSiteQuery, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              });
              const result = await res.json();
              if (!res.ok || result.error) {
                throw new Error(result.error || 'Failed to update order');
              }
              const cleanUrl = new URL(window.location.href);
              cleanUrl.searchParams.delete('reorder');
              window.location.href = cleanUrl.toString();
            } catch (err) {
              alert('Failed to save order: ' + err.message);
              this.isSaving = false;
            }
          }
        };
      };
      if (window.Alpine) {
        window.Alpine.data('tableReorderApp', window.tableReorderApp);
      } else {
        document.addEventListener('alpine:init', () => {
          window.Alpine.data('tableReorderApp', window.tableReorderApp);
        });
      }
    </script>
    ` : ''}
    <div x-data="${orderField ? 'tableReorderApp()' : '{}'}">
      <div class="header">
        <div class="breadcrumbs">
          <a href="/admin${siteQuery}">Collections</a>
          <span>/</span>
          ${activeScope ? html`
            <a href="/admin/content/${collection}${siteQuery}">${collection}</a>
            <span>/</span>
            <span class="current">${activeScope.label}</span>
          ` : html`
            <span class="current">${collection}</span>
          `}
        </div>
        <div class="header-actions" style="display: flex; align-items: center; gap: 8px;">
          ${orderField ? html`
            <button
              type="button"
              class="btn btn-reorder"
              :class="{ 'btn-reorder-active': isReorderMode }"
              @click="toggleReorderMode()"
              title="Toggle drag-and-drop display order reordering"
            >
              <span x-text="isReorderMode ? '✕ Exit Reorder' : '↕️ Reorder'">↕️ Reorder</span>
            </button>
          ` : ''}
          <a href="/admin/content/${collection}/+${newRecordQuery}" class="btn btn-primary">+ New ${collection.slice(0, -1) || 'Record'}</a>
        </div>
      </div>

    ${(orderField && scopeFilterDef && scopeFilterDef.values.length > 1 && !activeScope) ? html`
      <div
        x-show="isReorderMode"
        x-cloak
        class="card scope-info-banner"
        style="margin-bottom: 16px; padding: 10px 16px; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 8px;"
      >
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-primary);">
            <span style="font-size: 16px;">💡</span>
            <span>
              This collection contains distinct <strong>${scopeFilterDef.label}</strong> categories. You may wish to scope the reordering by selecting a category above, or proceed reordering all records below.
            </span>
          </div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center;">
            ${scopeFilterDef.values.map(v => html`
              <a
                href="/admin/content/${collection}?${siteQueryParam ? `${siteQueryParam}&` : ''}${scopeFilterDef.key}=${encodeURIComponent(v.value)}&reorder=true"
                class="btn btn-secondary"
                style="font-size: 11px; padding: 3px 10px; border-color: rgba(56, 189, 248, 0.3); color: #38bdf8;"
              >
                ${v.label} (${v.count})
              </a>
            `)}
          </div>
        </div>
      </div>
    ` : ''}

    ${orderField ? html`
      <div
        class="reorder-banner"
        x-show="isReorderMode"
        x-cloak
        style="display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; padding: 12px 16px; background: rgba(14, 165, 233, 0.1); border: 1px solid rgba(14, 165, 233, 0.4); border-radius: 8px; flex-wrap: wrap;"
      >
        <div style="display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--text-primary); flex-wrap: wrap;">
          <span style="font-size: 18px;">↕️</span>
          <div>
            <strong>Reorder Mode Active</strong>
            <span style="color: var(--text-muted); margin-left: 6px;">
              Drag rows with <code style="font-size: 11px;">⠿</code>, use <kbd style="background: rgba(255,255,255,0.1); padding: 1px 4px; border-radius: 3px;">▲</kbd>/<kbd style="background: rgba(255,255,255,0.1); padding: 1px 4px; border-radius: 3px;">▼</kbd>, or edit numbers directly.
            </span>
          </div>
          <span
            x-show="dirtyCount > 0"
            class="badge"
            style="background: #f59e0b; color: #000; font-weight: 700; padding: 2px 8px; border-radius: 9999px; font-size: 11px;"
            x-text="dirtyCount + ' pending change' + (dirtyCount === 1 ? '' : 's')"
          ></span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0; flex-wrap: wrap;">
          <button
            type="button"
            class="btn btn-secondary"
            @click="autoSequence(10)"
            style="padding: 4px 10px; font-size: 12px;"
            title="Auto-sequence visible rows as 10, 20, 30..."
          >
            Auto (10, 20...)
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            @click="autoSequence(1)"
            style="padding: 4px 10px; font-size: 12px;"
            title="Auto-sequence visible rows as 1, 2, 3..."
          >
            Auto (1, 2...)
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            @click="resetOrders()"
            :disabled="dirtyCount === 0"
            style="padding: 4px 10px; font-size: 12px;"
          >
            Reset
          </button>
          <button
            type="button"
            class="btn btn-primary"
            @click="saveOrders()"
            :disabled="isSaving || dirtyCount === 0"
            style="padding: 4px 14px; font-size: 12px; font-weight: 600; background: #0284c7; border-color: #38bdf8;"
          >
            <span x-text="isSaving ? 'Saving...' : '💾 Save Order'">💾 Save Order</span>
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            @click="toggleReorderMode()"
            style="padding: 4px 10px; font-size: 12px;"
          >
            ✕ Close
          </button>
        </div>
      </div>
    ` : ''}

    ${(scopeFilterDef && scopeFilterDef.values.length > 1) ? html`
      <div class="scope-filter-container">
        <div class="scope-filter-header">
          <span class="scope-filter-label">${scopeFilterDef.label}:</span>
          <div class="scope-pills">
            <a
              href="/admin/content/${collection}${siteQuery}"
              class="scope-pill ${!activeScope ? 'active' : ''}"
            >
              All
              <span class="pill-count">${totalCount}</span>
            </a>
            ${scopeFilterDef.values.map(v => {
              const isActive = activeScope && activeScope.value.toLowerCase() === v.value.toLowerCase();
              return html`
                <a
                  href="/admin/content/${collection}?${siteQueryParam ? `${siteQueryParam}&` : ''}${scopeFilterDef.key}=${encodeURIComponent(v.value)}"
                  class="scope-pill ${isActive ? 'active' : ''}"
                >
                  ${v.label}
                  <span class="pill-count">${v.count}</span>
                </a>
              `;
            })}
          </div>
        </div>
        ${(!activeScope && orderField) ? html`
          <div class="scope-reorder-hint">
            <span>💡 This collection contains distinct ${scopeFilterDef.label.toLowerCase()} categories. You may scope reordering by category above, or reorder across all records as needed.</span>
          </div>
        ` : ''}
      </div>
    ` : ''}

    ${(!isDirectMatch && (pageSlug || sectionKey) && (!scopeFilterDef || scopeFilterDef.values.length <= 1)) ? html`
      <div class="card context-banner" style="display: flex; align-items: center; justify-content: space-between; background: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.3); padding: 10px 16px; margin-bottom: 16px; border-radius: 8px;">
        <div style="display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-primary); flex-wrap: wrap;">
          <span style="font-size: 16px;">🎯</span>
          <strong style="color: #a5b4fc;">Filtered by Context:</strong>
          ${pageSlug ? html`<span class="badge" style="background: rgba(99, 102, 241, 0.25); color: #c7d2fe; font-family: monospace; padding: 2px 8px; border-radius: 4px;">Page: ${pageSlug}</span>` : ''}
          ${sectionKey ? html`<span class="badge" style="background: rgba(99, 102, 241, 0.25); color: #c7d2fe; font-family: monospace; padding: 2px 8px; border-radius: 4px;">Section: ${sectionKey}</span>` : ''}
          <span style="color: var(--text-muted);">(${displayItems.length} of ${items.length} records)</span>
        </div>
        <a href="/admin/content/${collection}${siteQuery}" class="btn btn-secondary" style="padding: 4px 12px; font-size: 12px; white-space: nowrap;">✕ Clear Filter (Show All)</a>
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
            ${orderField ? html`
              <th x-show="isReorderMode" x-cloak style="width: 36px; text-align: center;"></th>
              <th onclick="sortTable('order')" class="sortable-th" style="width: 110px;" title="Sort by Order">
                Order <span class="sort-indicator">↕</span>
              </th>
            ` : ''}
            <th onclick="sortTable(1)" class="sortable-th" title="Sort by Title">Title <span class="sort-indicator">↕</span></th>
            <th onclick="sortTable(2)" class="sortable-th" title="Sort by Slug">Slug <span class="sort-indicator">↕</span></th>
            ${scopeFilterDef ? html`
              <th onclick="sortTable('scope')" class="sortable-th" title="Sort by ${scopeFilterDef.label}">${scopeFilterDef.label} <span class="sort-indicator">↕</span></th>
            ` : ''}
            <th onclick="sortTable(3)" class="sortable-th" title="Sort by Status">Status <span class="sort-indicator">↕</span></th>
            <th onclick="sortTable(4, 'date')" class="sortable-th" title="Sort by Date">Last Updated <span class="sort-indicator">↕</span></th>
            <th style="text-align: right;">Actions</th>
          </tr>
        </thead>
        <tbody id="itemsTableBody"${orderField ? html` x-sort="handleSort($item, $position)"` : ''}>
          ${displayItems.length === 0 ? html`
            <tr id="initialEmptyRow">
              <td colspan="${6 + (orderField ? 2 : 0) + (scopeFilterDef ? 1 : 0)}" class="empty-cell">No records matching context in this collection. Click "+ New" above to create one.</td>
            </tr>
          ` : displayItems.map((item, idx) => {
            let parsed: any = {};
            try {
              parsed = typeof item.data === 'string' ? JSON.parse(item.data) : (item.data || {});
            } catch {}
            const o = orderField ? parsed[orderField] : undefined;
            const initialOrder = (o !== undefined && o !== null && o !== '' && !isNaN(Number(o))) ? Number(o) : (idx + 1) * 10;
            const itemScopeValue = scopeFilterDef ? String(parsed[scopeFilterDef.key] ?? (item as any)[scopeFilterDef.key] ?? '') : '';

            return html`
            <tr
              class="item-row"
              id="row_${item.id}"
              data-id="${item.id}"
              data-order="${initialOrder}"
              data-title="${(item.title || '').toLowerCase()}"
              data-slug="${(item.slug || '').toLowerCase()}"
              data-scope="${itemScopeValue.toLowerCase()}"
              data-status="${(item.status || 'draft').toLowerCase()}"
              data-updated="${item.updated_at}"
              ${orderField ? html`x-sort:item="'${item.id}'" :class="{ 'row-dirty': isItemDirty('${item.id}') }"` : ''}
            >
              <td style="text-align: center;">
                <input type="checkbox" class="row-checkbox" value="${item.id}" data-title="${item.title || item.slug}" onchange="updateSelection()" />
              </td>
              ${orderField ? html`
                <td x-show="isReorderMode" x-cloak style="text-align: center; cursor: grab; padding: 4px 6px; vertical-align: middle;">
                  <span class="drag-handle" x-sort:handle title="Drag to reorder" style="font-size: 16px; color: var(--text-muted); cursor: grab; user-select: none;">⠿</span>
                </td>
                <td style="white-space: nowrap; vertical-align: middle;">
                  <span x-show="!isReorderMode" class="order-badge" x-text="getItemOrder('${item.id}')">${initialOrder}</span>
                  <div x-show="isReorderMode" x-cloak style="display: flex; align-items: center; gap: 4px;">
                    <input
                      type="number"
                      class="reorder-input"
                      :value="getItemOrder('${item.id}')"
                      @input="updateItemOrder('${item.id}', $event.target.value)"
                      style="width: 54px; padding: 3px 6px; font-size: 12px; font-family: monospace; background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: 4px;"
                    />
                    <div style="display: flex; flex-direction: column; gap: 1px;">
                      <button type="button" class="btn-step" @click="moveRow('${item.id}', -1)" title="Move up" style="padding: 1px 4px; font-size: 9px; line-height: 1; border: 1px solid var(--border-subtle); background: var(--bg-surface); color: var(--text-muted); cursor: pointer; border-radius: 2px;">▲</button>
                      <button type="button" class="btn-step" @click="moveRow('${item.id}', 1)" title="Move down" style="padding: 1px 4px; font-size: 9px; line-height: 1; border: 1px solid var(--border-subtle); background: var(--bg-surface); color: var(--text-muted); cursor: pointer; border-radius: 2px;">▼</button>
                    </div>
                  </div>
                </td>
              ` : ''}
              <td><strong><a href="/admin/content/${collection}/${item.id}${siteQuery}">${item.title || '(Untitled)'}</a></strong></td>
              <td><code style="font-size: 12px; color: #cbd5e1;">${item.slug || '—'}</code></td>
              ${scopeFilterDef ? html`
                <td>
                  ${itemScopeValue ? html`
                    <span class="badge" style="font-family: monospace; font-size: 11px; background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.25); padding: 2px 6px; border-radius: 4px;">
                      ${itemScopeValue}
                    </span>
                  ` : html`<span style="color: var(--text-muted); font-size: 11px;">—</span>`}
                </td>
              ` : ''}
              <td>
                <span class="status-pill status-${item.status}">${item.status}</span>
                ${item.draft_status && item.draft_status !== 'none' ? html`
                  <span class="status-pill" style="margin-left: 6px; background: #451a03; color: #fb923c; border: 1px solid #d97706; font-size: 10px; font-weight: 700; padding: 2px 6px;">
                    📝 Draft ${item.draft_status}
                  </span>
                ` : ''}
              </td>
              <td style="color: var(--text-muted); font-size: 13px;">
                ${item.updated_at ? new Date(typeof item.updated_at === 'number' && item.updated_at < 1e12 ? item.updated_at * 1000 : item.updated_at).toLocaleDateString() : '—'}
              </td>
              <td style="text-align: right; white-space: nowrap;">
                <a href="/admin/content/${collection}/${item.id}${siteQuery}" class="btn-link">Edit</a>
                <span class="action-divider">|</span>
                <button type="button" class="btn-text text-danger" onclick="deleteSingleRecord('${collection}', '${item.id}', '${item.title || item.slug}')">Delete</button>
              </td>
            </tr>
          `;
          })}
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
    </div>

    <script>
      let activeStatusFilter = 'all';
      let sortDirections = {};
      let highlightedRowIndex = -1;
      const currentCollection = ${raw(JSON.stringify(collection))};
      const currentActiveSite = ${raw(JSON.stringify(activeSite || ''))};
      window.currentActiveSite = currentActiveSite;

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
          window.location.href = '/admin/content/' + currentCollection + '/new' + (currentActiveSite ? '?site_id=' + encodeURIComponent(currentActiveSite) : '');
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
          const scope = row.dataset.scope || '';

          const matchesQuery = !query || title.includes(query) || slug.includes(query) || scope.includes(query);
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
          badge.innerText = (visibleCount === rows.length ? rows.length : (visibleCount + ' of ' + rows.length)) + ' records';
        }
      }
      window.applyItemFilters = applyItemFilters;

      function sortTable(colIndex, type = 'text') {
        const tbody = document.getElementById('itemsTableBody');
        const rows = Array.from(tbody.querySelectorAll('.item-row'));
        const asc = !sortDirections[colIndex];
        sortDirections[colIndex] = asc;

        rows.sort((a, b) => {
          let valA = '';
          let valB = '';

          if (colIndex === 'order') {
            const numA = Number(a.dataset.order) || 0;
            const numB = Number(b.dataset.order) || 0;
            return asc ? numA - numB : numB - numA;
          }
          if (colIndex === 'scope') {
            valA = a.dataset.scope || '';
            valB = b.dataset.scope || '';
            return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
          }
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

      function getTableAuthHeaders(extra) {
        return Object.assign({}, extra || {});
      }

      async function executeBulkStatus(col, targetStatus) {
        const checked = getSelectedCheckboxes();
        if (checked.length === 0) return;

        const ids = checked.map(c => c.value);
        const itemSiteQuery = window.currentActiveSite ? '?site_id=' + encodeURIComponent(window.currentActiveSite) : '';
        try {
          await Promise.all(
            ids.map(id =>
              fetch('/items/' + col + '/' + id + itemSiteQuery, {
                method: 'PATCH',
                headers: getTableAuthHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ status: targetStatus, site_id: window.currentActiveSite || undefined })
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

        const confirmed = confirm('Are you sure you want to PERMANENTLY delete ' + checked.length + ' document(s) from ' + col + '? This cannot be undone.');
        if (!confirmed) return;

        const ids = checked.map(c => c.value);
        const itemSiteQuery = window.currentActiveSite ? '?site_id=' + encodeURIComponent(window.currentActiveSite) : '';
        try {
          await Promise.all(
            ids.map(id =>
              fetch('/items/' + col + '/' + id + itemSiteQuery, { method: 'DELETE', headers: getTableAuthHeaders() })
            )
          );
          window.location.reload();
        } catch (e) {
          alert('Bulk delete failed: ' + e.message);
        }
      }

      async function deleteSingleRecord(col, id, title) {
        const confirmed = confirm('Are you sure you want to PERMANENTLY delete "' + title + '"? This cannot be undone.');
        if (!confirmed) return;

        const itemSiteQuery = window.currentActiveSite ? '?site_id=' + encodeURIComponent(window.currentActiveSite) : '';
        try {
          const res = await fetch('/items/' + col + '/' + id + itemSiteQuery, { method: 'DELETE', headers: getTableAuthHeaders() });
          if (res.ok || res.status === 204) {
            const row = document.getElementById('row_' + id);
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
  `, undefined, siteContext);
}
