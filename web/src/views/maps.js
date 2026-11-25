// 3D map viewer: terrain from the game's heightmap with the in-game overhead image draped
// on it, every placed model, and the physics (collision) geometry as a toggle.
import {
  Engine, Scene, Vector3, Color3, Color4, UniversalCamera, HemisphericLight, DirectionalLight, Mesh, VertexData,
  StandardMaterial, Texture, MeshBuilder, Matrix, VertexBuffer,
} from '@babylonjs/core';
import { fetchJson, esc } from '../store.js';
import { DATA, fetchBin, positions, indices, matrices, decodeHeights } from '../lib/bin.js';

const TEAM_COLOR = { 0: new Color3(0.9, 0.9, 0.3), 1: new Color3(0.25, 0.6, 1), 2: new Color3(1, 0.3, 0.25) };
const ui = { map: null, mode: 'visual', terrain: 'satellite', layer: 'main', eye: 0, cats: { static: true, vegetation: true, destructible: true, entity: true, blocker: true }, markers: true, speed: 3 };
let root; let engine; let scene; let view = null; let resizeObs;

export async function mount(el, rest) {
  root = el;
  const index = await fetchJson(`${DATA}/maps/index.json`).catch(() => null);
  if (!index?.maps?.length) { el.innerHTML = '<div class="empty">No maps have been converted yet.<br>Run <code>npm run scan:maps</code> in the project folder and reload.</div>'; return; }
  const want = rest?.[0];
  ui.map = index.maps.find((m) => m.id === want)?.id ?? ui.map ?? (index.maps.find((m) => m.id === 'canyonnetwork') ?? index.maps[0]).id;
  el.innerHTML = `<div class="mapwrap"><canvas id="mapcanvas" tabindex="0"></canvas>
    <div class="hud">
      <h4>Map</h4><select id="mapsel">${index.maps.map((m) => `<option value="${m.id}" ${m.id === ui.map ? 'selected' : ''}>${esc(m.label)} (${(m.size / 1000).toFixed(1)} km)</option>`).join('')}</select>
      <h4>Geometry</h4><div class="seg" id="mode"><button data-v="visual">Visual</button><button data-v="colliders">Hitboxes</button><button data-v="both">Both</button></div>
      <div class="dim small" style="margin-top:5px" id="modenote"></div>
      <h4>Terrain</h4><div class="seg" id="terr"><button data-v="satellite">Satellite</button><button data-v="height">Height</button><button data-v="slope">Slope</button></div>
      <h4>Game mode</h4><select id="layer"></select>
      <h4>Show</h4>
      <label><input type="checkbox" data-cat="static" checked /> Structures &amp; rocks</label>
      <label><input type="checkbox" data-cat="destructible" checked /> Destructible objects</label>
      <label><input type="checkbox" data-cat="entity" checked /> Mode objects (bases, walls)</label>
      <label><input type="checkbox" data-cat="vegetation" checked /> Vegetation</label>
      <label><input type="checkbox" data-cat="blocker" checked /> <span style="color:#ff9a3c">Invisible walls</span></label>
      <label><input type="checkbox" id="markers" checked /> Spawns &amp; objectives</label>
      <h4>Camera</h4><div class="seg" id="eye"><button data-v="0">Free fly</button><button data-v="9">Light</button><button data-v="13">Heavy</button><button data-v="17">Assault</button></div>
      <div class="bar" style="margin:6px 0 0"><button id="topdown">Top-down</button><button id="slower">−</button><span class="dim small" id="speed"></span><button id="faster">+</button></div>
      <div class="dim small" style="margin-top:8px;line-height:1.5">Click the view, then <b>W A S D</b> to move, <b>Q / E</b> down / up, drag to look, <b>Shift</b> to go faster. Click the minimap to jump there. Cockpit heights put you at pilot eye level so you can check sight lines.</div>
      <div class="dim small" id="stats" style="margin-top:8px"></div>
    </div>
    <div class="readout" id="readout"></div>
    <div class="mini"><canvas id="mini" width="600" height="600"></canvas></div>
    <div class="loading" id="loading">Loading map…</div></div>`;

  const canvas = el.querySelector('#mapcanvas');
  engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false });
  resizeObs = new ResizeObserver(() => engine?.resize()); resizeObs.observe(canvas);
  el.querySelector('#mapsel').addEventListener('change', (e) => { location.hash = `#/maps/${e.target.value}`; });
  const seg = (id, key, cb) => el.querySelectorAll(`#${id} button`).forEach((b) => b.addEventListener('click', () => { ui[key] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v; syncUi(); cb?.(); }));
  seg('mode', 'mode', applyVisibility); seg('terr', 'terrain', applyTerrainLook); seg('eye', 'eye');
  el.querySelector('#layer').addEventListener('change', (e) => { ui.layer = e.target.value; applyVisibility(); });
  el.querySelectorAll('input[data-cat]').forEach((c) => c.addEventListener('change', () => { ui.cats[c.dataset.cat] = c.checked; applyVisibility(); }));
  el.querySelector('#markers').addEventListener('change', (e) => { ui.markers = e.target.checked; applyVisibility(); });
  el.querySelector("#topdown").addEventListener('click', () => topDown());
  el.querySelector('#slower').addEventListener('click', () => { ui.speed = Math.max(0.5, ui.speed / 1.6); syncUi(); });
  el.querySelector('#faster').addEventListener('click', () => { ui.speed = Math.min(40, ui.speed * 1.6); syncUi(); });
  el.querySelector('#mini').addEventListener('click', miniClick);
  await loadMap(ui.map);
  engine.runRenderLoop(() => { if (scene) { tick(); scene.render(); } });
}

