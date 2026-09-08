import { describe, it, expect, beforeEach } from 'vitest';
import { getAuthenticatedUser, setCachedPublicKey, clearJwksCache } from '../src/auth/guard.js';

function base64UrlEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function createTestJwt(
  payload: Record<string, any>,
  privateKey: CryptoKey,
  kid: string = 'test-kid'
): Promise<string> {
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const data = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    data
  );

  const encodedSig = base64UrlEncodeBytes(new Uint8Array(signature));
  return `${encodedHeader}.${encodedPayload}.${encodedSig}`;
}

describe('SlottD Auth & Edge Security', () => {
  let keyPair: CryptoKeyPair;
  const testIssuer = 'https://brainendeavor.cloudflareaccess.com';
  const testKid = 'test-access-key-1';

  beforeEach(async () => {
    clearJwksCache();
    keyPair = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    )) as CryptoKeyPair;
    setCachedPublicKey(testIssuer, testKid, keyPair.publicKey);
  });

  it('authenticates user from Cloudflare Access email header', async () => {
    const mockContext: any = {
      env: { ENVIRONMENT: 'production' },
      req: {
        header: (name: string) => {
          if (name.toLowerCase() === 'cf-access-authenticated-user-email') {
            return 'brian@brainendeavor.com';
          }
          return null;
        },
      },
    };

    const user = await getAuthenticatedUser(mockContext);
    expect(user).not.toBeNull();
    expect(user?.email).toBe('brian@brainendeavor.com');
    expect(user?.authMethod).toBe('cloudflare-access');
  });

  it('authenticates user from CF_Authorization cookie with valid RS256 JWT', async () => {
    const now = Math.floor(Date.now() / 1000);
    const validJwt = await createTestJwt(
      {
        email: 'bmoelk@gmail.com',
        iss: testIssuer,
        aud: ['test-aud-123'],
        exp: now + 3600,
        nbf: now - 60,
      },
      keyPair.privateKey,
      testKid
    );

    const mockContext: any = {
      env: { ENVIRONMENT: 'production', CF_ACCESS_AUD: 'test-aud-123' },
      req: {
        header: (name: string) => {
          if (name.toLowerCase() === 'cookie') {
            return `theme=dark; CF_Authorization=${validJwt}; session=xyz`;
          }
          return null;
        },
      },
    };

    const user = await getAuthenticatedUser(mockContext);
    expect(user).not.toBeNull();
    expect(user?.email).toBe('bmoelk@gmail.com');
    expect(user?.authMethod).toBe('cloudflare-access');
  });

  it('authenticates user from cf-access-jwt-assertion header with valid RS256 JWT', async () => {
    const now = Math.floor(Date.now() / 1000);
    const validJwt = await createTestJwt(
      {
        email: 'editor@brainendeavor.com',
        iss: testIssuer,
        exp: now + 3600,
        nbf: now - 60,
      },
      keyPair.privateKey,
      testKid
    );

    const mockContext: any = {
      env: { ENVIRONMENT: 'production' },
      req: {
        header: (name: string) => {
          if (name.toLowerCase() === 'cf-access-jwt-assertion') {
            return validJwt;
          }
          return null;
        },
      },
    };

    const user = await getAuthenticatedUser(mockContext);
    expect(user).not.toBeNull();
    expect(user?.email).toBe('editor@brainendeavor.com');
    expect(user?.authMethod).toBe('cloudflare-access');
  });

  it('rejects expired CF_Authorization JWT cookie', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expiredJwt = await createTestJwt(
      {
        email: 'bmoelk@gmail.com',
        iss: testIssuer,
        exp: now - 100, // expired in past
      },
      keyPair.privateKey,
      testKid
    );

    const mockContext: any = {
      env: { ENVIRONMENT: 'production' },
      req: {
        header: (name: string) => {
          if (name.toLowerCase() === 'cookie') {
            return `CF_Authorization=${expiredJwt}`;
          }
          return null;
        },
      },
    };

    const user = await getAuthenticatedUser(mockContext);
    expect(user).toBeNull();
  });

  it('rejects tampered / forged CF_Authorization JWT cookie', async () => {
    const now = Math.floor(Date.now() / 1000);
    const validJwt = await createTestJwt(
      {
        email: 'bmoelk@gmail.com',
        iss: testIssuer,
        exp: now + 3600,
      },
      keyPair.privateKey,
      testKid
    );

    // Tamper with payload
    const parts = validJwt.split('.');
    const tamperedPayload = base64UrlEncode(JSON.stringify({ email: 'hacker@evil.com', iss: testIssuer, exp: now + 3600 }));
    const forgedJwt = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const mockContext: any = {
      env: { ENVIRONMENT: 'production' },
      req: {
        header: (name: string) => {
          if (name.toLowerCase() === 'cookie') {
            return `CF_Authorization=${forgedJwt}`;
          }
          return null;
        },
      },
    };

    const user = await getAuthenticatedUser(mockContext);
    expect(user).toBeNull();
  });

  it('rejects JWT cookie with untrusted issuer domain', async () => {
    const now = Math.floor(Date.now() / 1000);
    const invalidIssuerJwt = await createTestJwt(
      {
        email: 'bmoelk@gmail.com',
        iss: 'https://evil.com',
        exp: now + 3600,
      },
      keyPair.privateKey,
      testKid
    );

    const mockContext: any = {
      env: { ENVIRONMENT: 'production' },
      req: {
        header: (name: string) => {
          if (name.toLowerCase() === 'cookie') {
            return `CF_Authorization=${invalidIssuerJwt}`;
          }
          return null;
        },
      },
    };

    const user = await getAuthenticatedUser(mockContext);
    expect(user).toBeNull();
  });

  it('authenticates user from Bearer ADMIN_API_KEY token', async () => {
    const mockContext: any = {
      env: { ENVIRONMENT: 'production', ADMIN_API_KEY: 'secret-test-token-123' },
      req: {
        header: (name: string) => {
          if (name.toLowerCase() === 'authorization') {
            return 'Bearer secret-test-token-123';
          }
          return null;
        },
      },
    };

    const user = await getAuthenticatedUser(mockContext);
    expect(user).not.toBeNull();
    expect(user?.authMethod).toBe('bearer-token');
  });

  it('rejects invalid or missing Bearer token in production', async () => {
    const mockContext: any = {
      env: { ENVIRONMENT: 'production', ADMIN_API_KEY: 'secret-test-token-123' },
      req: {
        header: (name: string) => {
          if (name.toLowerCase() === 'authorization') {
            return 'Bearer wrong-token';
          }
          return null;
        },
      },
    };

    const user = await getAuthenticatedUser(mockContext);
    expect(user).toBeNull();
  });

  it('allows local Briefcase operations seamlessly when in development mode', async () => {
    const mockContext: any = {
      env: { ENVIRONMENT: 'development', OPERATOR_NAME: 'Brian Moelk', OPERATOR_EMAIL: 'brian@brainendeavor.com' },
      req: {
        header: (name: string) => {
          if (name.toLowerCase() === 'host') return 'localhost:8787';
          return null;
        },
      },
    };

    const user = await getAuthenticatedUser(mockContext);
    expect(user).not.toBeNull();
    expect(user?.authMethod).toBe('local-briefcase');
    expect(user?.name).toBe('Brian Moelk');
    expect(user?.email).toBe('brian@brainendeavor.com');
  });

  it('rejects invalid explicit credentials in development mode when ADMIN_API_KEY is configured', async () => {
    const mockContext: any = {
      env: { ENVIRONMENT: 'development', ADMIN_API_KEY: 'local-key-123' },
      req: {
        header: (name: string) => {
          if (name.toLowerCase() === 'authorization') return 'Bearer wrong-key';
          return null;
        },
      },
    };

    const user = await getAuthenticatedUser(mockContext);
    expect(user).toBeNull();
  });

  it('strictly rejects unauthenticated write operations in production mode without Cloudflare Access', async () => {
    const mockContext: any = {
      env: { ENVIRONMENT: 'production' },
      req: {
        header: () => null,
      },
    };

    const user = await getAuthenticatedUser(mockContext);
    expect(user).toBeNull();
  });

  it('hashes and verifies passwords using Web Crypto HMAC', async () => {
    const { hashPassword, verifyPassword } = await import('../src/auth/guard.js');
    const apiKey = 'test-api-key-123';
    const password = 'super-secret-operator-pass';

    const hash = await hashPassword(password, apiKey);
    expect(hash).toBeTruthy();
    expect(hash).not.toBe(password);

    const isValid = await verifyPassword(password, hash, apiKey);
    expect(isValid).toBe(true);

    const isInvalid = await verifyPassword('wrong-password', hash, apiKey);
    expect(isInvalid).toBe(false);
  });

  it('creates and verifies briefcase session cookies', async () => {
    const { createBriefcaseSessionCookie, verifyBriefcaseSessionCookie } = await import('../src/auth/guard.js');
    const secret = 'jwt-secret-xyz';
    const email = 'operator@localhost';

    const cookieToken = await createBriefcaseSessionCookie(email, secret);
    expect(cookieToken).toContain('.');

    const verified = await verifyBriefcaseSessionCookie(cookieToken, secret);
    expect(verified?.email).toBe(email);

    const tampered = cookieToken.slice(0, -4) + 'abcd';
    const tamperedResult = await verifyBriefcaseSessionCookie(tampered, secret);
    expect(tamperedResult).toBeNull();
  });

  it('enforces password challenge in local dev when password hash is configured', async () => {
    const { hashPassword, createBriefcaseSessionCookie } = await import('../src/auth/guard.js');
    const apiKey = 'test-local-key';
    const secret = 'test-jwt-secret';
    const password = 'my-briefcase-pass';
    const hash = await hashPassword(password, apiKey);

    // 1. Without cookie or bearer token -> rejected
    const unauthCtx: any = {
      env: {
        ENVIRONMENT: 'development',
        ADMIN_API_KEY: apiKey,
        JWT_SECRET: secret,
        ADMIN_PASSWORD_HASH: hash,
        OPERATOR_EMAIL: 'dev@localhost',
      },
      req: {
        header: () => null,
      },
    };
    const unauthUser = await getAuthenticatedUser(unauthCtx);
    expect(unauthUser).toBeNull();

    // 2. With valid session cookie -> authenticated
    const sessionCookie = await createBriefcaseSessionCookie('dev@localhost', secret);
    const authCtx: any = {
      env: {
        ENVIRONMENT: 'development',
        ADMIN_API_KEY: apiKey,
        JWT_SECRET: secret,
        ADMIN_PASSWORD_HASH: hash,
        OPERATOR_EMAIL: 'dev@localhost',
      },
      req: {
        header: (name: string) => (name.toLowerCase() === 'cookie' ? `slottd_session=${sessionCookie}` : null),
      },
    };
    const authUser = await getAuthenticatedUser(authCtx);
    expect(authUser?.email).toBe('dev@localhost');
    expect(authUser?.authMethod).toBe('local-briefcase');
  });

  it('encrypts and decrypts secrets at rest using AES-GCM', async () => {
    const { encryptSecret, decryptSecret } = await import('../src/auth/guard.js');
    const secret = 'strong-jwt-secret-32-chars-long!';
    const plainToken = 'ghp_secretTokenForGitHub123456';

    const cipher = await encryptSecret(plainToken, secret);
    expect(cipher).toContain(':');
    expect(cipher).not.toBe(plainToken);

    const decrypted = await decryptSecret(cipher, secret);
    expect(decrypted).toBe(plainToken);

    const failed = await decryptSecret('bad:cipher:data', secret);
    expect(failed).toBeNull();
  });
});
