import { html } from 'hono/html';
import { renderRichEditorWidget } from './rich-editor.js';
import { renderMediaPickerWidget } from './media-picker.js';

export function renderFieldWidget(
  field: any,
  value: any,
  draftMeta?: { isModified?: boolean; publishedValue?: any; draftValue?: any }
) {
  const val = value ?? '';
  const isDraftModified = Boolean(draftMeta?.isModified);
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
    return renderRichEditorWidget(field, String(val), draftMeta);
  }

  // 2. Media Fields -> Live Preview Card & R2 Modal Browser
  if (
    field.widget === 'media' ||
    lowerName.includes('image') ||
    lowerName.includes('avatar') ||
    lowerName.includes('cover') ||
    lowerName.includes('photo')
  ) {
    return html`
      <div class="field-wrapper">
        ${isDraftModified ? html`
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
            <span class="field-draft-badge" style="background: #451a03; color: #fb923c; border: 1px solid #d97706; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 700;">
              Draft Modified
            </span>
          </div>
        ` : ''}
        ${renderMediaPickerWidget(field, String(val))}
        ${isDraftModified ? html`
          <div style="font-size: 11px; color: #94a3b8; margin-top: -6px; margin-bottom: 12px;">
            Live Published Asset: <code style="color: #cbd5e1; background: #090d16; padding: 2px 6px; border-radius: 4px; font-family: monospace;">${String(draftMeta?.publishedValue || '(empty)')}</code>
          </div>
        ` : ''}
      </div>
    `;
  }

  // 3. Select Dropdowns
  if (field.widget === 'select' && field.options) {
    return html`
      <div class="form-group">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
          <label for="${field.name}" style="margin-bottom: 0;">${field.label}</label>
          ${isDraftModified ? html`
            <span class="field-draft-badge" style="background: #451a03; color: #fb923c; border: 1px solid #d97706; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 700;">
              Draft Modified
            </span>
          ` : ''}
        </div>
        <select id="${field.name}" name="${field.name}" class="input-select">
          ${field.options.map((opt: any) => html`
            <option value="${opt.value}" ${String(val) === String(opt.value) ? 'selected' : ''}>${opt.label}</option>
          `)}
        </select>
        ${isDraftModified ? html`
          <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">
            Live Published: <code style="color: #cbd5e1; background: #090d16; padding: 2px 6px; border-radius: 4px; font-family: monospace;">${String(draftMeta?.publishedValue ?? '(empty)')}</code>
          </div>
        ` : ''}
      </div>
    `;
  }

  // 4. Repeaters / Composite JSON Objects
  if (field.widget === 'repeater' || field.widget === 'object') {
    const jsonStr = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val || '[]');
    return html`
      <div class="form-group">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
          <label style="margin-bottom: 0;">${field.label} (Composite JSON)</label>
          ${isDraftModified ? html`
            <span class="field-draft-badge" style="background: #451a03; color: #fb923c; border: 1px solid #d97706; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 700;">
              Draft Modified
            </span>
          ` : ''}
        </div>
        <textarea id="${field.name}" name="${field.name}" class="input-textarea repeater-input" rows="5">${jsonStr}</textarea>
        ${isDraftModified ? html`
          <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">
            Live Published: <code style="color: #cbd5e1; background: #090d16; padding: 2px 6px; border-radius: 4px; font-family: monospace;">${typeof draftMeta?.publishedValue === 'object' ? JSON.stringify(draftMeta?.publishedValue) : String(draftMeta?.publishedValue ?? '(empty)')}</code>
          </div>
        ` : ''}
      </div>
    `;
  }

  // 5. Default Text / Number Input
  return html`
    <div class="form-group">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
        <label for="${field.name}" style="margin-bottom: 0;">${field.label}</label>
        ${isDraftModified ? html`
          <span class="field-draft-badge" style="background: #451a03; color: #fb923c; border: 1px solid #d97706; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 700;">
            Draft Modified
          </span>
        ` : ''}
      </div>
      <input type="text" id="${field.name}" name="${field.name}" value="${val}" class="input-text" />
      ${isDraftModified ? html`
        <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">
          Live Published: <code style="color: #cbd5e1; background: #090d16; padding: 2px 6px; border-radius: 4px; font-family: monospace;">${String(draftMeta?.publishedValue ?? '(empty)')}</code>
        </div>
      ` : ''}
    </div>
  `;
}
