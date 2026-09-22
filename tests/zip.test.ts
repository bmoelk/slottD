import { describe, it, expect } from 'vitest';
import { createZipArchive, calculateCrc32 } from '../src/sync/zip.js';
import * as zlib from 'node:zlib';

describe('Zero-Dependency Edge ZIP Builder', () => {
  it('calculates correct CRC-32 for strings', () => {
    const encoder = new TextEncoder();
    const data = encoder.encode('123456789');
    // Standard test vector for CRC-32 of "123456789" is 0xcbf43926 (3421780262)
    expect(calculateCrc32(data)).toBe(0xcbf43926);
  });

  it('builds a valid ZIP archive containing multiple files and folders', () => {
    const files = [
      { path: 'README.md', content: '# Welcome\n\nThis is a test readme.' },
      { path: 'pages/home.json', content: JSON.stringify({ title: 'Home Page' }, null, 2) },
      { path: 'pages/home.md', content: '## Home Content' },
    ];

    const zipBytes = createZipArchive(files);
    expect(zipBytes).toBeInstanceOf(Uint8Array);
    expect(zipBytes.length).toBeGreaterThan(100);

    // Verify ZIP magic signature (PK\x03\x04)
    expect(zipBytes[0]).toBe(0x50);
    expect(zipBytes[1]).toBe(0x4b);
    expect(zipBytes[2]).toBe(0x03);
    expect(zipBytes[3]).toBe(0x04);
  });
});
