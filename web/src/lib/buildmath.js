// Build maths shared by the website and the batch build generator.
// Everything here is derived from the scanned game data; the handful of numbers the
// game hard-codes (not present in its data files) are collected in TUNING so they are
// easy to find and correct.

export const TUNING = {
  baseHeatCapacity: 30,          // capacity before heat sinks
  engineSinkCount: 10,           // the first N sinks use the "engine" cooling/capacity values
  kphPerRating: 16.2,            // top speed = rating * 16.2 / tons
  headMaxArmor: 18,
  // extra heat per weapon fired past its free limit, as a fraction of (heat * penalty)
  ghostScale: [0, 0, 0.08, 0.18, 0.30, 0.45, 0.60, 0.80, 1.10, 1.50, 2.00, 3.00, 5.00],
  ammoSeconds: 110,              // sustained fire time builds are stocked for
  roleRange: { brawl: 150, mid: 420, long: 720, sniper: 900, missile: 550, scout: 200, support: 500, stealth: 450 },
  // Team equipment. Each number is the share added to a build's score in that role.
  gearValue: {
    support: { ams: 0.05, tag: 0.06, narc: 0.08 },
    stealth: { ams: 0.02, tag: 0.08, narc: 0.08 },
  },
  maxAmsCredit: 3,
  tagLockBoost: 0.12,            // own lock-on missiles land tighter on a TAGged target (missile boats)
  narcLockBoost: 0.06,
  artemisBoost: 1.15,            // Artemis: 30% tighter spread, counted as 15% more damage on the aimed component
  heatStableAt: 0.95,            // cooling / heat generated at which a build counts as heat stable
  scoutMinKph: 105,              // slower than this (with skills) is not a scout
  scoutRefKph: 125,
  missileBoatOtherWeight: 0.25,  // how much non-missile weapons count on a missile boat
};

export const COMPONENTS = ['head', 'centre_torso', 'left_torso', 'right_torso', 'left_arm', 'right_arm', 'left_leg', 'right_leg'];
const SHORT = { head: 'hd', centre_torso: 'ct', left_torso: 'lt', right_torso: 'rt', left_arm: 'la', right_arm: 'ra', left_leg: 'll', right_leg: 'rl' };
export const COMP_LABEL = { head: 'Head', centre_torso: 'Center Torso', left_torso: 'Left Torso', right_torso: 'Right Torso', left_arm: 'Left Arm', right_arm: 'Right Arm', left_leg: 'Left Leg', right_leg: 'Right Leg' };
const REAR = { centre_torso: 'centre_torso_rear', left_torso: 'left_torso_rear', right_torso: 'right_torso_rear' };
const WEAPON_TYPES = ['Ballistic', 'Energy', 'Missile'];

// ---------------------------------------------------------------- database index
export function indexDb(db) {
  const ctx = { db, item: new Map(), weapon: new Map(), upgrade: new Map(), podsByChassis: new Map(), pod: new Map() };
  for (const w of db.weapons) { ctx.weapon.set(w.id, w); ctx.item.set(w.id, { ...w, slots: w.stats.slots ?? 0, tons: w.stats.tons ?? 0, kind: 'weapon' }); }
  for (const a of db.ammo) ctx.item.set(a.id, { ...a, kind: 'ammo' });
  for (const e of db.engines) ctx.item.set(e.id, { ...e, kind: 'engine' });
  for (const e of db.equipment) ctx.item.set(e.id, { ...e, kind: e.cType === 'CHeatSinkStats' ? 'heatsink' : 'equipment' });
  for (const e of db.jumpjets) ctx.item.set(e.id, { ...e, kind: 'jumpjet' });
  for (const e of db.masc) ctx.item.set(e.id, { ...e, kind: 'masc' });
  for (const e of db.internals) ctx.item.set(e.id, { ...e, kind: 'internal' });
  for (const u of db.upgrades) ctx.upgrade.set(u.id, u);
  for (const p of db.omnipods) { ctx.pod.set(p.id, p); if (!ctx.podsByChassis.has(p.chassis)) ctx.podsByChassis.set(p.chassis, []); ctx.podsByChassis.get(p.chassis).push(p); }
  ctx.ammoByType = new Map();
  for (const a of db.ammo) { const k = a.type.toLowerCase(); if (!ctx.ammoByType.has(k) || (a.tons === 1 && ctx.ammoByType.get(k).tons !== 1)) ctx.ammoByType.set(k, a); }
  ctx.engines = db.engines.slice().sort((a, b) => a.rating - b.rating);
  ctx.upgradesOf = (cType, faction) => db.upgrades.filter((u) => u.cType === cType && (!u.faction.length || u.faction.includes(faction)));
  ctx.ecm = db.equipment.filter((e) => e.cType === 'CGECMStats');
  // team equipment per faction, and the Artemis twin of each launcher (a separate item in the game)
  const byName = new Map(db.weapons.map((w) => [w.name, w]));
  const gearOf = (prefix) => {
    const g = { ams: byName.get(prefix + 'AntiMissileSystem'), tag: byName.get(prefix + 'TAG'), narc: byName.get(prefix + 'NarcBeacon') };
    g.amsAmmo = g.ams && ctx.ammoByType.get((g.ams.stats.ammoType ?? '').toLowerCase());
    g.narcAmmo = g.narc && ctx.ammoByType.get((g.narc.stats.ammoType ?? '').toLowerCase());
    return g;
  };
  ctx.gear = { InnerSphere: gearOf(''), Clan: gearOf('Clan') };
  ctx.artemisOf = new Map();
  for (const w of db.weapons) { const twin = byName.get(w.name + '_Artemis'); if (twin) ctx.artemisOf.set(w.id, twin.id); }
  ctx.skillBonus = { InnerSphere: skillBonuses(db, 'IS'), Clan: skillBonuses(db, 'Clan') };
  return ctx;
}

// A "typical" full firepower + operations skill investment, taken from the skill tree data.
const SKILL_EFFECTS = ['all_range_multiplier', 'all_velocity_multiplier', 'all_cooldown_multiplier', 'all_heat_multiplier', 'laser_duration_multiplier', 'heatdissipation_multiplier', 'maxheat_multiplier', 'mechtopspeed_multiplier'];
function skillBonuses(db, faction) {
  const out = [];
  for (const node of db.skills ?? []) for (const e of node.effects) {
    if (!SKILL_EFFECTS.includes(e.name)) continue;
    const v = e.byFaction?.[faction]?.value ?? e.value;
    if (v) out.push({ name: e.name, value: v * node.count });
  }
  const merged = new Map();
  for (const q of out) merged.set(q.name, (merged.get(q.name) ?? 0) + q.value);
  return [...merged].map(([name, value]) => ({ name, value }));
}

// ---------------------------------------------------------------- quirks
// Quirk names are "<scope>_<stat>_<multiplier|additive>". The scope is "all", a hardpoint
// type, or one of the weapon's HardpointAliases (which is how the game matches them).
export function quirkTable(quirks) {
  const t = new Map();
  for (const q of quirks) t.set(q.name, (t.get(q.name) ?? 0) + q.value);
  return t;
}

