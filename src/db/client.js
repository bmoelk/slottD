import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';
/**
 * Creates a Kysely query client bound to the Cloudflare D1 database
 */
export function createDb(d1) {
    return new Kysely({
        dialect: new D1Dialect({ database: d1 }),
    });
}
