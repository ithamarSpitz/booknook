/**
 * One-off icon rasterizer (pine palette). Run: node public/icons/gen-icons.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));

const WALL = [255, 255, 255];
const INK = [51, 38, 26];
const ACCENT = [154, 106, 58];
const BOARD = [220, 191, 138];
const PLUS_BG = [241, 226, 194];

/** @param {number} size */
function rgba(size) {
  const px = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const o = i * 4;
    px[o] = WALL[0];
    px[o + 1] = WALL[1];
    px[o + 2] = WALL[2];
    px[o + 3] = 255;
  }
  return px;
}

/** @param {Uint8Array} px @param {number} size @param {number} x0 @param {number} y0 @param {number} w @param {number} h @param {number[]} rgb */
function fillRect(px, size, x0, y0, w, h, rgb) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const o = (y * size + x) * 4;
      px[o] = rgb[0];
      px[o + 1] = rgb[1];
      px[o + 2] = rgb[2];
      px[o + 3] = 255;
    }
  }
}

/** @param {number} size */
function drawIcon(size) {
  const px = rgba(size);
  const m = Math.round(size * 0.12);
  const shelfH = Math.round(size * 0.08);
  const shelfY = Math.round(size * 0.62);
  fillRect(px, size, m, shelfY, size - m * 2, shelfH, BOARD);

  const bookW = Math.round(size * 0.14);
  const bookH = Math.round(size * 0.34);
  const gap = Math.round(size * 0.04);
  let x = Math.round(size * 0.22);
  const bookY = shelfY - bookH;
  for (let i = 0; i < 3; i++) {
    fillRect(px, size, x, bookY, bookW, bookH, i === 1 ? ACCENT : INK);
    x += bookW + gap;
  }

  const plus = Math.round(size * 0.16);
  const px0 = size - m - plus;
  const py0 = bookY + Math.round((bookH - plus) / 2);
  fillRect(px, size, px0, py0, plus, plus, PLUS_BG);
  const stroke = Math.max(2, Math.round(size * 0.018));
  const cx = px0 + Math.floor(plus / 2);
  const cy = py0 + Math.floor(plus / 2);
  fillRect(px, size, cx - Math.floor(plus * 0.22), cy - stroke, Math.round(plus * 0.44), stroke * 2, INK);
  fillRect(px, size, cx - stroke, cy - Math.floor(plus * 0.22), stroke * 2, Math.round(plus * 0.44), INK);

  return px;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** @param {number} size */
function encodePng(size) {
  const raw = drawIcon(size);
  const stride = size * 4 + 1;
  const filtered = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    const row = y * stride;
    filtered[row] = 0;
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      const d = row + 1 + x * 4;
      filtered[d] = raw[o];
      filtered[d + 1] = raw[o + 1];
      filtered[d + 2] = raw[o + 2];
      filtered[d + 3] = raw[o + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(filtered)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function write(name, size) {
  const path = join(here, name);
  writeFileSync(path, encodePng(size));
  console.log("wrote", path);
}

write("icon-192.png", 192);
write("icon-512.png", 512);
write("apple-touch-icon.png", 180);
