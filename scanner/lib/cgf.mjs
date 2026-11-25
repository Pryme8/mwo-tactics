// Decoder for compiled CryEngine geometry (.cgf / .cga / .chr, "CryTek" chunk files
// version 0x744 / 0x745). Returns visual geometry and, separately, the physics
// (collision) geometry the engine actually tests hits against.

const CHUNK = {
  MESH: 0xcccc0000, NODE: 0xcccc000b, MTL_NAME: 0xcccc0014, DATA_STREAM: 0xcccc0016,
  MESH_SUBSETS: 0xcccc0017, MESH_PHYSICS: 0xcccc0018, COMPILED_BONES: 0xacdc0000, COMPILED_PHYS_PROXY: 0xacdc0003,
};
const STREAM = { POSITIONS: 0, NORMALS: 1, UVS: 2, COLORS: 3, INDICES: 5, P3S_C4B_T2S: 15 };

const cstr = (d, o, max) => { let e = o; const end = Math.min(d.length, o + max); while (e < end && d[e]) e++; return d.toString('latin1', o, e); };

function halfToFloat(h) {
  const s = (h & 0x8000) ? -1 : 1; const e = (h >> 10) & 0x1f; const f = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}

export function readChunks(d) {
  if (d.length < 24 || d.toString('latin1', 0, 6) !== 'CryTek') return null;
  const version = d.readUInt32LE(12);
  const tbl = d.readUInt32LE(16);
  if (tbl + 4 > d.length) return null;
  const n = d.readUInt32LE(tbl);
  const esz = version === 0x745 ? 20 : 16;
  const chunks = [];
  for (let i = 0; i < n; i++) {
    const o = tbl + 4 + i * esz;
    if (o + esz > d.length) break;
    chunks.push({ type: d.readUInt32LE(o), version: d.readUInt32LE(o + 4), offset: d.readUInt32LE(o + 8), id: d.readUInt32LE(o + 12), size: esz === 20 ? d.readUInt32LE(o + 16) : 0 });
  }
  if (esz === 16) {
    const sorted = [...chunks].sort((a, b) => a.offset - b.offset);
    sorted.forEach((c, i) => { c.size = (i + 1 < sorted.length ? sorted[i + 1].offset : tbl) - c.offset; });
  }
  return { version, chunks, byId: new Map(chunks.map((c) => [c.id, c])) };
}

function readStream(d, c) {
  const o = c.offset + 16;
  const type = d.readUInt32LE(o + 4); const count = d.readUInt32LE(o + 8); const esz = d.readUInt32LE(o + 12) & 0xffff;
  return { type, count, esz, at: o + 24 };
}

