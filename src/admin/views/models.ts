import { html } from 'hono/html';
import { renderLayout } from '../layout.js';

export function renderModelsView(
  modelsWithFields: any[],
  user: { email: string; authMethod?: string }
) {
  return renderLayout('Model Registry — SlottD Studio', 'models', user, html`
    <div class="header">
      <div>
        <h1>Content Models & Schema Registry</h1>
        <p class="subtitle">Read-only schema registry of active model packs, field mappings, and SQLite dynamic views.</p>
      </div>
    </div>

    <div class="models-list">
      ${modelsWithFields.length === 0 ? html`
        <div class="card empty-state"><p>No collection models found.</p></div>
      ` : modelsWithFields.map((model) => html`
        <div class="card model-card">
          <div class="model-header">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="col-icon">${model.icon || '⚙️'}</span>
              <div>
                <h2>${model.display_name || model.name} <code>(${model.name})</code></h2>
                <p class="model-desc">${model.description || 'No description provided.'}</p>
              </div>
            </div>
            <div class="model-badges">
              <span class="badge">${model.pack_name}</span>
              <span class="badge">v${model.schema_version}</span>
            </div>
          </div>

          <table class="table field-table">
            <thead>
              <tr>
                <th>Field Name</th>
                <th>Type</th>
                <th>Widget</th>
                <th>Required</th>
              </tr>
            </thead>
            <tbody>
              ${model.fields.map((f: any) => html`
                <tr>
                  <td><code>${f.name}</code></td>
                  <td><span class="type-pill">${f.type}</span></td>
                  <td><code>${f.widget || 'text'}</code></td>
                  <td>${f.required ? '✓ Required' : 'Optional'}</td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      `)}
    </div>
  `);
}
