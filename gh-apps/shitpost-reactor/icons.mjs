const COLORS = {
  background: [17, 17, 17, 255],
  yellow: [245, 233, 78, 255],
  paper: [242, 242, 235, 255],
  magenta: [232, 90, 208, 255],
  red: [255, 81, 71, 255],
  cyan: [70, 224, 224, 255],
  ink: [17, 17, 17, 255],
};

export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="9" fill="#111"/>
  <rect x="3" y="3" width="58" height="58" rx="7" fill="none" stroke="#f5e94e" stroke-width="3"/>
  <path d="M14 10h27l9 9v32H14z" fill="#f2f2eb"/>
  <path d="M41 10v9h9z" fill="#e85ad0"/>
  <path d="M20 25h24v3H20zm0 8h29v3H20zm0 8h20v3H20z" fill="#111"/>
  <path d="M18 47l9-5 7 7 12-8" fill="none" stroke="#ff5147" stroke-width="4" stroke-linecap="square" stroke-linejoin="miter"/>
  <rect x="49" y="14" width="4" height="4" fill="#46e0e0"/>
</svg>`;

function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function u32be(value) {
  return Uint8Array.of(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const payload = concatBytes([typeBytes, data]);
  return concatBytes([u32be(data.length), payload, u32be(crc32(payload))]);
}

function adler32(bytes) {
  let checksumA = 1;
  let checksumB = 0;
  for (const byte of bytes) {
    checksumA = (checksumA + byte) % 65521;
    checksumB = (checksumB + checksumA) % 65521;
  }
  return ((checksumB << 16) | checksumA) >>> 0;
}

function zlibStore(bytes) {
  const blocks = [Uint8Array.of(0x78, 0x01)];
  let offset = 0;
  while (offset < bytes.length) {
    const remaining = bytes.length - offset;
    const length = Math.min(remaining, 65535);
    const final = offset + length >= bytes.length ? 1 : 0;
    const nlen = 0xffff ^ length;
    blocks.push(Uint8Array.of(
      final,
      length & 0xff,
      (length >>> 8) & 0xff,
      nlen & 0xff,
      (nlen >>> 8) & 0xff,
    ));
    blocks.push(bytes.subarray(offset, offset + length));
    offset += length;
  }
  blocks.push(u32be(adler32(bytes)));
  return concatBytes(blocks);
}

function nearSegment(x, y, x1, y1, x2, y2, width) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = (dx * dx) + (dy * dy);
  const projection = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (((x - x1) * dx) + ((y - y1) * dy)) / lengthSquared));
  const px = x1 + (projection * dx);
  const py = y1 + (projection * dy);
  return Math.hypot(x - px, y - py) <= width;
}

function pixelColor(x, y) {
  const border = x <= 0.055 || x >= 0.945 || y <= 0.055 || y >= 0.945;
  if (border) return COLORS.yellow;

  const paper = x >= 0.22 && x <= 0.78 && y >= 0.16 && y <= 0.80;
  if (!paper) {
    if (x >= 0.755 && x <= 0.825 && y >= 0.20 && y <= 0.27) return COLORS.cyan;
    return COLORS.background;
  }

  if (x >= 0.61 && y <= 0.33 && y >= (x - 0.45)) return COLORS.magenta;

  const bar1 = y >= 0.36 && y <= 0.405 && x >= 0.30 && x <= 0.68;
  const bar2 = y >= 0.47 && y <= 0.515 && x >= 0.30 && x <= 0.75;
  const bar3 = y >= 0.58 && y <= 0.625 && x >= 0.30 && x <= 0.62;
  if (bar1 || bar2 || bar3) return COLORS.ink;

  const red = nearSegment(x, y, 0.28, 0.72, 0.42, 0.64, 0.026)
    || nearSegment(x, y, 0.42, 0.64, 0.53, 0.74, 0.026)
    || nearSegment(x, y, 0.53, 0.74, 0.70, 0.62, 0.026);
  return red ? COLORS.red : COLORS.paper;
}

export function renderPng(size) {
  if (!Number.isInteger(size) || size < 16 || size > 512) throw new Error('invalid_icon_size');
  const stride = 1 + (size * 4);
  const raw = new Uint8Array(stride * size);

  for (let y = 0; y < size; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const color = pixelColor((x + 0.5) / size, (y + 0.5) / size);
      const offset = row + 1 + (x * 4);
      raw.set(color, offset);
    }
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  ihdr.set([8, 6, 0, 0, 0], 8);

  return concatBytes([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlibStore(raw)),
    pngChunk('IEND', new Uint8Array()),
  ]);
}

export function renderIco(size = 32) {
  const png = renderPng(size);
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, 1, true);
  header[6] = size >= 256 ? 0 : size;
  header[7] = size >= 256 ? 0 : size;
  header[8] = 0;
  header[9] = 0;
  view.setUint16(10, 1, true);
  view.setUint16(12, 32, true);
  view.setUint32(14, png.length, true);
  view.setUint32(18, header.length, true);
  return concatBytes([header, png]);
}

const PNG_ROUTES = new Map([
  ['/favicon-16x16.png', 16],
  ['/favicon-32x32.png', 32],
  ['/favicon-96x96.png', 96],
  ['/apple-touch-icon.png', 180],
  ['/apple-touch-icon-precomposed.png', 180],
  ['/mstile-150x150.png', 150],
  ['/icon-192.png', 192],
  ['/icon-512.png', 512],
  ['/icon-512-maskable.png', 512],
]);

export function iconAsset(pathname) {
  if (pathname === '/favicon.svg') {
    return { body: ICON_SVG, contentType: 'image/svg+xml; charset=utf-8' };
  }
  if (pathname === '/favicon.ico') {
    return { body: renderIco(32), contentType: 'image/x-icon' };
  }
  const size = PNG_ROUTES.get(pathname);
  if (size) return { body: renderPng(size), contentType: 'image/png' };
  return null;
}
