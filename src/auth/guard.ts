import type { Context, MiddlewareHandler } from 'hono';
import type { Env } from '../types.js';

export interface AuthenticatedUser {
  email: string;
  authMethod: 'cloudflare-access' | 'bearer-token' | 'local-dev';
}

/**
 * Extracts authenticated user identity from Cloudflare Access headers,
 * Bearer token, or local dev loopback.
 */
export function getAuthenticatedUser(c: Context<{ Bindings: Env }>): AuthenticatedUser | null {
  const env = c.env;

  // 1. Cloudflare Access Identity Headers (Zero Trust)
  const cfAccessEmail = c.req.header('cf-access-authenticated-user-email');
  if (cfAccessEmail) {
    return {
      email: cfAccessEmail,
      authMethod: 'cloudflare-access',
    };
  }

  // 2. Bearer Token or X-API-Key Header
  const authHeader = c.req.header('authorization');
  const apiKeyHeader = c.req.header('x-api-key');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : apiKeyHeader?.trim();

  const configuredKey = env.ADMIN_API_KEY || (env as any).ADMIN_PASSWORD;

  if (configuredKey && token && token === configuredKey) {
    return {
      email: 'admin@apikey',
      authMethod: 'bearer-token',
    };
  }

  // 3. Local Development Loopback (wrangler dev)
  const host = c.req.header('host') || '';
  const isLocalHost = host.includes('localhost') || host.includes('127.0.0.1') || host.includes('0.0.0.0');
  const isDev = env.ENVIRONMENT !== 'production';

  if (isDev && isLocalHost && !configuredKey) {
    return {
      email: 'dev@localhost',
      authMethod: 'local-dev',
    };
  }

  return null;
}

/**
 * Middleware: Requires valid Cloudflare Access session or Bearer API token
 * for all mutating operations (POST, PATCH, DELETE, releases).
 */
export const requireWriteAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const user = getAuthenticatedUser(c);

  if (!user) {
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
 * Middleware: Guard for Admin Studio UI (/admin/*).
 */
export const requireStudioAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const user = getAuthenticatedUser(c);

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

  (c as any).set('user', user || { email: 'guest@edge', authMethod: 'local-dev' });
  return next();
};
