const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_BYTES = 22;
const MAX_ZIP_COMMENT_BYTES = 0xffff;
const MAX_ENTRY_BYTES = 48 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 200;

export class ZipEntryError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 422) {
    super(code);
    this.name = 'ZipEntryError';
    this.code = code;
    this.status = status;
  }
}

export interface ExtractedZipEntry {
  path: string;
  bytes: ArrayBuffer;
  compressedSize: number;
  uncompressedSize: number;
  crc32: string;
  compression: 'stored' | 'deflate';
}

type CentralEntry = {
  path: string;
  flags: number;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
};

function u16(view: DataView, offset: number): number {
  if (offset < 0 || offset + 2 > view.byteLength) throw new ZipEntryError('invalid_zip_bounds');
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) throw new ZipEntryError('invalid_zip_bounds');
  return view.getUint32(offset, true);
}

export function zipEntryPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1_000) {
    throw new ZipEntryError('invalid_zip_entry_path', 400);
  }
  if (
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new ZipEntryError('invalid_zip_entry_path', 400);
  }
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new ZipEntryError('invalid_zip_entry_path', 400);
  }
  return value;
}

function findEocd(bytes: Uint8Array, view: DataView): number {
  if (bytes.byteLength < EOCD_MIN_BYTES) throw new ZipEntryError('invalid_zip_archive');
  const minimum = Math.max(0, bytes.byteLength - EOCD_MIN_BYTES - MAX_ZIP_COMMENT_BYTES);
  for (let offset = bytes.byteLength - EOCD_MIN_BYTES; offset >= minimum; offset -= 1) {
    if (u32(view, offset) !== EOCD_SIGNATURE) continue;
    const commentLength = u16(view, offset + 20);
    if (offset + EOCD_MIN_BYTES + commentLength === bytes.byteLength) return offset;
  }
  throw new ZipEntryError('zip_eocd_not_found');
}

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (!utf8 && bytes.some((byte) => byte > 0x7f)) {
    throw new ZipEntryError('zip_entry_name_encoding_unsupported');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new ZipEntryError('invalid_zip_entry_name');
  }
}

function centralEntry(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  centralEnd: number,
): { entry: CentralEntry; next: number } {
  if (offset + 46 > centralEnd || u32(view, offset) !== CENTRAL_SIGNATURE) {
    throw new ZipEntryError('invalid_zip_central_directory');
  }
  const flags = u16(view, offset + 8);
  const method = u16(view, offset + 10);
  const crc = u32(view, offset + 16);
  const compressedSize = u32(view, offset + 20);
  const uncompressedSize = u32(view, offset + 24);
  const nameLength = u16(view, offset + 28);
  const extraLength = u16(view, offset + 30);
  const commentLength = u16(view, offset + 32);
  const localOffset = u32(view, offset + 42);
  if (
    compressedSize === 0xffffffff ||
    uncompressedSize === 0xffffffff ||
    localOffset === 0xffffffff
  ) {
    throw new ZipEntryError('zip64_not_supported');
  }
  const next = offset + 46 + nameLength + extraLength + commentLength;
  if (next > centralEnd) throw new ZipEntryError('invalid_zip_central_directory');
  const name = decodeName(
    bytes.subarray(offset + 46, offset + 46 + nameLength),
    (flags & 0x0800) !== 0,
  );
  return {
    entry: {
      path: name,
      flags,
      method,
      crc32: crc,
      compressedSize,
      uncompressedSize,
      localOffset,
    },
    next,
  };
}

function locateEntry(archive: ArrayBuffer, requestedPath: string): {
  entry: CentralEntry;
  centralOffset: number;
} {
  const bytes = new Uint8Array(archive);
  const view = new DataView(archive);
  const eocd = findEocd(bytes, view);
  const disk = u16(view, eocd + 4);
  const centralDisk = u16(view, eocd + 6);
  const entriesOnDisk = u16(view, eocd + 8);
  const totalEntries = u16(view, eocd + 10);
  const centralSize = u32(view, eocd + 12);
  const centralOffset = u32(view, eocd + 16);
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== totalEntries ||
    totalEntries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new ZipEntryError('multi_disk_or_zip64_not_supported');
  }
  const centralEnd = centralOffset + centralSize;
  if (centralOffset > archive.byteLength || centralEnd > eocd || centralEnd < centralOffset) {
    throw new ZipEntryError('invalid_zip_central_directory');
  }

  let cursor = centralOffset;
  let match: CentralEntry | null = null;
  for (let index = 0; index < totalEntries; index += 1) {
    const parsed = centralEntry(bytes, view, cursor, centralEnd);
    cursor = parsed.next;
    if (parsed.entry.path !== requestedPath) continue;
    if (match) throw new ZipEntryError('zip_entry_ambiguous');
    match = parsed.entry;
  }
  if (!match) throw new ZipEntryError('zip_entry_not_found', 409);
  return { entry: match, centralOffset };
}

