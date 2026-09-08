import type { PublishCheck, PublishCheckResult, PublishHookContext } from '../types.js';

export interface TerminologyCheckOptions {
  flaggedTerms: string[];
  severity?: 'error' | 'warning';
}

export function terminologyCheck(options: TerminologyCheckOptions): PublishCheck {
  const { flaggedTerms, severity = 'error' } = options;
  const normalizedTerms = flaggedTerms.map((t) => t.toLowerCase());

  return async (ctx: PublishHookContext): Promise<PublishCheckResult> => {
    const result: PublishCheckResult = {
      name: 'terminology-linter',
      displayName: 'Brand & Terminology Linter',
      passed: true,
      errors: [],
      warnings: [],
      metadata: { flaggedTermsCount: flaggedTerms.length },
    };

    const targetList = ctx.changedItems || [];

    for (const item of targetList) {
      const delta = item.delta || {};
      for (const [field, val] of Object.entries(delta)) {
        if (typeof val === 'string') {
          const lowerVal = val.toLowerCase();
          for (const term of normalizedTerms) {
            if (lowerVal.includes(term)) {
              const msg = `Found discouraged phrase '${term}' in ${item.collection}/${item.slug}.${field}`;
              if (severity === 'error') {
                result.passed = false;
                result.errors.push(msg);
              } else {
                result.warnings.push(msg);
              }
            }
          }
        }
      }
    }

    return result;
  };
}
