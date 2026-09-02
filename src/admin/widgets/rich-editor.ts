import { html } from 'hono/html';

export function renderRichEditorWidget(field: { name: string; label: string; widget?: string }, val: string) {
  const defaultMode = field.widget === 'richtext' ? 'richtext' : (field.widget === 'textarea' ? 'code' : 'markdown');

  return html`
    <div class="form-group editor-container-wrapper" id="${field.name}_editor_container" data-field="${field.name}">
      <div class="editor-header">
        <label>${field.label}</label>
        <div class="mode-switcher">
          <button type="button" class="mode-btn ${defaultMode === 'markdown' ? 'active' : ''}" data-mode="markdown" onclick="window.switchEditorMode('${field.name}', 'markdown')">📝 Markdown</button>
          <button type="button" class="mode-btn ${defaultMode === 'richtext' ? 'active' : ''}" data-mode="richtext" onclick="window.switchEditorMode('${field.name}', 'richtext')">⚡ Rich Text</button>
          <button type="button" class="mode-btn ${defaultMode === 'code' ? 'active' : ''}" data-mode="code" onclick="window.switchEditorMode('${field.name}', 'code')">🔤 Raw HTML</button>
        </div>
      </div>

      <!-- Hidden synced input for form submission -->
      <input type="hidden" name="${field.name}" id="${field.name}_hidden" value="${val}" />

      <!-- 1. Toast UI Markdown container -->
      <div class="toastui-editor-target" id="${field.name}_toast_target" data-field-name="${field.name}" data-initial-value="${val}" style="display: ${defaultMode === 'markdown' ? 'block' : 'none'}; min-height: 280px;"></div>

      <!-- 2. Trix Rich Text container -->
      <div class="trix-wrapper" id="${field.name}_trix_target" style="display: ${defaultMode === 'richtext' ? 'block' : 'none'};">
        <input id="${field.name}_trix_input" type="hidden" value="${val}">
        <trix-editor input="${field.name}_trix_input" class="trix-editor-element" oninput="const h = document.getElementById('${field.name}_hidden'); if (h) h.value = this.value;"></trix-editor>
      </div>

      <!-- 3. Raw Textarea fallback -->
      <div class="raw-code-wrapper" id="${field.name}_code_target" style="display: ${defaultMode === 'code' ? 'block' : 'none'};">
        <textarea
          class="input-textarea raw-code-textarea"
          rows="10"
          style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; line-height: 1.6;"
          oninput="const h = document.getElementById('${field.name}_hidden'); if (h) h.value = this.value;"
        >${val}</textarea>
      </div>
    </div>
  `;
}
