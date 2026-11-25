// Converts game levels into files the 3D viewer loads:
//   maps/<id>/map.json     metadata, model directory, object placements, markers
//   maps/<id>/height.bin   heightmap (uint16, row = north, col = east)
//   maps/<id>/geo.bin      model geometry (visual + collision) and instance matrices
//   maps/<id>/minimap.png  the in-game overhead map image
// Usage: node scanner/scan-maps.mjs [level ...]      (no arguments = every level)
import fs from 'node:fs';
import path from 'node:path';
import { GameFS } from './lib/pak.mjs';
import { parseXml, find, kid, kids, attr, num } from './lib/xml.mjs';
import { parseTerrain } from './lib/terrain.mjs';
import { decodeDds, encodePng } from './lib/image.mjs';
import { BinPacker, buildModel, toBabylonMatrix, quatToR, packPos, packIdx, packMats, encodeHeights } from './lib/models.mjs';
import { findInstall, buildInfo, writeJson, readJson, DATA_DIR } from './lib/game.mjs';

const SKIP_LEVELS = new Set(['lobby', 'mechlab']);
const BACKDROP = /\/skyboxes\/|terrainshadow|\/default\.cgf$|engineassets\//i;
const MARKER_CLASSES = new Set(['MWOSpawnPoint', 'MWCapturePoint', 'MWAssaultBase', 'TurretSpawner', 'MechSpawner', 'RadarTower', 'JammingTower', 'AirControlTower', 'Generator', 'MWPowerSupplyPickUp', 'MWPowerSupplyDropOff', 'MWIntelPickUpSpawner', 'ExtractionShipSpawner']);

const install = findInstall();
const info = buildInfo(install);
const gfs = new GameFS(path.join(install, 'Game'));
const MAPS_DIR = path.join(DATA_DIR, 'maps');
const wanted = process.argv.slice(2).map((s) => s.toLowerCase());
const levels = gfs.levelNames().filter((l) => !SKIP_LEVELS.has(l.toLowerCase()) && (!wanted.length || wanted.includes(l.toLowerCase())));
console.log(`Build ${info.version}: converting ${levels.length} level(s)`);

const pretty = (id) => id.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/qp$/i, ' (QP)').replace(/\b\w/g, (c) => c.toUpperCase());
const vec = (s, n = 3, d = 0) => { const p = (s || '').split(',').map(Number); const out = []; for (let i = 0; i < n; i++) out.push(Number.isFinite(p[i]) ? p[i] : d); return out; };