export function weaponScopes(w) {
  if (!w._scopes) w._scopes = [...new Set(['all', w.type.toLowerCase(), ...w.aliases.map((a) => a.toLowerCase())])];
  return w._scopes;
}

function weaponMod(qt, w, stat, kind = 'multiplier') {
  let v = 0;
  for (const s of weaponScopes(w)) v += qt.get(`${s}_${stat}_${kind}`) ?? 0;
  return v;
}

// ---------------------------------------------------------------- weapons
export function weaponProfile(w, qt = new Map()) {
  const s = w.stats;
  // damage is per projectile: x pellets per shell (LB-X) x projectiles per trigger pull (missiles, clan AC bursts)
  // splashPercent (Arrow IV): the blast also damages what is next to the impact
  const perShot = (s.damage ?? 0) * (s.numPerShot || 1) * (s.numFiring || 1) * (1 + (s.splashPercent ?? 0));
  const oneShot = !!s.isOneShot;
  const cdMul = 1 + weaponMod(qt, w, 'cooldown');
  const heatMul = 1 + weaponMod(qt, w, 'heat');
  const rangeMul = 1 + weaponMod(qt, w, 'range');
  const durMul = 1 + weaponMod(qt, w, 'duration');
  const velMul = 1 + weaponMod(qt, w, 'velocity');
  const continuous = (s.rof ?? 0) > 0 && !(s.cooldown > 0);
  let dps; let hps; let alpha; let alphaHeat; let cycle; let burn = 0;
  if (continuous) {
    const rof = s.rof * (1 + weaponMod(qt, w, 'rof'));
    dps = perShot * rof;
    hps = (s.heat ?? 0) * heatMul;
    const jam = (s.JammingChance ?? 0) * (1 + weaponMod(qt, w, 'jamchance'));
    if (jam > 0 && s.JammedTime) { const up = (s.jamRampUpTime ?? 6) / Math.max(0.05, jam * 10); dps *= up / (up + s.JammedTime); hps *= up / (up + s.JammedTime); }
    alpha = dps; alphaHeat = hps; cycle = 1; burn = 1;
  } else {
    burn = Math.max(0, s.duration ?? 0) * durMul;
    const charge = s.chargeTime ?? 0;
    cycle = Math.max(0.1, (s.cooldown ?? 0) * cdMul + burn + charge);
    const extra = s.ShotsDuringCooldown ?? 0;          // ultra autocannon double tap
    const jam = extra ? Math.max(0, (s.JammingChance ?? 0) * (1 + weaponMod(qt, w, 'jamchance'))) : 0;
    const shots = 1 + extra;
    const time = cycle + jam * (s.JammedTime ?? 0) * (1 + weaponMod(qt, w, 'jamduration'));
    alpha = perShot * shots; alphaHeat = (s.heat ?? 0) * heatMul * shots;
    dps = alpha / time; hps = alphaHeat / time;
    if (oneShot) { dps = 0; hps = 0; }                 // rocket launchers: a single volley, no sustained output
  }
  // range bands
  const ranges = w.ranges.length ? w.ranges : [{ start: 0, mod: 1 }, { start: 1, mod: 0 }];
  let peak = 0; for (const r of ranges) peak = Math.max(peak, r.mod);
  let optIdx = 0; ranges.forEach((r, i) => { if (r.mod >= peak - 1e-6) optIdx = i; });
  const pts = ranges.map((r, i) => ({ d: i >= optIdx && r.start > 0 ? r.start * rangeMul : r.start, mod: r.mod, interp: r.interp, exp: r.exp || 1 }));
  const spread = (s.spread ?? 0) * (1 + weaponMod(qt, w, 'spread'));
  return {
    id: w.id, name: w.name, label: w.label, type: w.type, tons: s.tons ?? 0, slots: s.slots ?? 0,
    perShot, alpha, alphaHeat, dps, hps, cycle, burn, continuous, oneShot, shells: w.type === 'Ballistic' ? (s.numFiring || 1) : 1,
    optimal: pts[optIdx].d, max: pts[pts.length - 1].d, min: pts[0].mod < 0.5 && pts.length > 1 ? pts[1].d : 0, pts, peak,
    speed: (s.speed ?? 0) * velMul, spread, lock: !!s.uselock, ammoType: s.ammoType || '', ammoPerShot: continuous ? (s.ammoPerShot || 1) * (s.rof || 1) : (s.ammoPerShot || 0) * (1 + (s.ShotsDuringCooldown ?? 0)),
    penaltyId: s.heatPenaltyID ?? null, penalty: s.heatpenalty ?? 0,
    penaltyLevel: s.minheatpenaltylevel ? s.minheatpenaltylevel + weaponMod(qt, w, 'minheatpenaltylevel', 'additive') : Infinity,
    baseHeat: (s.heat ?? 0) * heatMul, health: s.Health ?? 10,
  };
}

export function damageAt(p, dist) {
  const pts = p.pts;
  // past the last band nothing lands: missiles self-destruct at max range (their tables end at full damage)
  if (dist > pts[pts.length - 1].d) return 0;
  if (dist === pts[pts.length - 1].d) return pts[pts.length - 1].mod;
  for (let i = pts.length - 2; i >= 0; i--) {
    if (dist >= pts[i].d) {
      const a = pts[i]; const b = pts[i + 1];
      if (a.interp === 'step' || b.d <= a.d) return a.mod;
      let t = (dist - a.d) / (b.d - a.d);
      if (a.interp === 'exponential' && a.exp !== 1) t = Math.pow(t, a.exp);
      return a.mod + (b.mod - a.mod) * t;
    }
  }
  return pts[0].mod;
}

// How much of a weapon's paper damage lands on the component you aimed at.
export function precision(p, dist) {
  let f = 1;
  if (p.type === 'Missile') f = p.lock ? 0.5 : Math.max(0.2, 0.85 - dist / 600);
  else if (p.spread > 0) f = Math.max(0.2, 0.9 - (p.spread * dist) / 420);
  else if (p.continuous) f = 0.62;
  else if (p.shells > 1) f = 1 / (1 + (p.shells - 1) * 0.09);            // burst-fire autocannons walk across components
  else if (p.burn > 0) f = 1 / (1 + p.burn * 0.38);
  if (p.artemis) f = Math.min(1, f * TUNING.artemisBoost);
  if (p.speed > 0 && !p.lock) f *= Math.min(1, Math.max(0.45, 1 - Math.max(0, dist / p.speed - 0.18) * 0.9));   // lead time
  return f;
}