export async function update(rest) {
  const id = rest?.[0];
  if (id && id !== ui.map) { ui.map = id; root.querySelector('#mapsel').value = id; await loadMap(id); }
}

export function dispose() {
  resizeObs?.disconnect(); scene?.dispose(); engine?.dispose(); scene = null; engine = null; view = null;
}

function syncUi() {
  for (const [id, key] of [['mode', 'mode'], ['terr', 'terrain'], ['eye', 'eye']]) root.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle('on', String(ui[key]) === b.dataset.v));
  root.querySelector('#speed').textContent = `speed ${ui.speed.toFixed(1)}×`;
  root.querySelector('#modenote').textContent = ui.mode === 'visual' ? 'What you see in game.' : ui.mode === 'colliders' ? 'Only the physics shapes that stop shots and mechs. Anything missing here can be shot through.' : 'Physics shapes drawn as wireframe over the visuals: gaps show where the two disagree.';
}

async function loadMap(id) {
  const loading = root.querySelector('#loading'); loading.style.display = 'flex'; loading.textContent = 'Loading map…';
  scene?.dispose();
  scene = new Scene(engine);
  scene.clearColor = new Color4(0.42, 0.5, 0.58, 1);
  scene.skipPointerMovePicking = true;
  const base = `${DATA}/maps/${id}`;
  const [map, hbuf, gbuf] = await Promise.all([fetchJson(`${base}/map.json`), fetchBin(`${base}/height.cbin`), fetchBin(`${base}/geo.cbin`)]);
  const W = map.world;
  const N = W.grid;
  const hq = decodeHeights(hbuf, N);
  const hScale = (W.maxHeight - W.minHeight) / 0xfffe;
  const hAt = (c, r) => { const v = hq[r * N + c]; return v === 0xffff ? NaN : W.minHeight + v * hScale; };
  const heightAt = (x, z) => {
    const fx = Math.max(0, Math.min(N - 1.001, x / W.unit)); const fz = Math.max(0, Math.min(N - 1.001, z / W.unit));
    const c = Math.floor(fx); const r = Math.floor(fz); const tx = fx - c; const tz = fz - r;
    const a = hAt(c, r), b = hAt(c + 1, r), d = hAt(c, r + 1), e = hAt(c + 1, r + 1);
    const v = (a * (1 - tx) + b * tx) * (1 - tz) + (d * (1 - tx) + e * tx) * tz;
    return Number.isNaN(v) ? W.minHeight : v;
  };

  const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), scene); hemi.intensity = 0.75; hemi.groundColor = new Color3(0.35, 0.35, 0.4);
  const sun = new DirectionalLight('sun', new Vector3(-0.5, -0.8, -0.35), scene); sun.intensity = 0.7;

  // ---- terrain mesh
  const step = Math.max(1, Math.ceil((N - 1) / 1024));
  const M = Math.floor((N - 1) / step) + 1;
  const pos = new Float32Array(M * M * 3); const uv = new Float32Array(M * M * 2); const col = new Float32Array(M * M * 4);
  const mm = map.minimap;
  for (let r = 0; r < M; r++) for (let c = 0; c < M; c++) {
    const i = r * M + c; const x = c * step * W.unit; const z = r * step * W.unit; const h = hAt(c * step, r * step);
    pos[i * 3] = x; pos[i * 3 + 1] = Number.isNaN(h) ? W.minHeight : h; pos[i * 3 + 2] = z;
    if (mm) { uv[i * 2] = (z - mm.startY) / (mm.endY - mm.startY); uv[i * 2 + 1] = 1 - (x - mm.startX) / (mm.endX - mm.startX); }
  }
  const idx = new Uint32Array((M - 1) * (M - 1) * 6); let k = 0;
  for (let r = 0; r < M - 1; r++) for (let c = 0; c < M - 1; c++) {
    const a = r * M + c; const b = a + 1; const d = a + M; const e = d + 1;
    if (Number.isNaN(hAt(c * step, r * step)) || Number.isNaN(hAt((c + 1) * step, (r + 1) * step))) continue;   // holes (caves, tunnels)
    idx[k++] = a; idx[k++] = d; idx[k++] = b; idx[k++] = b; idx[k++] = d; idx[k++] = e;
  }
  const normals = new Float32Array(pos.length);
  VertexData.ComputeNormals(pos, idx.subarray(0, k), normals);
  if (normals[1] < 0) for (let i = 0; i < normals.length; i++) normals[i] = -normals[i];
  // height / slope colouring
  const heightCol = new Float32Array(M * M * 4); const slopeCol = new Float32Array(M * M * 4);
  for (let i = 0; i < M * M; i++) {
    const t = (pos[i * 3 + 1] - W.minHeight) / Math.max(1, W.maxHeight - W.minHeight);
    const ramp = [[0.16, 0.3, 0.42], [0.28, 0.5, 0.32], [0.62, 0.6, 0.36], [0.6, 0.42, 0.3], [0.95, 0.95, 0.95]];
    const f = Math.min(3.999, t * 4); const a = ramp[Math.floor(f)]; const b = ramp[Math.floor(f) + 1]; const u = f - Math.floor(f);
    heightCol.set([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, 1], i * 4);
    // slope: green = any mech climbs, amber = slows heavies, red = impassable-ish
    const deg = Math.acos(Math.min(1, Math.abs(normals[i * 3 + 1]))) * 57.3;
    const s = deg < 20 ? [0.3, 0.62, 0.35] : deg < 30 ? [0.75, 0.72, 0.3] : deg < 40 ? [0.9, 0.55, 0.2] : [0.85, 0.25, 0.22];
    slopeCol.set([s[0], s[1], s[2], 1], i * 4);
  }
  col.fill(1);
  const terrain = new Mesh('terrain', scene);
  const vd = new VertexData(); vd.positions = pos; vd.indices = idx.subarray(0, k); vd.normals = normals; vd.uvs = uv; vd.colors = col;
  vd.applyToMesh(terrain, true);
  terrain.isPickable = false; terrain.hasVertexAlpha = false;
  const tmat = new StandardMaterial('terrain', scene); tmat.specularColor = Color3.Black(); tmat.backFaceCulling = false;
  const sat = mm ? new Texture(`${base}/${mm.file}`, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE) : null;
  if (sat) { sat.anisotropicFilteringLevel = 8; sat.wrapU = Texture.CLAMP_ADDRESSMODE; sat.wrapV = Texture.CLAMP_ADDRESSMODE; }
  terrain.material = tmat;

  // ---- models
  const visMat = new StandardMaterial('vis', scene); visMat.specularColor = new Color3(0.04, 0.04, 0.04); visMat.backFaceCulling = false;
  const colMat = new StandardMaterial('col', scene); colMat.diffuseColor = new Color3(1, 0.2, 0.75); colMat.emissiveColor = new Color3(0.35, 0.03, 0.25); colMat.specularColor = Color3.Black(); colMat.backFaceCulling = false;
  const colWire = colMat.clone('colwire'); colWire.wireframe = true; colWire.emissiveColor = new Color3(1, 0.25, 0.8); colWire.disableLighting = true;
  const blockMat = new StandardMaterial('block', scene); blockMat.diffuseColor = new Color3(1, 0.55, 0.15); blockMat.emissiveColor = new Color3(0.5, 0.25, 0.05); blockMat.specularColor = Color3.Black(); blockMat.backFaceCulling = false; blockMat.alpha = 0.45;
  const geoCache = new Map();
  const geometry = (mi, kind) => {
    const key = `${mi}|${kind}`;
    if (geoCache.has(key)) return geoCache.get(key);
    const m = map.models[mi]; const src = kind === 'vis' ? m.vis : m.col;
    let data = null;
    if (src) {
      data = new VertexData(); data.positions = positions(gbuf, src.pos); data.indices = indices(gbuf, src.idx);
      const n = new Float32Array(src.pos.n); VertexData.ComputeNormals(data.positions, data.indices, n); data.normals = n;
      if (kind === 'vis' && src.col) { const c8 = new Uint8Array(gbuf, src.col.o, src.col.n); const cf = new Float32Array(c8.length); for (let i = 0; i < c8.length; i++) cf[i] = (i & 3) === 3 ? 1 : Math.min(1, (c8[i] / 255) * 1.45 + 0.07); data.colors = cf; }
    }
    geoCache.set(key, data); return data;
  };
  const groups = [];
  let tris = 0; let colTris = 0; let noCol = 0;
  for (const g of map.instances) {
    const mats = matrices(gbuf, g.mats);
    const make = (kind, material) => {
      const data = geometry(g.model, kind); if (!data) return null;
      const mesh = new Mesh(`${kind}${groups.length}`, scene);
      data.applyToMesh(mesh); mesh.material = material; mesh.isPickable = false;
      mesh.thinInstanceSetBuffer('matrix', mats, 16, true);
      mesh.alwaysSelectAsActiveMesh = true;
      return mesh;
    };
    const blocker = g.category === 'blocker';
    const vis = blocker ? null : make('vis', visMat);
    const coll = blocker ? (make('col', blockMat) ?? make('vis', blockMat)) : make('col', colMat);
    if (vis) tris += (map.models[g.model].vis.idx.n / 3) * g.count;
    if (coll) colTris += (map.models[g.model].col.idx.n / 3) * g.count; else noCol += g.count;
    groups.push({ g, vis, coll });
  }

  // ---- markers
  const markers = [];
  for (const mk of map.markers) {
    let mesh; let color = TEAM_COLOR[mk.teamId ?? 0] ?? TEAM_COLOR[0];
    const ground = heightAt(mk.pos[0], mk.pos[2]);
    if (mk.cls === 'MWOSpawnPoint') { mesh = MeshBuilder.CreateCylinder('spawn', { diameterTop: 0, diameterBottom: 9, height: 22, tessellation: 4 }, scene); mesh.position.set(mk.pos[0], ground + 11, mk.pos[2]); mesh.rotation.x = Math.PI; }
    else if (mk.cls === 'MWCapturePoint') { const r = Math.min(120, mk.radius && mk.radius < 200 ? mk.radius : 38); mesh = MeshBuilder.CreateCylinder('cap', { diameter: r * 2, height: 2.5, tessellation: 40 }, scene); mesh.position.set(mk.pos[0], ground + 1.5, mk.pos[2]); color = new Color3(1, 0.85, 0.2); }
    else { mesh = MeshBuilder.CreateBox('obj', { size: 8 }, scene); mesh.position.set(mk.pos[0], ground + 30, mk.pos[2]); color = mk.cls.includes('Turret') ? new Color3(1, 0.5, 0.1) : new Color3(0.7, 0.4, 1); }
    const m = new StandardMaterial('mk', scene); m.emissiveColor = color; m.diffuseColor = color; m.disableLighting = true; m.alpha = mk.cls === 'MWCapturePoint' ? 0.45 : 0.9;
    mesh.material = m; mesh.isPickable = false;
    markers.push({ mk, mesh });
  }

  // ---- camera
  const cam = new UniversalCamera('cam', new Vector3(W.size * 0.5, W.maxHeight + 250, W.size * 0.2), scene);
  cam.minZ = 1; cam.maxZ = 20000; cam.fov = 1.0; cam.inertia = 0.6; cam.angularSensibility = 2500;
  cam.keysUp = [87]; cam.keysDown = [83]; cam.keysLeft = [65]; cam.keysRight = [68]; cam.keysUpward = [69]; cam.keysDownward = [81];
  cam.attachControl(engine.getRenderingCanvas(), true);
  let fast = false;
  scene.onKeyboardObservable.add((e) => { if (e.event.key === 'Shift') fast = e.type === 1; });

  // minimap image for the 2D panel
  const img = new Image(); if (mm) img.src = `${base}/${mm.file}`;

  view = { map, W, heightAt, terrain, tmat, sat, col, heightCol, slopeCol, groups, markers, cam, img, isFast: () => fast };
  window.__mwoMap = view;
  // game mode list
  const sel = root.querySelector('#layer');
  const modes = map.layers.filter((l) => l !== 'main');
  if (!map.layers.includes(ui.layer)) ui.layer = 'main';
  sel.innerHTML = `<option value="main">None (base map only)</option>` + modes.map((l) => `<option value="${esc(l)}" ${l === ui.layer ? 'selected' : ''}>${esc(l)}</option>`).join('');
  root.querySelector('#stats').innerHTML = `${map.models.length} models · ${map.instances.reduce((a, g) => a + g.count, 0).toLocaleString()} objects<br>${Math.round(tris / 1000).toLocaleString()}k visual / ${Math.round(colTris / 1000).toLocaleString()}k hitbox triangles<br>${noCol.toLocaleString()} objects have no collision at all`;
  applyTerrainLook(); applyVisibility(); syncUi(); topDown(true);
  await scene.whenReadyAsync();
  loading.style.display = 'none';
}

