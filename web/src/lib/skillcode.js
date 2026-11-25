// Picks skill tree nodes for a build and turns them into the code the in-game Skills
// screen accepts under Import.
//
// Code format (from Kitlaan's open-source skill planner, which reads and writes the game's
// codes): the letter 'a', then 60 hex digits = 30 bytes = one bit per node, lowest bit of
// each byte first. Node N is the Nth <Node> of MechSkillTreeNodesDisplay.xml, which the
// scanner stores untouched as db.skillNodes.

export const MAX_NODES = 91;
const CODE_BYTES = 30;

export const SKILL_LABEL = {
  Cooldown: 'Cooldown', Range: 'Range', HeatGen: 'Heat Gen', Velocity: 'Velocity', LaserDuration: 'Laser Duration', FlamerVentilation: 'Flamer Ventilation',
  MagazineCapacity: 'Magazine Capacity', GaussCharge: 'Gauss Charge', LBXSpread: 'LBX Spread', UACJamChance: 'UAC Jam Chance', MissileRack: 'Missile Rack',
  MissileSpread: 'Missile Spread', HighExplosive: 'High Explosive', SkeletalDensity: 'Skeletal Density', ArmorHardening: 'Armor Hardening',
  ReinforcedCasing: 'Reinforced Casing', ShockAbsorbance: 'Shock Absorbance', AMSOverload: 'AMS Overload', KineticBurst: 'Kinetic Burst', TorsoSpeed: 'Torso Speed',
  TorsoYaw: 'Torso Yaw', HardBrake: 'Hard Brake', TorsoPitch: 'Torso Pitch', AnchorTurn: 'Anchor Turn', SpeedTweak: 'Speed Tweak', LiftSpeed: 'Lift Speed',
  VentCalibration: 'Vent Calibration', Vectoring: 'Vectoring', HeatShielding: 'Heat Shielding', QuickIgnition: 'Quick Ignition', ImprovedGyros: 'Improved Gyros',
  CoolRun: 'Cool Run', SpeedRetention: 'Speed Retention', HeatContainment: 'Heat Containment', HillClimb: 'Hill Climb', TargetInfoGathering: 'Target Info Gathering',
  TargetDecay: 'Target Decay', TargetRetention: 'Target Retention', SensorRange: 'Sensor Range', RadarDeprivation: 'Radar Deprivation', AdvancedZoom: 'Advanced Zoom',
  SeismicSensor: 'Seismic Sensor', EnhancedECM: 'Enhanced ECM', ConsumableSlot: 'Consumable Slot', CaptureAssist: 'Capture Assist', EnhancedNARC: 'Enhanced NARC',
  UAVRange: 'UAV Range', UAVTime: 'UAV Duration', ExtraUAV: 'Extra UAV', EnhancedCoolshot: 'Enhanced Coolshot', CoolshotCooldown: 'Coolshot Cooldown',
  CoolantReserves: 'Coolant Reserves', ExpandedReserves: 'Expanded Reserves', ExtendedBombardment: 'Extended Bombardment', EnhancedSpotting: 'Enhanced Spotting',
};

const groupOf = (name) => name.replace(/\d+$/, '');

// Every skill line with its nodes in purchase order (Cooldown1, Cooldown2, ...).
export function skillGroups(db) {
  const groups = new Map();
  for (const s of db.skills ?? []) {
    if (!s.names.length) continue;
    groups.set(groupOf(s.names[0]), { key: groupOf(s.names[0]), names: s.names, effects: s.effects, affects: s.affects });
  }
  return groups;
}

function effectValue(e, mech) {
  const f = e.byFaction?.[mech.faction === 'Clan' ? 'Clan' : 'IS'];
  if (!f) return e.value ?? 0;
  const c = f.byClass?.[mech.weightClass];
  if (!c) return f.value ?? e.value ?? 0;
  return c.byTons?.[String(mech.tons)] ?? c.value ?? f.value ?? 0;
}

// What the build carries, as far as the skill tree cares.
function traits(ctx, build, ev) {
  const t = { laser: false, projectile: false, uac: false, lbx: false, gauss: false, missile: false, lock: false, ballisticAmmo: false, missileAmmo: false };
  for (const p of ev.profiles) {
    const w = ctx.weapon.get(p.id); const name = `${w?.name ?? ''} ${(w?.aliases ?? []).join(' ')}`;
    if (p.type === 'Energy' && /laser/i.test(name)) t.laser = true;
    if ((w?.stats.speed ?? 0) > 0 && !p.lock) t.projectile = true;
    if (/ultra|rotary|\buac|\brac/i.test(name)) t.uac = true;
    if (/lb\d|lbx/i.test(name)) t.lbx = true;
    if (/gauss/i.test(name)) t.gauss = true;
    if (p.type === 'Missile') { t.missile = true; if (p.lock) t.lock = true; if (p.ammoType) t.missileAmmo = true; }
    if (p.type === 'Ballistic' && p.ammoType) t.ballisticAmmo = true;
  }
  t.hot = ev.hps > 0 ? ev.dissipation / ev.hps < 0.85 : false;
  t.ecm = !!build.ecm;
  return t;
}