// ---------------------------------------------------------------- mech frame
export function mechFrame(ctx, mech, podChoice = null) {
  const faction = mech.faction;
  const quirks = [...mech.quirks];
  const comps = {};
  const pods = {};
  if (mech.omni) {
    const all = ctx.podsByChassis.get(mech.chassis) ?? [];
    for (const c of COMPONENTS) {
      const fixedPod = mech.components[c]?.omniPod;
      const wantId = fixedPod ?? podChoice?.[c];
      pods[c] = (wantId && ctx.pod.get(wantId)) || all.find((p) => p.set === mech.name && p.component === c) || all.find((p) => p.component === c) || null;
    }
    const sets = new Set(COMPONENTS.map((c) => pods[c]?.set));
    for (const c of COMPONENTS) if (pods[c]) quirks.push(...pods[c].quirks);
    if (sets.size === 1) for (const b of ctx.db.setBonuses) if (b.chassis === mech.chassis && b.set === [...sets][0] && b.pieces <= 8) quirks.push(...b.quirks);
  }
  let canECM = mech.canEquipECM; let maxJJ = mech.maxJumpJets;
  for (const c of COMPONENTS) {
    const mc = mech.components[c];
    if (!mc) continue;
    const pod = pods[c];
    const internals = [...mc.internals, ...(pod ? pod.internals.map((i) => i.id) : [])];
    const fixed = [...mc.fixed, ...(pod ? pod.fixed : [])];
    let used = 0;
    for (const id of internals) used += ctx.item.get(id)?.slots ?? 0;
    let fixedEngine = null;
    for (const id of fixed) {
      const it = ctx.item.get(id); if (!it) continue;
      // heat sinks fixed in the centre torso sit inside the engine and take no slots
      if (it.kind === 'heatsink' && c === 'centre_torso') { comps.fixedEngineSinks = (comps.fixedEngineSinks ?? 0) + 1; continue; }
      used += it.slots ?? 0; if (it.kind === 'engine') fixedEngine = it;
    }
    const hardpoints = { Ballistic: 0, Energy: 0, Missile: 0, AMS: 0, ECM: 0 };
    for (const h of (pod ? [...mc.hardpoints, ...pod.hardpoints] : mc.hardpoints)) hardpoints[h.type] = (hardpoints[h.type] ?? 0) + h.count;
    if (mc.canEquipECM || pod?.canEquipECM) canECM = true;
    if (pod?.maxJumpJets) maxJJ += pod.maxJumpJets;
    comps[c] = { name: c, slots: mc.slots, free: mc.slots - used, hp: mc.hp, hardpoints, fixed, maxArmor: c === 'head' ? TUNING.headMaxArmor : mc.hp * 2 };
    if (fixedEngine) comps.fixedEngine = fixedEngine;
  }
  const fixedEngine = comps.fixedEngine ?? null; delete comps.fixedEngine;
  const fixedEngineSinks = comps.fixedEngineSinks ?? 0; delete comps.fixedEngineSinks;
  return { mech, faction, comps, pods, quirks, fixedEngine, fixedEngineSinks, canECM, maxJJ, omni: mech.omni, stock: mech.stock };
}

export function engineChoices(ctx, frame, wantKph) {
  if (frame.fixedEngine) return [frame.fixedEngine];
  const { mech } = frame;
  const kinds = mech.faction === 'Clan' ? ['Clan_XL'] : ['XL', 'Light', 'Std'];
  const out = [];
  for (const kph of wantKph) {
    let rating = Math.round((kph * mech.tons) / TUNING.kphPerRating / 5) * 5;
    rating = Math.max(mech.minEngine, Math.min(mech.maxEngine, rating));
    for (const kind of kinds) {
      const e = ctx.engines.find((x) => x.kind === kind && x.rating === rating && x.faction.includes(mech.faction));
      if (e && !out.includes(e)) out.push(e);
    }
  }
  return out;
}