function applyTerrainLook() {
  if (!view) return;
  const { terrain, tmat, sat, col, heightCol, slopeCol } = view;
  const useSat = ui.terrain === 'satellite' && sat;
  tmat.diffuseTexture = useSat ? sat : null;
  tmat.diffuseColor = Color3.White();
  terrain.setVerticesData(VertexBuffer.ColorKind, useSat ? col : ui.terrain === 'slope' ? slopeCol : heightCol, false, 4);
}

function applyVisibility() {
  if (!view) return;
  for (const { g, vis, coll } of view.groups) {
    const on = ui.cats[g.category] && (g.layer === 'main' || g.layer === ui.layer);
    vis?.setEnabled(on && ui.mode !== 'colliders');
    if (g.category === 'blocker') { coll?.setEnabled(on); continue; }
    if (coll) { coll.setEnabled(on && ui.mode !== 'visual'); coll.material = scene.getMaterialByName(ui.mode === 'both' ? 'colwire' : 'col'); }
  }
  for (const { mk, mesh } of view.markers) mesh.setEnabled(ui.markers && (mk.layer === 'main' || mk.layer === ui.layer));
}

function topDown(initial) {
  if (!view) return;
  const { W, cam, map } = view;
  const mm = map.minimap;
  const cx = mm ? (mm.startX + mm.endX) / 2 : W.size / 2; const cz = mm ? (mm.startY + mm.endY) / 2 : W.size / 2;
  const span = mm ? mm.endX - mm.startX : W.size;
  ui.eye = 0;
  if (initial) { cam.position.set(cx - span * 0.38, W.maxHeight + span * 0.3, cz - span * 0.38); cam.setTarget(new Vector3(cx, W.minHeight, cz)); }
  else { cam.position.set(cx, W.maxHeight + span * 0.75, cz - 1); cam.setTarget(new Vector3(cx, W.minHeight, cz)); }
  syncUi();
}

