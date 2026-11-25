// Exports one chassis' geometry for the 3D build view:
//   mechs/<chassis>/mech.json   piece directory + which weapon model goes on which hardpoint
//   mechs/<chassis>/geo.bin     piece geometry, already posed (viewer space, Y up)
import fs from 'node:fs';
import path from 'node:path';
import { parseXml, find, kids, attr } from './xml.mjs';
import { parseCgf } from './cgf.mjs';
import { BinPacker, quatToR, packPos, packIdx } from './models.mjs';
import { DATA_DIR, writeJson } from './game.mjs';

const LOD = /_lod\d|_damaged|_destroyed/i;

export function exportMech(gfs, chassis) {
  const base = `Objects/mechs/${chassis}`;
  const cdfText = gfs.text(`${base}/${chassis}.cdf`);
  if (!cdfText) return null;
  const pack = new BinPacker();
  const pieces = {};
  let tris = 0;
  for (const a of find(parseXml(cdfText), 'Attachment')) {
    const name = attr(a, 'AName'); const binding = (attr(a, 'Binding', '') || '').replace(/\\/g, '/');
    if (!name || !/\.(cga|cgf)$/i.test(binding) || LOD.test(name) || pieces[name]) continue;
    const buf = gfs.read(binding);
    if (!buf) continue;
    let g; try { g = parseCgf(buf); } catch { continue; }
    if (!g || !g.visual.idx.length) continue;
    const q = (attr(a, 'Rotation', '1,0,0,0') || '1,0,0,0').split(',').map(Number);
    const p = (attr(a, 'Position', '0,0,0') || '0,0,0').split(',').map(Number);
    const R = quatToR(q[0], q[1], q[2], q[3]);
    const src = g.visual.pos; const pos = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) {
      const x = src[i], y = src[i + 1], z = src[i + 2];
      const wx = R[0] * x + R[1] * y + R[2] * z + p[0]; const wy = R[3] * x + R[4] * y + R[5] * z + p[1]; const wz = R[6] * x + R[7] * y + R[8] * z + p[2];
      pos[i] = wx; pos[i + 1] = wz; pos[i + 2] = wy;          // engine Z-up -> viewer Y-up
    }
    const idx = new Uint32Array(g.visual.idx.length);
    for (let i = 0; i + 2 < idx.length; i += 3) { idx[i] = g.visual.idx[i]; idx[i + 1] = g.visual.idx[i + 2]; idx[i + 2] = g.visual.idx[i + 1]; }
    pieces[name] = { pos: packPos(pack, pos), idx: packIdx(pack, idx, pos.length / 3) };
    tris += idx.length / 3;
  }
  // hardpoint id -> mounts -> which attachment each weapon family uses
  const hardpoints = {};
  const hpText = gfs.text(`${base}/${chassis}-hardpoints.xml`);
  if (hpText) {
    for (const h of find(parseXml(hpText), 'Hardpoint')) {
      hardpoints[attr(h, 'id')] = kids(h, 'WeaponSlot').map((slot) => kids(slot, 'Attachment')
        .map((x) => ({ s: attr(x, 'search', ''), a: attr(x, 'AName', '') })).filter((x) => x.s));
    }
  }
  const dir = path.join(DATA_DIR, 'mechs', chassis);
  fs.mkdirSync(dir, { recursive: true });
  const geo = pack.toCompressed();
  fs.rmSync(path.join(dir, 'geo.bin'), { force: true });
  fs.writeFileSync(path.join(dir, 'geo.cbin'), geo);
  const meta = { chassis, pieces, hardpoints, tris };
  writeJson(path.join(dir, 'mech.json'), meta);
  return { ...meta, bytes: geo.length };
}
