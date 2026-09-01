import { Hono } from 'hono';
import { html } from 'hono/html';
import { createDb } from '../db/client.js';
import { introspectCollectionFields } from '../api/views.js';
import type { Env } from '../types.js';

export const adminRouter = new Hono<{ Bindings: Env }>();

// 1. Dashboard: Collections List
adminRouter.get('/', async (c) => {
  const db = createDb(c.env.DB);
  let collectionsList: { name: string; display_name?: string; icon?: string | null; pack_name?: string; pack_author?: string | null }[] = [];

  try {
    const metas = await db.selectFrom('collections').selectAll().execute();
    if (metas.length > 0) {
      collectionsList = metas.map((m) => ({
        name: m.name,
        display_name: m.display_name,
        icon: m.icon,
        pack_name: m.pack_name,
        pack_author: m.pack_author,
      }));
    }
  } catch {}

  if (collectionsList.length === 0) {
    const collectionsResult = await db
      .selectFrom('documents')
      .select('collection')
      .distinct()
      .execute();
    collectionsList = collectionsResult.map((r) => ({ name: r.collection, display_name: r.collection }));
  }

  return c.html(renderLayout('SlottD Studio', html`
    <div class="header">
      <div class="brand">
        <svg class="logo" viewBox="0 0 512 512" width="32" height="32">
          <rect width="512" height="512" rx="96" fill="#1e293b"/>
          <path d="M 160 128 H 210 V 384 H 160 Z" fill="#FFD043"/>
          <path d="M 218 128 H 304 C 364 128 408 172 408 232 H 344 C 344 198 320 184 296 184 H 218 Z" fill="#FF8A00"/>
          <path d="M 218 328 H 296 C 320 328 344 314 344 280 H 408 C 408 340 364 384 304 384 H 218 Z" fill="#FFD043"/>
          <rect x="200" y="244" width="112" height="24" rx="4" fill="#FFE082"/>
        </svg>
        <h1>SlottD Studio</h1>
      </div>
      <span class="badge">Edge Runtime (D1)</span>
    </div>

    <div class="card">
      <h2>Collections & Model Packs</h2>
      <p class="subtitle">Select a collection to manage records, preview drafts, or release content.</p>
      
      <div class="collection-grid">
        ${collectionsList.length === 0 ? html`
          <div class="empty-state">
            <p>No collections found yet.</p>
            <p>Register collections via <code>slottd.config.ts</code> or run a migration.</p>
          </div>
        ` : collectionsList.map((col) => html`
          <a href="/admin/content/${col.name}" class="collection-item">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span>${col.icon || '📁'}</span>
              <div>
                <strong style="display: block; color: var(--text);">${col.display_name || col.name}</strong>
                ${col.pack_name ? html`<small style="color: var(--muted); font-size: 11px;">${col.pack_name}${col.pack_author ? ` (${col.pack_author})` : ''}</small>` : ''}
              </div>
            </div>
            <span class="col-arrow">→</span>
          </a>
        `)}
      </div>
    </div>
  `));
});