function miniToWorld(px, py, size) {
  const mm = view.map.minimap; const W = view.W;
  if (!mm) return [px / size * W.size, (1 - py / size) * W.size];
  // image u runs along world Y (north), image v (down) runs along world X
  return [mm.startX + (py / size) * (mm.endX - mm.startX), mm.startY + (px / size) * (mm.endY - mm.startY)];
}
function worldToMini(x, z, size) {
  const mm = view.map.minimap; const W = view.W;
  if (!mm) return [x / W.size * size, (1 - z / W.size) * size];
  return [((z - mm.startY) / (mm.endY - mm.startY)) * size, ((x - mm.startX) / (mm.endX - mm.startX)) * size];
}

function miniClick(e) {
  if (!view) return;
  const r = e.currentTarget.getBoundingClientRect();
  const [x, z] = miniToWorld(((e.clientX - r.left) / r.width) * 600, ((e.clientY - r.top) / r.height) * 600, 600);
  const g = view.heightAt(x, z);
  view.cam.position.set(x, ui.eye ? g + ui.eye : Math.max(view.cam.position.y, g + 60), z);
}

let frame = 0;
function tick() {
  if (!view) return;
  const { cam, heightAt, W } = view;
  cam.speed = ui.speed * (view.isFast() ? 4 : 1) * (ui.eye ? 0.35 : 1);
  const ground = heightAt(cam.position.x, cam.position.z);
  if (ui.eye) cam.position.y = ground + ui.eye;
  else if (cam.position.y < ground + 2) cam.position.y = ground + 2;
  if (frame++ % 6) return;
  const fwd = cam.getDirection(Vector3.Forward());
  // range to the terrain under the crosshair (marches the heightfield)
  let range = null;
  for (let d = 4; d < 3000; d += d < 400 ? 2 : 6) {
    const x = cam.position.x + fwd.x * d; const y = cam.position.y + fwd.y * d; const z = cam.position.z + fwd.z * d;
    if (x < 0 || z < 0 || x > W.size || z > W.size) break;
    if (y <= heightAt(x, z)) { range = d; break; }
  }
  const col = String.fromCharCode(65 + Math.max(0, Math.min(25, Math.floor(((cam.position.x - (view.map.minimap?.startX ?? 0)) / ((view.map.minimap?.endX ?? W.size) - (view.map.minimap?.startX ?? 0))) * 10))));
  root.querySelector('#readout').textContent = `x ${cam.position.x.toFixed(0)}  y ${cam.position.z.toFixed(0)}  alt ${cam.position.y.toFixed(0)} m (${(cam.position.y - ground).toFixed(0)} above ground)  ·  crosshair range ${range ? range.toFixed(0) + ' m' : '—'}`;
  drawMini(fwd);
  void col;
}

