// Runs the build optimizer over every mech in the latest snapshot and ranks the results
// into meta tiers. Output: data/patches/<key>/builds.json
import path from 'node:path';
import { readJson, writeJson, DATA_DIR } from './lib/game.mjs';
import { indexDb, optimize, mechFrame, stockBuild, evaluate, score, describeBuild } from '../web/src/lib/buildmath.js';

const ROLES = ['brawl', 'mid', 'long'];
const index = readJson(path.join(DATA_DIR, 'index.json'));
if (!index?.latest) { console.error('No snapshot yet. Run: npm run scan'); process.exit(1); }
const key = process.argv[2] || index.latest;
const db = readJson(path.join(DATA_DIR, 'patches', key, 'db.json'));
const ctx = indexDb(db);
const t0 = Date.now();

const pack = (e) => ({
  score: +e.score.total.toFixed(3),
  factors: { firepower: +e.score.firepower.toFixed(2), durability: +e.score.durability.toFixed(3), mobility: +e.score.mobility.toFixed(3), alpha: +e.score.alphaFactor.toFixed(3), heat: e.score.heatFactor, ammo: +e.score.ammoFactor.toFixed(3) },
  title: describeBuild(ctx, e.build),
  build: { engine: e.build.engine.id, armorType: e.build.armorType, structureType: e.build.structureType, heatSinkType: e.build.heatSinkType, artemis: e.build.artemis, armorPct: +e.build.armorPct.toFixed(4), weapons: e.build.weapons, ammo: e.build.ammo, heatSinks: e.build.heatSinks, ecm: e.build.ecm },
});

// Many variants are reskins with identical stats: optimise each distinct frame once.
const signature = (m) => JSON.stringify([m.chassis, m.tons, m.faction, m.minEngine, m.maxEngine, m.canEquipECM, m.maxJumpJets,
  Object.entries(m.components).map(([n, c]) => [n, c.slots, c.hp, c.internals, c.fixed, c.hardpoints.map((h) => [h.type, h.count]), c.omniPod ?? 0]),
  m.quirks.filter((q) => !/xpbonus|cbillbonus/.test(q.name)), m.omni ? m.name.replace(/[^a-z0-9-]/g, '') : '']);

const cache = new Map();
const mechs = {};
let done = 0;
for (const mech of db.mechs) {
  const sig = mech.omni ? null : signature(mech);
  let res = sig ? cache.get(sig) : null;
  if (!res) {
    try {
      const r = optimize(ctx, mech, { roles: ROLES, keep: 4, skills: true });
      const frame = r.frame;
      const sb = stockBuild(ctx, frame);
      let stock = null;
      if (sb) { const ev = evaluate(ctx, frame, sb, { skills: true }); stock = Object.fromEntries(ROLES.map((role) => [role, +score(frame, ev, role).total.toFixed(3)])); }
      res = { roles: Object.fromEntries(ROLES.map((role) => [role, (r.results[role] ?? []).map(pack)])), stock, sameAs: null, source: mech.id };
    } catch (e) { res = { roles: Object.fromEntries(ROLES.map((r) => [r, []])), stock: null, error: e.message, source: mech.id }; }
    if (sig) cache.set(sig, res);
    mechs[mech.id] = res;
  } else mechs[mech.id] = { ...res, sameAs: res.source };
  if (++done % 200 === 0) console.log(`  ${done}/${db.mechs.length}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

// ---- meta tiers: rank each mech's best build against its weight class, per role
const tiers = {};
const TIER_CUTS = [[0.06, 'S'], [0.2, 'A'], [0.5, 'B'], [1.01, 'C']];
for (const wc of ['Light', 'Medium', 'Heavy', 'Assault']) {
  for (const role of ROLES) {
    const rows = db.mechs.filter((m) => m.weightClass === wc && !mechs[m.id].sameAs && mechs[m.id].roles[role][0])
      .map((m) => ({ id: m.id, s: mechs[m.id].roles[role][0].score })).sort((a, b) => b.s - a.s);
    rows.forEach((r, i) => {
      const pct = i / Math.max(1, rows.length);
      (tiers[r.id] ??= {})[role] = { rank: i + 1, of: rows.length, tier: TIER_CUTS.find(([c]) => pct < c)[1], rel: +(r.s / rows[0].s).toFixed(3) };
    });
  }
}
for (const m of db.mechs) {
  const e = mechs[m.id];
  const t = tiers[e.sameAs ?? m.id] ?? {};
  e.tiers = t;
  const best = ROLES.map((r) => t[r]).filter(Boolean).sort((a, b) => 'SABC'.indexOf(a.tier) - 'SABC'.indexOf(b.tier) || b.rel - a.rel)[0];
  e.bestTier = best?.tier ?? null;
  e.bestRole = best ? ROLES.find((r) => t[r] === best) : null;
}

writeJson(path.join(DATA_DIR, 'patches', key, 'builds.json'), { key, generatedAt: new Date().toISOString(), roles: ROLES, mechs });
const distinct = Object.values(mechs).filter((m) => !m.sameAs).length;
console.log(`Builds for ${db.mechs.length} variants (${distinct} distinct frames) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const wc of ['Light', 'Medium', 'Heavy', 'Assault']) for (const role of ROLES) {
  const top = db.mechs.filter((m) => m.weightClass === wc && mechs[m.id].tiers[role]?.rank <= 3 && !mechs[m.id].sameAs).sort((a, b) => mechs[a.id].tiers[role].rank - mechs[b.id].tiers[role].rank);
  console.log(`  ${wc.padEnd(8)}${role.padEnd(6)} ${top.map((m) => `${m.variant} (${mechs[m.id].roles[role][0].title})`).join('  |  ')}`);
}
