import { html } from 'hono/html';
import { renderLayout } from '../layout.js';
import { renderFieldWidget } from '../widgets/fields.js';
import { renderMediaModal } from '../widgets/media-picker.js';

export function renderEditorView(
  collection: string,
  doc: any,
  fields: any[],
  isNew: boolean,
  user: { email: string; authMethod?: string }
) {
  let customData: Record<string, any> = {};
  try {
    customData = typeof doc.data === 'string' ? JSON.parse(doc.data) : (doc.data || {});
  } catch {}

  return renderLayout(isNew ? `New ${collection}` : `Edit: ${doc.title || doc.slug || collection}`, 'content', user, html`
    <div class="header">
      <div class="breadcrumbs">
        <a href="/admin">Collections</a>
        <span>/</span>
        <a href="/admin/content/${collection}">${collection}</a>
        <span>/</span>
        <span class="current">${isNew ? 'New Record' : doc.title || doc.slug}</span>
      </div>
      <div class="actions">
        <a href="/admin/content/${collection}" class="btn btn-secondary">Cancel</a>
        <button id="saveBtn" class="btn btn-primary">Save & Publish</button>
      </div>
    </div>

    <form id="editorForm" class="editor-grid">
      <div class="main-column card">
        <div class="form-group">
          <label for="title">Title *</label>
          <input type="text" id="title" name="title" value="${doc.title || ''}" class="input-text" required placeholder="Document Title..." />
        </div>

        <div class="form-group">
          <label for="slug">Slug *</label>
          <input type="text" id="slug" name="slug" value="${doc.slug || ''}" class="input-text" required placeholder="url-friendly-slug" />
        </div>

        <!-- Dynamic / Schema-Driven Custom Fields -->
        ${fields
          .filter((f) => !['id', 'collection', 'slug', 'title', 'status', 'created_at', 'updated_at'].includes(f.name))
          .map((f) => renderFieldWidget(f, customData[f.name]))}
      </div>

      <div class="sidebar-column">
        <div class="card">
          <h3>Publishing & Status</h3>
          <div class="form-group" style="margin-top: 12px;">
            <label for="status">Document Status</label>
            <select id="status" name="status" class="input-select">
              <option value="draft" ${doc.status === 'draft' ? 'selected' : ''}>Draft</option>
              <option value="published" ${doc.status === 'published' ? 'selected' : ''}>Published</option>
              <option value="archived" ${doc.status === 'archived' ? 'selected' : ''}>Archived</option>
            </select>
          </div>

          <hr class="divider" />
          <div class="meta-info">
            <p><strong>Collection:</strong> <code>${collection}</code></p>
            <p><strong>Document ID:</strong> <code>${doc.id}</code></p>
            ${doc.updated_at ? html`<p><strong>Last Updated:</strong> ${new Date(doc.updated_at).toLocaleString()}</p>` : ''}
          </div>
        </div>

        ${!isNew ? html`
          <div class="card danger-card" style="margin-top: 16px;">
            <h3 style="color: var(--danger);">Danger Zone</h3>
            <p style="font-size: 12px; color: var(--text-muted); margin-top: 6px; line-height: 1.4;">
              Permanently delete this document from the D1 database.
            </p>
            <button type="button" class="btn btn-danger-outline" style="width: 100%; margin-top: 12px;" onclick="deleteCurrentDocument()">
              🗑️ Delete Document
            </button>
          </div>
        ` : ''}

        <div class="card" style="margin-top: 16px;">
          <h3>SlotWire In-Situ Bridge</h3>
          <p style="font-size: 13px; color: var(--text-muted); margin-top: 6px; line-height: 1.4;">
            Changes saved here are instantly accessible by Astro SSR preview cookies and Static Content Loaders.
          </p>
        </div>
      </div>
    </form>

    <!-- Visual R2 Media Browser Modal -->
    ${renderMediaModal()}

    <script>
      const isNew = ${isNew};
      const collection = "${collection}";
      const docId = "${doc.id}";
      const toastEditors = {};
      let activeMediaTargetField = null;

      // 1. Initialize 3-Way Mode Switcher Editors safely
      function initAllEditors() {
        document.querySelectorAll('.editor-container-wrapper').forEach(wrapper => {
          const fieldName = wrapper.dataset.field;
          const initialValue = wrapper.dataset.initial || '';
          const defaultMode = wrapper.dataset.defaultMode || 'toast';
          const toastEl = wrapper.querySelector('.toast-container');
          const rawEl = wrapper.querySelector('.raw-textarea');
          const hiddenInput = wrapper.querySelector('.editor-payload-input');

          let toastInitialized = false;

          if (toastEl && typeof toastui !== 'undefined' && toastui.Editor) {
            try {
              toastEditors[fieldName] = new toastui.Editor({
                el: toastEl,
                height: '350px',
                initialEditType: 'markdown',
                previewStyle: 'tab',
                initialValue: initialValue,
                events: {
                  change: () => {
                    const md = toastEditors[fieldName].getMarkdown();
                    if (hiddenInput) hiddenInput.value = md;
                    if (rawEl) rawEl.value = md;
                  }
                }
              });
              toastInitialized = true;
            } catch (err) {
              console.warn('[SlottD] Toast-UI init warning for field', fieldName, err);
            }
          }

          // If default mode is toast but Toast-UI couldn't initialize, fallback to raw textarea immediately
          if (defaultMode === 'toast' && !toastInitialized) {
            switchEditorMode(fieldName, 'raw');
          } else {
            switchEditorMode(fieldName, defaultMode);
          }
        });
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAllEditors);
      } else {
        initAllEditors();
      }

      // 2. Mode Switcher Handler (Toast-UI <-> Trix <-> Raw)
      function switchEditorMode(fieldName, mode, btn) {
        const wrapper = document.querySelector(\`.editor-container-wrapper[data-field="\${fieldName}"]\`);
        if (!wrapper) return;

        wrapper.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        if (btn) {
          btn.classList.add('active');
        } else {
          const targetBtn = wrapper.querySelector(\`.mode-btn[data-mode="\${mode}"]\`);
          if (targetBtn) targetBtn.classList.add('active');
        }

        const toastEl = wrapper.querySelector('.toast-container');
        const trixWrap = wrapper.querySelector('.trix-wrapper');
        const rawEl = wrapper.querySelector('.raw-textarea');
        const hiddenInput = wrapper.querySelector('.editor-payload-input');

        // Current synchronized value
        let currentVal = hiddenInput.value || '';
        if (rawEl && rawEl.style.display !== 'none' && rawEl.value) {
          currentVal = rawEl.value;
        } else if (toastEditors[fieldName]) {
          try { currentVal = toastEditors[fieldName].getMarkdown(); } catch {}
        }

        if (mode === 'toast') {
          if (toastEditors[fieldName]) {
            if (toastEl) toastEl.style.display = 'block';
            if (trixWrap) trixWrap.style.display = 'none';
            if (rawEl) rawEl.style.display = 'none';
            try { toastEditors[fieldName].setMarkdown(currentVal); } catch {}
          } else {
            // Graceful fallback to raw textarea
            if (toastEl) toastEl.style.display = 'none';
            if (trixWrap) trixWrap.style.display = 'none';
            if (rawEl) {
              rawEl.style.display = 'block';
              rawEl.value = currentVal;
            }
          }
        } else if (mode === 'trix') {
          if (toastEl) toastEl.style.display = 'none';
          if (trixWrap) {
            trixWrap.style.display = 'block';
            const trixInput = document.getElementById(\`\${fieldName}_trix_input\`);
            const trixEditor = trixWrap.querySelector('trix-editor');
            if (trixInput) trixInput.value = currentVal;
            if (trixEditor && trixEditor.editor) {
              trixEditor.editor.loadHTML(currentVal.replace(/\\n/g, '<br>'));
            }
          }
          if (rawEl) rawEl.style.display = 'none';
        } else if (mode === 'raw') {
          if (toastEl) toastEl.style.display = 'none';
          if (trixWrap) trixWrap.style.display = 'none';
          if (rawEl) {
            rawEl.style.display = 'block';
            rawEl.value = currentVal;
          }
        }
      }

      // 3. Save Document Form Handler
      document.getElementById('saveBtn').addEventListener('click', async (e) => {
        e.preventDefault();
        const form = document.getElementById('editorForm');
        const formData = new FormData(form);
        const payload = Object.fromEntries(formData.entries());

        // Extract values from dynamic editors
        for (const [field, editor] of Object.entries(toastEditors)) {
          const wrapper = document.querySelector(\`.editor-container-wrapper[data-field="\${field}"]\`);
          const rawEl = wrapper?.querySelector('.raw-textarea');
          if (rawEl && rawEl.style.display !== 'none') {
            payload[field] = rawEl.value;
          } else {
            try { payload[field] = editor.getMarkdown(); } catch {}
          }
        }

        // Parse repeaters / JSON fields
        document.querySelectorAll('.repeater-input').forEach(input => {
          try {
            payload[input.name] = JSON.parse(input.value);
          } catch {}
        });

        const url = isNew ? \`/items/\${collection}\` : \`/items/\${collection}/\${docId}\`;
        const method = isNew ? 'POST' : 'PATCH';
        if (isNew) payload.id = docId;

        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          const btn = document.getElementById('saveBtn');
          btn.innerText = 'Saved! ✓';
          btn.style.backgroundColor = '#10B981';
          setTimeout(() => {
            if (isNew) {
              window.location.href = \`/admin/content/\${collection}/\${docId}\`;
            } else {
              btn.innerText = 'Save & Publish';
              btn.style.backgroundColor = '';
            }
          }, 800);
        } else {
          const errText = await res.text();
          alert('Failed to save changes: ' + errText);
        }
      });

      // 4. Delete Single Document from Editor
      async function deleteCurrentDocument() {
        const confirmed = confirm(\`Are you sure you want to PERMANENTLY delete this document? This action cannot be undone.\`);
        if (!confirmed) return;

        try {
          const res = await fetch(\`/items/\${collection}/\${docId}\`, { method: 'DELETE' });
          if (res.ok || res.status === 204) {
            window.location.href = \`/admin/content/\${collection}\`;
          } else {
            alert('Failed to delete document: ' + (await res.text()));
          }
        } catch (e) {
          alert('Delete error: ' + e.message);
        }
      }

      // 5. Media Picker & Thumbnail Logic
      let cachedMedia = [];

      async function openMediaModal(fieldName) {
        activeMediaTargetField = fieldName;
        document.getElementById('mediaModal').style.display = 'flex';
        if (cachedMedia.length === 0) {
          const res = await fetch('/files');
          const json = await res.json();
          cachedMedia = json.data || [];
        }
        renderModalMedia(cachedMedia);
      }

      function closeMediaModal() {
        document.getElementById('mediaModal').style.display = 'none';
        activeMediaTargetField = null;
      }

      function renderModalMedia(items) {
        const grid = document.getElementById('modalMediaGrid');
        if (items.length === 0) {
          grid.innerHTML = '<p style="color:var(--text-muted);grid-column:1/-1;">No assets found.</p>';
          return;
        }
        grid.innerHTML = items.map(m => \`
          <div class="modal-media-item" onclick="selectMediaAsset('\${m.url || '/media/' + m.key}')">
            <img src="/media/\${m.key}" alt="\${m.filename}" loading="lazy" />
            <span class="modal-media-name">\${m.filename}</span>
          </div>
        \`).join('');
      }

      function filterMediaModal(query) {
        const q = query.toLowerCase();
        const filtered = cachedMedia.filter(m => (m.filename || '').toLowerCase().includes(q) || (m.key || '').toLowerCase().includes(q));
        renderModalMedia(filtered);
      }

      function selectMediaAsset(url) {
        if (!activeMediaTargetField) return;
        const input = document.getElementById(\`\${activeMediaTargetField}_input\`);
        if (input) {
          input.value = url;
          updateThumbnailPreview(activeMediaTargetField, url);
        }
        closeMediaModal();
      }

      function updateThumbnailPreview(fieldName, url) {
        const previewEl = document.getElementById(\`\${fieldName}_preview\`);
        const img = previewEl?.querySelector('img');
        if (previewEl && img) {
          if (url) {
            img.src = url;
            previewEl.style.display = 'flex';
          } else {
            previewEl.style.display = 'none';
          }
        }
      }

      async function uploadFieldAsset(input, fieldName) {
        if (!input.files || input.files.length === 0) return;
        const file = input.files[0];
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/files', { method: 'POST', body: formData });
        if (res.ok) {
          const json = await res.json();
          const fileUrl = json.data?.url || \`/media/\${json.data?.key}\`;
          const inputEl = document.getElementById(\`\${fieldName}_input\`);
          if (inputEl) inputEl.value = fileUrl;
          updateThumbnailPreview(fieldName, fileUrl);
        } else {
          alert('Upload failed: ' + await res.text());
        }
      }

      async function uploadModalAsset(input) {
        if (!input.files || input.files.length === 0) return;
        const file = input.files[0];
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/files', { method: 'POST', body: formData });
        if (res.ok) {
          const json = await res.json();
          const fileUrl = json.data?.url || \`/media/\${json.data?.key}\`;
          selectMediaAsset(fileUrl);
        } else {
          alert('Upload failed: ' + await res.text());
        }
      }
    </script>
  `);
}
