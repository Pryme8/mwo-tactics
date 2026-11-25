// DDS (DXT1/3/5, ATI2, uncompressed) -> RGBA, and RGBA -> PNG. No dependencies.
import zlib from 'node:zlib';

const c565 = (c) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];

function colorBlock(d, o, out, w, h, bx, by, dxt1) {
  const c0 = d.readUInt16LE(o); const c1 = d.readUInt16LE(o + 2);
  const a = c565(c0); const b = c565(c1);
  const pal = [a, b, null, null];
  if (c0 > c1 || !dxt1) {
    pal[2] = [(2 * a[0] + b[0]) / 3, (2 * a[1] + b[1]) / 3, (2 * a[2] + b[2]) / 3];
    pal[3] = [(a[0] + 2 * b[0]) / 3, (a[1] + 2 * b[1]) / 3, (a[2] + 2 * b[2]) / 3];
  } else {
    pal[2] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    pal[3] = null;
  }
  const bits = d.readUInt32LE(o + 4);
  for (let i = 0; i < 16; i++) {
    const x = bx + (i & 3); const y = by + (i >> 2);
    if (x >= w || y >= h) continue;
    const c = pal[(bits >>> (i * 2)) & 3];
    const p = (y * w + x) * 4;
    if (c) { out[p] = c[0]; out[p + 1] = c[1]; out[p + 2] = c[2]; out[p + 3] = 255; } else { out[p] = out[p + 1] = out[p + 2] = 0; out[p + 3] = 0; }
  }
}

function alphaBlock(d, o, out, w, h, bx, by, channel) {
  const a0 = d[o]; const a1 = d[o + 1];
  const pal = [a0, a1];
  if (a0 > a1) for (let i = 1; i < 7; i++) pal.push(((7 - i) * a0 + i * a1) / 7);
  else { for (let i = 1; i < 5; i++) pal.push(((5 - i) * a0 + i * a1) / 5); pal.push(0, 255); }
  let bits = 0n;
  for (let i = 0; i < 6; i++) bits |= BigInt(d[o + 2 + i]) << BigInt(8 * i);
  for (let i = 0; i < 16; i++) {
    const x = bx + (i & 3); const y = by + (i >> 2);
    if (x >= w || y >= h) continue;
    out[(y * w + x) * 4 + channel] = pal[Number((bits >> BigInt(i * 3)) & 7n)];
  }
}

export function ddsInfo(d) {
  if (!d || d.length < 128 || d.toString('latin1', 0, 4) !== 'DDS ') return null;
  const pfFlags = d.readUInt32LE(80);
  return {
    height: d.readUInt32LE(12), width: d.readUInt32LE(16), mips: Math.max(1, d.readUInt32LE(28)),
    fourcc: (pfFlags & 4) ? d.toString('latin1', 84, 88) : '', bpp: d.readUInt32LE(88),
    masks: [d.readUInt32LE(92), d.readUInt32LE(96), d.readUInt32LE(100), d.readUInt32LE(104)],
    cube: (d.readUInt32LE(112) & 0x200) !== 0,
  };
}

const blockBytes = (fourcc) => (fourcc === 'DXT1' || fourcc === 'ATI1' ? 8 : 16);

// Decode one mip level (0 = full size) to RGBA.
export function decodeDds(d, mip = 0) {
  const info = ddsInfo(d);
  if (!info || info.cube) return null;
  let w = info.width; let h = info.height; let o = 128;
  if (info.fourcc === 'DX10') return null;
  const levelSize = (lw, lh) => (info.fourcc ? Math.max(1, (lw + 3) >> 2) * Math.max(1, (lh + 3) >> 2) * blockBytes(info.fourcc) : lw * lh * (info.bpp >> 3));
  for (let i = 0; i < Math.min(mip, info.mips - 1); i++) { o += levelSize(w, h); w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); }
  if (o + levelSize(w, h) > d.length) return null;
  const out = new Uint8ClampedArray(w * h * 4);
  if (info.fourcc) {
    const bb = blockBytes(info.fourcc);
    for (let by = 0; by < h; by += 4) for (let bx = 0; bx < w; bx += 4) {
      if (info.fourcc === 'DXT1') colorBlock(d, o, out, w, h, bx, by, true);
      else if (info.fourcc === 'DXT5') { colorBlock(d, o + 8, out, w, h, bx, by, false); alphaBlock(d, o, out, w, h, bx, by, 3); }
      else if (info.fourcc === 'DXT3') {
        colorBlock(d, o + 8, out, w, h, bx, by, false);
        for (let i = 0; i < 16; i++) { const x = bx + (i & 3), y = by + (i >> 2); if (x < w && y < h) out[(y * w + x) * 4 + 3] = ((d[o + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17; }
      } else if (info.fourcc === 'ATI2') {
        alphaBlock(d, o, out, w, h, bx, by, 1); alphaBlock(d, o + 8, out, w, h, bx, by, 0);
        for (let i = 0; i < 16; i++) { const x = bx + (i & 3), y = by + (i >> 2); if (x < w && y < h) { out[(y * w + x) * 4 + 2] = 255; out[(y * w + x) * 4 + 3] = 255; } }
      } else return null;
      o += bb;
    }
  } else {
    const bytes = info.bpp >> 3;
    if (bytes < 3) return null;
    const shift = (m) => { let s = 0; while (m && !(m & 1)) { m >>>= 1; s++; } return s; };
    const [rm, gm, bm, am] = info.masks; const rs = shift(rm), gs = shift(gm), bs = shift(bm), as = shift(am);
    for (let i = 0; i < w * h; i++) {
      const v = bytes === 4 ? d.readUInt32LE(o + i * 4) : d[o + i * 3] | (d[o + i * 3 + 1] << 8) | (d[o + i * 3 + 2] << 16);
      out[i * 4] = (v & rm) >>> rs; out[i * 4 + 1] = (v & gm) >>> gs; out[i * 4 + 2] = (v & bm) >>> bs; out[i * 4 + 3] = am ? (v & am) >>> as : 255;
    }
  }
  return { width: w, height: h, data: out };
}

// Average colour of a texture, read from a small mip (cheap: no full decode).
export function ddsAverageColor(d) {
  const info = ddsInfo(d);
  if (!info) return null;
  const mip = Math.max(0, Math.min(info.mips - 1, Math.floor(Math.log2(Math.max(info.width, info.height))) - 2));
  const img = decodeDds(d, mip);
  if (!img) return null;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < img.data.length; i += 4) { if (img.data[i + 3] < 8) continue; r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++; }
  return n ? [r / n / 255, g / n / 255, b / n / 255] : null;
}

let crcTable;
function crc32(buf) {
  if (!crcTable) { crcTable = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function encodePng({ width, height, data }, { alpha = true } = {}) {
  const ch = alpha ? 4 : 3;
  const raw = Buffer.alloc((width * ch + 1) * height);
  for (let y = 0; y < height; y++) {
    const ro = y * (width * ch + 1);
    raw[ro] = 0;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4; const t = ro + 1 + x * ch;
      raw[t] = data[s]; raw[t + 1] = data[s + 1]; raw[t + 2] = data[s + 2]; if (alpha) raw[t + 3] = data[s + 3];
    }
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