// The order skill lines are bought in for a role. Each entry is [line, how many nodes];
// the list is walked until the 91 nodes are spent, so later entries are the first to go.
function wishes(role, t) {
  const w = [['Cooldown', 16]];
  if (t.laser) w.push(['LaserDuration', 4]);
  if (t.uac) w.push(['UACJamChance', 2]);
  if (t.gauss) w.push(['GaussCharge', 2]);
  if (t.lbx) w.push(['LBXSpread', 2]);
  if (t.missile) w.push(['MissileSpread', 2]);
  w.push(['CoolRun', 5], ['HeatContainment', 5]);
  if (t.hot) w.push(['HeatGen', 14]);
  if (role !== 'brawl') { w.push(['Range', 15]); if (t.projectile) w.push(['Velocity', 5]); }
  w.push(['ArmorHardening', 10], ['SkeletalDensity', 10]);
  if (!t.hot) w.push(['HeatGen', 8]);
  if (role === 'brawl') w.push(['SpeedTweak', 5], ['SeismicSensor', 2], ['TorsoSpeed', 6], ['KineticBurst', 7], ['RadarDeprivation', 5], ['Range', 6]);
  else w.push(['RadarDeprivation', 5], ['SpeedTweak', 5], ['SeismicSensor', 2]);
  if (role === 'long') w.push(['AdvancedZoom', 1], ['SensorRange', 5]);
  if (t.lock) w.push(['TargetDecay', 5]);
  if (t.ecm) w.push(['EnhancedECM', 2]);
  if (t.projectile && role === 'brawl') w.push(['Velocity', 5]);
  if (t.missile) w.push(['HighExplosive', 2]);
  if (t.missileAmmo) w.push(['MissileRack', 2]);
  if (t.ballisticAmmo) w.push(['MagazineCapacity', 2]);
  // whatever is left over
  w.push(['HeatGen', 14], ['Range', 15], ['ConsumableSlot', 4], ['CoolantReserves', 1], ['EnhancedCoolshot', 2], ['CoolshotCooldown', 1],
    ['TorsoSpeed', 6], ['KineticBurst', 7], ['AnchorTurn', 5], ['HardBrake', 7], ['ReinforcedCasing', 8], ['TargetInfoGathering', 5], ['SensorRange', 5]);
  return w;
}

// Returns { picks: Map(line -> node count), total, nodes: [node names] }.
export function pickSkills(ctx, frame, build, ev, role) {
  const groups = skillGroups(ctx.db);
  const picks = new Map(); let left = MAX_NODES;
  for (const [key, want] of wishes(role, traits(ctx, build, ev))) {
    const g = groups.get(key); if (!g || left <= 0) continue;
    const have = picks.get(key) ?? 0;
    const add = Math.min(left, Math.min(want, g.names.length) - have);
    if (add > 0) { picks.set(key, have + add); left -= add; }
  }
  const nodes = [];
  for (const [key, n] of picks) nodes.push(...groups.get(key).names.slice(0, n));
  return { picks, total: MAX_NODES - left, nodes };
}

export function skillCode(db, nodes) {
  const order = db.skillNodes; if (!order?.length || order.length > CODE_BYTES * 8) return null;
  const index = new Map(order.map((n, i) => [n.name, i]));
  const bytes = new Uint8Array(CODE_BYTES);
  for (const name of nodes) { const i = index.get(name); if (i === undefined) return null; bytes[i >> 3] |= 1 << (i & 7); }
  return `a${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function decodeSkillCode(db, code) {
  if (!/^a[0-9a-f]{60}$/i.test(code)) return null;
  const out = [];
  db.skillNodes.forEach((n, i) => { if (parseInt(code.substr(1 + (i >> 3) * 2, 2), 16) & (1 << (i & 7))) out.push(n.name); });
  return out;
}

// One line per skill line picked: label, nodes taken / available, and the summed effect.
export function skillSummary(ctx, frame, picked) {
  const groups = skillGroups(ctx.db);
  return [...picked.picks].map(([key, n]) => {
    const g = groups.get(key); const e = g.effects[0];
    const v = e ? effectValue(e, frame.mech) * n : 0;
    const pct = e && /_multiplier$/.test(e.name);
    const text = !e || !v ? '' : pct ? `${v > 0 ? '+' : ''}${+(v * 100).toFixed(1)}%` : `${v > 0 ? '+' : ''}${+v.toFixed(2)}`;
    return { key, label: SKILL_LABEL[key] ?? key, n, of: g.names.length, effect: text };
  });
}
