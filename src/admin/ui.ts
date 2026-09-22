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

/**
 * Renders site favicon with automatic fallback to globe emoji
 */
export function renderFavicon(siteId: string, size = 16) {
  const enc = encodeURIComponent(siteId || '');
  return html`<img
    src="https://www.google.com/s2/favicons?domain=${enc}&sz=${size * 2}"
    alt=""
    width="${size}"
    height="${size}"
    loading="lazy"
    style="width: ${size}px; height: ${size}px; border-radius: 3px; object-fit: contain; vertical-align: middle; flex-shrink: 0;"
    onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-block';"
  /><span style="display: none; font-size: ${size}px; line-height: 1;">🌐</span>`;
}