// ---------------------------------------------------------------- evaluate a build
// build: { engine, armorType, structureType, heatSinkType, artemis, armorPct, weapons:[weaponId...], ammo:{ammoId:count}, heatSinks, ecm }
export function evaluate(ctx, frame, build, opts = {}) {
  const { mech } = frame;
  const engine = build.engine;
  const upA = ctx.upgrade.get(build.armorType); const upS = ctx.upgrade.get(build.structureType); const upH = ctx.upgrade.get(build.heatSinkType);
  const sinkItem = ctx.item.get(upH?.heatSinkTypeStats?.compatibleHeatSink ?? 3000);
  const qt = opts.qt ?? quirkTable(opts.skills ? [...frame.quirks, ...ctx.skillBonus[mech.faction]] : frame.quirks);
  const cache = opts.cache;
  const profileOf = (id) => {
    const w = ctx.weapon.get(id);
    const art = build.artemis && w.stats.artemisAmmoType;
    const key = art ? id + 'a' : id;
    let p = cache?.get(key);
    if (!p) {
      p = weaponProfile(w, qt);
      if (art) p = { ...p, artemis: true, ammoType: w.stats.artemisAmmoType, spread: p.spread * (ctx.upgrade.get(3050)?.artemisTypeStats?.missileSpread ?? 0.7) };
      cache?.set(key, p);
    }
    return p;
  };

  // ---- weight
  const structureTons = Math.ceil(mech.tons * (upS?.structureTypeStats?.weightPerTon ?? 0.1) * 2 - 1e-9) / 2;
  let maxArmor = 0; for (const c of COMPONENTS) maxArmor += frame.comps[c]?.maxArmor ?? 0;
  const armorPts = Math.round(maxArmor * (build.armorPct ?? 1));
  const armorTons = Math.ceil((armorPts / (upA?.armorTypeStats?.armorPerTon ?? 32)) * 2 - 1e-9) / 2;
  const profiles = build.weapons.map(profileOf);
  const artemisUp = ctx.upgrade.get(3050)?.artemisTypeStats ?? { extraTons: 1, extraSlots: 1 };
  let weaponTons = 0; let ammoTons = 0; let ammoSlots = 0;
  const artemisWeapons = build.artemis ? build.weapons.filter((id) => ctx.weapon.get(id).stats.artemisAmmoType).length : 0;
  for (const p of profiles) weaponTons += p.tons;
  weaponTons += artemisWeapons * artemisUp.extraTons;
  for (const [id, n] of Object.entries(build.ammo ?? {})) { const a = ctx.item.get(+id); ammoTons += (a?.tons ?? 1) * n; ammoSlots += (a?.slots ?? 1) * n; }
  const fixedSinks = COMPONENTS.reduce((n, c) => n + (frame.comps[c]?.fixed.filter((id) => ctx.item.get(id)?.kind === 'heatsink').length ?? 0), 0);
  const internalSinks = engine.heatsinks;
  const engineSlotSinks = Math.max(0, Math.floor(engine.rating / 25) - 10 - frame.fixedEngineSinks);
  const extSinks = build.heatSinks ?? 0;                // sinks the build adds (engine slots first, then components)
  const ecm = build.ecm ? ctx.ecm.find((e) => e.faction.includes(mech.faction)) : null;
  const fixedTons = COMPONENTS.reduce((t, c) => t + (frame.comps[c]?.fixed.reduce((a, id) => { const it = ctx.item.get(id); return a + (it && it.kind !== 'engine' && it.kind !== 'heatsink' ? it.tons ?? 0 : 0); }, 0) ?? 0), 0);
  const G = ctx.gear[mech.faction] ?? {}; const want = build.gear ?? {};
  const gearIds = [...Array(want.ams ?? 0).fill(G.ams?.id), ...(want.tag ? [G.tag?.id] : []), ...Array(want.narc ?? 0).fill(G.narc?.id)].filter(Boolean);
  const gearTons = gearIds.reduce((t, id) => t + (ctx.item.get(id)?.tons ?? 0), 0);
  const tons = gearTons + structureTons + armorTons + engine.tons + weaponTons + ammoTons + (extSinks + fixedSinks) * (sinkItem?.tons ?? 1) + (ecm?.tons ?? 0) + fixedTons;

  // ---- slots
  const free = {}; let totalFree = 0;
  for (const c of COMPONENTS) { free[c] = frame.comps[c]?.free ?? 0; }
  if (!frame.fixedEngine) { free.centre_torso -= engine.slots; free.left_torso -= engine.sideSlots; free.right_torso -= engine.sideSlots; }
  const hpLeft = {}; for (const c of COMPONENTS) hpLeft[c] = { ...(frame.comps[c]?.hardpoints ?? {}) };
  const placement = [];
  let valid = true; const problems = [];
  const order = profiles.map((p, i) => ({ p, i })).sort((a, b) => b.p.slots - a.p.slots);
  for (const { p, i } of order) {
    const need = p.slots + (build.artemis && ctx.weapon.get(p.id).stats.artemisAmmoType ? artemisUp.extraSlots : 0);
    let best = null;
    for (const c of COMPONENTS) {
      if (!(hpLeft[c][p.type] > 0) || free[c] < need) continue;
      // prefer torsos for big guns, keep the head for last
      const pref = (c === 'head' ? -20 : 0) + free[c] - (c.endsWith('arm') ? 0.5 : 0);
      if (!best || pref > best.pref) best = { c, pref };
    }
    if (!best) { valid = false; problems.push(`No ${p.type.toLowerCase()} hardpoint with ${need} free slots for ${p.label}`); continue; }
    hpLeft[best.c][p.type]--; free[best.c] -= need; placement[i] = best.c;
  }
  const gearPlaced = [];
  for (const id of gearIds) {
    const it = ctx.item.get(id);
    const c = COMPONENTS.filter((x) => hpLeft[x][it.type] > 0 && free[x] >= it.slots).sort((a, b) => free[b] - free[a])[0];
    if (!c) { valid = false; problems.push('No free ' + it.type + ' hardpoint for ' + it.label); continue; }
    hpLeft[c][it.type]--; free[c] -= it.slots; gearPlaced.push({ id, c });
  }
  if (ecm) { const c = COMPONENTS.find((x) => free[x] >= ecm.slots && x !== 'head') ; if (c) free[c] -= ecm.slots; else { valid = false; problems.push('No room for ECM'); } }
  for (const c of COMPONENTS) { if (free[c] < 0) { valid = false; problems.push(`${COMP_LABEL[c]} is over its slot limit`); } totalFree += Math.max(0, free[c]); }
  const dynSlots = frame.omni ? 0 : (upA?.slotUsage?.slots ?? 0) + (upS?.slotUsage?.slots ?? 0);
  const sinkSlots = sinkItem?.slots ?? 1;
  const sinksInComponents = Math.max(0, extSinks - engineSlotSinks);
  let sinkRoom = 0; for (const c of COMPONENTS) sinkRoom += Math.floor(Math.max(0, free[c]) / sinkSlots);
  if (sinksInComponents > sinkRoom) { valid = false; problems.push('Not enough room for the heat sinks'); }
  const slotsNeeded = sinksInComponents * sinkSlots + ammoSlots + dynSlots;
  if (slotsNeeded > totalFree) { valid = false; problems.push(`Needs ${slotsNeeded} slots, ${totalFree} free`); }
  if (tons > mech.tons + 1e-6) { valid = false; problems.push(`Overweight by ${(tons - mech.tons).toFixed(2)}t`); }
  const totalSinks = internalSinks + extSinks + fixedSinks;
  if (totalSinks < 10) { valid = false; problems.push('Fewer than 10 heat sinks'); }

  // ---- heat
  const hs = sinkItem?.heatSinkStats ?? { cooling: 0.15, engineCooling: 0.18, heatbase: -0.85, engineHeatbase: -2.25 };
  const eng = Math.min(TUNING.engineSinkCount, totalSinks); const ext = totalSinks - eng;
  const capacity = (TUNING.baseHeatCapacity + eng * Math.abs(hs.engineHeatbase) + ext * Math.abs(hs.heatbase)) * (1 + (qt.get('maxheat_multiplier') ?? 0));
  const dissipation = (eng * hs.engineCooling + ext * hs.cooling) * (1 + (qt.get('heatdissipation_multiplier') ?? 0));

  // ---- firepower
  let alpha = 0; let alphaHeat = 0; let dps = 0; let hps = 0;
  for (const p of profiles) { alpha += p.alpha; alphaHeat += p.alphaHeat; dps += p.dps; hps += p.hps; }
  // ghost heat when everything in a penalty group is fired together
  const groups = new Map();
  for (const p of profiles) { if (p.penaltyId == null || p.continuous) continue; if (!groups.has(p.penaltyId)) groups.set(p.penaltyId, []); groups.get(p.penaltyId).push(p); }
  let ghost = 0;
  for (const g of groups.values()) {
    const limit = Math.min(...g.map((p) => p.penaltyLevel));
    if (g.length < limit) continue;
    const heat = Math.max(...g.map((p) => p.baseHeat)); const pen = Math.max(...g.map((p) => p.penalty));
    for (let k = limit; k <= g.length; k++) ghost += heat * pen * (TUNING.ghostScale[Math.min(k, TUNING.ghostScale.length - 1)] ?? 5);
  }
  const sustainFrac = hps > 0 ? Math.min(1, dissipation / hps) : 1;
  const window = (T, dist, effOf = precision) => {
    // damage deliverable in T seconds from cold, staggering fire to avoid ghost heat
    let raw = 0; let eff = 0; let heatPerDmg = 0;
    for (const p of profiles) { const m = damageAt(p, dist); const d = p.dps * m; raw += d; eff += d * effOf(p, dist); }
    if (raw <= 0) return { raw: 0, eff: 0 };
    heatPerDmg = hps / Math.max(1e-6, dps);
    const first = profiles.reduce((a, p) => a + (p.continuous ? 0 : p.alpha * damageAt(p, dist)), 0);
    const heatBudget = capacity * 0.92 + dissipation * T;
    const unlimited = first + raw * T;
    const limited = heatPerDmg > 0 ? heatBudget / heatPerDmg * (raw / Math.max(1e-6, dps)) : unlimited;
    const total = Math.min(unlimited, limited);
    return { raw: total, eff: total * (eff / raw) };
  };

  // ---- ammo endurance
  let ammoSeconds = Infinity;
  const need = new Map();
  for (const p of profiles) if (p.ammoType) { const k = p.ammoType.toLowerCase(); need.set(k, (need.get(k) ?? 0) + p.ammoPerShot / p.cycle); }
  for (const [k, perSec] of need) {
    let shots = 0;
    for (const [id, n] of Object.entries(build.ammo ?? {})) { const a = ctx.item.get(+id); if (a && a.type.toLowerCase() === k) shots += a.numShots * n; }
    ammoSeconds = Math.min(ammoSeconds, perSec > 0 ? shots / perSec : Infinity);
  }

  // ---- durability / mobility
  let armorBonus = 0; let structBonus = 0; let structure = 0;
  for (const c of COMPONENTS) { structure += frame.comps[c]?.hp ?? 0; armorBonus += qt.get(`armorresist_${SHORT[c]}_additive`) ?? 0; structBonus += qt.get(`internalresist_${SHORT[c]}_additive`) ?? 0; }
  const ehp = armorPts + armorBonus + structure + structBonus;
  const ctKill = (frame.comps.centre_torso.maxArmor * (build.armorPct ?? 1)) + frame.comps.centre_torso.hp + (qt.get('armorresist_ct_additive') ?? 0) + (qt.get('internalresist_ct_additive') ?? 0);
  const kph = (engine.rating * TUNING.kphPerRating / mech.tons) * (1 + (qt.get('mechtopspeed_multiplier') ?? 0));
  const sideDeath = engine.sidesToDie === 1;

  return {
    valid, problems, tons, freeTons: mech.tons - tons, slotsFree: totalFree - slotsNeeded,
    structureTons, armorTons, armorPts, weaponTons, ammoTons, totalSinks,
    alpha, alphaHeat: alphaHeat + ghost, ghost, dps, hps, capacity, dissipation, sustainFrac, sustainedDps: dps * sustainFrac,
    alphasToOverheat: alphaHeat + ghost > 0 ? capacity / (alphaHeat + ghost) : Infinity,
    ammoSeconds, ehp, ctKill, kph, sideDeath, placement, profiles, window, ecm: !!ecm, engine,
    stealthArmor: /stealth/i.test(upA?.name ?? ''), artemis: artemisWeapons > 0,
    gear: { ams: want.ams ?? 0, tag: !!want.tag, narc: want.narc ?? 0, placed: gearPlaced },
    optimal: dps > 0 ? profiles.reduce((a, p) => a + p.optimal * p.dps, 0) / dps : 0,
  };
}

