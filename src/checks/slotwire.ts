import type { PublishCheck, PublishCheckResult, PublishHookContext } from '../types.js';

export interface SlotwireCheckOptions {
  endpoint: string;
  timeoutMs?: number;
  strict?: boolean;
}

export function slotwireContractCheck(options: SlotwireCheckOptions): PublishCheck {
  const { endpoint, timeoutMs = 8000 } = options;

  return async (ctx: PublishHookContext): Promise<PublishCheckResult> => {
    const result: PublishCheckResult = {
      name: 'slotwire-contracts',
      displayName: 'SlotWire Schema Contracts',
      passed: true,
      errors: [],
      warnings: [],
      metadata: { endpoint },
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'SlottD-PrePublishRunner/2.7',
        },
        body: JSON.stringify({
          bundle: ctx.bundle,
          changedItems: ctx.changedItems || [],
          timestamp: ctx.timestamp || Date.now(),
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        result.passed = false;
        result.errors.push(`Validation endpoint returned HTTP ${res.status}: ${errorText.slice(0, 200)}`);
        return result;
      }

      const report: any = await res.json().catch(() => ({}));
      result.metadata = { ...result.metadata, ...report };

      if (report.valid === false || (report.errors && report.errors.length > 0)) {
        result.passed = false;
        if (Array.isArray(report.errors)) {
          report.errors.forEach((err: any) => {
            const msg = typeof err === 'string' ? err : `${err.field || err.slotKey}: ${err.message}`;
            result.errors.push(msg);
          });
        }
      }

      if (Array.isArray(report.warnings)) {
        report.warnings.forEach((warn: any) => {
          const msg = typeof warn === 'string' ? warn : `${warn.field || warn.slotKey}: ${warn.message}`;
          result.warnings.push(msg);
        });
      }

      return result;
    } catch (err: any) {
      result.passed = false;
      result.errors.push(`Failed to reach SlotWire validation endpoint: ${err.message || err}`);
      return result;
    }
  };
}
