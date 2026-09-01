import { html } from 'hono/html';

export function renderMediaPickerWidget(field: { name: string; label: string }, val: string) {
  const hasValue = Boolean(val);

  return html`
    <div class="form-group">
      <label>${field.label}</label>
      
      <!-- Live Thumbnail Preview Card -->
      <div id="${field.name}_preview" class="media-preview-card" style="display: ${hasValue ? 'flex' : 'none'};">
        <img src="${val}" alt="${field.label}" onerror="this.src='/admin/placeholder.svg'" />
        <div class="media-preview-details">
          <span class="media-preview-path">${val}</span>
          <div class="media-preview-actions">
            <button type="button" class="btn-text" onclick="openMediaModal('${field.name}')">Change</button>
            <button type="button" class="btn-text text-danger" onclick="document.getElementById('${field.name}_input').value=''; updateThumbnailPreview('${field.name}', '')">Remove</button>
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
          oninput="updateThumbnailPreview('${field.name}', this.value)"
        />
        <button type="button" class="btn btn-secondary" onclick="openMediaModal('${field.name}')">Browse R2</button>
        <label class="btn btn-secondary" style="cursor: pointer;">
          Upload
          <input type="file" style="display: none;" onchange="uploadFieldAsset(this, '${field.name}')" />
        </label>
      </div>
    </div>
  `;
}

export function renderMediaModal() {
  return html`
    <div id="mediaModal" class="modal-backdrop" style="display: none;">
      <div class="modal-dialog">
        <div class="modal-header">
          <h3>Select Asset from Cloudflare R2</h3>
          <button type="button" class="btn-close" onclick="closeMediaModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="modal-actions">
            <input type="text" id="mediaSearchInput" class="input-text" placeholder="Search filename..." oninput="filterMediaModal(this.value)" />
            <label class="btn btn-secondary" style="cursor: pointer; white-space: nowrap;">
              + Upload File
              <input type="file" style="display: none;" onchange="uploadModalAsset(this)" />
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