// ---------------------------------------------------------------- scoring
// One number per role so builds can be ranked. Each factor is reported so the UI can
// show why a build rates the way it does.
const CLASS_BASE = { Light: { ehp: 300, kph: 125 }, Medium: { ehp: 440, kph: 92 }, Heavy: { ehp: 580, kph: 76 }, Assault: { ehp: 760, kph: 60 } };
// Missile boats are judged on their missiles: lock-on launchers get full credit for the
// damage they spread over a target (they can fire over cover on a team-mate's lock),
// and everything else on the mech only counts as backup.
function missileBoatShare(p, dist) {
  if (p.type !== 'Missile') return precision(p, dist) * TUNING.missileBoatOtherWeight;
  return p.lock ? Math.min(1, 0.62 * (p.artemis ? TUNING.artemisBoost : 1)) : precision(p, dist);
}
export const missileDpsAt = (ev, dist) => ev.profiles.reduce((a, p) => a + (p.type === 'Missile' ? p.dps * damageAt(p, dist) : 0), 0);

// Snipers trade at extreme range from cover: only damage that arrives in one spot at
// once is worth much, and lock-on missiles do not count at all.
function sniperShare(p, dist) {
  if (p.type === 'Missile' && p.lock) return 0;
  const pinpoint = !p.continuous && p.burn === 0 && !(p.spread > 0) && p.shells === 1;
  return precision(p, dist) * (pinpoint ? 1 : 0.7);
}

const ZERO = { total: 0, firepower: 0, durability: 0, mobility: 0, alphaFactor: 0, heatFactor: 0, ammoFactor: 0, gearFactor: 0, burst: 0, sustain: 0 };
const MOBILITY_EXP = { brawl: 0.55, mid: 0.4, long: 0.25, sniper: 0.2, missile: 0.2, scout: 1.2, support: 0.3, stealth: 0.45 };
const BURST_WEIGHT = { sniper: 0.8, support: 0.2 };       // share of the score from the first 8 s (default 0.5)
const ECM_BONUS = { scout: 1.2, support: 1.15, stealth: 1 };

// A role key may end in '+stable': the same role, but builds that cannot keep firing
// without building heat are marked down hard.
export const STABLE = '+stable';
export const baseRole = (key) => (key.endsWith(STABLE) ? key.slice(0, -STABLE.length) : key);

export function score(frame, ev, roleKey) {
  const role = baseRole(roleKey); const stable = role !== roleKey;
  const dist = TUNING.roleRange[role];
  if (role === 'missile' && missileDpsAt(ev, dist) <= 0) return ZERO;
  if (role === 'stealth' && !ev.ecm) return ZERO;                      // stealth needs ECM (and stealth armor needs it too)
  if (role === 'scout' && ev.kph < TUNING.scoutMinKph) return ZERO;
  const lockBoost = 1 + (ev.gear.tag ? TUNING.tagLockBoost : 0) + (ev.gear.narc ? TUNING.narcLockBoost : 0);
  const effOf = role === 'missile' ? (p, d) => missileBoatShare(p, d) * (p.type === 'Missile' && p.lock ? lockBoost : 1) : role === 'sniper' ? sniperShare : precision;
  const burst = ev.window(8, dist, effOf); const sustain = ev.window(30, dist, effOf);
  const wb = BURST_WEIGHT[role] ?? 0.5;
  const firepower = wb * burst.eff / 8 + (1 - wb) * sustain.eff / 30;                // effective dps
  if (!(firepower > 0)) return ZERO;
  const base = CLASS_BASE[frame.mech.weightClass];
  let durability = Math.pow(ev.ehp / base.ehp, role === 'scout' ? 0.3 : 0.45) * (ev.sideDeath ? 0.9 : 1) * (ev.ecm ? ECM_BONUS[role] ?? 1.08 : 1);
  if (role === 'stealth' && ev.stealthArmor) durability *= 1.2;        // cannot be targeted or locked while it is on
  // scouts are measured against one speed for every weight class; everyone else against their class
  const mobility = Math.pow(Math.max(0.5, ev.kph / (role === 'scout' ? TUNING.scoutRefKph : base.kph)), MOBILITY_EXP[role] ?? 0.3);
  let alphaFactor = 0.8 + 0.2 * Math.min(1.5, ev.alpha / (base.ehp * 0.085));         // reward trade-winning alphas
  if (role === 'sniper') {
    const reach = ev.profiles.reduce((a, p) => a + (p.continuous || (p.type === 'Missile' && p.lock) ? 0 : p.alpha * damageAt(p, dist)), 0);
    alphaFactor = 0.6 + 0.4 * Math.min(1.6, reach / (base.ehp * 0.085));
  }
  let heatFactor = ev.alphaHeat > ev.capacity ? 0.6 : (ev.alphasToOverheat < 2 ? 0.88 : 1);
  if (role === 'support' || role === 'stealth') heatFactor *= 0.75 + 0.25 * ev.sustainFrac;   // has to keep firing / cannot cool while stealthed
  if (stable) heatFactor *= Math.pow(Math.min(1, ev.sustainFrac / TUNING.heatStableAt), 3);
  const ammoFactor = !Number.isFinite(ev.ammoSeconds) ? 1 : role === 'support' ? Math.min(1, 0.4 + 0.6 * ev.ammoSeconds / 110) : Math.min(1, 0.6 + 0.4 * ev.ammoSeconds / 90);
  const gv = TUNING.gearValue[role];
  const gearFactor = gv ? 1 + gv.ams * Math.min(TUNING.maxAmsCredit, ev.gear.ams) + (ev.gear.tag ? gv.tag : 0) + (ev.gear.narc ? gv.narc : 0) : 1;
  const total = firepower * durability * mobility * alphaFactor * heatFactor * ammoFactor * gearFactor;
  return { total, firepower, durability, mobility, alphaFactor, heatFactor, ammoFactor, gearFactor, burst: burst.eff, sustain: sustain.eff };
}

