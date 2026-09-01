import { html } from 'hono/html';
import { renderRichEditorWidget } from './rich-editor.js';
import { renderMediaPickerWidget } from './media-picker.js';

export function renderFieldWidget(field: any, value: any) {
  const val = value ?? '';
  const lowerName = (field.name || '').toLowerCase();
  const isBodyOrLongText =
    field.widget === 'markdown' ||
    field.widget === 'richtext' ||
    field.widget === 'textarea' ||
    lowerName === 'content' ||
    lowerName === 'body' ||
    lowerName === 'description' ||
    lowerName === 'quote' ||
    lowerName === 'excerpt' ||
    lowerName === 'bio' ||
    lowerName === 'summary';

  // 1. Long-form Text & Content Fields -> 3-Way Mode Switcher
  if (isBodyOrLongText) {
    return renderRichEditorWidget(field, String(val));
  }

  // 2. Media Fields -> Live Preview Card & R2 Modal Browser
  if (
    field.widget === 'media' ||
    lowerName.includes('image') ||
    lowerName.includes('avatar') ||
    lowerName.includes('cover') ||
    lowerName.includes('photo')
  ) {
    return renderMediaPickerWidget(field, String(val));
  }

  // 3. Select Dropdowns
  if (field.widget === 'select' && field.options) {
    return html`
      <div class="form-group">
        <label for="${field.name}">${field.label}</label>
        <select id="${field.name}" name="${field.name}" class="input-select">
          ${field.options.map((opt: any) => html`
            <option value="${opt.value}" ${String(val) === String(opt.value) ? 'selected' : ''}>${opt.label}</option>
          `)}
        </select>
      </div>
    `;
  }

  // 4. Repeaters / Composite JSON Objects
  if (field.widget === 'repeater' || field.widget === 'object') {
    const jsonStr = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val || '[]');
    return html`
      <div class="form-group">
        <label>${field.label} (Composite JSON)</label>
        <textarea name="${field.name}" class="input-textarea repeater-input" rows="5">${jsonStr}</textarea>
      </div>
    `;
  }

  // 5. Default Text / Number Input
  return html`
    <div class="form-group">
      <label for="${field.name}">${field.label}</label>
      <input type="text" id="${field.name}" name="${field.name}" value="${val}" class="input-text" />
    </div>
  `;
}
