import type { PublishCheck, PublishCheckResult, PublishHookContext } from '../types.js';

export interface MediaCheckOptions {
  severity?: 'error' | 'warning';
  checkR2?: boolean;
}

export function mediaIntegrityCheck(options: MediaCheckOptions = {}): PublishCheck {
  const { severity = 'warning', checkR2 = true } = options;

  return async (ctx: PublishHookContext): Promise<PublishCheckResult> => {
    const result: PublishCheckResult = {
      name: 'media-integrity',
      displayName: 'Media Asset Integrity',
      passed: true,
      errors: [],
      warnings: [],
      metadata: { missingAssets: [], recommendations: [] },
    };

    const targetList = ctx.changedItems && ctx.changedItems.length > 0
      ? ctx.changedItems
      : (ctx.items || []);

    const missingAssets: Array<{ collection: string; slug: string; field: string; key: string }> = [];
    const recommendations: string[] = [];

    // 1. Gather all referenced media keys across target items
    const referencedMap: Array<{ collection: string; slug: string; field: string; rawKey: string; cleanKey: string }> = [];

    for (const item of targetList) {
      const dataPayload = (item as any).delta || (item as any).data || item;
      const collection = (item as any).collection || 'unknown';
      const slug = (item as any).slug || 'item';

      if (typeof dataPayload === 'object' && dataPayload !== null) {
        for (const [field, val] of Object.entries(dataPayload)) {
          if (typeof val === 'string' && val.trim()) {
            const isMediaField =
              /image|photo|avatar|media|thumbnail|cover|defaultOgImage/i.test(field) ||
              /\.(jpe?g|png|webp|svg|gif|avif)$/i.test(val);

            if (isMediaField) {
              const cleanKey = val.replace(/^\/media\//, '').replace(/^\/+/, '');
              // Ignore remote external HTTP URLs in R2 local checks unless relative
              if (!cleanKey.startsWith('http://') && !cleanKey.startsWith('https://')) {
                referencedMap.push({
                  collection,
                  slug,
                  field,
                  rawKey: val,
                  cleanKey,
                });
              }
            }
          }
        }
      }
    }

    if (referencedMap.length === 0) {
      return result;
    }

    // 2. Query known media from D1 if database client available
    const db = ctx.db;
    const env = ctx.env;
    const knownKeys = new Set<string>();

    if (db) {
      try {
        const rows = await db
          .selectFrom('media')
          .select(['key', 'filename', 'id'])
          .execute();

        for (const r of rows) {
          if (r.key) knownKeys.add(r.key);
          if (r.filename) knownKeys.add(r.filename);
          if (r.id) knownKeys.add(String(r.id));
        }
      } catch {
        // Table might not exist or empty
      }
    }

    // 3. Verify each referenced key
    for (const ref of referencedMap) {
      let found = knownKeys.has(ref.cleanKey);

      // If not found in D1, try R2 head directly if env.MEDIA exists
      if (!found && checkR2 && env?.MEDIA) {
        try {
          const head = await env.MEDIA.head(ref.cleanKey);
          if (head) {
            found = true;
            knownKeys.add(ref.cleanKey);
          }
        } catch {}
      }

      if (!found) {
        missingAssets.push({
          collection: ref.collection,
          slug: ref.slug,
          field: ref.field,
          key: ref.cleanKey,
        });

        const msg = `Referenced media '${ref.rawKey}' not found in R2 storage (${ref.collection}/${ref.slug}.${ref.field})`;
        if (severity === 'error') {
          result.passed = false;
          result.errors.push(msg);
        } else {
          result.warnings.push(msg);
        }

        recommendations.push(
          `Upload '${ref.cleanKey}' to Media library or update '${ref.field}' in ${ref.collection}/${ref.slug}.`
        );
      }
    }

    result.metadata = {
      totalReferenced: referencedMap.length,
      missingAssets,
      recommendations: Array.from(new Set(recommendations)),
    };

    return result;
  };
}