// 2. Collection Item List (SlotWire List View Target)
adminRouter.get('/content/:collection', async (c) => {
  const collection = c.req.param('collection');
  const db = createDb(c.env.DB);

  const items = await db
    .selectFrom('documents')
    .where('collection', '=', collection)
    .selectAll()
    .orderBy('updated_at', 'desc')
    .execute();

  return c.html(renderLayout(`${collection} — SlottD`, html`
    <div class="header">
      <div class="breadcrumbs">
        <a href="/admin">Collections</a>
        <span>/</span>
        <span class="current">${collection}</span>
      </div>
      <a href="/admin/content/${collection}/+" class="btn btn-primary">+ New ${collection.slice(0, -1) || 'Record'}</a>
    </div>

    <div class="card">
      <table class="table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Slug</th>
            <th>Status</th>
            <th>Last Updated</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${items.length === 0 ? html`
            <tr>
              <td colspan="5" class="empty-cell">No records in this collection yet.</td>
            </tr>
          ` : items.map((item) => html`
            <tr>
              <td><strong><a href="/admin/content/${collection}/${item.id}">${item.title}</a></strong></td>
              <td><code>${item.slug}</code></td>
              <td><span class="status-pill status-${item.status}">${item.status}</span></td>
              <td>${new Date(item.updated_at).toLocaleString()}</td>
              <td>
                <a href="/admin/content/${collection}/${item.id}" class="btn-link">Edit</a>
              </td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>
  `));
});

// 3. Single Document Editor (SlotWire Deep Link Target)
adminRouter.get('/content/:collection/:id', async (c) => {
  const collection = c.req.param('collection');
  const idOrSlug = c.req.param('id');
  const isNew = idOrSlug === '+';
  const db = createDb(c.env.DB);

  let doc: any = {
    id: isNew ? crypto.randomUUID() : '',
    collection,
    slug: '',
    title: '',
    status: 'draft',
    data: '{}',
  };

  if (!isNew) {
    const existing = await db
      .selectFrom('documents')
      .where('collection', '=', collection)
      .where((eb) => eb.or([eb('id', '=', idOrSlug), eb('slug', '=', idOrSlug)]))
      .selectAll()
      .executeTakeFirst();

    if (existing) {
      doc = existing;
    }
  }

  let customData: Record<string, any> = {};
  try {
    customData = typeof doc.data === 'string' ? JSON.parse(doc.data) : doc.data;
  } catch {}

  const fields = await introspectCollectionFields(db, collection);

  return c.html(renderLayout(isNew ? `New ${collection}` : `Edit: ${doc.title || collection}`, html`
    <div class="header">
      <div class="breadcrumbs">
        <a href="/admin">Collections</a>
        <span>/</span>
        <a href="/admin/content/${collection}">${collection}</a>
        <span>/</span>
        <span class="current">${isNew ? 'New Item' : doc.title || doc.slug}</span>
      </div>
      <div class="actions">
        <a href="/admin/content/${collection}" class="btn btn-secondary">Cancel</a>
        <button id="saveBtn" class="btn btn-primary">Save Changes</button>
      </div>
    </div>

    <form id="editorForm" class="editor-grid">
      <div class="main-column card">
        <div class="form-group">
          <label for="title">Title *</label>
          <input type="text" id="title" name="title" value="${doc.title}" class="input-text" required placeholder="Document Title..." />
        </div>

        <div class="form-group">
          <label for="slug">Slug *</label>
          <input type="text" id="slug" name="slug" value="${doc.slug}" class="input-text" required placeholder="url-friendly-slug" />
        </div>

        <!-- Custom / Dynamic Fields -->
        ${fields
          .filter((f) => !['id', 'collection', 'slug', 'title', 'status', 'created_at', 'updated_at'].includes(f.name))
          .map((f) => renderFieldWidget(f, customData[f.name]))}
      </div>

      <div class="sidebar-column card">
        <h3>Publishing</h3>
        <div class="form-group">
          <label for="status">Status</label>
          <select id="status" name="status" class="input-select">
            <option value="draft" ${doc.status === 'draft' ? 'selected' : ''}>Draft</option>
            <option value="published" ${doc.status === 'published' ? 'selected' : ''}>Published</option>
            <option value="archived" ${doc.status === 'archived' ? 'selected' : ''}>Archived</option>
          </select>
        </div>

        <hr/>
        <div class="meta-info">
          <p><strong>Collection:</strong> ${collection}</p>
          <p><strong>Document ID:</strong> <code>${doc.id}</code></p>
        </div>
      </div>
    </form>

    <!-- Toast UI & Trix Script Injections -->
    <link rel="stylesheet" href="https://uicdn.toast.com/editor/latest/toastui-editor.min.css" />
    <script src="https://uicdn.toast.com/editor/latest/toastui-editor-all.min.js"></script>
    <link rel="stylesheet" href="https://unpkg.com/trix@2.0.8/dist/trix.css" />
    <script src="https://unpkg.com/trix@2.0.8/dist/trix.umd.min.js"></script>

    <script>
      const isNew = ${isNew};
      const collection = "${collection}";
      const docId = "${doc.id}";
      const editors = {};

      // Initialize Toast-UI Markdown editors
      document.querySelectorAll('.markdown-editor-container').forEach(el => {
        const fieldName = el.dataset.field;
        const initialValue = el.dataset.initial || '';
        editors[fieldName] = new toastui.Editor({
          el: el,
          height: '400px',
          initialEditType: 'markdown',
          previewStyle: 'tab',
          initialValue: initialValue,
          theme: 'dark'
        });
      });

      // Save handler
      document.getElementById('saveBtn').addEventListener('click', async (e) => {
        e.preventDefault();
        const form = document.getElementById('editorForm');
        const formData = new FormData(form);
        const payload = Object.fromEntries(formData.entries());

        // Attach markdown editor values
        for (const [field, editor] of Object.entries(editors)) {
          payload[field] = editor.getMarkdown();
        }

        // Attach repeaters/composite json
        document.querySelectorAll('.repeater-input').forEach(input => {
          try {
            payload[input.name] = JSON.parse(input.value);
          } catch {}
        });

        const url = isNew ? \`/items/\${collection}\` : \`/items/\${collection}/\${docId}\`;
        const method = isNew ? 'POST' : 'PATCH';

        if (isNew) payload.id = docId;

        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          const btn = document.getElementById('saveBtn');
          btn.innerText = 'Saved! ✓';
          btn.style.backgroundColor = '#10B981';
          setTimeout(() => {
            if (isNew) {
              window.location.href = \`/admin/content/\${collection}/\${docId}\`;
            } else {
              btn.innerText = 'Save Changes';
              btn.style.backgroundColor = '';
            }
          }, 1000);
        } else {
          alert('Failed to save changes');
        }
      });
    </script>
  `));
});

function renderFieldWidget(field: any, value: any) {
  const val = value ?? '';

  if (field.widget === 'markdown') {
    return html`
      <div class="form-group">
        <label>${field.label}</label>
        <div class="markdown-editor-container" data-field="${field.name}" data-initial="${val}"></div>
      </div>
    `;
  }

  if (field.widget === 'richtext') {
    return html`
      <div class="form-group">
        <label>${field.label}</label>
        <input id="${field.name}_input" type="hidden" name="${field.name}" value="${val}">
        <trix-editor input="${field.name}_input"></trix-editor>
      </div>
    `;
  }

  if (field.widget === 'media') {
    return html`
      <div class="form-group">
        <label>${field.label}</label>
        <div class="media-uploader">
          <input type="text" name="${field.name}" value="${val}" class="input-text" placeholder="/files/asset-id.jpg" />
          <input type="file" onchange="uploadAsset(this, '${field.name}')" class="file-picker" />
        </div>
      </div>
    `;
  }

  if (field.widget === 'repeater' || field.widget === 'object') {
    const jsonStr = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val || '[]');
    return html`
      <div class="form-group">
        <label>${field.label} (Composite JSON)</label>
        <textarea name="${field.name}" class="input-textarea repeater-input" rows="5">${jsonStr}</textarea>
      </div>
    `;
  }

  return html`
    <div class="form-group">
      <label for="${field.name}">${field.label}</label>
      <input type="text" id="${field.name}" name="${field.name}" value="${val}" class="input-text" />
    </div>
  `;
}

function renderLayout(title: string, content: any) {
  return html`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <style>
        :root {
          --bg: #090d16;
          --surface: #0f172a;
          --surface-border: #1e293b;
          --text: #f8fafc;
          --text-muted: #94a3b8;
          --primary: #FF8A00;
          --primary-hover: #FFAA00;
          --accent: #FFD043;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        body { background: var(--bg); color: var(--text); padding: 24px; min-height: 100vh; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
        .brand { display: flex; align-items: center; gap: 12px; }
        .brand h1 { font-size: 20px; font-weight: 700; color: #fff; }
        .badge { background: #1e293b; border: 1px solid #334155; padding: 4px 10px; border-radius: 99px; font-size: 12px; color: var(--accent); }
        .card { background: var(--surface); border: 1px solid var(--surface-border); border-radius: 12px; padding: 24px; margin-bottom: 24px; }
        .subtitle { color: var(--text-muted); font-size: 14px; margin-top: 4px; margin-bottom: 20px; }
        .collection-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
        .collection-item { display: flex; justify-content: space-between; align-items: center; background: #1e293b; padding: 16px; border-radius: 8px; text-decoration: none; color: #fff; font-weight: 600; border: 1px solid transparent; transition: all 0.2s; }
        .collection-item:hover { border-color: var(--primary); transform: translateY(-2px); }
        .table { width: 100%; border-collapse: collapse; text-align: left; }
        .table th, .table td { padding: 12px 16px; border-bottom: 1px solid var(--surface-border); font-size: 14px; }
        .table th { color: var(--text-muted); font-weight: 600; }
        .table a { color: var(--text); text-decoration: none; }
        .table a:hover { color: var(--primary); }
        .status-pill { padding: 4px 8px; border-radius: 6px; font-size: 11px; text-transform: uppercase; font-weight: 700; }
        .status-published { background: #064e3b; color: #34d399; }
        .status-draft { background: #451a03; color: #fb923c; }
        .status-archived { background: #334155; color: #94a3b8; }
        .btn { display: inline-flex; align-items: center; padding: 8px 16px; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; border: none; transition: 0.2s; }
        .btn-primary { background: var(--primary); color: #000; }
        .btn-primary:hover { background: var(--primary-hover); }
        .btn-secondary { background: #1e293b; color: #fff; border: 1px solid #334155; margin-right: 8px; }
        .editor-grid { display: grid; grid-template-columns: 1fr 320px; gap: 24px; }
        .form-group { margin-bottom: 20px; }
        .form-group label { display: block; font-size: 13px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px; }
        .input-text, .input-select, .input-textarea { width: 100%; background: #090d16; border: 1px solid var(--surface-border); color: #fff; padding: 10px 12px; border-radius: 6px; font-size: 14px; outline: none; }
        .input-text:focus, .input-select:focus, .input-textarea:focus { border-color: var(--primary); }
        .breadcrumbs { display: flex; gap: 8px; font-size: 14px; color: var(--text-muted); }
        .breadcrumbs a { color: var(--text-muted); text-decoration: none; }
        .breadcrumbs a:hover { color: #fff; }
        .breadcrumbs .current { color: #fff; font-weight: 600; }
        .meta-info p { font-size: 13px; color: var(--text-muted); margin-bottom: 8px; }
        .toastui-editor-defaultUI { background: #090d16 !important; border-color: var(--surface-border) !important; }
      </style>
    </head>
    <body>
      ${content}
    </body>
    </html>
  `;
}
