import { html } from 'hono/html';

export function renderRichEditorWidget(field: { name: string; label: string; widget?: string }, val: string) {
  const defaultMode = field.widget === 'richtext' ? 'trix' : (field.widget === 'textarea' ? 'raw' : 'toast');

  return html`
    <div class="form-group editor-container-wrapper" data-field="${field.name}" data-initial="${val}" data-default-mode="${defaultMode}">
      <div class="editor-header">
        <label>${field.label}</label>
        <div class="mode-switcher">
          <button type="button" class="mode-btn ${defaultMode === 'toast' ? 'active' : ''}" data-mode="toast" onclick="switchEditorMode('${field.name}', 'toast', this)">📝 Markdown</button>
          <button type="button" class="mode-btn ${defaultMode === 'trix' ? 'active' : ''}" data-mode="trix" onclick="switchEditorMode('${field.name}', 'trix', this)">⚡ Rich Text</button>
          <button type="button" class="mode-btn ${defaultMode === 'raw' ? 'active' : ''}" data-mode="raw" onclick="switchEditorMode('${field.name}', 'raw', this)">🔤 Raw</button>
        </div>
      </div>

      <input type="hidden" name="${field.name}" id="${field.name}_hidden" class="editor-payload-input" value="${val}" />

      <!-- Toast-UI Markdown Container -->
      <div class="toast-container" style="display: ${defaultMode === 'toast' ? 'block' : 'none'}; min-height: 280px;"></div>

      <!-- Trix Rich Text Container -->
      <div class="trix-wrapper" style="display: ${defaultMode === 'trix' ? 'block' : 'none'};">
        <input id="${field.name}_trix_input" type="hidden" value="${val}">
        <trix-editor input="${field.name}_trix_input" oninput="document.getElementById('${field.name}_hidden').value = this.value"></trix-editor>
      </div>

      <!-- Raw Textarea Container (Rock-Solid Pure HTML Default) -->
      <textarea
        class="input-textarea raw-textarea"
        rows="10"
        style="display: ${defaultMode === 'raw' ? 'block' : 'none'}; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; line-height: 1.6;"
        oninput="document.getElementById('${field.name}_hidden').value = this.value"
      >${val}</textarea>
    </div>
  `;
}