export const ROLES = ['brawl', 'mid', 'long', 'sniper', 'missile', 'scout', 'support', 'stealth'];
export const ROLE_LABEL = { brawl: 'Brawl', mid: 'Mid range', long: 'Long range', sniper: 'Sniper', missile: 'Missile boat', scout: 'Scout', support: 'Support', stealth: 'Stealth' };
export const ALL_ROLES = [...ROLES, ...ROLES.map((r) => r + STABLE)];
export const ROLE_NOTE = {
  brawl: 'Close-range damage and the speed and armor to deliver it.',
  mid: 'All-round trading at medium range.',
  long: 'Sustained damage at long range.',
  sniper: 'Pinpoint alpha strikes at 900 m. Front-loaded damage counts most, spread and beam-duration weapons are marked down, and lock-on missiles do not count.',
  missile: 'Rated on missiles: lock-on launchers (LRM, ATM) get full credit for the damage they spread across a target, other weapons count as backup only.',
  scout: 'Speed first: needs at least 105 kph, is measured against 125 kph whatever the weight class, and gets extra credit for ECM. Armor matters less.',
  support: 'Keeps up steady fire at 500 m: sustained damage, cool running and deep ammo count most, with credit for ECM and AMS hardpoints.',
  stealth: 'ECM is required. Inner Sphere builds are tried with Stealth Armor, which is credited for hiding the mech; heat efficiency matters because a stealthed mech cannot cool.',
};

// ---------------------------------------------------------------- optimizer
const SPEED_TARGETS = { Light: [118, 138, 155], Medium: [82, 97, 113], Heavy: [65, 76, 88], Assault: [52, 61, 70] };

