import { html, raw } from 'hono/html';
import { renderLayout } from '../layout.js';

export function renderMediaView(
  mediaFiles: any[],
  user: { email: string; authMethod?: string }
) {
  const clientScript = `
    let activeTypeFilter = 'all';
    let highlightedMediaIndex = -1;

    function getVisibleMedia() {
      const container = document.getElementById('mediaContainer');
      return Array.from(container.querySelectorAll('.media-card-wrapper')).filter(c => c.style.display !== 'none');
    }

    function updateMediaHighlight() {
      const visible = getVisibleMedia();
      document.querySelectorAll('.media-card-wrapper').forEach(c => c.classList.remove('keyboard-highlight'));

      if (highlightedMediaIndex >= 0 && highlightedMediaIndex < visible.length) {
        visible[highlightedMediaIndex].classList.add('keyboard-highlight');
        visible[highlightedMediaIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }

    // Keyboard Controls (/, ArrowDown, ArrowUp, ArrowRight, ArrowLeft, Enter, Escape, u, Delete)
    window.addEventListener('keydown', (e) => {
      const search = document.getElementById('mediaSearch');
      const isInputActive = document.activeElement === search || document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA';

      if (e.key === '/' && !isInputActive) {
        e.preventDefault();
        search?.focus();
        search?.select();
        return;
      }

      if (e.key === 'u' && !isInputActive) {
        e.preventDefault();
        document.getElementById('mediaUploadInput')?.click();
        return;
      }

      const visible = getVisibleMedia();
      if (visible.length === 0) return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (highlightedMediaIndex < visible.length - 1) {
          highlightedMediaIndex++;
        } else {
          highlightedMediaIndex = 0;
        }
        updateMediaHighlight();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (highlightedMediaIndex > 0) {
          highlightedMediaIndex--;
        } else {
          highlightedMediaIndex = visible.length - 1;
        }
        updateMediaHighlight();
      } else if (e.key === 'Enter') {
        if (highlightedMediaIndex >= 0 && highlightedMediaIndex < visible.length) {
          e.preventDefault();
          const downloadLink = visible[highlightedMediaIndex].querySelector('a[download]');
          if (downloadLink) downloadLink.click();
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!isInputActive && highlightedMediaIndex >= 0 && highlightedMediaIndex < visible.length) {
          e.preventDefault();
          const deleteBtn = visible[highlightedMediaIndex].querySelector('.btn-delete-icon');
          if (deleteBtn) deleteBtn.click();
        }
      } else if (e.key === 'Escape') {
        highlightedMediaIndex = -1;
        updateMediaHighlight();
        if (document.activeElement === search) {
          search.blur();
        }
      }
    });

    document.getElementById('mediaSearch')?.addEventListener('input', applyMediaFilters);

    function filterByType(type, btn) {
      activeTypeFilter = type;
      document.querySelectorAll('#mediaTypeFilterPills .pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyMediaFilters();
    }

    function setMediaViewMode(mode) {
      const container = document.getElementById('mediaContainer');
      const btnGrid = document.getElementById('btnMediaGrid');
      const btnRows = document.getElementById('btnMediaRows');

      if (mode === 'rows') {
        container?.classList.add('view-rows');
        container?.classList.remove('view-grid');
        btnRows?.classList.add('active');
        btnGrid?.classList.remove('active');
      } else {
        container?.classList.add('view-grid');
        container?.classList.remove('view-rows');
        btnGrid?.classList.add('active');
        btnRows?.classList.remove('active');
      }

      try {
        localStorage.setItem('slottd_media_view', mode);
      } catch {}
    }

    try {
      const savedView = localStorage.getItem('slottd_media_view');
      if (savedView) setMediaViewMode(savedView);
    } catch {}

    function applyMediaFilters() {
      const query = (document.getElementById('mediaSearch')?.value || '').trim().toLowerCase();
      const sortMode = document.getElementById('mediaSortSelect')?.value || 'name-asc';
      const container = document.getElementById('mediaContainer');
      const cards = Array.from(container.querySelectorAll('.media-card-wrapper'));
      let visibleCount = 0;

      cards.forEach(card => {
        const key = card.dataset.key || '';
        const filename = card.dataset.filename || '';
        const type = card.dataset.type || '';

        const matchesQuery = !query || key.includes(query) || filename.includes(query);
        const matchesType = activeTypeFilter === 'all' || type === activeTypeFilter;

        if (matchesQuery && matchesType) {
          card.style.display = '';
          visibleCount++;
        } else {
          card.style.display = 'none';
        }
      });

      cards.sort((a, b) => {
        if (sortMode === 'name-asc') {
          return (a.dataset.filename || '').localeCompare(b.dataset.filename || '');
        } else if (sortMode === 'name-desc') {
          return (b.dataset.filename || '').localeCompare(a.dataset.filename || '');
        } else if (sortMode === 'date-desc') {
          return (Number(b.dataset.date) || 0) - (Number(a.dataset.date) || 0);
        } else if (sortMode === 'date-asc') {
          return (Number(a.dataset.date) || 0) - (Number(b.dataset.date) || 0);
        } else if (sortMode === 'size-desc') {
          return (Number(b.dataset.size) || 0) - (Number(a.dataset.size) || 0);
        } else if (sortMode === 'size-asc') {
          return (Number(a.dataset.size) || 0) - (Number(b.dataset.size) || 0);
        }
        return 0;
      });

      cards.forEach(card => container.appendChild(card));

      const noState = document.getElementById('noMediaState');
      if (noState) {
        noState.style.display = visibleCount === 0 && cards.length > 0 ? 'block' : 'none';
      }

      if (visibleCount === 1) {
        highlightedMediaIndex = 0;
      } else {
        highlightedMediaIndex = -1;
      }
      updateMediaHighlight();
    }

    function copyRelativeUrl(key, btn) {
      const url = '/media/' + key;
      navigator.clipboard.writeText(url);
      const originalText = btn.innerText;
      btn.innerText = 'Copied!';
      setTimeout(() => btn.innerText = originalText, 1500);
    }

    function copyAbsoluteUrl(key, btn) {
      const url = window.location.origin + '/media/' + key;
      navigator.clipboard.writeText(url);
      const originalText = btn.innerText;
      btn.innerText = 'Copied CDN!';
      setTimeout(() => btn.innerText = originalText, 1500);
    }

    async function deleteMediaAsset(idOrKey, filename) {
      const confirmed = confirm('Are you sure you want to permanently delete ' + filename + ' from R2 storage?');
      if (!confirmed) return;

      try {
        const res = await fetch('/files/' + encodeURIComponent(idOrKey), { method: 'DELETE' });
        if (res.ok || res.status === 204) {
          window.location.reload();
        } else {
          alert('Failed to delete asset: ' + (await res.text()));
        }
      } catch (e) {
        alert('Delete error: ' + e.message);
      }
    }

    async function uploadStandaloneAsset(input) {
      if (!input.files || input.files.length === 0) return;
      const file = input.files[0];
      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch('/files', { method: 'POST', body: formData });
        if (res.ok) {
          window.location.reload();
        } else {
          alert('Upload failed: ' + (await res.text()));
        }
      } catch (e) {
        alert('Upload error: ' + e.message);
      }
    }
  `;

  return renderLayout('Media Library — SlottD Studio', 'media', user, html`
    <div class="header">
      <div>
        <h1>Media & Assets (Cloudflare R2)</h1>
        <p class="subtitle">Descriptive keys, edge-cached delivery, and bi-directional D1 indexing.</p>
      </div>
      <div class="header-actions">
        <label class="btn btn-primary" style="cursor: pointer;">
          + Upload Asset (u)
          <input type="file" id="mediaUploadInput" style="display: none;" onchange="uploadStandaloneAsset(this)" />
        </label>
      </div>
    </div>

    <!-- Toolbar: Search, Filters, Sort & View Mode -->
    <div class="toolbar card">
      <div class="toolbar-search">
        <span class="search-icon">🔍</span>
        <input
          type="search"
          id="mediaSearch"
          class="input-search"
          placeholder="Filter media assets... (Press / to focus, ↑/↓/←/→ to select, Enter to open)"
          autocomplete="off"
        />
      </div>

      <div class="toolbar-actions">
        <!-- Type Filter Pills -->
        <div class="filter-pills" id="mediaTypeFilterPills">
          <button type="button" class="pill-btn active" data-type="all" onclick="filterByType('all', this)">
            All <span class="pill-count">${mediaFiles.length}</span>
          </button>
          <button type="button" class="pill-btn" data-type="image" onclick="filterByType('image', this)">
            Images <span class="pill-count">${mediaFiles.filter(m => (m.mime_type || '').startsWith('image/')).length}</span>
          </button>
          <button type="button" class="pill-btn" data-type="other" onclick="filterByType('other', this)">
            Other <span class="pill-count">${mediaFiles.filter(m => !(m.mime_type || '').startsWith('image/')).length}</span>
          </button>
        </div>

        <div class="toolbar-right-controls">
          <!-- Sort Dropdown -->
          <div class="custom-select-wrap">
            <select id="mediaSortSelect" class="select-control" onchange="applyMediaFilters()">
              <option value="name-asc">Sort: Name (A-Z)</option>
              <option value="name-desc">Sort: Name (Z-A)</option>
              <option value="date-desc">Sort: Newest First</option>
              <option value="date-asc">Sort: Oldest First</option>
              <option value="size-desc">Sort: Largest Size</option>
              <option value="size-asc">Sort: Smallest Size</option>
            </select>
          </div>

          <!-- Grid/List View Mode Toggle -->
          <div class="view-toggle-group">
            <button type="button" id="btnMediaGrid" class="toggle-btn active" onclick="setMediaViewMode('grid')" title="Grid View">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
              </svg>
            </button>
            <button type="button" id="btnMediaRows" class="toggle-btn" onclick="setMediaViewMode('rows')" title="List / Card Rows View">
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

    <!-- Media Grid / Card Rows Container -->
    <div class="media-container view-grid" id="mediaContainer">
      ${mediaFiles.length === 0 ? html`
        <div class="card empty-state" style="grid-column: 1 / -1;">
          <p class="empty-icon">🖼️</p>
          <h3>No media files in R2 storage</h3>
          <p class="empty-subtitle">Upload assets to serve them with edge caching.</p>
        </div>
      ` : mediaFiles.map((m) => {
        const isImage = (m.mime_type || '').startsWith('image/');
        const sizeKb = Math.round((m.size || 0) / 1024);
        const dateStr = m.created_at ? new Date(m.created_at).toLocaleDateString() : '';

        return html`
          <div
            class="media-card-wrapper"
            id="media_${m.id || m.key}"
            data-id="${m.id}"
            data-key="${(m.key || '').toLowerCase()}"
            data-filename="${(m.filename || '').toLowerCase()}"
            data-type="${isImage ? 'image' : 'other'}"
            data-size="${m.size || 0}"
            data-date="${m.created_at || 0}"
          >
            <div class="media-card">
              <div class="media-thumb-container">
                ${isImage ? html`
                  <img src="/media/${m.key}" alt="${m.filename}" loading="lazy" onerror="this.src='/admin/placeholder.svg'" />
                ` : html`
                  <div class="media-file-icon">📄</div>
                `}
              </div>
              <div class="media-card-info">
                <strong class="media-filename" title="${m.filename}">${m.filename}</strong>
                <p class="media-key"><code>/media/${m.key}</code></p>
                <div class="media-meta-row">
                  <span class="file-size">${sizeKb} KB</span>
                  <span class="file-type">${m.mime_type || 'binary'}</span>
                  ${dateStr ? html`<span class="file-date">${dateStr}</span>` : ''}
                </div>
                <div class="media-card-actions">
                  <button type="button" class="btn-copy" onclick="copyRelativeUrl('${m.key}', this)" title="Copy relative URL (/media/...)">Copy Relative</button>
                  <button type="button" class="btn-copy" onclick="copyAbsoluteUrl('${m.key}', this)" title="Copy full origin URL">Copy CDN</button>
                  <a href="/media/${m.key}" download="${m.filename}" class="btn-action-icon" title="Download asset">⬇️</a>
                  <button type="button" class="btn-action-icon btn-delete-icon" onclick="deleteMediaAsset('${m.id || m.key}', '${m.filename}')" title="Delete asset">🗑️</button>
                </div>
              </div>
            </div>
          </div>
        `;
      })}
    </div>

    <!-- Empty Search State -->
    <div id="noMediaState" class="card empty-state" style="display: none;">
      <p class="empty-icon">🔍</p>
      <h3>No matching media found</h3>
      <p class="empty-subtitle">Try adjusting your search query or type filter.</p>
    </div>

    <style>
      .media-container.view-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 16px;
      }
      .media-container.view-rows {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .media-container.view-rows .media-card {
        flex-direction: row;
        align-items: center;
        padding: 12px 16px;
        gap: 16px;
      }
      .media-container.view-rows .media-thumb-container {
        width: 64px;
        height: 64px;
        flex-shrink: 0;
      }
      .media-container.view-rows .media-card-info {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
      }
      .media-container.view-rows .media-card-actions {
        margin-top: 0;
      }
      .media-card {
        background: var(--bg-card, #1e1e24);
        border: 1px solid var(--border-color, rgba(255,255,255,0.08));
        border-radius: 8px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        transition: all 0.2s;
      }
      .media-card-wrapper.keyboard-highlight .media-card {
        border-color: #6366f1;
        box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.4);
      }
      .media-thumb-container {
        width: 100%;
        height: 140px;
        background: rgba(0,0,0,0.2);
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }
      .media-thumb-container img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .media-file-icon {
        font-size: 36px;
      }
      .media-card-info {
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .media-filename {
        font-size: 13px;
        color: var(--text-primary, #fff);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .media-key code {
        font-size: 11px;
        color: var(--text-muted, #94a3b8);
      }
      .media-meta-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        color: var(--text-muted, #94a3b8);
      }
      .media-card-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 6px;
        flex-wrap: wrap;
      }
      .btn-copy {
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.1);
        color: var(--text-primary, #fff);
        font-size: 11px;
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.15s;
      }
      .btn-copy:hover {
        background: rgba(99, 102, 241, 0.2);
        border-color: #6366f1;
      }
      .btn-action-icon {
        padding: 4px 6px;
        font-size: 13px;
        border-radius: 4px;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.1);
        cursor: pointer;
        text-decoration: none;
        color: inherit;
        display: inline-flex;
        align-items: center;
      }
      .btn-action-icon:hover {
        background: rgba(255,255,255,0.15);
      }
      .btn-delete-icon:hover {
        background: rgba(239, 68, 68, 0.2);
        border-color: #ef4444;
      }
    </style>

    <script>
      ${raw(clientScript)}
    </script>
  `);
}
