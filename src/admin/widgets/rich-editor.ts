import { html } from 'hono/html';

export interface EditorConfig {
  format?: 'markdown' | 'richtext';
  tier?: 'light' | 'heavy';
}

export function renderRichEditorWidget(
  field: { name: string; label: string; widget?: string },
  val: string,
  draftMeta?: { isModified?: boolean; publishedValue?: any; draftValue?: any },
  editorConfig?: EditorConfig
) {
  const isDraftModified = Boolean(draftMeta?.isModified);

  // Determine target format:
  // 1. Explicit widget takes precedence ('richtext', 'markdown', or 'textarea' / code)
  // 2. Otherwise falls back to global editorConfig.format (default 'markdown')
  const defaultGlobalFormat = editorConfig?.format || 'markdown';
  const format: 'markdown' | 'richtext' | 'code' =
    field.widget === 'richtext'
      ? 'richtext'
      : field.widget === 'textarea'
      ? 'code'
      : field.widget === 'markdown'
      ? 'markdown'
      : defaultGlobalFormat;

  const tier = editorConfig?.tier || 'light';

  // Option A (Clean 2-Tab Layout):
  // Tab 1: Primary active editor (Markdown or Rich Text)
  // Tab 2: Raw fallback (Raw Text or Raw HTML)
  const isCodeOnly = format === 'code';
  const primaryLabel = format === 'richtext' ? '⚡ Rich Text' : '📝 Markdown';
  const rawLabel = format === 'richtext' ? '🔤 Raw HTML' : '🔤 Raw Text';

  return html`
    <div class="form-group editor-container-wrapper" id="${field.name}_editor_container" data-field="${field.name}" data-format="${format}" data-tier="${tier}">
      <div class="editor-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <label style="margin-bottom: 0;">${field.label}</label>
          ${isDraftModified ? html`
            <span class="field-draft-badge" style="background: #451a03; color: #fb923c; border: 1px solid #d97706; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 700;">
              Draft Modified
            </span>
          ` : ''}
        </div>
        <div class="editor-header-actions">
          <div class="mode-switcher" id="${field.name}_edit_modes">
            ${!isCodeOnly ? html`
              <button type="button" class="mode-btn active" data-mode="primary" onclick="window.switchEditorMode('${field.name}', 'primary')">${primaryLabel}</button>
            ` : ''}
            <button type="button" class="mode-btn ${isCodeOnly ? 'active' : ''}" data-mode="code" onclick="window.switchEditorMode('${field.name}', 'code')">${rawLabel}</button>
          </div>
          <span class="editor-header-divider"></span>
          <button type="button" class="preview-toggle-btn" id="${field.name}_preview_btn" onclick="window.togglePreview('${field.name}')" title="Preview rendered output">
            <span>👁</span> Preview
          </button>
        </div>
      </div>

      <!-- Hidden synced input for form submission -->
      <input type="hidden" name="${field.name}" id="${field.name}_hidden" value="${val}" />

      ${!isCodeOnly ? html`
        <!-- Primary Editor Container -->
        <div class="primary-editor-wrapper" id="${field.name}_primary_target" style="display: block;">
          ${format === 'markdown' && tier === 'light' ? html`
            <!-- GitHub Markdown Toolbar + Textarea -->
            <markdown-toolbar for="${field.name}_md_textarea">
              <button type="button" data-md-action="bold" title="Bold (Cmd+B)">B</button>
              <button type="button" data-md-action="italic" title="Italic (Cmd+I)"><i>I</i></button>
              <button type="button" data-md-action="header" data-level="2" title="Heading 2">H2</button>
              <button type="button" data-md-action="header" data-level="3" title="Heading 3">H3</button>
              <span class="md-toolbar-divider"></span>
              <button type="button" data-md-action="link" title="Link (Cmd+K)">
                <svg aria-hidden="true" height="14" viewBox="0 0 16 16" version="1.1" width="14" fill="currentColor">
                  <path d="m7.775 3.275 1.25-1.25a3.5 3.5 0 1 1 4.95 4.95l-2.5 2.5a3.5 3.5 0 0 1-4.95 0 .751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018 1.998 1.998 0 0 0 2.83 0l2.5-2.5a2.002 2.002 0 0 0-2.83-2.83l-1.25 1.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042Zm-1.2 8.72a1.995 1.995 0 0 0 1.425.582 2.003 2.003 0 0 0 1.425-.582.75.75 0 0 1 1.06 1.06 3.5 3.5 0 0 1-4.95 0l-2.5-2.5a3.5 3.5 0 0 1 4.95-4.95l1.25 1.25a.75.75 0 0 1-1.06 1.06l-1.25-1.25a2 2 0 0 0-2.83 2.83l2.5 2.5Z"></path>
                </svg>
              </button>
              <button
                type="button"
                data-md-action="image"
                title="Insert Media from R2 (or Upload)"
                onclick="event.stopPropagation(); if (typeof window.openEditorMediaModal === 'function') { window.openEditorMediaModal('${field.name}', 'markdown'); }"
              >
                <svg aria-hidden="true" height="14" viewBox="0 0 16 16" version="1.1" width="14" fill="currentColor">
                  <path d="M1.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25H1.75ZM1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75Zm10.5 4.75a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm-7.25 5a.75.75 0 0 1-.53-1.28l2.5-2.5a.75.75 0 0 1 1.06 0l1.22 1.22 2.72-2.72a.75.75 0 0 1 1.06 0l2.5 2.5a.75.75 0 0 1-1.06 1.06L11.5 8.81l-2.72 2.72a.75.75 0 0 1-1.06 0L6.5 10.31l-1.72 1.72a.75.75 0 0 1-.53.22Z"></path>
                </svg>
              </button>
              <button type="button" data-md-action="quote" title="Quote">“</button>
              <button type="button" data-md-action="code" title="Code Block">&lt;/&gt;</button>
              <span class="md-toolbar-divider"></span>
              <button type="button" data-md-action="unordered-list" title="Bullet List">•≡</button>
              <button type="button" data-md-action="ordered-list" title="Numbered List">1≡</button>
            </markdown-toolbar>
            <textarea
              id="${field.name}_md_textarea"
              data-field="${field.name}"
              class="input-textarea md-toolbar-textarea"
              rows="10"
              oninput="const h = document.getElementById('${field.name}_hidden'); if (h) h.value = this.value; const r = document.getElementById('${field.name}_raw_textarea'); if (r) r.value = this.value; if (typeof window.updateDraftButtonState === 'function') window.updateDraftButtonState();"
            >${val}</textarea>
          ` : ''}

          ${format === 'markdown' && tier === 'heavy' ? html`
            <!-- Toast UI Markdown container -->
            <div class="toastui-editor-target" id="${field.name}_toast_target" data-field-name="${field.name}" data-initial-value="${val}" style="min-height: 280px;"></div>
          ` : ''}

          ${format === 'richtext' && tier === 'light' ? html`
            <!-- Pell WYSIWYG container -->
            <div class="pell-wrapper pell-editor-target" id="${field.name}_pell_target" data-field-name="${field.name}"></div>
          ` : ''}

          ${format === 'richtext' && tier === 'heavy' ? html`
            <!-- Trix Rich Text container -->
            <div class="trix-wrapper" id="${field.name}_trix_target">
              <input id="${field.name}_trix_input" type="hidden" value="${val}">
              <trix-editor input="${field.name}_trix_input" class="trix-editor-element" oninput="const h = document.getElementById('${field.name}_hidden'); if (h) h.value = this.value; const r = document.getElementById('${field.name}_raw_textarea'); if (r) r.value = this.value; if (typeof window.updateDraftButtonState === 'function') window.updateDraftButtonState();" ontrix-change="const h = document.getElementById('${field.name}_hidden'); if (h) h.value = this.value; const r = document.getElementById('${field.name}_raw_textarea'); if (r) r.value = this.value; if (typeof window.updateDraftButtonState === 'function') window.updateDraftButtonState();"></trix-editor>
            </div>
          ` : ''}
        </div>
      ` : ''}

      <!-- Raw Textarea Fallback (Always Present) -->
      <div class="raw-code-wrapper" id="${field.name}_code_target" style="display: ${isCodeOnly ? 'block' : 'none'};">
        <textarea
          id="${field.name}_raw_textarea"
          data-field="${field.name}"
          class="input-textarea raw-code-textarea"
          rows="10"
          style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; line-height: 1.6;"
          oninput="const h = document.getElementById('${field.name}_hidden'); if (h) h.value = this.value; if (typeof window.syncFromRawTextarea === 'function') window.syncFromRawTextarea('${field.name}', this.value); if (typeof window.updateDraftButtonState === 'function') window.updateDraftButtonState();"
        >${val}</textarea>
      </div>

      <!-- Live Rendered Preview Container (Toggled via Preview button) -->
      <div class="preview-wrapper" id="${field.name}_preview_target" style="display: none;">
        <div class="preview-content" id="${field.name}_preview_content"></div>
      </div>

      ${isDraftModified ? html`
        <div class="field-live-diff" style="font-size: 11px; color: #94a3b8; margin-top: 8px; background: #090d16; border: 1px dashed #334155; padding: 8px 12px; border-radius: 6px;">
          <div style="margin-bottom: 4px;">
            <span style="font-weight: 600; color: #cbd5e1;">Live Published Value:</span>
          </div>
          <div style="font-family: monospace; color: #94a3b8; white-space: pre-wrap; max-height: 90px; overflow-y: auto; line-height: 1.4;">${String(draftMeta?.publishedValue || '(empty)')}</div>
        </div>
      ` : ''}
    </div>
  `;
}
