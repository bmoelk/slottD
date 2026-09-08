import type { Context, MiddlewareHandler } from 'hono';
import type { Env } from '../types.js';

export interface AuthenticatedUser {
  email: string;
  name?: string;
  authMethod: 'cloudflare-access' | 'bearer-token' | 'local-briefcase' | 'local-dev' | string;
}

/**
 * Pluggable AuthAdapter Interface.
 */
export interface AuthAdapter {
  name: string;
  authenticate(c: Context<{ Bindings: Env }>): Promise<AuthenticatedUser | null> | AuthenticatedUser | null;
}

function getCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const match = header.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return atob(base64);
}

function base64UrlToUint8Array(str: string): Uint8Array {
  const binaryString = base64UrlDecode(str);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

interface CachedKey {
  key: CryptoKey;
  expiresAt: number;
}

export const jwksCache = new Map<string, CachedKey>();

export function clearJwksCache() {
  jwksCache.clear();
}

export function setCachedPublicKey(issuer: string, kid: string, key: CryptoKey, ttlMs: number = 3600000) {
  jwksCache.set(`${issuer}:${kid}`, {
    key,
    expiresAt: Date.now() + ttlMs,
  });
}

async function getPublicKeyForKid(issuer: string, kid: string): Promise<CryptoKey | null> {
  const cacheKey = `${issuer}:${kid}`;
  const now = Date.now();
  const cached = jwksCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.key;
  }

  try {
    const certsUrl = `${issuer.replace(/\/$/, '')}/cdn-cgi/access/certs`;
    const res = await fetch(certsUrl);
    if (!res.ok) {
      console.warn(`[CloudflareAccess:JWKS] Failed to fetch certs from ${certsUrl}: status ${res.status}`);
      return null;
    }
    const data: any = await res.json();
    const keys: any[] = data.keys || [];

    for (const keyData of keys) {
      if (keyData.kty === 'RSA' && keyData.kid) {
        try {
          const cryptoKey = await crypto.subtle.importKey(
            'jwk',
            {
              kty: keyData.kty,
              n: keyData.n,
              e: keyData.e,
              alg: keyData.alg || 'RS256',
              ext: true,
            },
            {
              name: 'RSASSA-PKCS1-v1_5',
              hash: 'SHA-256',
            },
            false,
            ['verify']
          );
          jwksCache.set(`${issuer}:${keyData.kid}`, {
            key: cryptoKey,
            expiresAt: now + 60 * 60 * 1000,
          });
        } catch (keyErr: any) {
          console.warn(`[CloudflareAccess:JWKS] Error importing key ${keyData.kid}:`, keyErr.message);
        }
      }
    }

    const resolved = jwksCache.get(cacheKey);
    if (!resolved) {
      console.warn(`[CloudflareAccess:JWKS] Key ${kid} not found in certs from ${issuer}`);
    }
    return resolved ? resolved.key : null;
  } catch (fetchErr: any) {
    console.error(`[CloudflareAccess:JWKS] Network error fetching ${issuer}:`, fetchErr.message);
    return null;
  }
}

