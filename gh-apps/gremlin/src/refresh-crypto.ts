export interface EncryptedRefreshReceipt {
  expiresAt: number;
  iv: string;
  ciphertext: string;
}

// Derive an independent encryption key for every receipt from an existing
// Worker secret. The receipt key never leaves the Gremlin Worker.
async function deriveKey(secret: string, receiptId: string): Promise<CryptoKey> {
  const master = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new TextEncoder().encode('gremlin-refresh-receipts-v1'),
    info: new TextEncoder().encode(receiptId),
  }, master, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(input: string): Uint8Array {
  return Uint8Array.from(atob(input), (char) => char.charCodeAt(0));
}

export async function sealRefreshReceipt(
  value: unknown, secret: string, receiptId: string, expiresAt: number,
): Promise<EncryptedRefreshReceipt> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(secret, receiptId);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)),
  );
  return { expiresAt, iv: base64(iv), ciphertext: base64(new Uint8Array(encrypted)) };
}

export async function openRefreshReceipt<T>(
  receipt: EncryptedRefreshReceipt, secret: string, receiptId: string,
): Promise<T> {
  const key = await deriveKey(secret, receiptId);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(receipt.iv) }, key, fromBase64(receipt.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
