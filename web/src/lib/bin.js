// Readers for the compact binary files the scanner writes (*.cbin = gzip stream).
// Positions are 16-bit, quantised to each model's bounding box; indices are 16-bit
// where they fit; instance matrices drop their constant last column.

export const DATA = `${import.meta.env.BASE_URL}data`;

export async function fetchBin(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const raw = await r.arrayBuffer();
  const head = new Uint8Array(raw, 0, 2);
  // Some hosts transparently decompress; only inflate when the gzip magic is still there.
  if (head[0] !== 0x1f || head[1] !== 0x8b) return raw;
  return new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

export function positions(buf, ref) {
  const q = new Uint16Array(buf, ref.o, ref.n);
  const out = new Float32Array(ref.n);
  const [mx, my, mz] = ref.min; const sx = ref.size[0] / 65535; const sy = ref.size[1] / 65535; const sz = ref.size[2] / 65535;
  for (let i = 0; i < ref.n; i += 3) { out[i] = mx + q[i] * sx; out[i + 1] = my + q[i + 1] * sy; out[i + 2] = mz + q[i + 2] * sz; }
  return out;
}

export const indices = (buf, ref) => (ref.t === 'u16' ? new Uint16Array(buf, ref.o, ref.n) : new Uint32Array(buf, ref.o, ref.n));

export function matrices(buf, ref) {
  const src = new Float32Array(buf, ref.o, ref.n);
  const count = ref.n / 12;
  const out = new Float32Array(count * 16);
  for (let i = 0; i < count; i++) {
    const s = i * 12; const d = i * 16;
    out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2];
    out[d + 4] = src[s + 3]; out[d + 5] = src[s + 4]; out[d + 6] = src[s + 5];
    out[d + 8] = src[s + 6]; out[d + 9] = src[s + 7]; out[d + 10] = src[s + 8];
    out[d + 12] = src[s + 9]; out[d + 13] = src[s + 10]; out[d + 14] = src[s + 11]; out[d + 15] = 1;
  }
  return out;
}

// Heights are stored as zig-zagged residuals of a left+up-upleft predictor, low bytes
// then high bytes, which is what makes them compress to a fraction of the raw grid.
export function decodeHeights(buf, n) {
  const bytes = new Uint8Array(buf);
  const count = n * n;
  const out = new Uint16Array(count);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    const zz = bytes[i] | (bytes[count + i] << 8);
    const d = (zz >>> 1) ^ -(zz & 1);
    const L = x ? out[i - 1] : 0; const U = y ? out[i - n] : 0; const UL = x && y ? out[i - n - 1] : 0;
    out[i] = (L + U - UL + d) & 0xffff;
  }
  return out;
}
