import { describe, it, expect, vi } from 'vitest';
import { mediaIntegrityCheck } from '../src/checks/media.js';

describe('SlottD Media Integrity Pre-Publish Check', () => {
  it('passes cleanly when all referenced media files exist', async () => {
    const mockDb = {
      selectFrom: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          execute: vi.fn().mockResolvedValue([
            { id: '1', key: 'pottery-1.jpg', filename: 'pottery-1.jpg' },
          ]),
        }),
      }),
    };

    const check = mediaIntegrityCheck({ severity: 'error' });
    const result = await check({
      changedItems: [
        {
          collection: 'gallery',
          slug: 'pottery-1',
          status: 'modified',
          modifiedFields: ['imageUrl'],
          delta: { imageUrl: '/media/pottery-1.jpg' },
        },
      ],
      db: mockDb,
    } as any);

    expect(result.passed).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('detects missing media and aggregates recommendations without failing silently', async () => {
    const mockDb = {
      selectFrom: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          execute: vi.fn().mockResolvedValue([
            { id: '1', key: 'pottery-1.jpg', filename: 'pottery-1.jpg' },
          ]),
        }),
      }),
    };

    const check = mediaIntegrityCheck({ severity: 'error' });
    const result = await check({
      changedItems: [
        {
          collection: 'gallery',
          slug: 'pottery-2',
          status: 'new',
          modifiedFields: ['imageUrl'],
          delta: { imageUrl: '/media/pottery-2.jpg' },
        },
      ],
      db: mockDb,
    } as any);

    expect(result.passed).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("Referenced media '/media/pottery-2.jpg' not found");
    expect(result.metadata?.recommendations).toContain(
      "Upload 'pottery-2.jpg' to Media library or update 'imageUrl' in gallery/pottery-2."
    );
  });
});
