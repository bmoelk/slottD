import type { GitContentItem } from './git-sync.js';

export interface DocumentDiff {
  collection: string;
  slug: string;
  title: string;
  type: 'added' | 'removed' | 'modified' | 'unchanged';
  changes?: string[];
}

export interface DiffReport {
  tag: string;
  totalActive: number;
  totalTag: number;
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
  diffs: DocumentDiff[];
  summary: string;
  formattedOutput: string;
}

/**
 * Computes semantic diff between active D1 database items and a Git tag snapshot.
 */
export function computeContentDiff(
  activeItems: GitContentItem[],
  tagItems: GitContentItem[],
  tagName: string
): DiffReport {
  const activeMap = new Map<string, GitContentItem>();
  for (const item of activeItems) {
    activeMap.set(`${item.collection}:${item.slug}`, item);
  }

  const tagMap = new Map<string, GitContentItem>();
  for (const item of tagItems) {
    tagMap.set(`${item.collection}:${item.slug}`, item);
  }

  const diffs: DocumentDiff[] = [];
  let added = 0;
  let removed = 0;
  let modified = 0;
  let unchanged = 0;

  // 1. Check all active D1 items against tag snapshot
  for (const [key, active] of activeMap) {
    const fromTag = tagMap.get(key);
    if (!fromTag) {
      added++;
      diffs.push({
        collection: active.collection,
        slug: active.slug,
        title: active.title || active.slug,
        type: 'added',
      });
    } else {
      const changes: string[] = [];
      if ((active.title || '') !== (fromTag.title || '')) {
        changes.push(`Title: "${fromTag.title}" -> "${active.title}"`);
      }
      if ((active.status || 'published') !== (fromTag.status || 'published')) {
        changes.push(`Status: "${fromTag.status}" -> "${active.status}"`);
      }

      // Deep compare custom data attributes
      const activeDataStr = JSON.stringify(active.data || {});
      const tagDataStr = JSON.stringify(fromTag.data || {});
      if (activeDataStr !== tagDataStr) {
        // Find specific keys that changed
        const activeKeys = Object.keys(active.data || {});
        const tagKeys = Object.keys(fromTag.data || {});
        const allKeys = Array.from(new Set([...activeKeys, ...tagKeys]));
        const fieldChanges: string[] = [];

        for (const k of allKeys) {
          const vActive = active.data?.[k];
          const vTag = fromTag.data?.[k];
          if (JSON.stringify(vActive) !== JSON.stringify(vTag)) {
            fieldChanges.push(k);
          }
        }

        if (fieldChanges.length > 0) {
          changes.push(`Fields changed: [${fieldChanges.join(', ')}]`);
        } else {
          changes.push('Content attributes updated');
        }
      }

      if (changes.length > 0) {
        modified++;
        diffs.push({
          collection: active.collection,
          slug: active.slug,
          title: active.title || active.slug,
          type: 'modified',
          changes,
        });
      } else {
        unchanged++;
        diffs.push({
          collection: active.collection,
          slug: active.slug,
          title: active.title || active.slug,
          type: 'unchanged',
        });
      }
    }
  }

  // 2. Check for items present in tag snapshot but missing in active D1
  for (const [key, fromTag] of tagMap) {
    if (!activeMap.has(key)) {
      removed++;
      diffs.push({
        collection: fromTag.collection,
        slug: fromTag.slug,
        title: fromTag.title || fromTag.slug,
        type: 'removed',
      });
    }
  }

  const summary = `${modified} modified, ${added} added, ${removed} removed, ${unchanged} unchanged (Total active: ${activeItems.length}, Tag: ${tagItems.length}).`;

  const lines: string[] = [];
  lines.push(`Content Diff against tag '${tagName}':`);
  lines.push(`Summary: ${summary}`);
  lines.push('───────────────────────────────────────────────────');

  const changedDiffs = diffs.filter((d) => d.type !== 'unchanged');
  if (changedDiffs.length === 0) {
    lines.push('✨ Working database matches Git tag exactly (0 changes).');
  } else {
    for (const d of changedDiffs) {
      if (d.type === 'added') {
        lines.push(`  + [${d.collection}] ${d.slug} ("${d.title}") [NEW in D1]`);
      } else if (d.type === 'removed') {
        lines.push(`  - [${d.collection}] ${d.slug} ("${d.title}") [DELETED in D1 / Present in Tag]`);
      } else if (d.type === 'modified') {
        lines.push(`  ~ [${d.collection}] ${d.slug} ("${d.title}")`);
        if (d.changes) {
          for (const ch of d.changes) {
            lines.push(`      • ${ch}`);
          }
        }
      }
    }
  }

  return {
    tag: tagName,
    totalActive: activeItems.length,
    totalTag: tagItems.length,
    added,
    removed,
    modified,
    unchanged,
    diffs,
    summary,
    formattedOutput: lines.join('\n'),
  };
}
