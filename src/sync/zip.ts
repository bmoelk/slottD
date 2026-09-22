/**
 * Zero-dependency, edge-compatible ZIP archive builder.
 * Uses standard ZIP format (compression method 0: STORE) with IEEE 802.3 CRC-32.
 * Fully compatible with Cloudflare Workers isolates, Node.js, and standard decompression tools.
 */

// Precomputed CRC-32 lookup table
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c;
}

export function calculateCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipFileInput {
  path: string;
  content: string | Uint8Array;
}

function writeUint16LE(arr: Uint8Array, offset: number, val: number) {
  arr[offset] = val & 0xff;
  arr[offset + 1] = (val >>> 8) & 0xff;
}

function writeUint32LE(arr: Uint8Array, offset: number, val: number) {
  arr[offset] = val & 0xff;
  arr[offset + 1] = (val >>> 8) & 0xff;
  arr[offset + 2] = (val >>> 16) & 0xff;
  arr[offset + 3] = (val >>> 24) & 0xff;
}

/**
 * Creates an uncompressed (STORE) ZIP archive from a list of files.
 */
export function createZipArchive(files: ZipFileInput[]): Uint8Array {
  const textEncoder = new TextEncoder();
  const date = new Date();

  // Convert Date to MS-DOS time and date
  const dosTime =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((Math.floor(date.getSeconds() / 2) & 0x1f) >>> 0);

  const dosDate =
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);

  interface PreparedFile {
    nameBytes: Uint8Array;
    contentBytes: Uint8Array;
    crc: number;
    localHeaderOffset: number;
  }

  const prepared: PreparedFile[] = [];
  let totalLocalSize = 0;
  let totalCentralDirSize = 0;

  for (const file of files) {
    // Normalize path separators to forward slash and strip leading slash
    const normalizedPath = file.path.replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBytes = textEncoder.encode(normalizedPath);
    const contentBytes =
      typeof file.content === 'string'
        ? textEncoder.encode(file.content)
        : file.content;
    const crc = calculateCrc32(contentBytes);

    const localHeaderSize = 30 + nameBytes.length + contentBytes.length;
    const centralHeaderSize = 46 + nameBytes.length;

    prepared.push({
      nameBytes,
      contentBytes,
      crc,
      localHeaderOffset: totalLocalSize,
    });

    totalLocalSize += localHeaderSize;
    totalCentralDirSize += centralHeaderSize;
  }

  const endRecordSize = 22;
  const totalArchiveSize = totalLocalSize + totalCentralDirSize + endRecordSize;
  const zip = new Uint8Array(totalArchiveSize);

  let offset = 0;

  // 1. Write Local File Headers + File Data
  for (const file of prepared) {
    // Signature 0x04034b50
    writeUint32LE(zip, offset, 0x04034b50);
    // Version needed to extract (2.0 = 20)
    writeUint16LE(zip, offset + 4, 20);
    // General purpose bit flag (0x0800 for UTF-8)
    writeUint16LE(zip, offset + 6, 0x0800);
    // Compression method (0 = STORE)
    writeUint16LE(zip, offset + 8, 0);
    // DOS time and date
    writeUint16LE(zip, offset + 10, dosTime);
    writeUint16LE(zip, offset + 12, dosDate);
    // CRC-32
    writeUint32LE(zip, offset + 14, file.crc);
    // Compressed size
    writeUint32LE(zip, offset + 18, file.contentBytes.length);
    // Uncompressed size
    writeUint32LE(zip, offset + 22, file.contentBytes.length);
    // File name length
    writeUint16LE(zip, offset + 26, file.nameBytes.length);
    // Extra field length (0)
    writeUint16LE(zip, offset + 28, 0);

    offset += 30;

    // File name
    zip.set(file.nameBytes, offset);
    offset += file.nameBytes.length;

    // File content
    zip.set(file.contentBytes, offset);
    offset += file.contentBytes.length;
  }

  const centralDirStartOffset = offset;

  // 2. Write Central Directory Headers
  for (const file of prepared) {
    // Signature 0x02014b50
    writeUint32LE(zip, offset, 0x02014b50);
    // Version made by (2.0 = 20)
    writeUint16LE(zip, offset + 4, 20);
    // Version needed to extract (20)
    writeUint16LE(zip, offset + 6, 20);
    // General purpose bit flag (0x0800 for UTF-8)
    writeUint16LE(zip, offset + 8, 0x0800);
    // Compression method (0 = STORE)
    writeUint16LE(zip, offset + 10, 0);
    // DOS time and date
    writeUint16LE(zip, offset + 12, dosTime);
    writeUint16LE(zip, offset + 14, dosDate);
    // CRC-32
    writeUint32LE(zip, offset + 16, file.crc);
    // Compressed size
    writeUint32LE(zip, offset + 20, file.contentBytes.length);
    // Uncompressed size
    writeUint32LE(zip, offset + 24, file.contentBytes.length);
    // File name length
    writeUint16LE(zip, offset + 28, file.nameBytes.length);
    // Extra field length
    writeUint16LE(zip, offset + 30, 0);
    // File comment length
    writeUint16LE(zip, offset + 32, 0);
    // Disk number start
    writeUint16LE(zip, offset + 34, 0);
    // Internal file attributes
    writeUint16LE(zip, offset + 36, 0);
    // External file attributes (0644 regular file: 0x81a40000)
    writeUint32LE(zip, offset + 38, 0x81a40000);
    // Relative offset of local header
    writeUint32LE(zip, offset + 42, file.localHeaderOffset);

    offset += 46;

    // File name
    zip.set(file.nameBytes, offset);
    offset += file.nameBytes.length;
  }

  const centralDirSize = offset - centralDirStartOffset;

  // 3. Write End of Central Directory Record (EOCD)
  // Signature 0x06054b50
  writeUint32LE(zip, offset, 0x06054b50);
  // Number of this disk
  writeUint16LE(zip, offset + 4, 0);
  // Disk where central directory starts
  writeUint16LE(zip, offset + 6, 0);
  // Number of central directory records on this disk
  writeUint16LE(zip, offset + 8, prepared.length);
  // Total number of central directory records
  writeUint16LE(zip, offset + 10, prepared.length);
  // Size of central directory
  writeUint32LE(zip, offset + 12, centralDirSize);
  // Offset of start of central directory
  writeUint32LE(zip, offset + 16, centralDirStartOffset);
  // Comment length (0)
  writeUint16LE(zip, offset + 20, 0);

  return zip;
}
