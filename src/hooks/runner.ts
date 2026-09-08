import { getSlottdConfig, getDefaultPacks } from '../config.js';
import { logActivity } from '../db/audit.js';
import type {
  CollectionDefinition,
  CollectionHooks,
  ItemHookContext,
  HookResult,
} from '../types.js';

export { composeHooks } from './builtins.js';

/**
 * Resolves the in-memory CollectionDefinition for a given collection name.
 * Checks:
 * 1. appConfig.collections
 * 2. appConfig.packs
 * 3. Default built-in packs (slotwirePack, blogPack)
 */
export function resolveCollectionDefinition(
  collectionName: string
): CollectionDefinition | undefined {
  const config = getSlottdConfig();

  // 1. Explicit collections in config
  if (config?.collections?.[collectionName]) {
    return config.collections[collectionName];
  }

  // 2. Configured packs in config
  if (config?.packs) {
    for (const pack of config.packs) {
      if (pack.collections?.[collectionName]) {
        return pack.collections[collectionName];
      }
    }
  }

  // 3. Fallback to default registered packs
  const defaultPacks = getDefaultPacks();
  for (const pack of defaultPacks) {
    if (pack.collections?.[collectionName]) {
      return pack.collections[collectionName];
    }
  }

  return undefined;
}

/**
 * Central runner for item lifecycle hooks.
 * Handles:
 * - Looking up collection hooks
 * - Executing the stage hook
 * - Evaluating draft vs published and `force: true` bypass policy
 * - Audit logging overrides
 */
export async function runItemHook<T = Record<string, any>>(
  stage: keyof CollectionHooks<T>,
  ctx: ItemHookContext<T>
): Promise<HookResult<T>> {
  const colDef = resolveCollectionDefinition(ctx.collection);
  const hook = colDef?.hooks?.[stage];

  if (!hook) {
    return { status: 'ok', data: ctx.data };
  }

  try {
    const rawResult = await (hook as any)(ctx);

    let result: HookResult<T>;
    if (rawResult && typeof rawResult === 'object' && 'status' in rawResult) {
      result = rawResult;
    } else if (rawResult && typeof rawResult === 'object') {
      result = { status: 'ok', data: rawResult as T };
    } else {
      result = { status: 'ok', data: ctx.data };
    }

    // Evaluate bypass policy
    if (result.status === 'error') {
      const isBypassable = result.bypassable !== false;

      // 1. If force: true is passed on a bypassable error, downgrade to warning & log override
      if (ctx.force && isBypassable) {
        try {
          await logActivity(ctx.db, {
            actor: ctx.user?.email || 'admin@localhost',
            action: 'override_constraint',
            collection: ctx.collection,
            documentId: ctx.id,
            documentTitle: (ctx.data as any)?.title || (ctx.data as any)?.slug || ctx.id,
            details: JSON.stringify({
              stage,
              code: result.code || 'VALIDATION_OVERRIDDEN',
              field: result.field,
              message: result.message,
            }),
          });
        } catch {}

        return {
          status: 'warning',
          message: `[Override] ${result.message}`,
          code: result.code,
          field: result.field,
          bypassable: true,
          data: result.data || ctx.data,
        };
      }

      // 2. If saving a draft on a bypassable error, downgrade to warning
      if (ctx.isDraft && isBypassable) {
        return {
          status: 'warning',
          message: `[Draft Warning] ${result.message}`,
          code: result.code,
          field: result.field,
          bypassable: true,
          data: result.data || ctx.data,
        };
      }
    }

    return result;
  } catch (err: any) {
    return {
      status: 'error',
      message: err.message || 'Hook execution failed',
      code: 'HOOK_EXECUTION_ERROR',
      bypassable: false,
    };
  }
}

/**
 * Formats a failed HookResult into a Directus REST-compliant JSON error response.
 */
export function formatHookErrorResponse(c: any, hookResult: HookResult) {
  // Non-bypassable errors (Tier 1 security, syntax) return 400 Bad Request
  // Bypassable constraint errors (Tier 2 schema/media) return 422 Unprocessable Entity
  const statusCode = hookResult.bypassable === false ? 400 : 422;

  return c.json(
    {
      error: 'ValidationFailed',
      message: hookResult.message || 'Validation failed',
      errors: [
        {
          message: hookResult.message,
          extensions: {
            code: hookResult.code || 'VALIDATION_FAILED',
            field: hookResult.field,
            bypassable: hookResult.bypassable ?? true,
          },
        },
      ],
    },
    statusCode
  );
}
