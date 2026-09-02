import { html, raw } from 'hono/html';
import { renderLayout } from '../layout.js';
import { renderFieldWidget } from '../widgets/fields.js';
import { renderMediaModal } from '../widgets/media-picker.js';

export function renderEditorView(
  collection: string,
  doc: any,
  fields: any[],
  isNew: boolean,
  user: { email: string; authMethod?: string },
  modelIcon: string = '⚙️'
) {
  let customData: Record<string, any> = {};
  try {
    customData = typeof doc.data === 'string' ? JSON.parse(doc.data) : (doc.data || {});
  } catch {}

  const clientScript = `
    const isNew = ${JSON.stringify(Boolean(isNew))};
    const collection = ${JSON.stringify(String(collection))};
    const docId = ${JSON.stringify(String(doc.id))};
    const toastEditors = {};
    let activeMediaTargetField = null;
    let cachedMedia = [];

    // 1. Slug Generator & Shortcut Sync
    function slugify(text) {
      return (text || '')
        .toString()
        .normalize('NFD')
        .replace(/[\\u0300-\\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\\s-]/g, '')
        .replace(/[\\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }

    const titleInput = document.getElementById('title');
    const slugInput = document.getElementById('slug');
    const slugifyBtn = document.getElementById('slugifyBtn');
    const slugLockBtn = document.getElementById('slugLockBtn');

    let autoSlug = isNew;

    if (slugLockBtn) {
      slugLockBtn.innerText = autoSlug ? '🔓 Auto: On' : '🔒 Auto: Off';
      slugLockBtn.addEventListener('click', function() {
        autoSlug = !autoSlug;
        slugLockBtn.innerText = autoSlug ? '🔓 Auto: On' : '🔒 Auto: Off';
        if (autoSlug && titleInput && slugInput) {
          slugInput.value = slugify(titleInput.value);
        }
      });
    }

    if (slugifyBtn) {
      slugifyBtn.addEventListener('click', function() {
        if (titleInput && slugInput) {
          const generated = slugify(titleInput.value);
          if (generated) {
            slugInput.value = generated;
            slugInput.focus();
          } else {
            alert('Please enter a Title first to generate a slug.');
          }
        }
      });
    }

    if (titleInput && slugInput) {
      titleInput.addEventListener('input', function() {
        if (autoSlug) {
          slugInput.value = slugify(titleInput.value);
        }
      });
      slugInput.addEventListener('input', function() {
        if (autoSlug) {
          autoSlug = false;
          if (slugLockBtn) slugLockBtn.innerText = '🔒 Auto: Off';
        }
      });
    }

    // Keyboard shortcut Alt+S or Cmd+Shift+S to generate slug
    document.addEventListener('keydown', function(e) {
      if ((e.altKey && e.key.toLowerCase() === 's') || ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 's')) {
        e.preventDefault();
        if (slugifyBtn) slugifyBtn.click();
      }
    });

    // 2. Initialize Toast-UI Markdown Editors
    function initMarkdownEditors() {
      document.querySelectorAll('.toastui-editor-target').forEach(function(el) {
        const fieldName = el.getAttribute('data-field-name');
        const initialVal = el.getAttribute('data-initial-value') || '';
        if (toastEditors[fieldName]) return;

        try {
          if (window.toastui && window.toastui.Editor) {
            const editor = new window.toastui.Editor({
              el: el,
              height: '360px',
              initialEditType: 'markdown',
              previewStyle: 'vertical',
              initialValue: initialVal,
              theme: 'dark'
            });

            editor.on('change', function() {
              const hidden = document.getElementById(fieldName + '_hidden');
              if (hidden) hidden.value = editor.getMarkdown();
            });

            toastEditors[fieldName] = editor;
          }
        } catch (e) {
          console.warn('Toast-UI init fallback to textarea:', e);
        }
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initMarkdownEditors);
    } else {
      setTimeout(initMarkdownEditors, 50);
    }

    // 3. Editor Mode Switcher (Toast Markdown <-> Trix Rich Text <-> Raw Code)
    window.switchEditorMode = function(fieldName, mode) {
      const container = document.getElementById(fieldName + '_editor_container');
      const hiddenInput = document.getElementById(fieldName + '_hidden');
      if (!container || !hiddenInput) return;

      const toastEl = document.getElementById(fieldName + '_toast_target');
      const trixEl = document.getElementById(fieldName + '_trix_target');
      const codeEl = document.getElementById(fieldName + '_code_target');
      const trixEditor = trixEl ? trixEl.querySelector('trix-editor') : null;
      const codeTextarea = codeEl ? codeEl.querySelector('textarea') : null;

      let currentVal = hiddenInput.value || '';
      if (toastEditors[fieldName]) {
        try { currentVal = toastEditors[fieldName].getMarkdown(); } catch (e) {}
      } else if (codeTextarea && codeEl && codeEl.style.display !== 'none') {
        currentVal = codeTextarea.value;
      }

      hiddenInput.value = currentVal;

      if (toastEl) toastEl.style.display = 'none';
      if (trixEl) trixEl.style.display = 'none';
      if (codeEl) codeEl.style.display = 'none';

      const switcher = container.querySelector('.mode-switcher');
      if (switcher) {
        switcher.querySelectorAll('.mode-btn').forEach(function(b) { b.classList.remove('active'); });
        const activeBtn = switcher.querySelector('[data-mode="' + mode + '"]');
        if (activeBtn) activeBtn.classList.add('active');
      }

      if (mode === 'markdown') {
        if (toastEl) {
          toastEl.style.display = 'block';
          if (toastEditors[fieldName]) {
            toastEditors[fieldName].setMarkdown(currentVal);
          } else {
            initMarkdownEditors();
          }
        }
      } else if (mode === 'richtext') {
        if (trixEl) {
          trixEl.style.display = 'block';
          if (trixEditor && trixEditor.editor) {
            trixEditor.editor.loadHTML(currentVal);
          }
        }
      } else if (mode === 'code') {
        if (codeEl) {
          codeEl.style.display = 'block';
          if (codeTextarea) codeTextarea.value = currentVal;
        }
      }
    };

    // 4. Form Submission
    const editorForm = document.getElementById('editorForm');
    const saveBtn = document.getElementById('saveBtn');

    if (editorForm) {
      editorForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        if (saveBtn) {
          saveBtn.innerText = 'Saving...';
          saveBtn.disabled = true;
        }

        const formData = new FormData(editorForm);
        const title = formData.get('title');
        const slug = formData.get('slug');
        const status = formData.get('status');

        const customPayload = {};
        for (const pair of formData.entries()) {
          const key = pair[0];
          const val = pair[1];
          if (key === 'title' || key === 'slug' || key === 'status') continue;
          if (key.endsWith('_editor_mode') || key.endsWith('_trix_input')) continue;

          if (toastEditors[key]) {
            try {
              customPayload[key] = toastEditors[key].getMarkdown();
            } catch (err) {
              customPayload[key] = val;
            }
          } else {
            const rawEl = document.querySelector('textarea[name="' + key + '"].raw-code-textarea');
            if (rawEl) {
              customPayload[key] = rawEl.value;
            } else {
              const repeaterEl = document.querySelector('textarea[name="' + key + '"].repeater-input');
              if (repeaterEl) {
                try {
                  customPayload[key] = JSON.parse(repeaterEl.value);
                } catch (jsonErr) {
                  customPayload[key] = repeaterEl.value;
                }
              } else {
                if (typeof val === 'string' && val.trim() !== '' && !isNaN(val) && !isNaN(parseFloat(val))) {
                  customPayload[key] = Number(val);
                } else {
                  customPayload[key] = val;
                }
              }
            }
          }
        }

        const payload = Object.assign({}, {
          id: docId,
          collection: collection,
          title: title,
          slug: slug,
          status: status
        }, customPayload);

        try {
          const endpoint = isNew ? '/items/' + collection : '/items/' + collection + '/' + encodeURIComponent(docId);
          const method = isNew ? 'POST' : 'PATCH';

          const res = await fetch(endpoint, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          if (res.ok) {
            window.location.href = '/admin/content/' + collection;
          } else {
            const err = await res.text();
            alert('Save failed: ' + err);
            if (saveBtn) {
              saveBtn.innerText = 'Save & Publish';
              saveBtn.disabled = false;
            }
          }
        } catch (err) {
          alert('Network error: ' + err.message);
          if (saveBtn) {
            saveBtn.innerText = 'Save & Publish';
            saveBtn.disabled = false;
          }
        }
      });
    }

    if (saveBtn && editorForm) {
      saveBtn.addEventListener('click', function() {
        editorForm.dispatchEvent(new Event('submit', { cancelable: true }));
      });
    }

    // 5. Delete Document
    window.deleteCurrentDocument = async function() {
      const confirmed = confirm('Are you sure you want to permanently delete this document (' + docId + ')?');
      if (!confirmed) return;

      try {
        const res = await fetch('/items/' + collection + '/' + encodeURIComponent(docId), {
          method: 'DELETE'
        });
        if (res.ok || res.status === 204) {
          window.location.href = '/admin/content/' + collection;
        } else {
          alert('Delete failed: ' + await res.text());
        }
      } catch (err) {
        alert('Delete error: ' + err.message);
      }
    };

    // 6. Media Picker & Thumbnail Logic
    window.openMediaModal = async function(fieldName) {
      activeMediaTargetField = fieldName;
      const modal = document.getElementById('mediaModal');
      if (modal) modal.style.display = 'flex';

      if (cachedMedia.length === 0) {
        try {
          const res = await fetch('/files');
          const json = await res.json();
          cachedMedia = json.data || [];
        } catch (e) {
          console.error('Error fetching /files:', e);
        }
      }
      renderModalMedia(cachedMedia);
    };

    window.closeMediaModal = function() {
      const modal = document.getElementById('mediaModal');
      if (modal) modal.style.display = 'none';
      activeMediaTargetField = null;
    };

    function renderModalMedia(items) {
      const grid = document.getElementById('modalMediaGrid');
      if (!grid) return;
      grid.innerHTML = '';
      if (!items || items.length === 0) {
        const emptyMsg = document.createElement('p');
        emptyMsg.style.cssText = 'color:var(--text-muted);grid-column:1/-1;text-align:center;padding:20px;';
        emptyMsg.innerText = 'No assets found in R2.';
        grid.appendChild(emptyMsg);
        return;
      }

      items.forEach(function(m) {
        const itemEl = document.createElement('div');
        itemEl.className = 'modal-media-item';
        itemEl.title = m.filename || m.key;

        const isImg = (m.type || m.mime_type || '').indexOf('image/') === 0 || /\\.(jpg|jpeg|png|webp|svg|gif)$/i.test(m.key || '');
        const assetUrl = m.url || ('/media/' + m.key);

        itemEl.addEventListener('click', function() {
          window.selectMediaAsset(assetUrl);
        });

        if (isImg) {
          const imgEl = document.createElement('img');
          imgEl.src = '/media/' + m.key;
          imgEl.alt = m.filename || '';
          imgEl.loading = 'lazy';
          itemEl.appendChild(imgEl);
        } else {
          const iconEl = document.createElement('div');
          iconEl.style.cssText = 'font-size:32px;padding:16px;';
          iconEl.innerText = '📄';
          itemEl.appendChild(iconEl);
        }

        const nameEl = document.createElement('span');
        nameEl.className = 'modal-media-name';
        nameEl.innerText = m.filename || m.key;
        itemEl.appendChild(nameEl);

        grid.appendChild(itemEl);
      });
    }

    window.filterMediaModal = function(query) {
      const q = (query || '').toLowerCase().trim();
      const filtered = cachedMedia.filter(function(m) {
        return (m.filename || '').toLowerCase().includes(q) || (m.key || '').toLowerCase().includes(q);
      });
      renderModalMedia(filtered);
    };

    window.selectMediaAsset = function(url) {
      if (!activeMediaTargetField) return;
      const input = document.getElementById(activeMediaTargetField + '_input');
      if (input) {
        input.value = url;
        window.updateThumbnailPreview(activeMediaTargetField, url);
      }
      window.closeMediaModal();
    };

    window.updateThumbnailPreview = function(fieldName, url) {
      const previewEl = document.getElementById(fieldName + '_preview');
      const img = previewEl ? previewEl.querySelector('img') : null;
      const pathEl = previewEl ? previewEl.querySelector('.media-preview-path') : null;
      const inputEl = document.getElementById(fieldName + '_input');

      if (inputEl && inputEl.value !== url) {
        inputEl.value = url;
      }

      if (previewEl && img) {
        if (url && url.trim()) {
          img.src = url;
          if (pathEl) pathEl.innerText = url;
          previewEl.style.display = 'flex';
        } else {
          previewEl.style.display = 'none';
          if (pathEl) pathEl.innerText = '';
        }
      }
    };

    window.uploadFieldAsset = async function(input, fieldName) {
      if (!input.files || input.files.length === 0) return;
      const file = input.files[0];
      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch('/files', { method: 'POST', body: formData });
        if (res.ok) {
          const json = await res.json();
          const fileUrl = json.data && json.data.url ? json.data.url : ('/media/' + json.data.key);
          window.updateThumbnailPreview(fieldName, fileUrl);
        } else {
          alert('Upload failed: ' + await res.text());
        }
      } catch (e) {
        alert('Upload error: ' + e.message);
      }
    };

    window.uploadModalAsset = async function(input) {
      if (!input.files || input.files.length === 0) return;
      const file = input.files[0];
      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch('/files', { method: 'POST', body: formData });
        if (res.ok) {
          const json = await res.json();
          const fileUrl = json.data && json.data.url ? json.data.url : ('/media/' + json.data.key);
          cachedMedia = [];
          window.selectMediaAsset(fileUrl);
        } else {
          alert('Upload failed: ' + await res.text());
        }
      } catch (e) {
        alert('Upload error: ' + e.message);
      }
    };
  `;

  return renderLayout(isNew ? `New ${collection}` : `Edit: ${doc.title || doc.slug || collection}`, 'content', user, html`
    <div class="header">
      <div class="breadcrumbs">
        <a href="/admin">Collections</a>
        <span>/</span>
        <a href="/admin/content/${collection}">${collection}</a>
        <span>/</span>
        <span class="current">${isNew ? 'New Record' : doc.title || doc.slug}</span>
        <span class="model-badge" style="margin-left: 8px; background: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.3); color: #a5b4fc; padding: 3px 10px; border-radius: 4px; font-size: 12px; font-family: monospace; display: inline-flex; align-items: center; gap: 4px;">
          <span>${modelIcon}</span> Model: <a href="/admin/models#model-${collection}" style="color: inherit; text-decoration: underline; font-weight: 600;">${collection}</a>
        </span>
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
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
            <label for="slug" style="margin-bottom: 0;">Slug *</label>
            <div style="display: flex; align-items: center; gap: 6px;">
              <button type="button" id="slugifyBtn" class="btn btn-secondary" style="padding: 2px 8px; font-size: 11px; height: auto;" title="Generate slug from Title (Shortcut: Alt+S)">
                🪄 Sync with Title
              </button>
              <button type="button" id="slugLockBtn" class="btn btn-secondary" style="padding: 2px 6px; font-size: 11px; height: auto;" title="Toggle automatic slug generation while typing">
                🔒 Auto: Off
              </button>
            </div>
          </div>
          <input type="text" id="slug" name="slug" value="${doc.slug || ''}" class="input-text" required placeholder="url-friendly-slug" style="font-family: monospace;" />
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
            <p><strong>Model:</strong> <code>${modelIcon} ${collection}</code></p>
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
            <button type="button" id="deleteBtn" class="btn btn-danger-outline" style="width: 100%; margin-top: 12px;" onclick="window.deleteCurrentDocument()">
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
      ${raw(clientScript)}
    </script>
  `);
}