export async function verifyCloudflareAccessJwt(
  token: string,
  expectedAud?: string
): Promise<{ email: string; [key: string]: any } | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.warn('[CloudflareAccess:JWT] Invalid token format (expected 3 parts, got ' + parts.length + ')');
      return null;
    }

    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));

    if (header.alg !== 'RS256' || !header.kid) {
      console.warn('[CloudflareAccess:JWT] Unsupported alg or missing kid:', header.alg, header.kid);
      return null;
    }

    // Check expiration and not-before claims
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < nowSec) {
      console.warn(`[CloudflareAccess:JWT] Token expired: exp=${payload.exp} now=${nowSec}`);
      return null;
    }
    if (payload.nbf && payload.nbf > nowSec + 60) {
      console.warn(`[CloudflareAccess:JWT] Token not yet active: nbf=${payload.nbf} now=${nowSec}`);
      return null;
    }

    // Check issuer: must be a Cloudflare Access issuer
    if (
      typeof payload.iss !== 'string' ||
      !payload.iss.startsWith('https://') ||
      !payload.iss.includes('.cloudflareaccess.com')
    ) {
      console.warn('[CloudflareAccess:JWT] Untrusted issuer:', payload.iss);
      return null;
    }

    // Check audience if specified in environment
    if (expectedAud) {
      const audList = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!audList.includes(expectedAud)) {
        console.warn(`[CloudflareAccess:JWT] Audience mismatch: expected ${expectedAud}, got`, payload.aud);
        return null;
      }
    }

    // Valid email must be present
    if (!payload.email || typeof payload.email !== 'string') {
      console.warn('[CloudflareAccess:JWT] Missing email in payload');
      return null;
    }

    // Verify cryptographic signature against JWKS
    const cryptoKey = await getPublicKeyForKid(payload.iss, header.kid);
    if (!cryptoKey) {
      console.warn('[CloudflareAccess:JWT] Public key unavailable for kid:', header.kid);
      return null;
    }

    const signatureBytes = base64UrlToUint8Array(parts[2]);
    const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);

    const isValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      signatureBytes,
      signedData
    );

    if (!isValid) {
      console.warn('[CloudflareAccess:JWT] RS256 signature verification failed');
      return null;
    }

    return payload;
  } catch (err: any) {
    console.error('[CloudflareAccess:JWT] Unexpected verification error:', err.message, err.stack);
    return null;
  }
}

export class CloudflareAccessAuthAdapter implements AuthAdapter {
  name = 'cloudflare-access';
  async authenticate(c: Context<{ Bindings: Env }>): Promise<AuthenticatedUser | null> {
    // 1. Direct Edge Header (injected by Cloudflare Access when path is inside Access policy)
    const cfAccessEmail = c.req.header('cf-access-authenticated-user-email');
    if (cfAccessEmail) {
      return {
        email: cfAccessEmail,
        authMethod: 'cloudflare-access',
      };
    }

    // 2. JWT Assertion Header or CF_Authorization Cookie (for same-origin API calls outside Access path)
    const assertion = c.req.header('cf-access-jwt-assertion');
    const rawCookie = c.req.header('cookie') || c.req.raw?.headers?.get('cookie') || '';
    const cookieToken = getCookie(rawCookie, 'CF_Authorization');
    const token = assertion?.trim() || cookieToken?.trim();

    if (token) {
      const expectedAud = (c.env as any).CF_ACCESS_AUD || (c.env as any).POLICY_AUD;
      const verified = await verifyCloudflareAccessJwt(token, expectedAud);
      if (verified && verified.email) {
        return {
          email: verified.email,
          authMethod: 'cloudflare-access',
        };
      }
    }

    return null;
  }
}

export class BearerTokenAuthAdapter implements AuthAdapter {
  name = 'bearer-token';
  authenticate(c: Context<{ Bindings: Env }>): AuthenticatedUser | null {
    const authHeader = c.req.header('authorization');
    const apiKeyHeader = c.req.header('x-api-key');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : apiKeyHeader?.trim();

    const configuredKey = c.env.ADMIN_API_KEY || (c.env as any).ADMIN_PASSWORD;

    if (configuredKey && token && token === configuredKey) {
      return {
        email: 'admin@apikey',
        authMethod: 'bearer-token',
      };
    }
    return null;
  }
}

