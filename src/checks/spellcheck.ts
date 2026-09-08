import type { PublishCheck, PublishCheckResult, PublishHookContext } from '../types.js';

export interface SpellCheckOptions {
  language?: string;
  ignoredWords?: string[];
  severity?: 'error' | 'warning';
}

/**
 * Optional Hunspell-based spellchecker using nspell and dictionary-en.
 * Gracefully no-ops if nspell is not installed in the host project.
 */
export function spellCheck(options: SpellCheckOptions = {}): PublishCheck {
  const { ignoredWords = [], severity = 'warning' } = options;
  const ignoredSet = new Set(ignoredWords.map((w) => w.toLowerCase()));

  return async (ctx: PublishHookContext): Promise<PublishCheckResult> => {
    const result: PublishCheckResult = {
      name: 'spell-check',
      displayName: 'Spell Checker (Hunspell)',
      passed: true,
      errors: [],
      warnings: [],
      metadata: { ignoredWordsCount: ignoredWords.length },
    };

    let nspell: any;
    let dictionary: any;

    try {
      // Dynamic optional import
      const nspellModule = await (Function('return import("nspell")')() as Promise<any>);
      const dictModule = await (Function('return import("dictionary-en")')() as Promise<any>);
      nspell = nspellModule.default || nspellModule;
      dictionary = dictModule.default || dictModule;
    } catch {
      result.metadata = { ...result.metadata, skipped: true, reason: 'nspell or dictionary-en not installed' };
      return result;
    }

    try {
      const speller = nspell(dictionary);
      for (const word of ignoredWords) {
        speller.add(word);
      }

      const targetList = ctx.changedItems || [];

      for (const item of targetList) {
        const delta = item.delta || {};
        for (const [field, val] of Object.entries(delta)) {
          if (typeof val === 'string') {
            // Remove code blocks, markdown urls, and html tags before checking
            const cleanText = val
              .replace(/```[\s\S]*?```/g, '')
              .replace(/`[^`]+`/g, '')
              .replace(/https?:\/\/\S+/g, '')
              .replace(/<[^>]+>/g, '');

            const words = cleanText.match(/[a-zA-Z]{3,}/g) || [];
            for (const word of words) {
              if (ignoredSet.has(word.toLowerCase())) continue;
              if (!speller.correct(word)) {
                const msg = `Possible typo '${word}' in ${item.collection}/${item.slug}.${field}`;
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
    } catch (e: any) {
      result.metadata = { ...result.metadata, error: e.message };
    }

    return result;
  };
}
