import { html } from 'hono/html';
import { renderLayout } from '../layout.js';

export function renderMediaView(
  mediaFiles: any[],
  user: { email: string; authMethod?: string }
) {
  return renderLayout('Media Library — SlottD Studio', 'media', user, html`
    <div class="header">
      <div>
        <h1>Media & Assets (Cloudflare R2)</h1>
        <p class="subtitle">Preserves clean, descriptive filenames and streams directly from R2 with edge caching.</p>
      </div>
      <div>
        <label class="btn btn-primary" style="cursor: pointer;">
          + Upload Asset
          <input type="file" id="mediaUploadInput" style="display: none;" onchange="uploadStandaloneAsset(this)" />
        </label>
      </div>
    </div>

    <div class="media-grid">
      ${mediaFiles.length === 0 ? html`
        <div class="card empty-state" style="grid-column: 1 / -1;"><p>No media files found in R2 bucket.</p></div>
      ` : mediaFiles.map((m) => html`
        <div class="media-card">
          <div class="media-thumb-container">
            <img src="/media/${m.key}" alt="${m.filename}" loading="lazy" onerror="this.src='/admin/placeholder.svg'" />
          </div>
          <div class="media-card-info">
            <strong title="${m.filename}">${m.filename}</strong>
            <p class="media-key"><code>/media/${m.key}</code></p>
            <div class="media-card-footer">
              <span class="file-size">${Math.round(m.size / 1024)} KB</span>
              <button class="btn-copy" onclick="navigator.clipboard.writeText('/media/${m.key}'); this.innerText='Copied!'; setTimeout(()=>this.innerText='Copy URL', 1500)">Copy URL</button>
            </div>
          </div>
        </div>
      `)}
    </div>

    <script>
      async function uploadStandaloneAsset(input) {
        if (!input.files || input.files.length === 0) return;
        const file = input.files[0];
        const formData = new FormData();
        formData.append('file', file);

        try {
          const res = await fetch('/files', { method: 'POST', body: formData });
          if (res.ok) {
            window.location.reload();
          } else {
            alert('Upload failed: ' + (await res.text()));
          }
        } catch (e) {
          alert('Upload error: ' + e.message);
        }
      }
    </script>
  `);
}