function convertLevel(level) {
  const t0 = Date.now();
  const lp = gfs.levelPak(level);
  const tdat = lp.read('terrain/terrain.dat');
  if (!tdat) { console.log(`  ${level}: no terrain, skipped`); lp.close(); return null; }
  const terr = parseTerrain(tdat);
  const id = level.toLowerCase();
  const outDir = path.join(MAPS_DIR, id);
  fs.mkdirSync(outDir, { recursive: true });

  // ---- heightmap ----
  const stride = terr.N > 2049 ? 2 : 1;
  const N = Math.floor((terr.N - 1) / stride) + 1;
  let minH = Infinity; let maxH = -Infinity;
  for (let i = 0; i < terr.heights.length; i++) if (terr.filled[i]) { minH = Math.min(minH, terr.heights[i]); maxH = Math.max(maxH, terr.heights[i]); }
  if (!Number.isFinite(minH)) { minH = 0; maxH = 1; }
  const hq = new Uint16Array(N * N);
  let holeCount = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const si = (y * stride) * terr.N + x * stride;
    if (terr.holes[si]) { hq[y * N + x] = 0xffff; holeCount++; continue; }
    hq[y * N + x] = Math.min(0xfffe, Math.round(((terr.heights[si] - minH) / (maxH - minH || 1)) * 0xfffe));
  }
  fs.writeFileSync(path.join(outDir, 'height.cbin'), encodeHeights(hq, N));
  for (const old of ['height.bin', 'geo.bin']) fs.rmSync(path.join(outDir, old), { force: true });   // previous uncompressed format

  // ---- minimap ----
  let minimap = null;
  const meta = gfs.text(`Levels/${level}/${level}.xml`);
  const mm = meta ? find(parseXml(meta), 'MiniMap')[0] : null;
  if (mm) {
    const dds = gfs.read(`Levels/${level}/${attr(mm, 'Filename')}`);
    const img = dds ? decodeDds(dds, 0) : null;
    if (img) {
      fs.writeFileSync(path.join(outDir, 'minimap.png'), encodePng(img, { alpha: false }));
      minimap = { file: 'minimap.png', startX: num(mm, 'startX'), startY: num(mm, 'startY'), endX: num(mm, 'endX'), endY: num(mm, 'endY'), width: img.width, height: img.height };
    }
  }

  // ---- placements ----
  const pack = new BinPacker();
  const models = [];                 // directory
  const modelIndex = new Map();      // lower path -> index (or -1 if unusable)
  const stats = { missing: 0, unparsedPhysics: 0, noCollider: 0 };
  const getModel = (file) => {
    if (!file) return -1;
    const key = file.toLowerCase().replace(/\\/g, '/');
    if (modelIndex.has(key)) return modelIndex.get(key);
    let idx = -1;
    if (!BACKDROP.test(key)) {
      const buf = key.startsWith('%level%/') ? lp.read(key.slice(8)) : gfs.read(key);
      let m = null;
      try { m = buf ? buildModel(gfs, key, buf) : null; } catch { m = null; }
      if (!m) stats.missing++;
      else if (m.visual.idx.length || m.collider) {
        idx = models.length;
        stats.unparsedPhysics += m.unparsedPhysics;
        if (!m.collider) stats.noCollider++;
        models.push({
          name: key,
          vis: m.visual.idx.length ? { pos: packPos(pack, m.visual.pos), idx: packIdx(pack, m.visual.idx, m.visual.pos.length / 3), col: pack.add(m.visual.colors) } : null,
          col: m.collider ? { pos: packPos(pack, m.collider.pos), idx: packIdx(pack, m.collider.idx, m.collider.pos.length / 3) } : null,
          approxCollider: m.unparsedPhysics > 0,
          invisible: /designtools|collision_proxy/i.test(m.mtlPath ?? ''),
          bounds: m.bounds,
        });
      }
    }
    modelIndex.set(key, idx);
    return idx;
  };

  const groups = new Map();          // "model|category" -> number[]
  const place = (model, cat, mat) => {
    if (model < 0) return;
    const k = `${model}|${cat}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    for (let i = 0; i < 16; i++) g.push(mat[i]);
  };

  const INVISIBLE = /designtools|collision_proxy|nodraw|invisible/i;
  for (const b of terr.brushes) {
    const m = b.m;
    const mi = getModel(terr.brushModels[b.model]);
    // Brushes textured with a design-tool material are never drawn in game: they are invisible walls.
    const override = b.material >= 0 ? terr.materials[b.material] ?? '' : '';
    const hidden = INVISIBLE.test(override) || (mi >= 0 && !override && models[mi].invisible);
    place(mi, hidden ? 'blocker' : 'static', toBabylonMatrix([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]], [m[3], m[7], m[11]]));
  }
  for (const v of terr.vegetation) {
    const c = Math.cos(v.angle) * v.scale; const s = Math.sin(v.angle) * v.scale;
    place(getModel(terr.vegGroups[v.group]), 'vegetation', toBabylonMatrix([c, -s, 0, s, c, 0, 0, 0, v.scale], [v.x, v.y, v.z]));
  }

  // ---- mission entities ----
  const markers = [];
  const layers = new Set();
  const mission = lp.text('mission_mission0.xml');
  let missionMiniMap = null;
  if (mission) {
    const root = parseXml(mission);
    const mmNode = find(root, 'MiniMap')[0];
    if (mmNode) missionMiniMap = { centerX: num(mmNode, 'CenterX'), centerY: num(mmNode, 'CenterY'), extendsX: num(mmNode, 'ExtendsX'), extendsY: num(mmNode, 'ExtendsY') };
    for (const e of find(root, 'Entity')) {
      const cls = attr(e, 'EntityClass', '');
      const pos = vec(attr(e, 'Pos'));
      const rot = attr(e, 'Rotate') ? vec(attr(e, 'Rotate'), 4) : [1, 0, 0, 0];
      const scale = attr(e, 'Scale') ? vec(attr(e, 'Scale'), 3, 1) : [1, 1, 1];
      const props = kid(e, 'Properties');
      const layer = attr(e, 'Layer', 'main');
      layers.add(layer);
      const file = attr(props, 'objModel') || attr(props, 'object_Model') || attr(e, 'Geometry') || attr(e, 'Model');
      if (file && /\.(cgf|cga)$/i.test(file)) {
        const cat = cls === 'MWBreakable' || cls === 'MWDestructable' ? 'destructible' : 'entity';
        place(getModel(file), `${cat}:${layer}`, toBabylonMatrix(quatToR(rot[0], rot[1], rot[2], rot[3], scale), pos));
      }
      if (MARKER_CLASSES.has(cls)) {
        const mk = { cls, name: attr(e, 'Name', ''), layer, pos: [pos[0], pos[2], pos[1]] };
        const yaw = Math.atan2(2 * (rot[0] * rot[3] + rot[1] * rot[2]), 1 - 2 * (rot[2] * rot[2] + rot[3] * rot[3]));
        mk.yaw = yaw;
        for (const k of ['teamId', 'eiTeamId', 'lanceId', 'sName', 'fRadius', 'eiTeamCanCapId']) { const v = attr(props, k); if (v !== undefined && v !== '') mk[k.replace(/^(ei|f|s)(?=[A-Z])/, '').replace(/^./, (c) => c.toLowerCase())] = /^-?[\d.]+$/.test(v) ? +v : v; }
        markers.push(mk);
      }
    }
  }

  const instances = [];
  for (const [k, arr] of groups) {
    const [model, cat] = k.split('|');
    const [category, layer] = cat.split(':');
    instances.push({ model: +model, category, layer: layer ?? 'main', count: arr.length / 16, mats: packMats(pack, arr) });
  }
  const geo = pack.toCompressed();
  fs.writeFileSync(path.join(outDir, 'geo.cbin'), geo);

  const map = {
    id, label: pretty(level), build: info.version,
    world: { size: terr.worldSize, unit: terr.header.unitSize * stride, grid: N, minHeight: minH, maxHeight: maxH, water: terr.header.oceanLevel > minH - 500 ? terr.header.oceanLevel : null, holes: holeCount },
    minimap, missionMiniMap, models, instances, markers, layers: [...layers].sort(),
    stats: { brushes: terr.brushes.length, vegetation: terr.vegetation.length, ...stats },
  };
  writeJson(path.join(outDir, 'map.json'), map);
  lp.close();
  const placed = instances.reduce((a, g) => a + g.count, 0);
  console.log(`  ${id.padEnd(24)} ${String(terr.worldSize).padStart(5)}m  models ${String(models.length).padStart(4)}  placed ${String(placed).padStart(6)}  markers ${String(markers.length).padStart(4)}  geo ${(geo.length / 1e6).toFixed(1)}MB  ${(Date.now() - t0)}ms${stats.unparsedPhysics ? `  (${stats.unparsedPhysics} colliders approximated)` : ''}`);
  return { id, label: map.label, size: terr.worldSize, hasMinimap: !!minimap, models: models.length, objects: placed, layers: map.layers };
}

const index = readJson(path.join(MAPS_DIR, 'index.json'), { maps: [] });
const byId = new Map(index.maps.map((m) => [m.id, m]));
for (const level of levels) {
  try { const r = convertLevel(level); if (r) byId.set(r.id, r); }
  catch (e) { console.log(`  ${level}: FAILED ${e.message}`); }
}
writeJson(path.join(MAPS_DIR, 'index.json'), { build: info.version, maps: [...byId.values()].sort((a, b) => a.label.localeCompare(b.label)) }, true);
console.log('Done.');
