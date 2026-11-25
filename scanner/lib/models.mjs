// Loads game models into viewer-ready buffers (Babylon space: X = east, Y = up, Z = north)
// and packs many typed arrays into one binary blob with a JSON directory.
import path from 'node:path';
import zlib from 'node:zlib';
import { parseCgf } from './cgf.mjs';
import { parseXml, find, attr, kids, kid } from './xml.mjs';
import { ddsAverageColor } from './image.mjs';

export class BinPacker {
  constructor() { this.parts = []; this.size = 0; }
  add(typed) {
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (this.size % 4)) % 4;
    if (pad) { this.parts.push(Buffer.alloc(pad)); this.size += pad; }
    const ref = { o: this.size, n: typed.length };
    this.parts.push(buf); this.size += buf.length;
    return ref;
  }
  toBuffer() { return Buffer.concat(this.parts); }
  toCompressed() { return zlib.gzipSync(this.toBuffer(), { level: 9 }); }
}

// 16-bit positions, quantised to the bounding box (sub-centimetre on anything map sized).
export function packPos(pack, pos) {
  const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { const v = pos[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  const size = max.map((v, k) => Math.max(1e-6, v - min[k]));
  const q = new Uint16Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) q[i + k] = Math.round(((pos[i + k] - min[k]) / size[k]) * 65535);
  return { ...pack.add(q), min: min.map((v) => +v.toFixed(4)), size: size.map((v) => +v.toFixed(4)) };
}

export function packIdx(pack, idx, vertexCount) {
  if (vertexCount <= 65536) return { ...pack.add(Uint16Array.from(idx)), t: 'u16' };
  return { ...pack.add(idx), t: 'u32' };
}

// Instance matrices without their constant last column (3x4 instead of 4x4).
export function packMats(pack, arr) {
  const n = arr.length / 16; const out = new Float32Array(n * 12);
  for (let i = 0; i < n; i++) { const s = i * 16; const d = i * 12; out.set([arr[s], arr[s + 1], arr[s + 2], arr[s + 4], arr[s + 5], arr[s + 6], arr[s + 8], arr[s + 9], arr[s + 10], arr[s + 12], arr[s + 13], arr[s + 14]], d); }
  return pack.add(out);
}

// Heightmap -> zig-zagged residuals of a left+up-upleft predictor, low bytes then high bytes, gzipped.
export function encodeHeights(hq, n) {
  const count = n * n; const bytes = Buffer.alloc(count * 2);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    const L = x ? hq[i - 1] : 0; const U = y ? hq[i - n] : 0; const UL = x && y ? hq[i - n - 1] : 0;
    let d = (hq[i] - (L + U - UL)) & 0xffff; if (d & 0x8000) d -= 0x10000;
    const zz = ((d << 1) ^ (d >> 15)) & 0xffff;
    bytes[i] = zz & 0xff; bytes[count + i] = zz >> 8;
  }
  return zlib.gzipSync(bytes, { level: 9 });
}

const colorCache = new Map();
const mtlCache = new Map();

function textureColor(gfs, file) {
  if (!file) return null;
  const key = file.toLowerCase().replace(/\\/g, '/').replace(/\.(tif|tga|png|bmp|jpg)$/, '.dds');
  if (colorCache.has(key)) return colorCache.get(key);
  let c = null;
  try { const d = gfs.read(key); if (d) c = ddsAverageColor(d); } catch { /* unreadable texture */ }
  colorCache.set(key, c);
  return c;
}

// Returns [{ name, color:[r,g,b], nodraw, texture }] for each sub-material of a .mtl.
export function loadMaterial(gfs, mtlPath) {
  const key = mtlPath.toLowerCase();
  if (mtlCache.has(key)) return mtlCache.get(key);
  const text = gfs.text(mtlPath);
  let out = null;
  if (text) {
    const root = kid(parseXml(text), 'Material');
    const subsNode = kid(root, 'SubMaterials');
    const list = subsNode ? kids(subsNode, 'Material') : (root ? [root] : []);
    out = list.map((m) => {
      const shader = (attr(m, 'Shader', '') || '').toLowerCase();
      const name = attr(m, 'Name', '') || '';
      const diffuse = (attr(m, 'Diffuse', '1,1,1') || '1,1,1').split(',').map(Number);
      const tex = find(m, 'Texture').find((t) => attr(t, 'Map') === 'Diffuse');
      const file = tex ? attr(tex, 'File') : null;
      const avg = textureColor(gfs, file);
      // Engine colours are linear multipliers on the texture; lift to something viewable.
      const base = avg ? avg.map((v, i) => Math.min(1, v * Math.min(1.6, 0.6 + (diffuse[i] ?? 1)))) : diffuse.map((v) => Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2));
      return {
        name, color: base, texture: file,
        nodraw: shader === 'nodraw' || /proxy|nodraw|collision/i.test(name),
        opacity: parseFloat(attr(m, 'Opacity', '1')),
      };
    });
  }
  mtlCache.set(key, out);
  return out;
}