function compressedSlice(
  archive: ArrayBuffer,
  entry: CentralEntry,
  centralOffset: number,
): Uint8Array {
  const bytes = new Uint8Array(archive);
  const view = new DataView(archive);
  const offset = entry.localOffset;
  if (offset + 30 > centralOffset || u32(view, offset) !== LOCAL_SIGNATURE) {
    throw new ZipEntryError('invalid_zip_local_header');
  }
  const flags = u16(view, offset + 6);
  const method = u16(view, offset + 8);
  const nameLength = u16(view, offset + 26);
  const extraLength = u16(view, offset + 28);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedSize;
  if (dataOffset > centralOffset || dataEnd > centralOffset || dataEnd < dataOffset) {
    throw new ZipEntryError('invalid_zip_entry_bounds');
  }
  if ((flags & 0x0001) !== 0 || (entry.flags & 0x0001) !== 0) {
    throw new ZipEntryError('encrypted_zip_entry_not_supported');
  }
  if (method !== entry.method) throw new ZipEntryError('zip_entry_method_mismatch');
  const localName = decodeName(
    bytes.subarray(offset + 30, offset + 30 + nameLength),
    (flags & 0x0800) !== 0,
  );
  if (localName !== entry.path) throw new ZipEntryError('zip_entry_name_mismatch');
  return bytes.subarray(dataOffset, dataEnd);
}

async function inflateRaw(compressed: Uint8Array): Promise<ArrayBuffer> {
  try {
    const input = new Response(compressed).body;
    if (!input) throw new Error('missing_body');
    const output = input.pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(output).arrayBuffer();
  } catch {
    throw new ZipEntryError('zip_entry_decompression_failed');
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function crcHex(value: number): string {
  return value.toString(16).padStart(8, '0');
}

export async function extractZipEntry(
  archive: ArrayBuffer,
  requestedPathValue: unknown,
  maxEntryBytes = MAX_ENTRY_BYTES,
): Promise<ExtractedZipEntry> {
  const requestedPath = zipEntryPath(requestedPathValue);
  if (!Number.isInteger(maxEntryBytes) || maxEntryBytes < 1 || maxEntryBytes > MAX_ENTRY_BYTES) {
    throw new ZipEntryError('invalid_zip_entry_limit', 500);
  }
  const located = locateEntry(archive, requestedPath);
  const entry = located.entry;
  if ((entry.flags & 0x0001) !== 0) throw new ZipEntryError('encrypted_zip_entry_not_supported');
  if (entry.method !== 0 && entry.method !== 8) {
    throw new ZipEntryError('zip_entry_compression_unsupported');
  }
  if (entry.uncompressedSize > maxEntryBytes) throw new ZipEntryError('zip_entry_too_large', 413);
  if (
    entry.uncompressedSize > 0 &&
    entry.compressedSize === 0
  ) {
    throw new ZipEntryError('invalid_zip_entry_size');
  }
  if (
    entry.compressedSize > 0 &&
    entry.uncompressedSize / entry.compressedSize > MAX_COMPRESSION_RATIO
  ) {
    throw new ZipEntryError('zip_entry_compression_ratio_too_high', 413);
  }

  const compressed = compressedSlice(archive, entry, located.centralOffset);
  const bytes = entry.method === 0
    ? archive.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength)
    : await inflateRaw(compressed);
  if (bytes.byteLength !== entry.uncompressedSize) {
    throw new ZipEntryError('zip_entry_size_mismatch');
  }
  const actualCrc = crc32(new Uint8Array(bytes));
  if (actualCrc !== entry.crc32) throw new ZipEntryError('zip_entry_crc_mismatch');

  return {
    path: entry.path,
    bytes,
    compressedSize: entry.compressedSize,
    uncompressedSize: entry.uncompressedSize,
    crc32: crcHex(actualCrc),
    compression: entry.method === 0 ? 'stored' : 'deflate',
  };
}
