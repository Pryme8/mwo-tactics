// Babylon scene for one mech: body pieces for the variant plus the weapon models the
// selected build mounts. "Hit locations" colours every piece by the component it damages.
import { Engine, Scene, Vector3, Color3, Color4, ArcRotateCamera, HemisphericLight, DirectionalLight, Mesh, VertexData, StandardMaterial } from '@babylonjs/core';
import { load } from './store.js';
import { DATA, fetchBin, positions, indices } from './lib/bin.js';
import { COMPONENTS } from './lib/buildmath.js';

const HIT_COLOR = {
  head: [1, 0.25, 0.25], centre_torso: [1, 0.72, 0.15], left_torso: [0.3, 0.75, 0.4], right_torso: [0.25, 0.6, 1],
  left_arm: [0.55, 0.9, 0.6], right_arm: [0.55, 0.8, 1], left_leg: [0.75, 0.5, 0.95], right_leg: [0.95, 0.5, 0.8],
  centre_torso_rear: [0.75, 0.45, 0.05], left_torso_rear: [0.12, 0.42, 0.2], right_torso_rear: [0.1, 0.3, 0.6],
};

export async function buildMechScene(canvas, mech, meta, weapons) {
  const S = await load();
  const gbuf = await fetchBin(`${DATA}/mechs/${mech.chassis}/geo.cbin`);
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.04, 0.05, 0.06, 1);
  const hemi = new HemisphericLight('h', new Vector3(0.3, 1, 0.2), scene); hemi.intensity = 0.85; hemi.groundColor = new Color3(0.25, 0.25, 0.3);
  const sun = new DirectionalLight('s', new Vector3(-0.4, -0.7, 0.6), scene); sun.intensity = 0.8;

  const mats = {};
  const matFor = (key, rgb, emissive = 0) => {
    if (mats[key]) return mats[key];
    const m = new StandardMaterial(key, scene); m.diffuseColor = new Color3(...rgb); m.specularColor = new Color3(0.12, 0.12, 0.12); m.backFaceCulling = false;
    if (emissive) m.emissiveColor = new Color3(rgb[0] * emissive, rgb[1] * emissive, rgb[2] * emissive);
    return (mats[key] = m);
  };
  const body = matFor('body', [0.5, 0.53, 0.56]);
  const gun = matFor('gun', [0.95, 0.62, 0.2], 0.25);

  const meshes = [];
  let min = new Vector3(1e9, 1e9, 1e9); let max = new Vector3(-1e9, -1e9, -1e9);
  const add = (name, comp, isWeapon) => {
    const p = meta.pieces[name]; if (!p) return false;
    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = positions(gbuf, p.pos); vd.indices = indices(gbuf, p.idx);
    const n = new Float32Array(p.pos.n); VertexData.ComputeNormals(vd.positions, vd.indices, n); vd.normals = n;
    vd.applyToMesh(mesh);
    mesh.refreshBoundingInfo();
    const bb = mesh.getBoundingInfo().boundingBox;
    min = Vector3.Minimize(min, bb.minimumWorld); max = Vector3.Maximize(max, bb.maximumWorld);
    meshes.push({ mesh, comp, isWeapon });
    return true;
  };

  // body pieces listed by the variant, per hit location
  for (const [comp, c] of Object.entries(mech.components)) for (const piece of c.pieces ?? []) add(piece, comp, false);

  // weapon models: walk each component's hardpoints in order and take the mount that matches
  let mounted = 0;
  const frameHp = {};
  for (const comp of COMPONENTS) {
    const list = [...(mech.components[comp]?.hardpoints ?? [])];
    if (mech.omni) for (const pod of S.ctx.podsByChassis.get(mech.chassis) ?? []) if (pod.set === mech.name && pod.component === comp) list.push(...pod.hardpoints);
    frameHp[comp] = list;
  }
  const used = {};
  for (const w of weapons) {
    const def = S.db.weapons.find((x) => x.name === w.name); if (!def || !w.comp) continue;
    const want = new Set([...def.aliases, `Missile${def.stats.numFiring ?? ''}`].map((s) => s.toLowerCase()));
    let done = false;
    for (const hp of frameHp[w.comp] ?? []) {
      if (hp.type !== def.type || done) continue;
      const slots = meta.hardpoints[hp.id] ?? [];
      for (let si = 0; si < slots.length && !done; si++) {
        const key = `${w.comp}|${hp.id}|${si}`; if (used[key]) continue;
        // most specific alias wins (aliases run general -> specific)
        let pick = null; let rank = -1;
        for (const cand of slots[si]) { const r = [...want].indexOf(cand.s.toLowerCase()); if (r > rank && cand.a) { rank = r; pick = cand; } }
        pick ??= slots[si].find((c) => c.a && c.s.toLowerCase() === 'default');
        used[key] = true; done = true;
        if (pick && add(pick.a, w.comp, true)) mounted++;
      }
    }
  }

  const center = min.add(max).scale(0.5); const size = max.subtract(min);
  const cam = new ArcRotateCamera('c', Math.PI / 2 + 0.55, 1.3, Math.max(size.x, size.y, size.z) * 1.35, center, scene);
  cam.lowerRadiusLimit = 4; cam.upperRadiusLimit = 120; cam.wheelPrecision = 12; cam.minZ = 0.2; cam.panningSensibility = 0;
  cam.attachControl(canvas, true);

  let mode = 'visual';
  const apply = () => {
    for (const { mesh, comp, isWeapon } of meshes) {
      if (mode === 'visual') mesh.material = isWeapon ? gun : body;
      else mesh.material = matFor(`hit_${comp}`, HIT_COLOR[comp] ?? [0.6, 0.6, 0.6], 0.2);
    }
  };
  apply();
  engine.runRenderLoop(() => scene.render());
  const ro = new ResizeObserver(() => engine.resize()); ro.observe(canvas);
  return {
    note: `${meshes.length} pieces${weapons.length ? ` · ${mounted}/${weapons.length} weapon models mounted` : ''} · ${size.y.toFixed(1)} m tall`,
    setMode(m) { mode = m === 'visual' ? 'visual' : 'hit'; apply(); },
    dispose() { ro.disconnect(); scene.dispose(); engine.dispose(); },
  };
}
