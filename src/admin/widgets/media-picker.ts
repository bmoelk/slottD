import { html } from 'hono/html';

export function renderMediaPickerWidget(field: { name: string; label: string }, val: string) {
  const hasValue = Boolean(val);

  return html`
    <div class="form-group">
      <label>${field.label}</label>
      
      <!-- Live Thumbnail Preview Card -->
      <div id="${field.name}_preview" class="media-preview-card" style="display: ${hasValue ? 'flex' : 'none'};">
        <img
          src="${val || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='1.5'%3E%3Crect x='3' y='3' width='18' height='18' rx='2'/%3E%3Ccircle cx='8.5' cy='8.5' r='1.5'/%3E%3Cpath d='m21 15-5-5L5 21'/%3E%3C/svg%3E"}"
          alt="${field.label}"
          onerror="this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'80\' height=\'80\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%2364748b\' stroke-width=\'1.5\'%3E%3Crect x=\'3\' y=\'3\' width=\'18\' height=\'18\' rx=\'2\'/%3E%3Ccircle cx=\'8.5\' cy=\'8.5\' r=\'1.5\'/%3E%3Cpath d=\'m21 15-5-5L5 21\'/%3E%3C/svg%3E';"
        />
        <div class="media-preview-details">
          <span class="media-preview-path">${val}</span>
          <div class="media-preview-actions">
            <button type="button" class="btn-text" onclick="window.openMediaModal('${field.name}')">Change</button>
            <button type="button" class="btn-text text-danger" onclick="document.getElementById('${field.name}_input').value=''; window.updateThumbnailPreview('${field.name}', '')">Remove</button>
          </div>
        </div>
      </div>

      <!-- Media Input Row -->
      <div class="media-input-row">
        <input
          type="text"
          id="${field.name}_input"
          name="${field.name}"
          value="${val}"
          class="input-text"
          placeholder="/media/hero-banner.png or https://..."
          oninput="window.updateThumbnailPreview('${field.name}', this.value)"
        />
        <button type="button" class="btn btn-secondary" onclick="window.openMediaModal('${field.name}')">Browse R2</button>
        <label class="btn btn-secondary" style="cursor: pointer;">
          Upload
          <input type="file" style="display: none;" onchange="window.uploadFieldAsset(this, '${field.name}')" />
        </label>
      </div>
    </div>
  `;
}

export function renderMediaModal() {
  return html`
    <div id="mediaModal" class="modal-backdrop" style="display: none;" onclick="if (event.target === this) window.closeMediaModal()">
      <div class="modal-dialog">
        <div class="modal-header">
          <h3>Select Asset from Cloudflare R2</h3>
          <button type="button" class="btn-close" onclick="window.closeMediaModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="modal-actions">
            <input type="text" id="mediaSearchInput" class="input-text" placeholder="Search filename..." oninput="window.filterMediaModal(this.value)" />
            <label class="btn btn-secondary" style="cursor: pointer; white-space: nowrap;">
              + Upload File
              <input type="file" style="display: none;" onchange="window.uploadModalAsset(this)" />
            </label>
          </div>
          <div id="modalMediaGrid" class="modal-media-grid">
            <!-- Populated dynamically via client JS -->
          </div>
        </div>
      </div>
    </div>
  `;
}
