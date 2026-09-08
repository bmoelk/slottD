import type {
  HookResult,
  PublishCheck,
  PublishCheckResult,
  PublishHookContext,
  PublishReportData,
} from '../types.js';

export * from './slotwire.js';
export * from './terminology.js';
export * from './spellcheck.js';
export * from './media.js';

/**
 * Executes a pipeline of checks concurrently, aggregating results with explicit
 * origin attribution ([displayName] prefix) into a standardized HookResult.
 */
export async function runCheckPipeline(
  checks: PublishCheck[],
  ctx: PublishHookContext
): Promise<HookResult<PublishReportData>> {
  const checkResults: PublishCheckResult[] = await Promise.all(
    checks.map((check) => check(ctx))
  );

  // Preserve check source attribution explicitly via [displayName] prefix
  const attributedErrors = checkResults.flatMap((r) =>
    r.errors.map((e) => `[${r.displayName}] ${e}`)
  );
  const attributedWarnings = checkResults.flatMap((r) =>
    r.warnings.map((w) => `[${r.displayName}] ${w}`)
  );
  const allPassed = checkResults.every((r) => r.passed);

  const status = allPassed
    ? attributedWarnings.length > 0
      ? 'warning'
      : 'ok'
    : 'error';

  const message = allPassed
    ? attributedWarnings.length > 0
      ? 'Pre-publish verification passed with warnings'
      : 'All pre-publish verification checks passed'
    : `Pre-publish verification failed with ${attributedErrors.length} error(s)`;

  return {
    status,
    message,
    data: {
      summary: {
        totalChecks: checkResults.length,
        passed: checkResults.filter((r) => r.passed).length,
        failed: checkResults.filter((r) => !r.passed).length,
        warningCount: attributedWarnings.length,
      },
      checks: checkResults,
      errors: attributedErrors,
      warnings: attributedWarnings,
    },
  };
}