// Physics geometry as saved by CryPhysics (phys_geometry + CTriMesh / box / etc).
function readPhysics(d, c) {
  const base = c.offset;
  const end = base + c.size;
  const geomType = d.readInt32LE(base + 108);
  if (geomType === 1) {
    const nVerts = d.readInt32LE(base + 112); const nTris = d.readInt32LE(base + 116);
    if (nVerts <= 0 || nTris <= 0 || nVerts > 65535 || nTris > 200000) return null;
    let o = base + 128;
    const hasVtxMap = d[o]; o += 1;
    if (hasVtxMap) o += nVerts * 2;
    const hasForeignIdx = d[o]; o += 1;
    if (hasForeignIdx) o += nTris * 2;   // per-triangle index back into the render mesh
    if (o + nVerts * 12 + nTris * 6 > end) return null;
    const pos = new Float32Array(nVerts * 3);
    for (let i = 0; i < nVerts * 3; i++) pos[i] = d.readFloatLE(o + i * 4);
    o += nVerts * 12;
    const idx = new Uint32Array(nTris * 3);
    for (let i = 0; i < nTris * 3; i++) { const v = d.readUInt16LE(o + i * 2); if (v >= nVerts) return null; idx[i] = v; }
    for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i]) || Math.abs(pos[i]) > 1e5) return null;
    return { kind: 'mesh', pos, idx };
  }
  if (geomType === 0) {
    // box: 3x3 basis, bOriented, centre, half-size
    const o = base + 112;
    const B = []; for (let i = 0; i < 9; i++) B.push(d.readFloatLE(o + i * 4));
    const oriented = d.readInt32LE(o + 36);
    const cx = d.readFloatLE(o + 40), cy = d.readFloatLE(o + 44), cz = d.readFloatLE(o + 48);
    const sx = d.readFloatLE(o + 52), sy = d.readFloatLE(o + 56), sz = d.readFloatLE(o + 60);
    if (![cx, cy, cz, sx, sy, sz, ...B].every((v) => Number.isFinite(v) && Math.abs(v) < 1e5)) return null;
    const pos = new Float32Array(24); let k = 0;
    for (const dz of [-1, 1]) for (const dy of [-1, 1]) for (const dx of [-1, 1]) {
      const lx = dx * sx, ly = dy * sy, lz = dz * sz;
      // basis rows are the box axes; world = centre + B^T * local
      pos[k++] = cx + (oriented ? B[0] * lx + B[3] * ly + B[6] * lz : lx);
      pos[k++] = cy + (oriented ? B[1] * lx + B[4] * ly + B[7] * lz : ly);
      pos[k++] = cz + (oriented ? B[2] * lx + B[5] * ly + B[8] * lz : lz);
    }
    const idx = new Uint32Array([0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5]);
    return { kind: 'box', pos, idx };
  }
  return { kind: `type${geomType}`, pos: null, idx: null };
}

const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
// Row-vector convention (v' = v * M), translation in the last row, as stored in node chunks.
function mul(a, b) {
  const r = new Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) r[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j] + a[i * 4 + 3] * b[12 + j];
  return r;
}
const xform = (m, x, y, z) => [x * m[0] + y * m[4] + z * m[8] + m[12], x * m[1] + y * m[5] + z * m[9] + m[13], x * m[2] + y * m[6] + z * m[10] + m[14]];

