import { html, raw } from 'hono/html';
import { renderLayout } from '../layout.js';
import { renderInfoBubble } from '../ui.js';

export function renderModelsView(
  modelsWithFields: any[],
  user: { email: string; authMethod?: string }
) {
  const clientScript = `
    let highlightedModelIndex = -1;

    function getVisibleModels() {
      const cards = Array.from(document.querySelectorAll('.model-accordion-item'));
      return cards.filter(c => c.style.display !== 'none');
    }

    function updateModelHighlight() {
      const visible = getVisibleModels();
      document.querySelectorAll('.model-accordion-item').forEach(c => c.classList.remove('keyboard-highlight'));

      if (highlightedModelIndex >= 0 && highlightedModelIndex < visible.length) {
        visible[highlightedModelIndex].classList.add('keyboard-highlight');
        visible[highlightedModelIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }

    window.addEventListener('keydown', (e) => {
      const search = document.getElementById('modelSearch');
      const isInputActive = document.activeElement === search || document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA';

      if (e.key === '/' && !isInputActive) {
        e.preventDefault();
        search?.focus();
        search?.select();
        return;
      }

      const visible = getVisibleModels();
      if (visible.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (highlightedModelIndex < visible.length - 1) {
          highlightedModelIndex++;
        } else {
          highlightedModelIndex = 0;
        }
        updateModelHighlight();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (highlightedModelIndex > 0) {
          highlightedModelIndex--;
        } else {
          highlightedModelIndex = visible.length - 1;
        }
        updateModelHighlight();
      } else if (e.key === 'Enter') {
        if (highlightedModelIndex >= 0 && highlightedModelIndex < visible.length) {
          e.preventDefault();
          const details = visible[highlightedModelIndex].querySelector('details');
          if (details) details.open = !details.open;
        }
      } else if (e.key === 'Escape') {
        highlightedModelIndex = -1;
        updateModelHighlight();
        if (document.activeElement === search) {
          search.blur();
        }
      }
    });

    document.getElementById('modelSearch')?.addEventListener('input', applyModelFilters);

    function applyModelFilters() {
      const query = (document.getElementById('modelSearch')?.value || '').trim().toLowerCase();
      const items = Array.from(document.querySelectorAll('.model-accordion-item'));
      let visibleCount = 0;

      items.forEach(item => {
        const name = item.dataset.name || '';
        const display = item.dataset.display || '';
        const desc = item.dataset.desc || '';
        const pack = item.dataset.pack || '';
        const fields = item.dataset.fields || '';

        const matchesQuery = !query || name.includes(query) || display.includes(query) || desc.includes(query) || pack.includes(query) || fields.includes(query);

        if (matchesQuery) {
          item.style.display = '';
          visibleCount++;
          // If searching, automatically expand matching items
          if (query) {
            const details = item.querySelector('details');
            if (details) details.open = true;
          }
        } else {
          item.style.display = 'none';
        }
      });

      const countBadge = document.getElementById('modelMatchCountBadge');
      if (countBadge) countBadge.innerText = visibleCount + ' Models';

      const noState = document.getElementById('noModelsState');
      if (noState) {
        noState.style.display = visibleCount === 0 && items.length > 0 ? 'block' : 'none';
      }

      if (visibleCount === 1) {
        highlightedModelIndex = 0;
      } else {
        highlightedModelIndex = -1;
      }
      updateModelHighlight();
    }

    function toggleAllAccordions(open) {
      document.querySelectorAll('.model-accordion-item details').forEach(function(d) {
        d.open = open;
      });
    }

    // Auto-open and scroll when navigating to an anchor hash (e.g. #model-gallery or #gallery)
    function handleAnchorHash() {
      if (window.location.hash) {
        const rawHash = window.location.hash.slice(1);
        const targetId = rawHash.startsWith('model-') ? rawHash : ('model-' + rawHash);
        const targetEl = document.getElementById(targetId) || document.getElementById(rawHash);
        if (targetEl) {
          const details = targetEl.querySelector('details');
          if (details) details.open = true;
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }

    window.addEventListener('hashchange', handleAnchorHash);
    setTimeout(handleAnchorHash, 100);
  `;

  return renderLayout('Model Registry — SlottD Studio', 'models', user, html`
    <div class="header">
      <div>
        <h1 style="display: flex; align-items: center;">
          Content Models & Schema Registry
          ${renderInfoBubble('Schema registry for registered model packs and dynamic SQLite views in D1.', 'models-archetypes')}
        </h1>
        <p class="subtitle">Read-only schema registry of active model packs, field contracts, and SQLite dynamic views.</p>
      </div>
      <div class="header-stats">
        <span class="stat-pill" id="modelMatchCountBadge">${modelsWithFields.length} Models</span>
      </div>
    </div>

    <!-- Toolbar: Search & Accordion Controls -->
    <div class="toolbar card">
      <div class="toolbar-search">
        <span class="search-icon">🔍</span>
        <input
          type="search"
          id="modelSearch"
          class="input-search"
          placeholder="Filter models or field names... (Press / to focus, ↑/↓ to navigate, Enter to toggle)"
          autocomplete="off"
        />
      </div>

      <div class="toolbar-actions">
        <div class="toolbar-right-controls" style="margin-left: auto;">
          <button type="button" class="btn btn-secondary" onclick="toggleAllAccordions(true)" style="font-size: 12px; padding: 6px 12px;">
            Expand All
          </button>
          <button type="button" class="btn btn-secondary" onclick="toggleAllAccordions(false)" style="font-size: 12px; padding: 6px 12px;">
            Collapse All
          </button>
        </div>
      </div>
    </div>

    <div class="models-list" id="modelsContainer">
      ${modelsWithFields.length === 0 ? html`
        <div class="card empty-state"><p>No collection models found.</p></div>
      ` : modelsWithFields.map((model) => {
        const fieldNames = model.fields.map((f: any) => `${f.name} ${f.type} ${f.widget || ''}`).join(' ').toLowerCase();

        return html`
          <div
            class="card model-card model-accordion-item"
            id="model-${model.name}"
            data-name="${(model.name || '').toLowerCase()}"
            data-display="${(model.display_name || '').toLowerCase()}"
            data-desc="${(model.description || '').toLowerCase()}"
            data-pack="${(model.pack_name || '').toLowerCase()}"
            data-fields="${fieldNames}"
            style="padding: 0; overflow: hidden; margin-bottom: 16px;"
          >
            <!-- Initially closed by default as requested -->
            <details class="model-accordion">
              <summary class="model-accordion-summary">
                <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0;">
                  <span class="col-icon" style="font-size: 20px;">${model.icon || '⚙️'}</span>
                  <div style="min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                      <h2 style="margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary);">${model.display_name || model.name}</h2>
                      <code style="font-size: 12px; color: var(--text-muted); background: rgba(255,255,255,0.04); padding: 2px 6px; border-radius: 4px;">${model.name}</code>
                    </div>
                    ${model.description ? html`<p class="model-desc" style="margin: 2px 0 0; font-size: 12px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${model.description}</p>` : ''}
                  </div>
                </div>

                <div class="model-badges" style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                  <span class="badge" style="background: rgba(99, 102, 241, 0.15); color: #818cf8; border-color: rgba(99, 102, 241, 0.3);">${model.pack_name}</span>
                  <span class="badge" style="background: rgba(255,255,255,0.06); color: var(--text-muted);">${model.fields.length} Fields</span>
                  <span class="badge" style="background: rgba(255,255,255,0.06); color: var(--text-muted);">v${model.schema_version}</span>
                  <span class="accordion-caret">▼</span>
                </div>
              </summary>

              <div class="model-accordion-body">
                <table class="table field-table" style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
                  <thead>
                    <tr>
                      <th style="padding: 10px 16px; background: rgba(0,0,0,0.2); color: var(--text-muted); font-size: 11px; text-transform: uppercase;">Field Name</th>
                      <th style="padding: 10px 16px; background: rgba(0,0,0,0.2); color: var(--text-muted); font-size: 11px; text-transform: uppercase;">Type</th>
                      <th style="padding: 10px 16px; background: rgba(0,0,0,0.2); color: var(--text-muted); font-size: 11px; text-transform: uppercase;">Widget</th>
                      <th style="padding: 10px 16px; background: rgba(0,0,0,0.2); color: var(--text-muted); font-size: 11px; text-transform: uppercase;">Required</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${model.fields.map((f: any) => html`
                      <tr style="border-top: 1px solid var(--border-color, rgba(255,255,255,0.06));">
                        <td style="padding: 10px 16px;"><code>${f.name}</code></td>
                        <td style="padding: 10px 16px;"><span class="type-pill">${f.type}</span></td>
                        <td style="padding: 10px 16px;"><code>${f.widget || 'text'}</code></td>
                        <td style="padding: 10px 16px; font-size: 12px; color: ${f.required ? '#10b981' : 'var(--text-muted)'};">${f.required ? '✓ Required' : 'Optional'}</td>
                      </tr>
                    `)}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        `;
      })}
    </div>

    <!-- Empty Search State -->
    <div id="noModelsState" class="card empty-state" style="display: none;">
      <p class="empty-icon">🔍</p>
      <h3>No matching content models found</h3>
      <p class="empty-subtitle">Try searching with a different collection name or field.</p>
    </div>

    <style>
      .model-accordion-summary {
        list-style: none;
        padding: 16px 20px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: var(--bg-card, #1e1e24);
        user-select: none;
        transition: background 0.15s;
      }
      .model-accordion-summary::-webkit-details-marker {
        display: none;
      }
      .model-accordion-summary:hover {
        background: rgba(255,255,255,0.03);
      }
      .model-accordion-item.keyboard-highlight {
        outline: 2px solid #6366f1;
      }
      .accordion-caret {
        font-size: 10px;
        color: var(--text-muted);
        transition: transform 0.2s ease;
      }
      details[open] .accordion-caret {
        transform: rotate(180deg);
      }
      .model-accordion-body {
        border-top: 1px solid var(--border-color, rgba(255,255,255,0.08));
        background: rgba(0,0,0,0.15);
      }
    </style>

    <script>
      ${raw(clientScript)}
    </script>
  `);
}
