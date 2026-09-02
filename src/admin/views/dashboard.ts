import { html } from 'hono/html';
import { renderLayout } from '../layout.js';

export interface DashboardCollectionItem {
  name: string;
  display_name?: string;
  description?: string | null;
  icon?: string | null;
  pack_name?: string;
  pack_author?: string | null;
  count?: number;
}

export function renderDashboardView(
  collectionsList: DashboardCollectionItem[],
  packs: string[],
  user: { email: string; authMethod?: string },
  recentActivity: any[] = []
) {
  return renderLayout('SlottD Studio', 'content', user, html`
    <div class="header">
      <div>
        <h1>Content Collections</h1>
        <p class="subtitle">Select a collection to manage documents, inspect drafts, or release content.</p>
      </div>
      <div class="header-stats">
        <span class="stat-pill" id="totalCollectionsBadge">${collectionsList.length} Collections</span>
      </div>
    </div>

    <!-- Filter, Sort & View Layout Toolbar -->
    <div class="toolbar card">
      <div class="toolbar-search">
        <span class="search-icon">🔍</span>
        <input
          type="search"
          id="colSearch"
          class="input-search"
          placeholder="Filter collections... (Press / to focus, ↑/↓ to select, Enter to open)"
          autocomplete="off"
        />
      </div>

      <div class="toolbar-actions">
        <!-- Pack Filter Pills -->
        <div class="filter-pills" id="packFilterPills">
          <button type="button" class="pill-btn active" data-pack="all" onclick="filterByPack('all', this)">
            All <span class="pill-count">${collectionsList.length}</span>
          </button>
          ${packs.map((p) => {
            const count = collectionsList.filter((c) => (c.pack_name || 'custom') === p).length;
            return html`
              <button type="button" class="pill-btn" data-pack="${p}" onclick="filterByPack('${p}', this)">
                ${p} <span class="pill-count">${count}</span>
              </button>
            `;
          })}
        </div>

        <div class="toolbar-right-controls">
          <!-- Sort Dropdown -->
          <div class="custom-select-wrap">
            <select id="colSortSelect" class="select-control" onchange="applySortAndFilter()">
              <option value="name-asc">Sort: Name (A-Z)</option>
              <option value="name-desc">Sort: Name (Z-A)</option>
              <option value="count-desc">Sort: Most Records</option>
              <option value="count-asc">Sort: Least Records</option>
            </select>
          </div>

          <!-- Grid/List View Mode Toggle -->
          <div class="view-toggle-group">
            <button type="button" id="btnGridView" class="toggle-btn active" onclick="setViewMode('grid')" title="Grid View">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
              </svg>
            </button>
            <button type="button" id="btnListView" class="toggle-btn" onclick="setViewMode('list')" title="List View">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="3" y="4" width="18" height="3" rx="1" />
                <rect x="3" y="10.5" width="18" height="3" rx="1" />
                <rect x="3" y="17" width="18" height="3" rx="1" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Collections Grid / List Container -->
    <div class="collection-grid view-grid" id="collectionGrid">
      ${collectionsList.map((col) => {
        const displayName = col.display_name || col.name;
        const pack = col.pack_name || 'custom';
        const desc = col.description || '';

        return html`
          <div
            class="collection-card-wrapper"
            data-name="${col.name.toLowerCase()}"
            data-display="${displayName.toLowerCase()}"
            data-desc="${desc.toLowerCase()}"
            data-pack="${pack.toLowerCase()}"
            data-count="${col.count ?? 0}"
          >
            <a href="/admin/content/${col.name}" class="collection-card">
              <div class="col-card-header">
                <div class="col-icon-box">${col.icon || '📁'}</div>
              </div>
              <div class="col-info">
                <div class="col-title-group">
                  <strong class="col-title">${displayName}</strong>
                  <code class="col-key">${col.name}</code>
                </div>
                ${desc ? html`<span class="col-desc" title="${desc}">${desc}</span>` : ''}
              </div>
              <div class="col-badges">
                <span class="pack-badge pack-${pack.replace(/[^a-z0-9]/gi, '-')}">${pack}</span>
                <span class="count-pill">${col.count ?? 0} records</span>
              </div>
            </a>
            <div class="col-card-footer">
              <a href="/admin/content/${col.name}" class="btn-card-action">View ${col.count ?? 0} ${col.count === 1 ? 'Record' : 'Records'}</a>
              <a href="/admin/content/${col.name}/+" class="btn-card-action btn-card-primary" title="Create new ${displayName}">+ New</a>
            </div>
          </div>
        `;
      })}
    </div>

    <!-- Empty Filter State -->
    <div id="noResultsState" class="card empty-state" style="display: none;">
      <p class="empty-icon">🔍</p>
      <h3>No matching collections found</h3>
      <p class="empty-subtitle">Try adjusting your search query or pack filter.</p>
      <button type="button" class="btn btn-secondary" onclick="clearFilters()">Reset Filters</button>
    </div>

    <script>
      let activePackFilter = 'all';
      let highlightedIndex = -1;

      function getVisibleCards() {
        const grid = document.getElementById('collectionGrid');
        return Array.from(grid.querySelectorAll('.collection-card-wrapper')).filter(c => c.style.display !== 'none');
      }

      function updateHighlight() {
        const visible = getVisibleCards();
        document.querySelectorAll('.collection-card-wrapper').forEach(c => c.classList.remove('keyboard-highlight'));

        if (highlightedIndex >= 0 && highlightedIndex < visible.length) {
          visible[highlightedIndex].classList.add('keyboard-highlight');
          visible[highlightedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }

      // Keyboard navigation handler (/, ArrowDown, ArrowUp, Enter, Escape)
      window.addEventListener('keydown', (e) => {
        const search = document.getElementById('colSearch');
        const isInputActive = document.activeElement === search;

        // Press '/' to focus search
        if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
          e.preventDefault();
          search?.focus();
          search?.select();
          return;
        }

        // Press 'n' or 'c' to open New Collection modal
        if ((e.key === 'n' || e.key === 'c') && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
          e.preventDefault();
          openCreateModal();
          return;
        }

        const visible = getVisibleCards();
        if (visible.length === 0) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (highlightedIndex < visible.length - 1) {
            highlightedIndex++;
          } else {
            highlightedIndex = 0; // Wrap around
          }
          updateHighlight();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (highlightedIndex > 0) {
            highlightedIndex--;
          } else {
            highlightedIndex = visible.length - 1; // Wrap around
          }
          updateHighlight();
        } else if (e.key === 'Enter') {
          if (highlightedIndex >= 0 && highlightedIndex < visible.length) {
            e.preventDefault();
            const link = visible[highlightedIndex].querySelector('.collection-card');
            if (link) window.location.href = link.href;
          } else if (visible.length === 1) {
            e.preventDefault();
            const link = visible[0].querySelector('.collection-card');
            if (link) window.location.href = link.href;
          }
        } else if (e.key === 'Escape') {
          highlightedIndex = -1;
          updateHighlight();
          if (isInputActive) {
            search.blur();
          }
        }
      });

      document.getElementById('colSearch').addEventListener('input', applySortAndFilter);

      function filterByPack(pack, btn) {
        activePackFilter = pack;
        document.querySelectorAll('#packFilterPills .pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applySortAndFilter();
      }

      function clearFilters() {
        const search = document.getElementById('colSearch');
        if (search) search.value = '';
        activePackFilter = 'all';
        document.querySelectorAll('#packFilterPills .pill-btn').forEach(b => {
          if (b.dataset.pack === 'all') b.classList.add('active');
          else b.classList.remove('active');
        });
        const sort = document.getElementById('colSortSelect');
        if (sort) sort.value = 'name-asc';
        applySortAndFilter();
      }

      function setViewMode(mode) {
        const grid = document.getElementById('collectionGrid');
        const btnGrid = document.getElementById('btnGridView');
        const btnRows = document.getElementById('btnRowsView');

        if (mode === 'rows') {
          grid?.classList.add('view-rows');
          btnRows?.classList.add('active');
          btnGrid?.classList.remove('active');
        } else {
          grid?.classList.remove('view-rows');
          btnGrid?.classList.add('active');
          btnRows?.classList.remove('active');
        }

        try {
          localStorage.setItem('slottd_collection_view', mode);
        } catch {}
      }

      // Restore saved layout mode
      try {
        const savedView = localStorage.getItem('slottd_collection_view');
        if (savedView) {
          setViewMode(savedView);
        }
      } catch {}

      function applySortAndFilter() {
        const query = (document.getElementById('colSearch')?.value || '').trim().toLowerCase();
        const sortMode = document.getElementById('colSortSelect')?.value || 'name-asc';
        const grid = document.getElementById('collectionGrid');
        const cards = Array.from(grid.querySelectorAll('.collection-card-wrapper'));
        let visibleCount = 0;

        // 1. Filter
        cards.forEach(card => {
          const name = card.dataset.name || '';
          const display = card.dataset.display || '';
          const desc = card.dataset.desc || '';
          const pack = card.dataset.pack || '';

          const matchesQuery = !query || name.includes(query) || display.includes(query) || desc.includes(query) || pack.includes(query);
          const matchesPack = activePackFilter === 'all' || pack === activePackFilter.toLowerCase();

          if (matchesQuery && matchesPack) {
            card.style.display = 'flex';
            visibleCount++;
          } else {
            card.style.display = 'none';
          }
        });

        // 2. Sort visible elements
        cards.sort((a, b) => {
          if (sortMode === 'name-asc') {
            return (a.dataset.display || '').localeCompare(b.dataset.display || '');
          } else if (sortMode === 'name-desc') {
            return (b.dataset.display || '').localeCompare(a.dataset.display || '');
          } else if (sortMode === 'count-desc') {
            return (Number(b.dataset.count) || 0) - (Number(a.dataset.count) || 0);
          } else if (sortMode === 'count-asc') {
            return (Number(a.dataset.count) || 0) - (Number(b.dataset.count) || 0);
          } else if (sortMode === 'pack') {
            const packCompare = (a.dataset.pack || '').localeCompare(b.dataset.pack || '');
            if (packCompare !== 0) return packCompare;
            return (a.dataset.display || '').localeCompare(b.dataset.display || '');
          }
          return 0;
        });

        cards.forEach(card => grid.appendChild(card));

        // 3. Auto-highlight if exactly 1 result is visible
        if (visibleCount === 1) {
          highlightedIndex = 0;
        } else {
          highlightedIndex = -1;
        }
        updateHighlight();

        // 4. Handle Empty State
        const emptyState = document.getElementById('noResultsState');
        if (visibleCount === 0) {
          emptyState.style.display = 'block';
          grid.style.display = 'none';
        } else {
          emptyState.style.display = 'none';
          grid.style.display = 'flex';
        }

        const badge = document.getElementById('totalCollectionsBadge');
        if (badge) {
          badge.innerText = visibleCount === cards.length ? \`\${cards.length} Collections\` : \`\${visibleCount} of \${cards.length} Collections\`;
        }
      }
    </script>
  `);
}