export function parseCgf(d) {
  const file = readChunks(d);
  if (!file) return null;
  const { chunks, byId } = file;

  // materials: the first MtlName chunk with sub-materials names the .mtl file
  const mtlChunks = chunks.filter((c) => c.type === CHUNK.MTL_NAME).map((c) => {
    const o = c.offset + 16;
    if (c.version === 0x800) {
      const nSub = d.readInt32LE(o + 140);
      const subs = []; for (let i = 0; i < Math.min(nSub, 64); i++) subs.push(d.readInt32LE(o + 144 + i * 4));
      return { id: c.id, name: cstr(d, o + 8, 128), physType: d.readInt32LE(o + 136), subs };
    }
    // 0x802: name[128], nSub, then physics types
    const nSub = d.readInt32LE(o + 128);
    return { id: c.id, name: cstr(d, o, 128), physType: -1, subs: [], nSub };
  });
  const rootMtl = mtlChunks.find((m) => m.subs.length || m.nSub) ?? mtlChunks[0];
  const mtlById = new Map(mtlChunks.map((m) => [m.id, m]));
  const subNames = rootMtl ? rootMtl.subs.map((id) => mtlById.get(id)?.name ?? '') : [];

  const nodes = chunks.filter((c) => c.type === CHUNK.NODE).map((c) => {
    const o = c.offset;
    const tm = []; for (let i = 0; i < 16; i++) tm.push(d.readFloatLE(o + 100 + i * 4));
    tm[3] = 0; tm[7] = 0; tm[11] = 0; tm[15] = 1;
    tm[12] /= 100; tm[13] /= 100; tm[14] /= 100;   // translations are stored in centimetres
    const propLen = d.readInt32LE(o + 216);
    return { id: c.id, name: cstr(d, o + 16, 64), objectId: d.readInt32LE(o + 80), parentId: d.readInt32LE(o + 84), tm, props: propLen > 0 ? cstr(d, o + 220, propLen) : '' };
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const world = (n, depth = 0) => {
    if (n.world) return n.world;
    const parent = nodeById.get(n.parentId);
    n.world = parent && depth < 32 ? mul(n.tm, world(parent, depth + 1)) : n.tm;
    return n.world;
  };

  const visual = { pos: [], uv: [], idx: [], subsets: [] };
  const colliders = [];
  const pieces = [];   // per-node record, used when assembling mechs
  const unknownPhys = {};

  for (const n of nodes) {
    const mc = byId.get(n.objectId);
    if (!mc || mc.type !== CHUNK.MESH) continue;
    const lname = n.name.toLowerCase();
    if (/^\$lod\d/.test(lname) || lname.includes('_lod')) continue;
    const isProxyNode = lname.startsWith('$physics_proxy') || lname.includes('proxy') || /^\$?(collision|phys)/.test(lname);
    const M = world(n);
    const o = mc.offset + 16;
    const flags = d.readInt32LE(o);
    const nVerts = d.readInt32LE(o + 8); const nIdx = d.readInt32LE(o + 12);
    const subsetsId = d.readInt32LE(o + 20);
    const streamIds = []; for (let i = 0; i < 16; i++) streamIds.push(d.readInt32LE(o + 28 + i * 4));
    const physIds = []; for (let i = 0; i < 4; i++) physIds.push(d.readInt32LE(o + 92 + i * 4));

    // physics geometry attached to this mesh
    const stripped = (flags & 1) || nVerts <= 0 || nIdx <= 0;
    let sharedCollider = false;
    physIds.forEach((pid, slot) => {
      const pc = pid ? byId.get(pid) : null;
      if (!pc || pc.type !== CHUNK.MESH_PHYSICS) return;
      const g = readPhysics(d, pc);
      if (!g) {
        // No vertices of its own: the physics mesh reuses the render mesh's triangles.
        if (!stripped) sharedCollider = true;
        else unknownPhys.unparsed = (unknownPhys.unparsed || 0) + 1;
        return;
      }
      if (!g.pos) { unknownPhys[g.kind] = (unknownPhys[g.kind] || 0) + 1; return; }
      const pos = new Float32Array(g.pos.length);
      for (let i = 0; i < g.pos.length; i += 3) { const v = xform(M, g.pos[i], g.pos[i + 1], g.pos[i + 2]); pos[i] = v[0]; pos[i + 1] = v[1]; pos[i + 2] = v[2]; }
      colliders.push({ node: n.name, slot, kind: g.kind, pos, idx: g.idx });
    });

    if (stripped) continue;   // stripped mesh: physics only
    const streams = {};
    for (const sid of streamIds) { const sc = sid ? byId.get(sid) : null; if (sc && sc.type === CHUNK.DATA_STREAM) { const s = readStream(d, sc); streams[s.type] = s; } }
    const ps = streams[STREAM.POSITIONS] ?? streams[STREAM.P3S_C4B_T2S]; const is = streams[STREAM.INDICES];
    if (!ps || !is) continue;

    const target = isProxyNode ? { pos: [], uv: [], idx: [], subsets: [] } : visual;
    const base = target.pos.length / 3;
    const us = streams[STREAM.UVS];
    for (let i = 0; i < ps.count; i++) {
      const a = ps.at + i * ps.esz;
      let x, y, z;
      if (ps.esz >= 12 && ps.type === STREAM.POSITIONS) { x = d.readFloatLE(a); y = d.readFloatLE(a + 4); z = d.readFloatLE(a + 8); }
      else { x = halfToFloat(d.readUInt16LE(a)); y = halfToFloat(d.readUInt16LE(a + 2)); z = halfToFloat(d.readUInt16LE(a + 4)); }
      const v = xform(M, x, y, z);
      target.pos.push(v[0], v[1], v[2]);
      if (ps.type === STREAM.P3S_C4B_T2S) target.uv.push(halfToFloat(d.readUInt16LE(a + 12)), halfToFloat(d.readUInt16LE(a + 14)));
      else if (us && i < us.count) target.uv.push(d.readFloatLE(us.at + i * us.esz), d.readFloatLE(us.at + i * us.esz + 4));
      else target.uv.push(0, 0);
    }
    const readIdx = (i) => (is.esz === 4 ? d.readUInt32LE(is.at + i * 4) : d.readUInt16LE(is.at + i * 2));
    const sc = byId.get(subsetsId);
    const subs = [];
    if (sc && sc.type === CHUNK.MESH_SUBSETS) {
      const so = sc.offset + 16; const cnt = d.readInt32LE(so + 4);
      for (let k = 0; k < cnt; k++) { const s = so + 16 + k * 36; subs.push({ first: d.readInt32LE(s), count: d.readInt32LE(s + 4), mat: d.readInt32LE(s + 16) }); }
    } else subs.push({ first: 0, count: is.count, mat: 0 });
    const pieceStart = target.idx.length;
    for (const s of subs) {
      const matName = (subNames[s.mat] ?? '').toLowerCase();
      const first = target.idx.length;
      for (let i = s.first; i < s.first + s.count && i < is.count; i++) { const v = readIdx(i); if (v < ps.count) target.idx.push(base + v); else target.idx.push(base); }
      const count = target.idx.length - first;
      // sub-materials named "proxy" (or with no-draw physics) are collision-only faces
      const proxyMat = /proxy|nodraw|collision/.test(matName);
      if (!isProxyNode && proxyMat) {
        const used = target.idx.splice(first, count);
        colliders.push(reindex(target.pos, used, n.name, 'matproxy'));
      } else if (count) target.subsets.push({ first, count, mat: s.mat });
    }
    if (isProxyNode) { if (target.idx.length) colliders.push(reindex(target.pos, target.idx, n.name, 'node')); }
    else if (sharedCollider && target.idx.length > pieceStart) colliders.push(reindex(target.pos, target.idx.slice(pieceStart), n.name, 'shared'));
    if (!isProxyNode) pieces.push({ node: n.name, first: pieceStart, count: target.idx.length - pieceStart });
  }

  return {
    mtlName: rootMtl?.name ?? '', subMaterials: subNames,
    nodes: nodes.map((n) => ({ name: n.name, parent: nodeById.get(n.parentId)?.name ?? null, world: world(n), props: n.props })),
    visual: { pos: new Float32Array(visual.pos), uv: new Float32Array(visual.uv), idx: new Uint32Array(visual.idx), subsets: visual.subsets },
    colliders, pieces, unknownPhys,
  };
}

function reindex(pos, indices, node, kind) {
  const map = new Map(); const outPos = []; const idx = new Uint32Array(indices.length);
  indices.forEach((v, i) => {
    let m = map.get(v);
    if (m === undefined) { m = outPos.length / 3; map.set(v, m); outPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); }
    idx[i] = m;
  });
  return { node, slot: 0, kind, pos: new Float32Array(outPos), idx };
}

// Skeleton of a .chr: bone names, parents and world-space bind transforms.
export function parseSkeleton(d) {
  const file = readChunks(d);
  if (!file) return null;
  const c = file.chunks.find((x) => x.type === CHUNK.COMPILED_BONES);
  if (!c) return null;
  // header(16) + 32 reserved, then 584-byte bone entries
  const BONE = 584; const start = c.offset + 16 + 32;
  const count = Math.floor((c.size - 48) / BONE);
  const bones = [];
  for (let i = 0; i < count; i++) {
    const o = start + i * BONE;
    const name = cstr(d, o + 4 + 4 + 0, 0) || cstr(d, o + 312, 256);
    bones.push({ index: i, raw: o, name });
  }
  return { count, bones, chunk: c };
}

export { CHUNK, IDENT };
