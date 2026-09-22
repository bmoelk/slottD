import type { Context } from 'hono';
import type { Env } from '../types.js';

export class SiteResolutionError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = 'SiteResolutionError';
  }
}

export function normalizeSiteId(id: string): string {
  if (!id) return 'default';
  let clean = id.trim().toLowerCase();
  if (clean.startsWith('http://') || clean.startsWith('https://')) {
    try {
      clean = new URL(clean).hostname.toLowerCase();
    } catch {}
  }
  clean = clean.split(':')[0].split('/')[0];
  const sanitized = clean.replace(/[^a-z0-9.-]/g, '');
  return sanitized || 'default';
}

function getCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const match = header.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Resolves the active site identifier for the incoming request using a rigid priority hierarchy.
 */
export async function resolveSiteId(c: Context<any>): Promise<string> {
  // 1. Explicit request headers (sent by Astro CMS client or SlotWire)
  const headerSite = c.req.header('x-slottd-site') || c.req.header('x-site-id');
  if (headerSite) {
    return normalizeSiteId(headerSite);
  }

  // 2. Query parameter (?site=domain.com or ?siteId=...)
  const querySite = c.req.query('site') || c.req.query('siteId');
  if (querySite) {
    return normalizeSiteId(querySite);
  }

  // 3. Studio active session cookie (set by navbar dropdown in Admin UI)
  const rawCookie = c.req.header('cookie') || c.req.raw?.headers?.get('cookie') || '';
  const cookieSite = getCookie(rawCookie, 'slottd_site') || getCookie(rawCookie, 'slottd_active_site');
  if (cookieSite) {
    return normalizeSiteId(cookieSite);
  }

  // 4. Request Origin / Referer (e.g. https://example.com or https://client-brand.org)
  const origin = c.req.header('origin') || c.req.header('referer');
  let originHost = '';
  if (origin) {
    try {
      const parsedUrl = new URL(origin);
      const hostname = parsedUrl.hostname.toLowerCase();
      if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
        originHost = hostname;
      }
    } catch {}
  }

  // 5. Host Header Domain Mapping (e.g. cms.spectragql.dev -> spectragql.dev)
  const host = (c.req.header('host') || '').split(':')[0].toLowerCase();
  let hostDerived = '';
  if (host.startsWith('cms.') && host.length > 4) {
    hostDerived = host.slice(4);
  } else if (host && host !== 'localhost' && host !== '127.0.0.1' && !host.endsWith('.internal')) {
    hostDerived = host;
  }

  // If a direct host or origin match is available
  const candidateDomain = originHost || hostDerived;

  // 6. Check Configurable Domain Referral Fallback (Disabled by default)
  const allowReferral = c.env.ALLOW_DOMAIN_REFERRAL_FALLBACK === true || c.env.ALLOW_DOMAIN_REFERRAL_FALLBACK === 'true';
  if (candidateDomain && allowReferral && c.env.DB) {
    try {
      const referralRow = (await c.env.DB.prepare(
        'SELECT target_site_id FROM site_domain_referrals WHERE referral_domain = ?'
      )
        .bind(candidateDomain)
        .first()) as { target_site_id: string } | null;

      if (referralRow?.target_site_id) {
        return normalizeSiteId(referralRow.target_site_id);
      }
    } catch {}
  }

  if (candidateDomain) {
    // Check if candidateDomain exists directly in site_settings
    if (c.env.DB) {
      try {
        const siteExists = (await c.env.DB.prepare(
          'SELECT site_id FROM site_settings WHERE site_id = ? LIMIT 1'
        )
          .bind(candidateDomain)
          .first()) as { site_id: string } | null;

        if (siteExists?.site_id) {
          return normalizeSiteId(siteExists.site_id);
        }
      } catch {}
    }
  }

  // 7. Environment Default Site ID (if explicitly configured)
  const defaultEnvSite = c.env.DEFAULT_SITE_ID || c.env.INITIAL_SITE_ID;
  if (defaultEnvSite) {
    return normalizeSiteId(defaultEnvSite);
  }

  // 8. If candidate domain was found, return it as the site identifier
  if (candidateDomain) {
    return normalizeSiteId(candidateDomain);
  }

  // 9. Generic Fallback for localhost / local dev / test suites
  return 'default';
}
