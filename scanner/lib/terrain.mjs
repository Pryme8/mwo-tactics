// Decoder for CryEngine 3 compiled terrain (terrain/terrain.dat, chunk version 24).
// Layout: header, vegetation groups, brush model table, material table,
// terrain quadtree (per-sector heightmaps), then the object octree (placed models).

const str = (d, o, max = 256) => { let e = o; const end = o + max; while (e < end && d[e]) e++; return d.toString('latin1', o, e); };

const VEG_GROUP_SIZE = 336;
const GEOM_ERRORS = 5;         // one float per LOD level stored after each node's heights
const TYPE_BRUSH = 1;
const TYPE_VEGETATION = 2;
const FIXED_SIZE = { [TYPE_BRUSH]: 104, [TYPE_VEGETATION]: 64 };

export function parseTerrain(d, opts = {}) {
  const header = {
    version: d.readInt8(0),
    heightmapSize: d.readInt32LE(8),     // in units
    unitSize: d.readInt32LE(12),         // metres per unit
    sectorSize: d.readInt32LE(16),       // metres
    sectorsTableSize: d.readInt32LE(20),
    zRatio: d.readFloatLE(24),
    oceanLevel: d.readFloatLE(28),
  };
  let p = 32;
  const nVeg = d.readInt32LE(p); p += 4;
  const vegGroups = [];
  for (let i = 0; i < nVeg; i++) vegGroups.push(str(d, p + i * VEG_GROUP_SIZE));
  p += nVeg * VEG_GROUP_SIZE;
  const nBrush = d.readInt32LE(p); p += 4;
  const brushModels = [];
  for (let i = 0; i < nBrush; i++) brushModels.push(str(d, p + i * 256));
  p += nBrush * 256;
  const nMat = d.readInt32LE(p); p += 4;
  const materials = [];
  for (let i = 0; i < nMat; i++) materials.push(str(d, p + i * 256));
  p += nMat * 256;

  // ---- terrain quadtree ----
  const worldSize = header.heightmapSize * header.unitSize;
  const N = header.heightmapSize + 1;
  const heights = new Float32Array(N * N);
  const filled = new Uint8Array(N * N);
  const holes = new Uint8Array(N * N);
  const leaves = [];

  const readNode = () => {
    const p0 = p;
    const hasHoles = d.readInt16LE(p + 2);
    const minX = d.readFloatLE(p + 4); const minY = d.readFloatLE(p + 8);
    const maxX = d.readFloatLE(p + 16);
    const fOffset = d.readFloatLE(p + 28); const fRange = d.readFloatLE(p + 32);
    const nSize = d.readInt32LE(p + 36); const nSurf = d.readInt32LE(p + 40);
    if (nSize < 0 || nSize > 4097 || nSurf < 0 || nSurf > 256) throw new Error(`terrain node parse error at ${p}`);
    const dataAt = p + 44;
    p = (dataAt + nSize * nSize * 2 + 3) & ~3;
    p += GEOM_ERRORS * 4;
    const surfAt = p;
    p = (p + nSurf + 3) & ~3;
    const width = maxX - minX;
    if (width > header.sectorSize + 0.5) { for (let i = 0; i < 4; i++) readNode(); return; }
    leaves.push({ minX, minY, maxZ: d.readFloatLE(p0 + 24), width, fOffset, fRange, nSize, dataAt, hasHoles, nSurf, surfAt });
  };
  readNode();
  const objectsStart = p;

  // Heights are 12-bit steps above each sector's base offset (low 4 bits = surface id).
  // The step size is not stored per sector, so recover it from the sector bounds:
  // (top of bounding box - base) / highest step. It comes out the same for every sector.
  const estimates = [];
  for (const lf of leaves) {
    if (lf.nSize < 9) continue;
    let mx = 0;
    for (let i = 0; i < lf.nSize * lf.nSize; i++) mx = Math.max(mx, d.readUInt16LE(lf.dataAt + i * 2) >> 4);
    if (mx > 64) estimates.push((lf.maxZ - lf.fOffset) / mx);
  }
  estimates.sort((a, b) => a - b);
  // Every level measured lands on 0.0500 (5 cm), so snap to it when the estimate agrees.
  const est = estimates.length ? estimates[Math.floor(estimates.length * 0.1)] : 0.05;
  const heightStep = opts.heightStep ?? (Math.abs(est - 0.05) < 0.002 ? 0.05 : est);
  header.heightStep = heightStep;
  header.heightStepSpread = estimates.length ? [estimates[Math.floor(estimates.length * 0.1)], estimates[Math.floor(estimates.length * 0.9)]] : null;

  // Each leaf is a (nSize x nSize) grid, x-major, covering one sector. Sectors that were
  // simplified at export (nSize < full) are upsampled bilinearly.
  const unitsPerSector = header.sectorSize / header.unitSize;
  for (const lf of leaves) {
    if (!lf.nSize) continue;
    const ux = Math.round(lf.minX / header.unitSize); const uy = Math.round(lf.minY / header.unitSize);
    const n = lf.nSize; const step = (n - 1) / unitsPerSector;
    // Sectors mark holes with the highest local surface id present in their table.
    const raw = opts.yMajor
      ? (ix, iy) => d.readUInt16LE(lf.dataAt + (iy * n + ix) * 2)
      : (ix, iy) => d.readUInt16LE(lf.dataAt + (ix * n + iy) * 2);
    for (let x = 0; x <= unitsPerSector; x++) {
      const fx = x * step; const x0 = Math.min(n - 1, Math.floor(fx)); const x1 = Math.min(n - 1, x0 + 1); const tx = fx - x0;
      for (let y = 0; y <= unitsPerSector; y++) {
        const fy = y * step; const y0 = Math.min(n - 1, Math.floor(fy)); const y1 = Math.min(n - 1, y0 + 1); const ty = fy - y0;
        const h = (v) => lf.fOffset + (v >> 4) * heightStep;
        const a = h(raw(x0, y0)); const b = h(raw(x1, y0)); const c = h(raw(x0, y1)); const e = h(raw(x1, y1));
        const gx = ux + x; const gy = uy + y;
        if (gx >= N || gy >= N) continue;
        const gi = gy * N + gx;
        heights[gi] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
        filled[gi] = 1;
        if (lf.hasHoles && (raw(Math.round(fx), Math.round(fy)) & 0xf) === 0xf) holes[gi] = 1;
      }
    }
  }

  // ---- object octree ----
  const plausibleRecord = (o, end) => {
    if (o + 28 > end) return false;
    const t = d.readInt32LE(o);
    if (t < 1 || t > 40) return false;
    const a = [];
    for (let i = 0; i < 6; i++) {
      const v = d.readFloatLE(o + 4 + i * 4);
      if (!Number.isFinite(v) || Math.abs(v) > 1e5 || (v !== 0 && Math.abs(v) < 1e-6)) return false;
      a.push(v);
    }
    return a[0] <= a[3] && a[1] <= a[4] && a[2] <= a[5];
  };

  const brushes = [];
  const vegetation = [];
  const otherTypes = {};
  p = objectsStart;
  const readOct = () => {
    if (p + 32 > d.length) return;
    const mask = d.readInt16LE(p + 2);
    const size = d.readInt32LE(p + 28);
    p += 32;
    const end = p + size;
    let o = p;
    while (o < end) {
      const type = d.readInt32LE(o);
      let len = FIXED_SIZE[type];
      if (!len) {
        len = -1;
        for (let s = 32; s <= 4096 && o + s <= end; s += 4) if (o + s === end || plausibleRecord(o + s, end)) { len = s; break; }
        if (len < 0) break;
        otherTypes[type] = (otherTypes[type] || 0) + 1;
      } else if (type === TYPE_BRUSH) {
        const m = new Array(12);
        for (let i = 0; i < 12; i++) m[i] = d.readFloatLE(o + 44 + i * 4);
        brushes.push({ model: d.readUInt16LE(o + 36), flags: d.readUInt32LE(o + 32), layer: d.readUInt16LE(o + 28), material: d.readInt32LE(o + 96), m });
      } else if (type === TYPE_VEGETATION) {
        vegetation.push({
          group: d[o + 62], x: d.readFloatLE(o + 44), y: d.readFloatLE(o + 48), z: d.readFloatLE(o + 52),
          scale: d.readFloatLE(o + 56), angle: (d[o + 61] / 255) * Math.PI * 2,
        });
      }
      o += len;
    }
    p = end;
    for (let i = 0; i < 8; i++) if (mask & (1 << i)) readOct();
  };
  readOct();

  return { header, worldSize, N, heights, filled, holes, vegGroups, brushModels, materials, brushes, vegetation, otherTypes, complete: p === d.length };
}
