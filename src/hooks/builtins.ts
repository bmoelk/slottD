import { sql } from 'kysely';
import type { ItemHookContext, HookResult } from '../types.js';

/**
 * Normalizes any media key or path to canonical `/media/:key`.
 */
export function normalizeMediaPath(val: string): string {
  if (!val || typeof val !== 'string') return val;
  const trimmed = val.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('/media/')) return trimmed;
  if (trimmed.startsWith('media/')) return `/${trimmed}`;
  return `/media/${trimmed.replace(/^\/+/, '')}`;
}

/**
 * Extracts raw storage key from canonical path or URL.
 */
export function extractMediaKey(val: string): string {
  if (!val || typeof val !== 'string') return val;
  let s = val.trim();
  if (s.startsWith('http://') || s.startsWith('https://')) {
    try {
      s = new URL(s).pathname;
    } catch {}
  }
  s = s.replace(/^\/media\//, '').replace(/^\/assets\//, '').replace(/^\/+/, '');
  return s;
}

/**
 * Validates that referenced media exists in D1 `media` table or R2 bucket.
 * Normalizes input to canonical `/media/:key`.
 */
export function verifyMediaExists(fields: string | string[]) {
  const fieldList = Array.isArray(fields) ? fields : [fields];

  return async (ctx: ItemHookContext): Promise<HookResult> => {
    for (const field of fieldList) {
      const rawVal = ctx.data[field];
      if (!rawVal || typeof rawVal !== 'string') continue;

      // 1. Normalize to canonical /media/:key in data payload
      const canonicalPath = normalizeMediaPath(rawVal);
      ctx.data[field] = canonicalPath;

      // External URLs are permitted without R2 lookup
      if (rawVal.startsWith('http://') || rawVal.startsWith('https://')) {
        continue;
      }

      const key = extractMediaKey(rawVal);
      if (!key) continue;

      // 2. Check D1 media table
      let exists = false;
      try {
        const row = await ctx.db
          .selectFrom('media')
          .where((eb: any) => eb.or([eb('key', '=', key), eb('id', '=', key)]))
          .select(['id', 'key'])
          .executeTakeFirst();
        if (row) exists = true;
      } catch {}

      // 3. Fallback: check R2 bucket directly
      if (!exists && ctx.env?.MEDIA?.head) {
        try {
          const r2Obj = await ctx.env.MEDIA.head(key);
          if (r2Obj) exists = true;
        } catch {}
      }

      if (!exists) {
        const msg = `[${ctx.collection}] Media asset '${canonicalPath}' referenced in '${field}' does not exist in storage.`;
        if (ctx.isDraft || ctx.force) {
          return {
            status: 'warning',
            message: msg,
            code: 'MEDIA_NOT_FOUND',
            field,
            bypassable: true,
            data: ctx.data,
          };
        }
        return {
          status: 'error',
          message: msg,
          code: 'MEDIA_NOT_FOUND',
          field,
          bypassable: true,
        };
      }
    }

    return { status: 'ok', data: ctx.data };
  };
}

/**
 * Validates URL format:
 * - Strictly rejects dangerous pseudo-protocols (`javascript:`, `data:`, `vbscript:`).
 * - Prefers root-relative URLs (`/about`, `/pricing`).
 * - Flags absolute URLs (`https://...`) as warnings/bypassable errors unless allowAbsolute is true.
 */
export function validateUrlFormat(
  fields: string | string[],
  options?: { allowAbsolute?: boolean }
) {
  const fieldList = Array.isArray(fields) ? fields : [fields];
  const allowAbsolute = options?.allowAbsolute ?? false;

  return async (ctx: ItemHookContext): Promise<HookResult> => {
    for (const field of fieldList) {
      const val = ctx.data[field];
      if (!val || typeof val !== 'string') continue;

      const trimmed = val.trim();
      const lower = trimmed.toLowerCase();

      // Tier 1: Non-bypassable dangerous protocols (XSS)
      if (
        lower.startsWith('javascript:') ||
        lower.startsWith('data:') ||
        lower.startsWith('vbscript:')
      ) {
        return {
          status: 'error',
          message: `[${ctx.collection}] Unsafe URL protocol detected in '${field}'.`,
          code: 'UNSAFE_URL',
          field,
          bypassable: false,
        };
      }

      // Root-relative or fragment is always safe
      if (trimmed.startsWith('/') || trimmed.startsWith('#')) {
        continue;
      }

      // Safe non-relative schemes
      if (lower.startsWith('mailto:') || lower.startsWith('tel:')) {
        continue;
      }

      // Absolute URL (http:// or https://)
      if (lower.startsWith('http://') || lower.startsWith('https://')) {
        if (!allowAbsolute) {
          const msg = `[${ctx.collection}] Field '${field}' should be a relative URL (e.g. /about). Use force: true to override.`;
          if (ctx.isDraft || ctx.force) {
            return {
              status: 'warning',
              message: msg,
              code: 'ABSOLUTE_URL_DISCOURAGED',
              field,
              bypassable: true,
              data: ctx.data,
            };
          }
          return {
            status: 'error',
            message: msg,
            code: 'ABSOLUTE_URL_DISCOURAGED',
            field,
            bypassable: true,
          };
        }
        continue;
      }

      // If it's a relative URL missing leading slash (e.g. "about" or "pricing/services")
      // auto-prefix with leading slash
      if (!trimmed.includes('://')) {
        ctx.data[field] = `/${trimmed}`;
      }
    }

    return { status: 'ok', data: ctx.data };
  };
}

/**
 * Auto-increments the `order` field within a parent scope (e.g. pageSlug).
 */
export function autoIncrementOrder(options?: {
  groupField?: string | string[];
  orderField?: string;
  step?: number;
  defaultStart?: number;
}) {
  const orderField = options?.orderField || 'order';
  const step = options?.step ?? 10;
  const defaultStart = options?.defaultStart ?? 10;

  return async (ctx: ItemHookContext): Promise<HookResult> => {
    // Only calculate if not explicitly provided
    if (
      ctx.data[orderField] === undefined ||
      ctx.data[orderField] === null ||
      ctx.data[orderField] === ''
    ) {
      let query = ctx.db
        .selectFrom('documents')
        .where('collection', '=', ctx.collection);

      if (options?.groupField) {
        const groups = Array.isArray(options.groupField)
          ? options.groupField
          : [options.groupField];
        for (const gf of groups) {
          const groupVal = ctx.data[gf];
          if (groupVal !== undefined && groupVal !== null) {
            query = query.where(sql`json_extract(data, '$.' || ${gf}) = ${groupVal}`);
          }
        }
      }

      const res = await query
        .select(
          sql`MAX(CAST(json_extract(data, '$.' || ${orderField}) AS INTEGER))`.as('maxOrder')
        )
        .executeTakeFirst();

      const max = (res as any)?.maxOrder;
      const nextOrder = max !== null && max !== undefined && !isNaN(Number(max))
        ? Number(max) + step
        : defaultStart;

      ctx.data[orderField] = nextOrder;
    }

    return { status: 'ok', data: ctx.data };
  };
}

/**
 * Validates that required fields are non-empty.
 */
export function validateRequiredFields(fields: string[]) {
  return async (ctx: ItemHookContext): Promise<HookResult> => {
    for (const field of fields) {
      const val = ctx.data[field];
      const isEmpty =
        val === undefined ||
        val === null ||
        (typeof val === 'string' && val.trim() === '');

      if (isEmpty) {
        const msg = `[${ctx.collection}] Field '${field}' is required to publish.`;
        if (ctx.isDraft || ctx.force) {
          return {
            status: 'warning',
            message: msg,
            code: 'REQUIRED_FIELD_MISSING',
            field,
            bypassable: true,
            data: ctx.data,
          };
        }
        return {
          status: 'error',
          message: msg,
          code: 'REQUIRED_FIELD_MISSING',
          field,
          bypassable: true,
        };
      }
    }

    return { status: 'ok', data: ctx.data };
  };
}

/**
 * Verifies that a foreign reference exists in the parent collection.
 */
export function validateParentExists(options: {
  parentCollection: string;
  parentKey?: string;
  foreignField: string;
}) {
  const parentKey = options.parentKey || 'slug';
  const foreignField = options.foreignField;

  return async (ctx: ItemHookContext): Promise<HookResult> => {
    const foreignVal = ctx.data[foreignField];
    if (!foreignVal) return { status: 'ok', data: ctx.data };

    try {
      const parent = await ctx.db
        .selectFrom('documents')
        .where('collection', '=', options.parentCollection)
        .where((eb: any) =>
          eb.or([
            eb('slug', '=', foreignVal),
            eb('id', '=', foreignVal),
            eb(sql`json_extract(data, '$.' || ${parentKey})`, '=', foreignVal),
          ])
        )
        .select(['id', 'slug'])
        .executeTakeFirst();

      if (!parent) {
        const msg = `[${ctx.collection}] Parent document '${options.parentCollection}' with ${parentKey}='${foreignVal}' not found.`;
        if (ctx.isDraft || ctx.force) {
          return {
            status: 'warning',
            message: msg,
            code: 'PARENT_NOT_FOUND',
            field: foreignField,
            bypassable: true,
            data: ctx.data,
          };
        }
        return {
          status: 'error',
          message: msg,
          code: 'PARENT_NOT_FOUND',
          field: foreignField,
          bypassable: true,
        };
      }
    } catch {}

    return { status: 'ok', data: ctx.data };
  };
}

/**
 * In `beforeDelete`, prevents deletion if child documents reference this record.
 */
export function guardReferentialIntegrity(options: {
  targetCollection: string;
  foreignKey: string;
  localField?: string;
}) {
  const localField = options.localField || 'slug';

  return async (ctx: ItemHookContext): Promise<HookResult> => {
    const val =
      ctx.existing?.[localField] ||
      ctx.existing?.slug ||
      ctx.id;

    if (!val) return { status: 'ok' };

    try {
      const child = await ctx.db
        .selectFrom('documents')
        .where('collection', '=', options.targetCollection)
        .where(sql`json_extract(data, '$.' || ${options.foreignKey}) = ${val}`)
        .select('id')
        .executeTakeFirst();

      if (child) {
        const msg = `[${ctx.collection}] Cannot delete '${val}': referenced by active records in '${options.targetCollection}'.`;
        if (ctx.force) {
          return {
            status: 'warning',
            message: msg,
            code: 'REFERENTIAL_INTEGRITY_VIOLATION',
            bypassable: true,
          };
        }
        return {
          status: 'error',
          message: msg,
          code: 'REFERENTIAL_INTEGRITY_VIOLATION',
          bypassable: true,
        };
      }
    } catch {}

    return { status: 'ok' };
  };
}

/**
 * Composes multiple lifecycle hook functions into a single pipeline.
 */
export function composeHooks<T = Record<string, any>>(
  ...hooks: Array<((ctx: ItemHookContext<T>) => Promise<HookResult<T> | T | void>) | undefined>
): (ctx: ItemHookContext<T>) => Promise<HookResult<T>> {
  return async (ctx: ItemHookContext<T>): Promise<HookResult<T>> => {
    let currentData = ctx.data;

    for (const hook of hooks) {
      if (!hook) continue;
      const res = await hook({ ...ctx, data: currentData });

      if (res && typeof res === 'object') {
        if ('status' in res) {
          const hr = res as HookResult<T>;
          if (hr.data) currentData = hr.data;
          if (hr.status === 'error') {
            return { ...hr, data: currentData };
          }
        } else {
          // Hook returned raw modified data
          currentData = res as T;
        }
      }
    }

    return { status: 'ok', data: currentData };
  };
}