function drawMini(fwd) {
  const cv = root.querySelector('#mini'); if (!cv) return;
  const g = cv.getContext('2d'); const size = 600;
  g.fillStyle = '#111'; g.fillRect(0, 0, size, size);
  if (view.img.complete && view.img.naturalWidth) g.drawImage(view.img, 0, 0, size, size);
  if (ui.markers) for (const { mk } of view.markers) {
    if (!(mk.layer === 'main' || mk.layer === ui.layer)) continue;
    const [px, py] = worldToMini(mk.pos[0], mk.pos[2], size);
    g.fillStyle = mk.cls === 'MWOSpawnPoint' ? (mk.teamId === 2 ? '#ff5544' : mk.teamId === 1 ? '#44a0ff' : '#e6e64d') : mk.cls === 'MWCapturePoint' ? '#ffd633' : '#b070ff';
    g.beginPath(); g.arc(px, py, mk.cls === 'MWCapturePoint' ? 7 : 4, 0, 7); g.fill();
  }
  const [cx, cy] = worldToMini(view.cam.position.x, view.cam.position.z, size);
  const [fx, fy] = worldToMini(view.cam.position.x + fwd.x * 100, view.cam.position.z + fwd.z * 100, size);
  const a = Math.atan2(fy - cy, fx - cx);
  g.save(); g.translate(cx, cy); g.rotate(a);
  g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 90, -0.5, 0.5); g.closePath(); g.fill();
  g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.moveTo(14, 0); g.lineTo(-8, 8); g.lineTo(-3, 0); g.lineTo(-8, -8); g.closePath(); g.stroke(); g.fill();
  g.restore();
}

void Matrix;
