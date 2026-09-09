import { html } from 'hono/html';

export { adminRouter } from './index.js';

export function renderInfoBubble(
  text: string,
  docAnchor?: string,
  position: 'center' | 'left' | 'right' = 'center'
) {
  const posClass = position === 'left' ? ' tooltip-left' : position === 'right' ? ' tooltip-right' : '';
  const docLink = docAnchor
    ? html`<a href="/admin/docs#${docAnchor}">Learn more in Docs &rarr;</a>`
    : '';

  return html`
    <span class="info-bubble" tabindex="0" role="tooltip">
      ⓘ
      <span class="info-tooltip${posClass}">
        ${text}
        ${docLink}
      </span>
    </span>
  `;
}