export function optimize(ctx, mech, opts = {}) {
  const { roles = ALL_ROLES, keep = 4, skills = true, deadline = Infinity } = opts;
  const frame = mechFrame(ctx, mech);
  const faction = mech.faction;
  const qt = quirkTable(skills ? [...frame.quirks, ...ctx.skillBonus[faction]] : frame.quirks);
  const hp = { Ballistic: 0, Energy: 0, Missile: 0 };
  let biggest = 0;
  for (const c of COMPONENTS) { const fc = frame.comps[c]; if (!fc) continue; for (const t of WEAPON_TYPES) hp[t] += fc.hardpoints[t] ?? 0; biggest = Math.max(biggest, fc.free); }

  // upgrade packages
  const pick = (cType, pred) => ctx.upgradesOf(cType, faction).find(pred);
  let packages;
  if (frame.omni && frame.stock) packages = [{ armorType: frame.stock.armorType, structureType: frame.stock.structureType, heatSinkType: frame.stock.heatSinkType }];
  else {
    const endo = pick('Structure', (u) => /Endo/i.test(u.name)); const stdS = pick('Structure', (u) => /Standard/i.test(u.name));
    const stdA = pick('Armor', (u) => /Standard/i.test(u.name));
    const ferro = pick('Armor', (u) => (faction === 'Clan' ? /^ClanFerro/i.test(u.name) : /^LightFerro/i.test(u.name)));
    const dhs = pick('HeatSink', (u) => /Double/i.test(u.name));
    const stealth = faction !== 'Clan' && frame.canECM && roles.some((r) => baseRole(r) === 'stealth') ? pick('Armor', (u) => /Stealth/i.test(u.name)) : null;
    packages = [{ armorType: stdA.id, structureType: endo.id, heatSinkType: dhs.id }, { armorType: ferro.id, structureType: endo.id, heatSinkType: dhs.id }, { armorType: stdA.id, structureType: stdS.id, heatSinkType: dhs.id }];
    if (stealth) packages.push({ armorType: stealth.id, structureType: endo.id, heatSinkType: dhs.id });
  }
  const engines = engineChoices(ctx, frame, SPEED_TARGETS[mech.weightClass]);
  if (!engines.length) return { frame, results: {} };

  // candidate weapons with at least one usable hardpoint
  const cands = ctx.db.weapons.filter((w) => WEAPON_TYPES.includes(w.type) && hp[w.type] > 0 && w.faction.includes(faction) && (w.stats.damage ?? 0) > 0 && (w.stats.slots ?? 0) <= biggest && !/flamer|tag|narc/i.test(w.name) && !w.stats.isOneShot && w.artemisRestrictedTo !== 3050)
    .map((w) => ({ w, p: weaponProfile(w, qt) })).filter((c) => c.p.dps > 0.05);

  const best = Object.fromEntries(roles.map((r) => [r, []]));
  const consider = (role, entry) => {
    if (!(entry.score.total > 0)) return;
    const list = best[role];
    const dup = list.findIndex((e) => e.key === entry.key);
    if (dup >= 0) { if (list[dup].score.total >= entry.score.total) return; list.splice(dup, 1); }
    else if (list.length >= keep * 3 && entry.score.total <= list[list.length - 1].score.total) return;
    list.push(entry); list.sort((a, b) => b.score.total - a.score.total); if (list.length > keep * 3) list.length = keep * 3;
  };

  const ammoFor = (picks, artemis) => {
    const ammo = {}; let tons = 0;
    const perType = new Map();
    for (const { c, n } of picks) if (c.p.ammoType) {
      const k = (artemis && c.w.stats.artemisAmmoType ? c.w.stats.artemisAmmoType : c.p.ammoType).toLowerCase();
      perType.set(k, (perType.get(k) ?? 0) + n * c.p.ammoPerShot / c.p.cycle);
    }
    for (const [k, perSec] of perType) {
      const a = ctx.ammoByType.get(k); if (!a || !a.numShots) return null;
      const n = Math.max(1, Math.min(8, Math.round((perSec * TUNING.ammoSeconds) / a.numShots)));
      ammo[a.id] = n; tons += n * a.tons;
    }
    return { ammo, tons };
  };

  // Team equipment and Artemis are only tried on the leaders (stage 2), and equipment only
  // for the roles that value it, so a brawler is never handed a TAG it gets nothing for.
  const G = ctx.gear[faction] ?? {};
  const amsMax = Math.min(TUNING.maxAmsCredit, COMPONENTS.reduce((n, c) => n + (frame.comps[c]?.hardpoints.AMS ?? 0), 0));
  const GEAR_ROLES = new Set(['support', 'stealth', 'missile']);
  const gearRoles = roles.filter((r) => GEAR_ROLES.has(baseRole(r)));
  const gearSets = [];
  if (gearRoles.length) {
    const ams = G.ams && amsMax > 0 ? amsMax : 0;
    const tag = !!G.tag && hp.Energy > 0; const narc = G.narc && hp.Missile > 0 ? 1 : 0;
    if (ams) gearSets.push({ ams, tag: false, narc: 0 });
    if (tag) gearSets.push({ ams, tag: true, narc: 0 });
    if (tag && ams) gearSets.push({ ams: 0, tag: true, narc: 0 });
    if (narc) gearSets.push({ ams, tag, narc }, { ams: 0, tag: false, narc });
  }

  let evaluated = 0;
  const evalOpts = { skills, qt, cache: new Map() };
  const arrowBest = {};
  // Artemis and team-equipment versions of a weapon mix, for the given roles
  const extras = (picks, forRoles) => {
    const out = [];
    const canArtemis = picks.some(({ c }) => c.w.stats.artemisAmmoType);
    const gr = forRoles.filter((r) => GEAR_ROLES.has(baseRole(r)));
    if (canArtemis) out.push({ artemis: true, gear: null, roles: forRoles });
    if (gr.length) for (const gear of gearSets) {
      out.push({ artemis: false, gear, roles: gr });
      if (canArtemis && gear.tag) out.push({ artemis: true, gear, roles: gr });
    }
    return out;
  };
  const tryLoadout = (picks, engineList = engines, pkgList = packages, sinkFn = consider, variantList = null) => {
    const weapons = [];
    for (const { c, n } of picks) for (let i = 0; i < n; i++) weapons.push(c.w.id);
    const key = picks.map(({ c, n }) => n + 'x' + c.w.id).sort().join('+');
    const leaders = sinkFn === consider;
    const hasArrow = picks.some(({ c }) => /arrow/i.test(c.w.name));
    const variants = variantList ?? [{ artemis: false, gear: null, roles }];
    for (const v of variants) {
      const am = ammoFor(picks, v.artemis); if (!am) continue;
      const ammo = { ...am.ammo };
      if (v.gear?.ams && G.amsAmmo) ammo[G.amsAmmo.id] = (ammo[G.amsAmmo.id] ?? 0) + 1;
      if (v.gear?.narc && G.narcAmmo) ammo[G.narcAmmo.id] = (ammo[G.narcAmmo.id] ?? 0) + 1;
      const vKey = (v.artemis ? 'a' : '') + (v.gear ? 'g' + v.gear.ams + (+v.gear.tag) + v.gear.narc : '');
      for (const engine of engineList) for (const pkg of pkgList) {
        const base = { engine, ...pkg, artemis: v.artemis, armorPct: 1, weapons, ammo, gear: v.gear ? { ...v.gear } : undefined, heatSinks: Math.max(0, 10 - engine.heatsinks), ecm: frame.canECM };
        let ev = evaluate(ctx, frame, base, evalOpts);
        evaluated++;
        if (ev.freeTons < 0) {
          // shave armour (up to 12%) before giving up
          const perTon = ctx.upgrade.get(pkg.armorType)?.armorTypeStats?.armorPerTon ?? 32;
          const shave = Math.ceil(-ev.freeTons * 2) / 2 * perTon / (ev.armorPts || 1);
          if (shave > 0.12) continue;
          base.armorPct = 1 - shave - 0.004; ev = evaluate(ctx, frame, base, evalOpts);
          if (ev.freeTons < 0) continue;
        }
        // spend what is left on heat sinks, as far as slots allow
        const sinkSlots = ctx.item.get(ctx.upgrade.get(pkg.heatSinkType)?.heatSinkTypeStats?.compatibleHeatSink)?.slots ?? 1;
        const engineSlots = Math.max(0, Math.floor(engine.rating / 25) - 10 - frame.fixedEngineSinks);
        const already = base.heatSinks;
        const bySlots = Math.max(0, engineSlots - already) + Math.floor(Math.max(0, ev.slotsFree) / sinkSlots);
        const add = Math.max(0, Math.min(Math.floor(ev.freeTons + 1e-6), bySlots, ev.hps > 0 ? 40 : 0));
        if (add) { base.heatSinks += add; ev = evaluate(ctx, frame, base, evalOpts); }
        if (!ev.valid) { if (add > 0) { base.heatSinks -= 1; ev = evaluate(ctx, frame, base, evalOpts); } if (!ev.valid) continue; }
        for (const role of v.roles) {
          const entry = { picks, key: [key, engine.id, pkg.armorType, pkg.structureType, vKey].join('|'), loadoutKey: key, build: { ...base, weapons: [...weapons], ammo: { ...ammo } }, ev, score: score(frame, ev, role) };
          sinkFn(role, entry);
          if (hasArrow && leaders && baseRole(role) === 'missile' && entry.score.total > (arrowBest[role]?.score.total ?? 0)) arrowBest[role] = entry;
        }
      }
    }
  };

  // Stage 1 ranks every weapon mix on one reference chassis setup; stage 2 then tries
  // every engine / upgrade option on the leaders only.
  const mid = engines[Math.min(engines.length - 1, Math.floor(engines.length / 2))];
  const refEngine = [engines.find((e) => e.rating === mid.rating && /Light|Clan/.test(e.kind)) ?? mid];
  const refPkg = [packages[0]];
  const pool = Object.fromEntries(roles.map((r) => [r, []]));
  const POOL = 28;
  const stage1 = (role, entry) => {
    if (!(entry.score.total > 0)) return;
    const list = pool[role];
    if (list.length >= POOL && entry.score.total <= list[list.length - 1].score.total) return;
    list.push(entry); list.sort((a, b) => b.score.total - a.score.total); if (list.length > POOL) list.length = POOL;
  };
  // Tonnage left for guns + ammo + extra sinks on the lightest sensible chassis setup.
  const lightEngine = engines.reduce((a, e) => (e.tons < a.tons ? e : a), engines[0]);
  const refEv = evaluate(ctx, frame, { engine: lightEngine, ...packages[0], armorPct: 0.88, weapons: [], ammo: {}, heatSinks: Math.max(0, 10 - lightEngine.heatsinks), ecm: frame.canECM }, evalOpts);
  const budget = Math.max(1, refEv.freeTons);
  const counts = (max) => (max <= 5 ? Array.from({ length: Math.max(0, max) }, (_, i) => i + 1) : [...new Set([1, 2, 3, 4, 6, 8, 10, max].filter((n) => n <= max))]);
  const maxN = (c) => Math.min(hp[c.w.type], Math.floor(budget / Math.max(0.25, c.p.tons)), 12);
  outer:
  for (let i = 0; i < cands.length; i++) {
    const A = cands[i]; const nAmax = maxN(A);
    for (const nA of counts(nAmax)) {
      if (nA * A.p.tons >= budget * 0.3 || nA === nAmax) tryLoadout([{ c: A, n: nA }], refEngine, refPkg, stage1);
      for (let j = i + 1; j < cands.length; j++) {
        const B = cands[j];
        const shared = A.w.type === B.w.type;
        const nBmax = Math.min(maxN(B), shared ? hp[B.w.type] - nA : hp[B.w.type]);
        for (const nB of counts(nBmax)) {
          const wt = nA * A.p.tons + nB * B.p.tons;
          if (wt > budget) break;
          if (wt < budget * 0.38 && !(nA === nAmax && nB === nBmax)) continue;
          tryLoadout([{ c: A, n: nA }, { c: B, n: nB }], refEngine, refPkg, stage1);
        }
      }
      if (Date.now() > deadline) break outer;
    }
  }

  const done = new Set();
  for (const role of roles) for (const e of pool[role]) { if (done.has(e.loadoutKey)) continue; done.add(e.loadoutKey); tryLoadout(e.picks); }

  // Arrow IV: always worked out for missile boats, alone and with the best light backup weapon
  if (roles.some((r) => baseRole(r) === 'missile')) {
    const backup = cands.filter((c) => c.w.type !== 'Missile' && c.p.tons <= 2 && !c.p.ammoType).sort((a, b) => b.p.dps / Math.max(0.5, b.p.tons) - a.p.dps / Math.max(0.5, a.p.tons))[0];
    for (const arrow of cands.filter((c) => /arrow/i.test(c.w.name))) {
      for (let n = 1; n <= Math.min(hp.Missile, 3); n++) {
        const missileRoles = roles.filter((r) => baseRole(r) === 'missile');
        const sets = [[{ c: arrow, n }]];
        if (backup) for (const k of [2, 4]) if (k <= hp[backup.w.type]) sets.push([{ c: arrow, n }, { c: backup, n: k }]);
        for (const set of sets) { tryLoadout(set); tryLoadout(set, engines, packages, consider, extras(set, missileRoles)); }
      }
    }
  }

  // second pass: fill leftover hardpoints on the leaders with light backup weapons
  const fillers = cands.filter((c) => c.p.tons <= 2 && !c.p.ammoType).sort((a, b) => b.p.dps / Math.max(0.5, b.p.tons) - a.p.dps / Math.max(0.5, a.p.tons)).slice(0, 4);
  for (const role of roles) {
    for (const e of best[role].slice(0, keep)) {
      const used = { Ballistic: 0, Energy: 0, Missile: 0 }; const counts = new Map();
      for (const id of e.build.weapons) { const w = ctx.weapon.get(id); used[w.type]++; counts.set(id, (counts.get(id) ?? 0) + 1); }
      if (counts.size >= 3) continue;
      const picks = [...counts].map(([id, n]) => ({ c: cands.find((c) => c.w.id === id), n })).filter((p) => p.c);
      for (const f of fillers) {
        if (counts.has(f.w.id)) continue;
        const room = hp[f.w.type] - used[f.w.type];
        for (let n = 1; n <= Math.min(room, 4); n++) tryLoadout([...picks, { c: f, n }]);
      }
    }
  }

  // third pass: Artemis and team equipment, tried on each role's leaders with the engine
  // and upgrades that already won for them
  const tried = new Set();
  for (const role of roles) {
    for (const e of best[role].slice(0, keep * 2)) {
      const id = role + '|' + e.key;
      if (tried.has(id) || e.build.artemis || e.build.gear) continue;
      tried.add(id);
      const list = extras(e.picks, [role]);
      if (!list.length) continue;
      // the extra weight may need the next engine down
      const at = engines.indexOf(e.build.engine);
      const lighter = engines.filter((x) => x.tons < e.build.engine.tons).sort((x, y) => y.tons - x.tons)[0];
      tryLoadout(e.picks, at >= 0 && lighter ? [e.build.engine, lighter] : [e.build.engine], packages, consider, list);
    }
  }

  // de-duplicate by weapon mix (keep the best engine/upgrade variant of each)
  const results = {};
  for (const role of roles) {
    const seen = new Set(); results[role] = [];
    for (const e of best[role]) { if (seen.has(e.loadoutKey)) continue; seen.add(e.loadoutKey); results[role].push(e); if (results[role].length >= keep) break; }
  }
  // Arrow IV rarely wins on damage per ton, so a missile boat list always keeps its best Arrow build as an option.
  for (const [role, e] of Object.entries(arrowBest)) {
    const list = results[role]; if (!list?.length || list.some((x) => x.loadoutKey === e.loadoutKey)) continue;
    if (list.length >= keep) list.pop();
    list.push(e);
  }
  return { frame, results, evaluated };
}