export class LocalDevAuthAdapter implements AuthAdapter {
  name = 'local-briefcase';
  async authenticate(c: Context<{ Bindings: Env }>): Promise<AuthenticatedUser | null> {
    const isDev = c.env.ENVIRONMENT !== 'production';
    if (!isDev) {
      return null;
    }

    const email = (c.env as any).OPERATOR_EMAIL || 'dev@localhost';
    const name = (c.env as any).OPERATOR_NAME || 'Local Operator';
    const secret = c.env.JWT_SECRET || 'briefcase-local-secret';
    const apiKey = c.env.ADMIN_API_KEY || 'local-briefcase';

    let configuredHash = (c.env as any).ADMIN_PASSWORD_HASH;
    const legacyPlain = (c.env as any).ADMIN_PASSWORD;

    // Check if password hash is stored in system_settings in D1
    if (!configuredHash && c.env.DB) {
      try {
        const row = await c.env.DB.prepare('SELECT value FROM system_settings WHERE key = ?')
          .bind('admin_password_hash')
          .first<{ value: string }>();
        if (row?.value) {
          configuredHash = row.value;
        }
      } catch {}
    }

    const isPasswordProtected = !!(configuredHash || legacyPlain);

    if (isPasswordProtected) {
      // 1. Check slottd_session cookie
      const rawCookie = c.req.header('cookie') || c.req.raw?.headers?.get('cookie') || '';
      const sessionToken = getCookie(rawCookie, 'slottd_session');
      if (sessionToken) {
        const session = await verifyBriefcaseSessionCookie(sessionToken, secret);
        if (session && session.email) {
          return {
            email: session.email,
            name,
            authMethod: 'local-briefcase',
          };
        }
      }

      // 2. Check Authorization: Bearer <token> or x-api-key
      const authHeader = c.req.header('authorization');
      const apiKeyHeader = c.req.header('x-api-key');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : apiKeyHeader?.trim();

      if (token) {
        if (token === apiKey || (legacyPlain && token === legacyPlain)) {
          return {
            email,
            name,
            authMethod: 'bearer-token',
          };
        }
        if (configuredHash) {
          const isValid = await verifyPassword(token, configuredHash, apiKey);
          if (isValid) {
            return {
              email,
              name,
              authMethod: 'bearer-token',
            };
          }
        }
      }

      // Password configured but neither valid session nor token was provided
      return null;
    }

    // In zero-barrier mode, if an explicit token was provided, reject if invalid
    const authHeader = c.req.header('authorization');
    const apiKeyHeader = c.req.header('x-api-key');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : apiKeyHeader?.trim();
    if (token && apiKey && token !== apiKey && token !== 'dev') {
      return null;
    }

    // Zero-barrier mode: seamlessly authenticate with local operator identity
    return {
      email,
      name,
      authMethod: 'local-briefcase',
    };
  }
}

export const registeredAuthAdapters: AuthAdapter[] = [
  new CloudflareAccessAuthAdapter(),
  new BearerTokenAuthAdapter(),
  new LocalDevAuthAdapter(),
];

export function registerAuthAdapter(adapter: AuthAdapter) {
  registeredAuthAdapters.unshift(adapter);
}

/**
 * Extracts authenticated user identity using registered AuthAdapters.
 */
export async function getAuthenticatedUser(c: Context<{ Bindings: Env }>): Promise<AuthenticatedUser | null> {
  const existing = typeof (c as any)?.get === 'function' ? (c as any).get('user') : null;
  if (existing && existing.email) {
    return existing as AuthenticatedUser;
  }

  for (const adapter of registeredAuthAdapters) {
    const user = await adapter.authenticate(c);
    if (user) {
      if (typeof (c as any)?.set === 'function') {
        (c as any).set('user', user);
      }
      return user as AuthenticatedUser;
    }
  }
  return null;
}

/**
 * Middleware: Requires valid Cloudflare Access session or Bearer API token
 * for all mutating operations (POST, PATCH, DELETE, releases).
 */
export const requireWriteAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const user = await getAuthenticatedUser(c);

  if (!user) {
    console.warn('[requireWriteAuth] Blocked unauthenticated write to', c.req.method, c.req.url, 'diagnostics:', {
      hasCookie: !!(c.req.header('cookie') || c.req.raw?.headers?.get('cookie')),
      hasCfAccessEmail: !!c.req.header('cf-access-authenticated-user-email'),
      hasAuthHeader: !!c.req.header('authorization'),
    });
    return c.json(
      {
        error: 'Unauthorized',
        message: 'Write operations require authentication via Cloudflare Access or Authorization: Bearer <ADMIN_API_KEY>',
      },
      401
    );
  }

  // Attach user to context
  (c as any).set('user', user);
  return next();
};

/**
 * Middleware: Protects draft queries and version inspections.
 * Unauthenticated users are rejected when requesting unpublished content.
 */
export const requireDraftReadAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const user = await getAuthenticatedUser(c);

  if (!user) {
    return c.json(
      {
        error: 'Unauthorized',
        message: 'Reading draft documents or versions requires authentication via Cloudflare Access or Authorization: Bearer <ADMIN_API_KEY>',
      },
      401
    );
  }

  (c as any).set('user', user);
  return next();
};

