import assert from 'node:assert/strict';
import test from 'node:test';

import { extractZipEntry, zipEntryPath } from '../src/zip-entry.ts';

const FIXTURE = 'UEsDBBQAAAAIAMI0FV2is6GyKAAAAEAfAAAXAAAAb3V0cHV0cy9hcHAtcmVsZWFzZS5hcGvtxTERADAIBDBFFfF33VgY8K8FISRL0vUzebFt27Zt27Zt27Zt+/ALUEsDBBQAAAAIAMI0FV2TlKIQGgAAABgAAAAQAAAAY2hlY2tzdW1zLnNoYTI1NktMSjY0MlZQSCwo0C1KzUlNLE7VSyzI5gIAUEsBAhQDFAAAAAgAwjQVXaKzobIoAAAAQB8AABcAAAAAAAAAAAAAAIABAAAAAG91dHB1dHMvYXBwLXJlbGVhc2UuYXBrUEsBAhQDFAAAAAgAwjQVXZOUohAaAAAAGAAAABAAAAAAAAAAAAAAAIABXQAAAGNoZWNrc3Vtcy5zaGEyNTZQSwUGAAAAAAIAAgCDAAAApQAAAAAA';

function archive(): ArrayBuffer {
  const buffer = Buffer.from(FIXTURE, 'base64');
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

test('extracts one exact deflated artifact entry and verifies its CRC', async () => {
  const entry = await extractZipEntry(archive(), 'outputs/app-release.apk');
  assert.equal(entry.path, 'outputs/app-release.apk');
  assert.equal(entry.uncompressedSize, 8_000);
  assert.equal(entry.crc32, 'b2a1b3a2');
  assert.equal(entry.compression, 'deflate');
  assert.equal(Buffer.from(entry.bytes).toString(), 'APKDATA-'.repeat(1_000));
});

test('extracts a second exact entry rather than guessing by extension', async () => {
  const entry = await extractZipEntry(archive(), 'checksums.sha256');
  assert.equal(Buffer.from(entry.bytes).toString(), 'abc123  app-release.apk\n');
  await assert.rejects(
    extractZipEntry(archive(), 'app-release.apk'),
    /zip_entry_not_found/,
  );
});

test('rejects traversal and ambiguous path shapes before reading the archive', () => {
  assert.throws(() => zipEntryPath('../app.apk'), /invalid_zip_entry_path/);
  assert.throws(() => zipEntryPath('/app.apk'), /invalid_zip_entry_path/);
  assert.throws(() => zipEntryPath('dir\\app.apk'), /invalid_zip_entry_path/);
});

test('rejects a CRC-corrupted central directory snapshot', async () => {
  const source = new Uint8Array(archive());
  const signature = [0x50, 0x4b, 0x01, 0x02];
  let central = -1;
  for (let index = 0; index <= source.length - signature.length; index += 1) {
    if (signature.every((byte, offset) => source[index + offset] === byte)) {
      central = index;
      break;
    }
  }
  assert.ok(central >= 0);
  source[central + 16] ^= 0xff;
  await assert.rejects(
    extractZipEntry(source.buffer, 'outputs/app-release.apk'),
    /zip_entry_crc_mismatch/,
  );
});