// The stock loadout as a build, for comparison.
export function stockBuild(ctx, frame) {
  const s = frame.stock; if (!s || !s.armorType) return null;
  const weapons = []; const ammo = {}; let sinks = 0; let engine = frame.fixedEngine; let armor = 0; let ecm = false;
  const gear = { ams: 0, tag: false, narc: 0 };
  for (const [, c] of Object.entries(s.components)) {
    armor += c.armor;
    for (const id of c.items) {
      const it = ctx.item.get(id); if (!it) continue;
      if (it.kind === 'weapon') {
        if (it.type === 'AMS') gear.ams++;
        else if (/TAG$/.test(it.name)) gear.tag = true;
        else if (/NarcBeacon$/.test(it.name)) gear.narc++;
        else if (WEAPON_TYPES.includes(it.type)) weapons.push(id);
      }
      else if (it.kind === 'ammo') ammo[id] = (ammo[id] ?? 0) + 1;
      else if (it.kind === 'heatsink') sinks++;
      else if (it.kind === 'engine') engine = it;
      else if (it.cType === 'CGECMStats') ecm = true;
    }
  }
  if (!engine) return null;
  let maxArmor = 0; for (const c of COMPONENTS) maxArmor += frame.comps[c]?.maxArmor ?? 0;
  return { engine, armorType: s.armorType, structureType: s.structureType, heatSinkType: s.heatSinkType, artemis: s.artemis, armorPct: Math.min(1, armor / maxArmor), weapons, ammo, heatSinks: sinks, ecm, gear };
}

export function gearText(build) {
  const g = build.gear ?? {}; const out = [];
  if (build.artemis) out.push('Artemis');
  if (g.tag) out.push('TAG');
  if (g.narc) out.push('NARC');
  if (g.ams) out.push(g.ams > 1 ? g.ams + '× AMS' : 'AMS');
  return out;
}

export function describeBuild(ctx, build) {
  const counts = new Map();
  for (const id of build.weapons) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].sort((a, b) => (ctx.weapon.get(b[0]).stats.tons ?? 0) * b[1] - (ctx.weapon.get(a[0]).stats.tons ?? 0) * a[1]).map(([id, n]) => `${n}× ${ctx.weapon.get(id).label}`).join(' + ') + (gearText(build).length ? ' · ' + gearText(build).join(', ') : '');
}