/**
 * Middleware: Guard for Admin Studio UI (/admin/*).
 */
export const requireStudioAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const user = await getAuthenticatedUser(c);

  // If in production and unauthenticated by Cloudflare Access or API key
  if (!user && c.env.ENVIRONMENT === 'production' && c.env.ADMIN_API_KEY) {
    return c.html(
      `<!DOCTYPE html>
      <html>
      <head>
        <title>Access Required — SlottD Studio</title>
        <style>
          body { background: #090d16; color: #f8fafc; font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .box { background: #0f172a; border: 1px solid #1e293b; padding: 32px; border-radius: 12px; max-width: 420px; text-align: center; }
          h1 { font-size: 20px; color: #FF8A00; margin-bottom: 12px; }
          p { color: #94a3b8; font-size: 14px; line-height: 1.5; margin-bottom: 20px; }
          code { background: #1e293b; padding: 2px 6px; border-radius: 4px; color: #FFD043; }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>🔒 Protected SlottD Studio</h1>
          <p>This micro-studio is protected by Cloudflare Access / Zero Trust. Please sign in via your authorized Cloudflare Access domain.</p>
        </div>
      </body>
      </html>`,
      401
    );
  }

  // If in local dev / Briefcase and unauthenticated, redirect to login
  if (!user && c.env.ENVIRONMENT !== 'production') {
    const path = c.req.path;
    if (path === '/admin/login') {
      return next();
    }
    return c.redirect('/admin/login');
  }

  (c as any).set('user', user || { email: 'guest@edge', authMethod: 'local-dev' });
  return next();
};

/**
 * Web Crypto HMAC-SHA256 Password Hasher
 */
export async function hashPassword(password: string, apiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(apiKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(password));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Web Crypto HMAC-SHA256 Password Verifier
 */
export async function verifyPassword(password: string, expectedHash: string, apiKey: string): Promise<boolean> {
  const computed = await hashPassword(password, apiKey);
  return computed === expectedHash;
}

/**
 * Creates signed session token for Briefcase Studio
 */
export async function createBriefcaseSessionCookie(email: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const exp = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
  const payload = JSON.stringify({ email, exp });
  const b64Payload = btoa(payload);

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(b64Payload));
  const hexSig = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${b64Payload}.${hexSig}`;
}

/**
 * Verifies signed session token for Briefcase Studio
 */
export async function verifyBriefcaseSessionCookie(
  cookieVal: string | null | undefined,
  secret: string
): Promise<{ email: string } | null> {
  if (!cookieVal) return null;
  const parts = cookieVal.split('.');
  if (parts.length !== 2) return null;
  const [b64Payload, hexSig] = parts;

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const hexBytes = hexSig.match(/.{1,2}/g) || [];
    const sigBytes = new Uint8Array(hexBytes.map((byte) => parseInt(byte, 16)));
    const isValid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(b64Payload));
    if (!isValid) return null;

    const payload = JSON.parse(atob(b64Payload));
    if (payload.exp && payload.exp < Date.now()) return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}

/**
 * AES-GCM Encrypt for Secrets (Tokens) stored in D1
 */
export async function encryptSecret(plainText: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret.padEnd(32, '0').slice(0, 32)),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    keyMaterial,
    encoder.encode(plainText)
  );
  const ivHex = Array.from(iv).map((b) => b.toString(16).padStart(2, '0')).join('');
  const encHex = Array.from(new Uint8Array(encrypted)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${ivHex}:${encHex}`;
}

/**
 * AES-GCM Decrypt for Secrets (Tokens) stored in D1
 */
export async function decryptSecret(cipherText: string, secret: string): Promise<string | null> {
  try {
    const [ivHex, encHex] = cipherText.split(':');
    if (!ivHex || !encHex) return null;
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret.padEnd(32, '0').slice(0, 32)),
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    const iv = new Uint8Array((ivHex.match(/.{1,2}/g) || []).map((b) => parseInt(b, 16)));
    const encrypted = new Uint8Array((encHex.match(/.{1,2}/g) || []).map((b) => parseInt(b, 16)));
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      keyMaterial,
      encrypted
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}
