import type { Context } from 'hono';
import type { Env } from '../types.js';
import { getAuthenticatedUser } from './guard.js';

export class SiteResolutionError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = 'SiteResolutionError';
  }
}

export function normalizeSiteId(id: string): string {
  if (!id || !id.trim()) {
    throw new SiteResolutionError("site_id is required; the 'default' site concept has been abolished.");
  }
  let clean = id.trim().toLowerCase();
  if (clean.startsWith('http://') || clean.startsWith('https://')) {
    try {
      clean = new URL(clean).hostname.toLowerCase();
    } catch {}
  }
  clean = clean.split(':')[0].split('/')[0];
  const sanitized = clean.replace(/[^a-z0-9.-]/g, '');
  if (!sanitized) {
    throw new SiteResolutionError(`Invalid site_id '${id}': must contain alphanumeric characters, dots, or hyphens.`);
  }
  return sanitized;
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
  // 1. Site-scoped Authenticated User / Bearer Token
  let user = typeof (c as any)?.get === 'function' ? (c as any).get('user') : null;
  if (!user && c.req && typeof c.req.header === 'function') {
    const authHeader = c.req.header('authorization');
    const apiKeyHeader = c.req.header('x-api-key');
    if (authHeader || apiKeyHeader) {
      try {
        user = await getAuthenticatedUser(c);
      } catch {}
    }
  }
  if (user?.siteId) {
    return normalizeSiteId(user.siteId);
  }

  // 2. Directus query filter (?filter[site_id][_eq]=domain.com or ?filter[site_id]=... or ?filter={"site_id":...})
  if (typeof c.req?.query === 'function') {
    const filterSite = c.req.query('filter[site_id][_eq]') || c.req.query('filter[site_id]');
    if (filterSite) {
      return normalizeSiteId(filterSite);
    }

    const rawFilter = c.req.query('filter');
    if (rawFilter && typeof rawFilter === 'string' && rawFilter.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(rawFilter);
        const siteVal = parsed?.site_id?._eq || parsed?.site_id;
        if (siteVal && typeof siteVal === 'string') {
          return normalizeSiteId(siteVal);
        }
      } catch {}
    }
  }

  // 3. Standard Query parameter (?site_id=domain.com)
  const querySite = typeof c.req?.query === 'function' ? c.req.query('site_id') : null;
  if (querySite) {
    return normalizeSiteId(querySite);
  }

  // 4. Studio active session cookie (set by navbar dropdown in Admin UI)
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
  let rawHost = c.req.header('host') || '';
  if (!rawHost && c.req.url) {
    try {
      rawHost = new URL(c.req.url).host;
    } catch {}
  }
  const host = rawHost.split(':')[0].toLowerCase();
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
    // Check if candidateDomain exists directly in system_site_settings
    if (c.env.DB) {
      try {
        const siteExists = (await c.env.DB.prepare(
          'SELECT site_id FROM system_site_settings WHERE site_id = ? LIMIT 1'
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

  // 9. Fail fast: No site context could be determined
  throw new SiteResolutionError(
    'Missing site context. Please specify site_id in query parameter (?site_id=...), session cookie, or bearer token.'
  );
}
