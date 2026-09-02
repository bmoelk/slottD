import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import type { Database } from './schema.js';

/**
 * Creates a Kysely query client bound to the Cloudflare D1 database
 */
export function createDb(d1: D1Database): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new D1Dialect({ database: d1 }) as any,
  });
}
