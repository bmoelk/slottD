import { html, raw } from 'hono/html';
import { renderLayout } from '../layout.js';
import { renderFieldWidget } from '../widgets/fields.js';
import { renderMediaModal } from '../widgets/media-picker.js';
import { renderInfoBubble } from '../ui.js';

export function renderEditorView(
  collection: string,
  doc: any,
  fields: any[],
  isNew: boolean,
  user: { email: string; authMethod?: string; apiKey?: string },
  modelIcon: string = '⚙️',
  editorConfig?: { format?: 'markdown' | 'richtext'; tier?: 'light' | 'heavy' }
) {
  let publishedData: Record<string, any> = {};
  let draftData: Record<string, any> = {};
  try {
    publishedData = typeof doc.data === 'string' ? JSON.parse(doc.data) : (doc.data || {});
  } catch {}
  try {
    draftData = typeof doc.draft_data === 'string' ? JSON.parse(doc.draft_data) : (doc.draft_data || {});
  } catch {}

  const hasDraft = Boolean(!isNew && doc.draft_status && doc.draft_status !== 'none' && Object.keys(draftData).length > 0);
  const activeData = hasDraft ? { ...publishedData, ...draftData } : publishedData;

  const modifiedFieldNames: string[] = [];
  if (hasDraft) {
    for (const key of Object.keys(draftData)) {
      if (JSON.stringify(draftData[key]) !== JSON.stringify(publishedData[key])) {
        modifiedFieldNames.push(key);
      }
    }
  }

  const titleField = fields.find((f) => f.name === 'title');
  const titleLabel = titleField?.label || 'Title';
  const titlePlaceholder = `${titleLabel}...`;

  const clientScript = `
    const isNew = ${JSON.stringify(Boolean(isNew))};
    const collection = ${JSON.stringify(String(collection))};
    const docId = ${JSON.stringify(String(doc.id))};
    const publishedData = ${JSON.stringify(publishedData)};
    const draftData = ${JSON.stringify(draftData)};
    const activeData = ${JSON.stringify(activeData)};
    const hasDraft = ${JSON.stringify(hasDraft)};
    let isDraftSave = false;
    let showingLive = false;
    const toastEditors = {};
    const pellEditors = {};
    let activeMediaTargetField = null;
    let activeEditorMediaTarget = null;
    let cachedMedia = [];

    function getStudioHeaders(extra) {
      return Object.assign({}, extra || {});
    }

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

    // 2. Initialize Editors (Toast-UI, Pell, Markdown Toolbar) with Resilient Retry & Fallback
    function initPellEditors() {
      if (typeof window.pell === 'undefined') return;
      document.querySelectorAll('.pell-editor-target').forEach(function(el) {
        const fieldName = el.getAttribute('data-field-name');
        if (!fieldName || pellEditors[fieldName]) return;
        const hidden = document.getElementById(fieldName + '_hidden');
        const initialVal = (hidden ? hidden.value : '') || '';

        try {
          const editor = window.pell.init({
            element: el,
            fieldName: fieldName,
            onChange: function(html) {
              if (hidden) hidden.value = html;
              const raw = document.getElementById(fieldName + '_raw_textarea');
              if (raw && document.activeElement !== raw) raw.value = html;
              if (typeof window.updateDraftButtonState === 'function') window.updateDraftButtonState();
            },
            defaultParagraphSeparator: 'p'
          });

          if (editor && editor.content) {
            editor.content.innerHTML = initialVal;
          }
          pellEditors[fieldName] = editor;
        } catch (e) {
          console.warn('Pell init fallback for field:', fieldName, e);
          window.switchEditorMode(fieldName, 'code');
        }
      });
    }

    function initMarkdownEditors() {
      document.querySelectorAll('.toastui-editor-target').forEach(function(el) {
        const fieldName = el.getAttribute('data-field-name');
        const initialVal = el.getAttribute('data-initial-value') || '';
        if (!fieldName || toastEditors[fieldName]) return;

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
              const raw = document.getElementById(fieldName + '_raw_textarea');
              if (raw && document.activeElement !== raw) raw.value = editor.getMarkdown();
              if (typeof window.updateDraftButtonState === 'function') window.updateDraftButtonState();
            });

            toastEditors[fieldName] = editor;
          }
        } catch (e) {
          console.warn('Toast-UI init fallback to textarea for field:', fieldName, e);
          window.switchEditorMode(fieldName, 'code');
        }
      });
    }

    function scheduleInitEditors(attempts) {
      attempts = attempts || 0;
      initPellEditors();
      if (window.toastui && window.toastui.Editor) {
        initMarkdownEditors();
      } else if (attempts < 8) {
        setTimeout(function() { scheduleInitEditors(attempts + 1); }, 150);
      } else {
        // If Toast UI CDN unavailable after retries, fallback those fields to raw textarea
        document.querySelectorAll('.toastui-editor-target').forEach(function(el) {
          const fieldName = el.getAttribute('data-field-name');
          if (fieldName && !toastEditors[fieldName]) {
            console.warn('Toast-UI CDN unavailable for ' + fieldName + ', falling back to native textarea.');
            window.switchEditorMode(fieldName, 'code');
          }
        });
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() { scheduleInitEditors(0); });
    } else {
      scheduleInitEditors(0);
    }

    // Two-way synchronization when editing in Raw Textarea tab
    window.syncFromRawTextarea = function(fieldName, val) {
      const hidden = document.getElementById(fieldName + '_hidden');
      if (hidden) hidden.value = val;

      const mdTextarea = document.getElementById(fieldName + '_md_textarea');
      if (mdTextarea && mdTextarea !== document.activeElement) {
        mdTextarea.value = val;
      }

      if (pellEditors[fieldName] && pellEditors[fieldName].content && pellEditors[fieldName].content !== document.activeElement) {
        pellEditors[fieldName].content.innerHTML = val;
      }

      if (toastEditors[fieldName]) {
        try { toastEditors[fieldName].setMarkdown(val); } catch (e) {}
      }

      const trixEl = document.getElementById(fieldName + '_trix_target');
      const trixEditor = trixEl ? trixEl.querySelector('trix-editor') : null;
      if (trixEditor && trixEditor.editor) {
        try { trixEditor.editor.loadHTML(val); } catch (e) {}
      }
    };

    // 3. Clean 2-Tab Mode Switcher: 'primary' (Active Configured Engine) <-> 'code' (Raw Textarea)
    window.switchEditorMode = function(fieldName, mode) {
      const container = document.getElementById(fieldName + '_editor_container');
      const hiddenInput = document.getElementById(fieldName + '_hidden');
      if (!container || !hiddenInput) return;

      const primaryEl = document.getElementById(fieldName + '_primary_target');
      const toastEl = document.getElementById(fieldName + '_toast_target');
      const trixEl = document.getElementById(fieldName + '_trix_target');
      const pellEl = document.getElementById(fieldName + '_pell_target');
      const codeEl = document.getElementById(fieldName + '_code_target');
      const codeTextarea = document.getElementById(fieldName + '_raw_textarea');
      const mdTextarea = document.getElementById(fieldName + '_md_textarea');

      // Extract current content from whichever view is currently active:
      let currentVal = '';
      if (codeEl && codeEl.style.display !== 'none' && codeTextarea) {
        currentVal = codeTextarea.value;
      } else if (mdTextarea && primaryEl && primaryEl.style.display !== 'none') {
        currentVal = mdTextarea.value;
      } else if (pellEditors[fieldName] && pellEditors[fieldName].content) {
        currentVal = pellEditors[fieldName].content.innerHTML;
      } else if (trixEl && trixEl.style.display !== 'none') {
        const trixInput = document.getElementById(fieldName + '_trix_input');
        const trixEditor = trixEl.querySelector('trix-editor');
        currentVal = (trixInput && trixInput.value) || (trixEditor && trixEditor.value) || '';
      } else if (toastEl && toastEl.style.display !== 'none' && toastEditors[fieldName]) {
        try { currentVal = toastEditors[fieldName].getMarkdown(); } catch (e) {}
      }

      if (!currentVal && hiddenInput.value) {
        currentVal = hiddenInput.value;
      }

      hiddenInput.value = currentVal;

      const switcher = container.querySelector('.mode-switcher');
      if (switcher) {
        switcher.querySelectorAll('.mode-btn').forEach(function(b) { b.classList.remove('active'); });
        const activeBtn = switcher.querySelector('[data-mode="' + mode + '"]') || (mode !== 'code' ? switcher.querySelector('[data-mode="primary"]') : null);
        if (activeBtn) activeBtn.classList.add('active');
      }

      // Always dismiss preview when switching edit modes
      const previewTarget = document.getElementById(fieldName + '_preview_target');
      const previewBtn = document.getElementById(fieldName + '_preview_btn');
      if (previewTarget) previewTarget.style.display = 'none';
      if (previewBtn) previewBtn.classList.remove('active');

      if (mode === 'primary' || mode === 'markdown' || mode === 'richtext') {
        if (codeEl) codeEl.style.display = 'none';
        if (primaryEl) primaryEl.style.display = 'block';
        if (toastEl) toastEl.style.display = 'block';

        if (mdTextarea) {
          mdTextarea.value = currentVal;
          mdTextarea.focus();
        } else if (pellEditors[fieldName] && pellEditors[fieldName].content) {
          pellEditors[fieldName].content.innerHTML = currentVal;
          pellEditors[fieldName].content.focus();
        } else if (toastEditors[fieldName]) {
          toastEditors[fieldName].setMarkdown(currentVal);
        } else if (trixEl) {
          const trixEditor = trixEl.querySelector('trix-editor');
          if (trixEditor && trixEditor.editor) {
            trixEditor.editor.loadHTML(currentVal);
          }
        }
      } else if (mode === 'code') {
        if (primaryEl) primaryEl.style.display = 'none';
        if (toastEl) toastEl.style.display = 'none';
        if (codeEl) {
          codeEl.style.display = 'block';
          if (codeTextarea) {
            codeTextarea.value = currentVal;
            codeTextarea.focus();
          }
        }
      }
    };

    // 3b. Rendered Preview Toggle (Separated from Edit Mode Switcher)
    window.togglePreview = function(fieldName) {
      const container = document.getElementById(fieldName + '_editor_container');
      const hiddenInput = document.getElementById(fieldName + '_hidden');
      const previewBtn = document.getElementById(fieldName + '_preview_btn');
      const previewTarget = document.getElementById(fieldName + '_preview_target');
      const previewContent = document.getElementById(fieldName + '_preview_content');
      if (!container || !previewTarget || !previewContent) return;

      const isPreviewing = previewTarget.style.display !== 'none';
      if (isPreviewing) {
        // Exit preview mode -> restore active editing view
        previewTarget.style.display = 'none';
        if (previewBtn) previewBtn.classList.remove('active');
        const switcher = container.querySelector('.mode-switcher');
        const activeModeBtn = switcher ? switcher.querySelector('.mode-btn.active') : null;
        const mode = activeModeBtn ? activeModeBtn.getAttribute('data-mode') : 'primary';
        window.switchEditorMode(fieldName, mode);
        return;
      }

      // Enter preview mode: extract latest content from currently visible editor
      const primaryEl = document.getElementById(fieldName + '_primary_target');
      const toastEl = document.getElementById(fieldName + '_toast_target');
      const trixEl = document.getElementById(fieldName + '_trix_target');
      const codeEl = document.getElementById(fieldName + '_code_target');
      const codeTextarea = document.getElementById(fieldName + '_raw_textarea');
      const mdTextarea = document.getElementById(fieldName + '_md_textarea');

      let currentVal = '';
      if (codeEl && codeEl.style.display !== 'none' && codeTextarea) {
        currentVal = codeTextarea.value;
      } else if (mdTextarea && primaryEl && primaryEl.style.display !== 'none') {
        currentVal = mdTextarea.value;
      } else if (pellEditors[fieldName] && pellEditors[fieldName].content) {
        currentVal = pellEditors[fieldName].content.innerHTML;
      } else if (trixEl && trixEl.style.display !== 'none') {
        const trixInput = document.getElementById(fieldName + '_trix_input');
        const trixEditor = trixEl.querySelector('trix-editor');
        currentVal = (trixInput && trixInput.value) || (trixEditor && trixEditor.value) || '';
      } else if (toastEl && toastEl.style.display !== 'none' && toastEditors[fieldName]) {
        try { currentVal = toastEditors[fieldName].getMarkdown(); } catch (e) {}
      }

      if (!currentVal && hiddenInput && hiddenInput.value) {
        currentVal = hiddenInput.value;
      }

      if (hiddenInput) hiddenInput.value = currentVal;

      // Hide all editor input panes
      if (primaryEl) primaryEl.style.display = 'none';
      if (codeEl) codeEl.style.display = 'none';
      if (toastEl) toastEl.style.display = 'none';

      // Render preview
      const format = container.getAttribute('data-format') || 'markdown';
      let htmlOutput = '';
      if (!currentVal || !currentVal.trim()) {
        htmlOutput = '<p style="color:var(--text-muted);font-style:italic;margin:0;">No content to preview.</p>';
      } else if (format === 'richtext') {
        htmlOutput = currentVal;
      } else {
        // Markdown rendering via isolate-served marked.js
        if (typeof window.marked !== 'undefined' && typeof window.marked.parse === 'function') {
          try {
            htmlOutput = window.marked.parse(currentVal);
          } catch (err) {
            htmlOutput = '<p style="color:#ef4444;">Preview error: ' + err.message + '</p><pre>' + currentVal + '</pre>';
          }
        } else {
          htmlOutput = currentVal.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\n/g, '<br/>');
        }
      }

      previewContent.innerHTML = htmlOutput;
      previewTarget.style.display = 'block';
      if (previewBtn) previewBtn.classList.add('active');
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

        const customPayload = {};

        // 4a. Explicitly flush all rich editor containers from active DOM
        document.querySelectorAll('.editor-container-wrapper').forEach(function(container) {
          const fieldName = container.getAttribute('data-field');
          if (!fieldName) return;
          const hidden = document.getElementById(fieldName + '_hidden');
          const rawTextarea = container.querySelector('textarea.raw-code-textarea') || document.getElementById(fieldName + '_raw_textarea');
          const trixInput = document.getElementById(fieldName + '_trix_input');
          const trixEditor = container.querySelector('trix-editor');
          
          let val = '';
          const activeBtn = container.querySelector('.mode-btn.active');
          const mode = activeBtn ? activeBtn.getAttribute('data-mode') : null;

          if (mode === 'code' && rawTextarea) {
            val = rawTextarea.value;
          } else if (mode === 'richtext') {
            val = (trixInput && trixInput.value) || (trixEditor && trixEditor.value) || '';
          } else if (mode === 'markdown' && toastEditors[fieldName]) {
            try {
              val = toastEditors[fieldName].getMarkdown();
            } catch (err) {}
          }

          // Fallback: If empty, inspect all components
          if (!val) {
            if (rawTextarea && rawTextarea.value) {
              val = rawTextarea.value;
            } else if (trixInput && trixInput.value) {
              val = trixInput.value;
            } else if (toastEditors[fieldName]) {
              try { val = toastEditors[fieldName].getMarkdown(); } catch (err) {}
            } else if (hidden && hidden.value) {
              val = hidden.value;
            }
          }

          if (hidden) hidden.value = val;
          customPayload[fieldName] = val;
        });

        // 4b. Parse standard form fields
        const formData = new FormData(editorForm);
        const title = formData.get('title');
        const slug = formData.get('slug');
        const status = formData.get('status');

        for (const pair of formData.entries()) {
          const key = pair[0];
          const val = pair[1];
          if (key === 'title' || key === 'slug' || key === 'status') continue;
          if (key.endsWith('_editor_mode') || key.endsWith('_trix_input') || key.endsWith('_raw_textarea')) continue;

          // If already captured from rich editor container, do not overwrite
          if (key in customPayload) continue;

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

        const payload = Object.assign({}, {
          id: docId,
          collection: collection,
          title: title,
          slug: slug,
          status: status,
          draft: isDraftSave
        }, customPayload);

        try {
          const endpoint = isNew ? '/items/' + collection : '/items/' + collection + '/' + encodeURIComponent(docId);
          const method = isNew ? 'POST' : 'PATCH';

          const res = await fetch(endpoint, {
            method: method,
            headers: getStudioHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(payload)
          });

          if (res.ok) {
            if (isDraftSave) {
              window.location.reload();
            } else {
              window.location.href = '/admin/content/' + collection;
            }
          } else {
            const err = await res.text();
            alert('Save failed: ' + err);
            if (publishBtn) { publishBtn.innerText = '💾 Save'; publishBtn.disabled = false; }
            if (saveDraftBtn) { saveDraftBtn.innerText = '💾 Save as Draft'; window.updateDraftButtonState(); }
          }
        } catch (err) {
          alert('Network error: ' + err.message);
          if (publishBtn) { publishBtn.innerText = '💾 Save'; publishBtn.disabled = false; }
          if (saveDraftBtn) { saveDraftBtn.innerText = '💾 Save as Draft'; window.updateDraftButtonState(); }
        }
      });
    }

    const saveDraftBtn = document.getElementById('saveDraftBtn');
    const publishBtn = document.getElementById('publishBtn');

    if (saveDraftBtn && editorForm) {
      saveDraftBtn.addEventListener('click', function() {
        if (!isFormDirty()) {
          alert('No fields have been modified yet.');
          return;
        }
        isDraftSave = true;
        saveDraftBtn.innerText = '💾 Saving Draft...';
        saveDraftBtn.disabled = true;
        editorForm.dispatchEvent(new Event('submit', { cancelable: true }));
      });
    }

    if (publishBtn && editorForm) {
      publishBtn.addEventListener('click', function() {
        isDraftSave = false;
        publishBtn.innerText = '💾 Saving...';
        publishBtn.disabled = true;
        editorForm.dispatchEvent(new Event('submit', { cancelable: true }));
      });
    }

    // 4c. Form Dirty State Tracking (Save as Draft active only when modifications exist)
    function captureFormValues() {
      const vals = {};
      if (!editorForm) return vals;
      const fd = new FormData(editorForm);
      for (const [k, v] of fd.entries()) {
        if (k.endsWith('_editor_mode') || k.endsWith('_trix_input') || k.endsWith('_raw_textarea')) continue;
        vals[k] = String(v ?? '');
      }
      document.querySelectorAll('.editor-container-wrapper').forEach(function(c) {
        const f = c.getAttribute('data-field');
        if (!f) return;
        const hidden = document.getElementById(f + '_hidden');
        if (hidden) vals[f] = String(hidden.value ?? '');
      });
      for (const fieldName in toastEditors) {
        if (toastEditors[fieldName]) {
          try { vals[fieldName] = toastEditors[fieldName].getMarkdown(); } catch (e) {}
        }
      }
      return vals;
    }

    let initialFormValues = null;

    function isFormDirty() {
      if (!initialFormValues) return false;
      const current = captureFormValues();
      const allKeys = new Set([...Object.keys(initialFormValues), ...Object.keys(current)]);
      for (const k of allKeys) {
        if ((current[k] ?? '') !== (initialFormValues[k] ?? '')) {
          return true;
        }
      }
      return false;
    }

    window.updateDraftButtonState = function() {
      if (!saveDraftBtn) return;
      if (showingLive) {
        saveDraftBtn.disabled = true;
        saveDraftBtn.style.opacity = '0.35';
        saveDraftBtn.style.cursor = 'not-allowed';
        saveDraftBtn.title = 'Switch back to Working Draft view to edit and save draft changes';
        return;
      }

      const dirty = isFormDirty();
      if (dirty) {
        saveDraftBtn.disabled = false;
        saveDraftBtn.style.opacity = '1';
        saveDraftBtn.style.cursor = 'pointer';
        saveDraftBtn.title = 'Save modified changes as working draft';
      } else {
        saveDraftBtn.disabled = true;
        saveDraftBtn.style.opacity = '0.35';
        saveDraftBtn.style.cursor = 'not-allowed';
        saveDraftBtn.title = 'No fields have been modified yet';
      }
    };

    if (editorForm) {
      editorForm.addEventListener('input', window.updateDraftButtonState);
      editorForm.addEventListener('change', window.updateDraftButtonState);
      editorForm.addEventListener('trix-change', window.updateDraftButtonState);
    }

    setTimeout(function() {
      initialFormValues = captureFormValues();
      window.updateDraftButtonState();
    }, 150);

    // Discard Working Draft
    window.discardWorkingDraft = async function() {
      const confirmed = confirm('Are you sure you want to discard all working draft changes for this document? This will revert the document to its published live state.');
      if (!confirmed) return;

      try {
        const res = await fetch('/items/' + collection + '/' + encodeURIComponent(docId) + '/discard-draft', {
          method: 'POST',
          headers: getStudioHeaders({ 'Content-Type': 'application/json' })
        });
        if (res.ok) {
          window.location.reload();
        } else {
          alert('Failed to discard draft: ' + await res.text());
        }
      } catch (err) {
        alert('Network error: ' + err.message);
      }
    };

    // Set Editor View Mode: 'draft' or 'live'
    window.setEditorViewMode = function(mode) {
      const isDraftMode = mode === 'draft';
      showingLive = !isDraftMode;
      const targetData = isDraftMode ? activeData : publishedData;

      const btnDraft = document.getElementById('btnSelectDraft');
      const btnLive = document.getElementById('btnSelectLive');
      const saveDraftBtn = document.getElementById('saveDraftBtn');
      const discardDraftBtn = document.getElementById('discardDraftBtn');

      if (btnDraft && btnLive) {
        if (isDraftMode) {
          btnDraft.style.background = '#451a03';
          btnDraft.style.borderColor = '#d97706';
          btnDraft.style.color = '#fb923c';
          btnDraft.style.fontWeight = '700';

          btnLive.style.background = 'transparent';
          btnLive.style.borderColor = 'transparent';
          btnLive.style.color = '#94a3b8';
          btnLive.style.fontWeight = '500';

          if (discardDraftBtn) {
            discardDraftBtn.disabled = false;
            discardDraftBtn.style.opacity = '1';
            discardDraftBtn.style.cursor = 'pointer';
            discardDraftBtn.title = 'Discard all working draft changes';
          }
        } else {
          btnLive.style.background = '#064e3b';
          btnLive.style.borderColor = '#059669';
          btnLive.style.color = '#34d399';
          btnLive.style.fontWeight = '700';

          btnDraft.style.background = 'transparent';
          btnDraft.style.borderColor = 'transparent';
          btnDraft.style.color = '#94a3b8';
          btnDraft.style.fontWeight = '500';

          // Disable draft operations while in live published mode
          if (saveDraftBtn) {
            saveDraftBtn.disabled = true;
            saveDraftBtn.style.opacity = '0.35';
            saveDraftBtn.style.cursor = 'not-allowed';
            saveDraftBtn.title = 'Switch back to Working Draft view to edit and save draft changes';
          }
          if (discardDraftBtn) {
            discardDraftBtn.disabled = true;
            discardDraftBtn.style.opacity = '0.35';
            discardDraftBtn.style.cursor = 'not-allowed';
            discardDraftBtn.title = 'Switch back to Working Draft view to discard draft';
          }
        }
      }

      for (const fieldName of Object.keys(targetData)) {
        const val = targetData[fieldName] !== undefined ? targetData[fieldName] : '';
        if (toastEditors[fieldName]) {
          try { toastEditors[fieldName].setMarkdown(val); } catch (e) {}
        }
        const trix = document.querySelector('trix-editor[input="' + fieldName + '_trix_input"]');
        if (trix && trix.editor) {
          try { trix.editor.loadHTML(val); } catch (e) {}
        }
        const input = document.getElementById(fieldName) || document.querySelector('[name="' + fieldName + '"]');
        if (input) {
          input.value = typeof val === 'object' ? JSON.stringify(val, null, 2) : val;
        }
        const hidden = document.getElementById(fieldName + '_hidden');
        if (hidden) hidden.value = val;
        const raw = document.getElementById(fieldName + '_raw_textarea');
        if (raw) raw.value = val;
      }

      initialFormValues = captureFormValues();
      if (typeof window.updateDraftButtonState === 'function') {
        window.updateDraftButtonState();
      }
    };

    // 5. Delete Document
    window.deleteCurrentDocument = async function() {
      const confirmed = confirm('Are you sure you want to permanently delete this document (' + docId + ')?');
      if (!confirmed) return;

      try {
        const res = await fetch('/items/' + collection + '/' + encodeURIComponent(docId), {
          method: 'DELETE',
          headers: getStudioHeaders()
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
    window.openEditorMediaModal = function(fieldName, format) {
      activeEditorMediaTarget = { fieldName: fieldName, format: format || 'markdown' };
      activeMediaTargetField = null;
      window.openMediaModal(fieldName);
    };

    window.openMediaModal = async function(fieldName) {
      if (!activeEditorMediaTarget) {
        activeMediaTargetField = fieldName;
      }
      const modal = document.getElementById('mediaModal');
      if (modal) modal.style.display = 'flex';

      if (cachedMedia.length === 0) {
        try {
          const res = await fetch('/files', { headers: getStudioHeaders() });
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
      activeEditorMediaTarget = null;
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

        const isImg = (m.type || m.mime_type || '').indexOf('image/') === 0 || /\.(jpg|jpeg|png|webp|svg|gif)$/i.test(m.key || '');
        const assetUrl = m.url || ('/media/' + m.key);
        const displayName = m.filename || m.key;

        if (isImg) {
          const imgEl = document.createElement('img');
          imgEl.src = '/media/' + m.key;
          imgEl.alt = displayName;
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
        nameEl.innerText = displayName;
        itemEl.appendChild(nameEl);

        if (activeEditorMediaTarget) {
          const actionsEl = document.createElement('div');
          actionsEl.className = 'modal-media-actions';

          const btnInsert = document.createElement('button');
          btnInsert.type = 'button';
          btnInsert.className = 'btn-modal-action';
          btnInsert.title = 'Insert image into content';
          btnInsert.innerText = isImg ? '🖼️ Image' : '📄 Insert';
          btnInsert.onclick = function(e) {
            e.stopPropagation();
            window.insertEditorMedia(assetUrl, displayName, false);
          };
          actionsEl.appendChild(btnInsert);

          const btnLink = document.createElement('button');
          btnLink.type = 'button';
          btnLink.className = 'btn-modal-action';
          btnLink.title = 'Insert link to asset';
          btnLink.innerText = '🔗 Link';
          btnLink.onclick = function(e) {
            e.stopPropagation();
            window.insertEditorMedia(assetUrl, displayName, true);
          };
          actionsEl.appendChild(btnLink);

          const btnCopy = document.createElement('button');
          btnCopy.type = 'button';
          btnCopy.className = 'btn-modal-action';
          btnCopy.title = 'Copy URL to clipboard';
          btnCopy.innerText = '📋';
          btnCopy.onclick = function(e) {
            e.stopPropagation();
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(assetUrl).then(function() {
                btnCopy.innerText = '✓';
                setTimeout(function() { btnCopy.innerText = '📋'; }, 1500);
              });
            }
          };
          actionsEl.appendChild(btnCopy);

          itemEl.appendChild(actionsEl);

          itemEl.addEventListener('click', function() {
            window.insertEditorMedia(assetUrl, displayName, false);
          });
        } else {
          itemEl.addEventListener('click', function() {
            window.selectMediaAsset(assetUrl);
          });
        }

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
      if (activeEditorMediaTarget) {
        window.insertEditorMedia(url, '', false);
        return;
      }
      if (!activeMediaTargetField) return;
      const input = document.getElementById(activeMediaTargetField + '_input');
      if (input) {
        input.value = url;
        window.updateThumbnailPreview(activeMediaTargetField, url);
      }
      window.closeMediaModal();
    };

    window.insertEditorMedia = function(url, filename, asLink) {
      if (!activeEditorMediaTarget) return;
      const targetField = activeEditorMediaTarget.fieldName;
      const format = activeEditorMediaTarget.format;

      const mdTextarea = document.getElementById(targetField + '_md_textarea');
      const rawTextarea = document.getElementById(targetField + '_raw_textarea');

      const activeTa = (mdTextarea && mdTextarea.offsetParent !== null) ? mdTextarea : rawTextarea;

      if (format === 'markdown' || (activeTa && activeTa.offsetParent !== null)) {
        if (activeTa) {
          activeTa.focus();
          const start = activeTa.selectionStart || 0;
          const end = activeTa.selectionEnd || 0;
          const selected = activeTa.value.slice(start, end) || filename || 'image';
          const snippet = asLink
            ? ('[' + selected + '](' + url + ')')
            : ('![' + selected + '](' + url + ')');

          let success = false;
          try {
            success = document.execCommand('insertText', false, snippet);
          } catch (e) { success = false; }
          if (!success) {
            activeTa.setRangeText(snippet, start, end, 'select');
          }
          activeTa.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } else if (format === 'html' || pellEditors[targetField]) {
        if (pellEditors[targetField] && pellEditors[targetField].content) {
          pellEditors[targetField].content.focus();
          if (asLink) {
            document.execCommand('createLink', false, url);
          } else {
            document.execCommand('insertImage', false, url);
          }
          pellEditors[targetField].content.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }

      if (typeof window.updateDraftButtonState === 'function') {
        window.updateDraftButtonState();
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
        const res = await fetch('/files', { method: 'POST', headers: getStudioHeaders(), body: formData });
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
        const res = await fetch('/files', { method: 'POST', headers: getStudioHeaders(), body: formData });
        if (res.ok) {
          const json = await res.json();
          const fileUrl = json.data && json.data.url ? json.data.url : ('/media/' + json.data.key);
          cachedMedia = [];
          if (activeEditorMediaTarget) {
            window.insertEditorMedia(fileUrl, file.name, false);
          } else {
            window.selectMediaAsset(fileUrl);
          }
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
      <div class="actions" style="display: flex; align-items: center; gap: 8px;">
        <a href="/admin/content/${collection}" class="btn btn-secondary">Cancel</a>
        <button type="button" id="publishBtn" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 4px;">
          💾 Save
        </button>
      </div>
    </div>

    ${hasDraft ? html`
      <div class="card draft-banner-card" style="background: #1c1308; border: 1px solid #d97706; border-radius: 8px; padding: 12px 18px; margin-bottom: 20px; box-shadow: 0 4px 16px rgba(217, 119, 6, 0.15);">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;">
          <div style="display: flex; gap: 12px; align-items: center;">
            <span style="font-size: 20px; line-height: 1;">📝</span>
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <strong style="color: #fb923c; font-size: 14px;">Working Draft Active (${doc.draft_status.toUpperCase()})</strong>
                <span style="background: #451a03; border: 1px solid #d97706; color: #fb923c; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px;">
                  ${modifiedFieldNames.length} modified
                </span>
                <span title="Uncommitted working draft changes are visible in Staging / In-Situ assist mode, but not live on production. The fields below reflect your active working copy." style="cursor: help; color: #a1a1aa; font-size: 14px; display: inline-flex; align-items: center; background: rgba(255,255,255,0.08); width: 18px; height: 18px; border-radius: 50%; justify-content: center;" aria-label="Draft info">ⓘ</span>
              </div>
              ${doc.draft_updated_at ? html`
                <div style="font-size: 11px; color: #a1a1aa; margin-top: 2px;">
                  Draft saved: <strong>${new Date(doc.draft_updated_at).toLocaleString()}</strong>
                </div>
              ` : ''}
            </div>
          </div>
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <!-- Segmented View Switch (Fixed captions, zero guesswork) -->
            <div class="sw-segmented-switch" style="display: inline-flex; background: #090d16; border: 1px solid #334155; border-radius: 6px; padding: 2px; gap: 2px;">
              <button
                type="button"
                id="btnSelectDraft"
                class="sw-segment-opt active"
                style="padding: 4px 10px; font-size: 12px; font-weight: 700; border-radius: 4px; border: 1px solid #d97706; background: #451a03; color: #fb923c; cursor: pointer; transition: all 0.15s ease;"
                onclick="window.setEditorViewMode('draft')"
              >
                ✏️ Working Draft
              </button>
              <button
                type="button"
                id="btnSelectLive"
                class="sw-segment-opt"
                style="padding: 4px 10px; font-size: 12px; font-weight: 500; border-radius: 4px; border: 1px solid transparent; background: transparent; color: #94a3b8; cursor: pointer; transition: all 0.15s ease;"
                onclick="window.setEditorViewMode('live')"
              >
                🌐 Live Published
              </button>
            </div>
            <!-- All draft operations co-located here -->
            <button
              type="button"
              id="saveDraftBtn"
              class="btn"
              disabled
              title="No fields have been modified yet"
              style="background: #451a03; border: 1px solid #d97706; color: #fb923c; font-weight: 700; font-size: 12px; padding: 5px 12px; display: inline-flex; align-items: center; gap: 4px; transition: all 0.15s ease; opacity: 0.35; cursor: not-allowed;"
            >
              💾 Save as Draft
            </button>
            <button
              type="button"
              id="discardDraftBtn"
              class="btn btn-danger-outline"
              style="font-size: 12px; padding: 5px 10px; transition: all 0.15s ease;"
              onclick="window.discardWorkingDraft()"
            >
              ✕ Discard Draft
            </button>
          </div>
        </div>
      </div>
    ` : (!isNew ? html`
      <div class="card" style="background: rgba(24, 24, 27, 0.4); border: 1px solid #27272a; border-radius: 8px; padding: 10px 16px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
        <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-muted);">
          <span style="color: #10b981;">✓</span>
          <span>In sync with live published copy.</span>
          <span title="You can save a working draft to preview changes in Staging without touching live production." style="cursor: help; color: #a1a1aa; font-size: 14px; display: inline-flex; align-items: center; background: rgba(255,255,255,0.08); width: 18px; height: 18px; border-radius: 50%; justify-content: center;" aria-label="Info">ⓘ</span>
        </div>
        <div>
          <button
            type="button"
            id="saveDraftBtn"
            class="btn"
            disabled
            title="No fields have been modified yet"
            style="background: #451a03; border: 1px solid #d97706; color: #fb923c; font-weight: 700; font-size: 12px; padding: 4px 10px; display: inline-flex; align-items: center; gap: 4px; opacity: 0.35; cursor: not-allowed;"
          >
            💾 Save as Draft
          </button>
        </div>
      </div>
    ` : '')}

    <form id="editorForm" class="editor-grid">
      <div class="main-column card">
        <div class="form-group">
          <label for="title">${titleLabel} *</label>
          <input type="text" id="title" name="title" value="${activeData.title || doc.title || ''}" class="input-text" required placeholder="${titlePlaceholder}" />
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
          <input type="text" id="slug" name="slug" value="${activeData.slug || doc.slug || ''}" class="input-text" required placeholder="url-friendly-slug" style="font-family: monospace;" />
        </div>

        <!-- Dynamic / Schema-Driven Custom Fields with Draft Intelligence -->
        ${fields
          .filter((f) => !['id', 'collection', 'slug', 'title', 'status', 'created_at', 'updated_at'].includes(f.name))
          .map((f) => {
            const isMod = modifiedFieldNames.includes(f.name);
            return renderFieldWidget(f, activeData[f.name], {
              isModified: isMod,
              publishedValue: publishedData[f.name],
              draftValue: draftData[f.name],
            }, editorConfig);
          })}
      </div>

      <div class="sidebar-column">
        <div class="card">
          <h3>Publishing & Status</h3>
          <div class="form-group" style="margin-top: 12px;">
            <label for="status" style="display: flex; align-items: center;">
              Document Status
              ${renderInfoBubble('Draft documents are rendered live in frontend preview mode (slotwire_preview=true) but excluded from production.', 'quickstart-querying')}
            </label>
            <select id="status" name="status" class="input-select">
              <option value="draft" ${!isNew && doc.status === 'draft' ? 'selected' : ''}>Draft</option>
              <option value="published" ${isNew || doc.status === 'published' ? 'selected' : ''}>Published</option>
              <option value="archived" ${!isNew && doc.status === 'archived' ? 'selected' : ''}>Archived</option>
            </select>
          </div>

          <hr class="divider" />
          <div class="meta-info">
            <p><strong>Model:</strong> <code>${modelIcon} ${collection}</code></p>
            <p><strong>Document ID:</strong> <code>${doc.id}</code></p>
            <p><strong>Draft State:</strong> 
              ${hasDraft ? html`
                <span class="badge" style="background: #451a03; border: 1px solid #d97706; color: #fb923c; font-weight: 700;">
                  ✏️ ${doc.draft_status.toUpperCase()}
                </span>
              ` : html`
                <span class="badge" style="color: #10b981; border-color: #059669; background: rgba(16, 185, 129, 0.1);">
                  ✓ Clean (In Sync)
                </span>
              `}
            </p>
            ${hasDraft && doc.draft_updated_at ? html`<p><strong>Draft Saved:</strong> ${new Date(doc.draft_updated_at).toLocaleString()}</p>` : ''}
            ${doc.updated_at ? html`<p><strong>Live Updated:</strong> ${new Date(doc.updated_at).toLocaleString()}</p>` : ''}
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
          <h3 style="display: flex; align-items: center;">
            SlotWire In-Situ Bridge
            ${renderInfoBubble('Direct visual bridge connecting frontend SlotWire badges to this exact document editor.', 'quickstart-querying')}
          </h3>
          <p style="font-size: 13px; color: var(--text-muted); margin-top: 6px; line-height: 1.4;">
            Changes saved as draft are instantly accessible in Astro Staging and In-Situ preview mode.
          </p>
        </div>
      </div>
    </form>

    <!-- Visual R2 Media Browser Modal -->
    ${renderMediaModal()}

    <script>
      ${raw(clientScript)}
    </script>
  `, editorConfig);
}
