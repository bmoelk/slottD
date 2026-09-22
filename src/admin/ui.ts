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
 * Renders site favicon with automatic fallback to globe emoji.
 * If cachedFavicon (Base64 data URI) is provided, uses it directly (0 network requests, Briefcase offline ready).
 * Otherwise falls back to fetching directly from https://${siteId}/favicon.ico.
 * Zero reliance on Google CDN.
 */
export function renderFavicon(siteId: string, size = 16, cachedFavicon?: string) {
  const enc = encodeURIComponent(siteId || '');
  const cleanId = (siteId || '').trim().toLowerCase();
  const src = cachedFavicon || (cleanId && cleanId !== 'default' ? `https://${cleanId}/favicon.svg` : '');

  if (!src) {
    return html`<span style="font-size: ${size}px; line-height: 1; vertical-align: middle;">🌐</span>`;
  }

  return html`<img
    src="${src}"
    data-site-favicon="${enc}"
    alt=""
    width="${size}"
    height="${size}"
    loading="lazy"
    style="width: ${size}px; height: ${size}px; border-radius: 3px; object-fit: contain; vertical-align: middle; flex-shrink: 0;"
    onerror="if(!this.dataset.triedIco){this.dataset.triedIco='1';this.src='https://${cleanId}/favicon.ico';}else{this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='inline-block';}"
  /><span style="display: none; font-size: ${size}px; line-height: 1; vertical-align: middle;">🌐</span>`;
}