function resolveMtl(gfs, modelPath, mtlName) {
  if (!mtlName) return null;
  const dir = path.posix.dirname(modelPath.replace(/\\/g, '/'));
  const clean = mtlName.replace(/\\/g, '/').replace(/\.mtl$/i, '');
  const cands = [`${clean}.mtl`, `${dir}/${clean}.mtl`, `${dir}/${path.posix.basename(clean)}.mtl`, modelPath.replace(/\.(cgf|cga|chr)$/i, '.mtl')];
  return cands.find((c) => gfs.has(c)) ?? null;
}

const DEFAULT_COLOR = [0.55, 0.55, 0.55];

// Converts engine geometry (Z up, right handed) to viewer space and bakes material colours.
export function buildModel(gfs, modelPath, buf) {
  const g = parseCgf(buf);
  if (!g) return null;
  const mtlPath = resolveMtl(gfs, modelPath, g.mtlName);
  const mats = mtlPath ? loadMaterial(gfs, mtlPath) : null;

  const swap = (src) => { const out = new Float32Array(src.length); for (let i = 0; i < src.length; i += 3) { out[i] = src[i]; out[i + 1] = src[i + 2]; out[i + 2] = src[i + 1]; } return out; };
  const flip = (src) => { const out = new Uint32Array(src.length); for (let i = 0; i + 2 < src.length; i += 3) { out[i] = src[i]; out[i + 1] = src[i + 2]; out[i + 2] = src[i + 1]; } return out; };

  // visual: drop no-draw subsets (they are collision faces), colour the rest per vertex
  const v = g.visual;
  const colors = new Uint8Array((v.pos.length / 3) * 4).fill(255);
  const keep = [];
  const extraCollider = [];
  for (const s of v.subsets) {
    const m = mats?.[s.mat] ?? mats?.[0];
    if (m?.nodraw) { for (let i = s.first; i < s.first + s.count; i++) extraCollider.push(v.idx[i]); continue; }
    const c = m?.color ?? DEFAULT_COLOR;
    for (let i = s.first; i < s.first + s.count; i++) {
      const vi = v.idx[i] * 4;
      colors[vi] = c[0] * 255; colors[vi + 1] = c[1] * 255; colors[vi + 2] = c[2] * 255;
      keep.push(v.idx[i]);
    }
  }
  const visual = { pos: swap(v.pos), idx: flip(Uint32Array.from(keep)), colors, uv: v.uv };

  // colliders: merge every physics shape into one buffer
  const cp = []; const ci = [];
  const addCol = (pos, idx) => { const base = cp.length / 3; for (let i = 0; i < pos.length; i++) cp.push(pos[i]); for (let i = 0; i < idx.length; i++) ci.push(base + idx[i]); };
  for (const c of g.colliders) addCol(c.pos, c.idx);
  if (extraCollider.length) addCol(v.pos, extraCollider);
  const unparsed = Object.values(g.unknownPhys).reduce((a, b) => a + b, 0);
  const collider = cp.length ? { pos: swap(Float32Array.from(cp)), idx: flip(Uint32Array.from(ci)) } : null;

  let min = [Infinity, Infinity, Infinity]; let max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < visual.pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], visual.pos[i + k]); max[k] = Math.max(max[k], visual.pos[i + k]); }
  if (!visual.pos.length) { min = [0, 0, 0]; max = [0, 0, 0]; }
  return { visual, collider, unparsedPhysics: unparsed, pieces: g.pieces, nodes: g.nodes, bounds: { min, max }, mtlPath };
}

// --- transforms: engine (column-vector, Z up) -> Babylon row-major float[16] in Y-up space ---
const SW = [0, 2, 1];
export function toBabylonMatrix(R, t) {
  // R: 3x3 row-major (engine), t: [x,y,z]. Result M' = P M P, emitted transposed (row-vector layout).
  const out = new Float32Array(16);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[c * 4 + r] = R[SW[r] * 3 + SW[c]];
  out[12] = t[0]; out[13] = t[2]; out[14] = t[1]; out[15] = 1;
  return out;
}

export function quatToR(w, x, y, z, s = [1, 1, 1]) {
  const n = Math.hypot(w, x, y, z) || 1; w /= n; x /= n; y /= n; z /= n;
  const R = [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) R[r * 3 + c] *= s[c];
  return R;
}
