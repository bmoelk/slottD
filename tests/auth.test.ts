import { describe, it, expect } from 'vitest';
import { getAuthenticatedUser } from '../src/auth/guard.js';

describe('SlottD Auth & Edge Security', () => {
  it('authenticates user from Cloudflare Access email header', () => {
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

    const user = getAuthenticatedUser(mockContext);
    expect(user).not.toBeNull();
    expect(user?.email).toBe('brian@brainendeavor.com');
    expect(user?.authMethod).toBe('cloudflare-access');
  });

  it('authenticates user from Bearer ADMIN_API_KEY token', () => {
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

    const user = getAuthenticatedUser(mockContext);
    expect(user).not.toBeNull();
    expect(user?.authMethod).toBe('bearer-token');
  });

  it('rejects invalid or missing Bearer token in production', () => {
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

    const user = getAuthenticatedUser(mockContext);
    expect(user).toBeNull();
  });

  it('allows local-dev loopback when in development mode and localhost', () => {
    const mockContext: any = {
      env: { ENVIRONMENT: 'development' },
      req: {
        header: (name: string) => {
          if (name.toLowerCase() === 'host') {
            return 'localhost:8787';
          }
          return null;
        },
      },
    };

    const user = getAuthenticatedUser(mockContext);
    expect(user).not.toBeNull();
    expect(user?.authMethod).toBe('local-dev');
  });
});
