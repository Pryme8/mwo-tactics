// Turns a build into the code the in-game MechLab accepts under Import (and gives out
// under Export). Format, as worked out by the Li Song Mechlab project:
//   'A' · mech id (2) · structure<<3|armor (1) · omni<<3|heatsink<<1|artemis (1) · actuators (1)
//   then per component in the order CT RT LT LA RA LL RL HD:
//     front armor (2) · omnipod id (3, omnimechs, not CT) · '|'+item id for each item · terminator p..w
//   then rear armor CT, LT, RT (2 each).
// Numbers are little-endian base 64 using the characters '0' (48) to 'o' (111).
import { COMPONENTS, COMP_LABEL } from './buildmath.js';

const ORDER = ['centre_torso', 'right_torso', 'left_torso', 'left_arm', 'right_arm', 'left_leg', 'right_leg', 'head'];
const TERMINATOR = 'pqrstuvw';
const REAR_ORDER = ['centre_torso', 'left_torso', 'right_torso'];
const ARMOR_BITS = { 2810: 0, 2811: 1, 2812: 2, 2814: 3, 2815: 4, 2816: 5 };
const STRUCTURE_BITS = { 3100: 0, 3101: 1, 3102: 2, 3103: 3 };
const SINK_BITS = { 3003: 0, 3002: 1, 3005: 2, 3006: 3 };
// Share of a torso's armor put on the back.
const REAR_SHARE = { centre_torso: 0.16, left_torso: 0.18, right_torso: 0.18 };

function num(value, min, max = min) {
  let out = ''; let rest = value; let n = 0;
  while (n < min || (rest > 0 && n < max)) { out += String.fromCharCode(48 + (rest & 63)); rest >>= 6; n++; }
  return out;
}

// layout: { items: {component: [itemId]}, front: {component: pts}, rear: {torso: pts}, pods: {component: podId} }
export function encodeLayout(mech, build, layout) {
  const a = ARMOR_BITS[build.armorType]; const s = STRUCTURE_BITS[build.structureType]; const h = SINK_BITS[build.heatSinkType];
  if (a === undefined || s === undefined || h === undefined) return null;
  let code = `A${num(mech.id, 2)}${num((s << 3) | a, 1)}${num((mech.omni ? 8 : 0) | (h << 1) | (build.artemis ? 1 : 0), 1)}${num(0, 1)}`;
  ORDER.forEach((c, i) => {
    code += num(layout.front[c] ?? 0, 2);
    if (mech.omni && c !== 'centre_torso') code += num(layout.pods[c] ?? 0, 3);
    for (const id of layout.items[c] ?? []) code += `|${num(id, 1, 6)}`;
    code += TERMINATOR[i];
  });
  for (const c of REAR_ORDER) code += num(layout.rear[c] ?? 0, 2);
  return code;
}

// The stock loadout already says where everything sits, so it is encoded as is.
export function stockLayout(frame) {
  const s = frame.stock; if (!s?.components) return null;
  const layout = { items: {}, front: {}, rear: {}, pods: {} };
  for (const c of COMPONENTS) {
    const sc = s.components[c]; if (!sc) return null;
    layout.items[c] = [...sc.items]; layout.front[c] = sc.armor;
    layout.pods[c] = sc.omniPod ?? frame.pods[c]?.id;
  }
  for (const c of REAR_ORDER) layout.rear[c] = s.components[`${c}_rear`]?.armor ?? 0;
  return { layout };
}

// Generated builds only say what to carry; this decides which component each item goes
// in. Returns { layout } or { problem } when the parts cannot be packed.
export function layoutBuild(ctx, frame, build, ev) {
  const { mech } = frame; const engine = build.engine;
  const items = {}; const free = {};
  for (const c of COMPONENTS) { items[c] = []; free[c] = frame.comps[c]?.free ?? 0; }
  if (!frame.fixedEngine) {
    items.centre_torso.push(engine.id);
    free.centre_torso -= engine.slots; free.left_torso -= engine.sideSlots; free.right_torso -= engine.sideSlots;
  }

  const artemisSlots = ctx.upgrade.get(3050)?.artemisTypeStats?.extraSlots ?? 1;
  for (let i = 0; i < build.weapons.length; i++) {
    const c = ev.placement[i]; const p = ev.profiles[i];
    if (!c) return { problem: `no hardpoint for ${p.label}` };
    // with Artemis the launcher is a different item in the game
    items[c].push((build.artemis && ctx.artemisOf.get(build.weapons[i])) || build.weapons[i]);
    free[c] -= p.slots + (build.artemis && ctx.weapon.get(p.id).stats.artemisAmmoType ? artemisSlots : 0);
  }
  for (const g of ev.gear?.placed ?? []) { items[g.c].push(g.id); free[g.c] -= ctx.item.get(g.id)?.slots ?? 1; }
  if (COMPONENTS.some((c) => free[c] < 0)) return { problem: 'the weapons do not fit their components' };

  const put = (id, slots, prefer, what) => {
    const c = prefer.find((x) => free[x] >= slots);
    if (!c) return what;
    items[c].push(id); free[c] -= slots; return null;
  };
  const roomiest = () => [...COMPONENTS].filter((c) => c !== 'head').sort((x, y) => free[y] - free[x]);

  if (build.ecm) {
    const ecm = ctx.ecm.find((e) => e.faction.includes(mech.faction));
    if (ecm) { const bad = put(ecm.id, ecm.slots, roomiest(), 'ECM'); if (bad) return { problem: 'no room for ECM' }; }
  }

  const up = ctx.upgrade.get(build.heatSinkType);
  const sink = ctx.item.get(up?.heatSinkTypeStats?.compatibleHeatSink ?? 3000);
  const inEngine = Math.min(build.heatSinks ?? 0, Math.max(0, Math.floor(engine.rating / 25) - 10 - frame.fixedEngineSinks));
  for (let i = 0; i < inEngine; i++) items.centre_torso.push(sink.id);
  for (let i = inEngine; i < (build.heatSinks ?? 0); i++) {
    if (put(sink.id, sink.slots ?? 1, roomiest(), 'sink')) return { problem: 'no room for all the heat sinks' };
  }

  // Ammo goes to the legs and head first, where an ammo explosion costs least.
  const ammoOrder = () => ['left_leg', 'right_leg', 'head', ...roomiest().filter((c) => !c.endsWith('leg'))];
  for (const [id, n] of Object.entries(build.ammo ?? {})) {
    const a = ctx.item.get(+id);
    for (let i = 0; i < n; i++) if (put(+id, a?.slots ?? 1, ammoOrder(), 'ammo')) return { problem: 'no room for all the ammo' };
  }

  if (!frame.omni) {
    const dyn = (ctx.upgrade.get(build.armorType)?.slotUsage?.slots ?? 0) + (ctx.upgrade.get(build.structureType)?.slotUsage?.slots ?? 0);
    const left = COMPONENTS.reduce((t, c) => t + free[c], 0);
    if (left < dyn) return { problem: `${dyn - left} slots short for the armor and structure upgrades` };
  }

  // Armor: the same fraction everywhere, then hand out what rounding left over.
  const pct = build.armorPct ?? 1; const total = {}; let sum = 0;
  for (const c of COMPONENTS) { total[c] = Math.floor((frame.comps[c]?.maxArmor ?? 0) * pct + 1e-9); sum += total[c]; }
  const byRoom = [...COMPONENTS].sort((x, y) => frame.comps[y].maxArmor - frame.comps[x].maxArmor);
  for (let left = ev.armorPts - sum, guard = 0; left > 0 && guard < 400; guard++) {
    const c = byRoom[guard % byRoom.length];
    if (total[c] < frame.comps[c].maxArmor) { total[c]++; left--; }
  }
  const front = {}; const rear = {};
  for (const c of COMPONENTS) {
    const r = REAR_SHARE[c] ? Math.round(total[c] * REAR_SHARE[c]) : 0;
    front[c] = total[c] - r; if (REAR_SHARE[c]) rear[c] = r;
  }
  const pods = {}; for (const c of COMPONENTS) pods[c] = frame.pods[c]?.id;
  return { layout: { items, front, rear, pods } };
}

// row: { build, ev, stock } as the Mechs page holds them.
export function buildCode(ctx, frame, row) {
  const r = row.stock ? stockLayout(frame) : layoutBuild(ctx, frame, row.build, row.ev);
  if (!r) return { problem: 'no stock loadout data' };
  if (r.problem) return r;
  const code = encodeLayout(frame.mech, row.stock ? { ...row.build, armorType: frame.stock.armorType, structureType: frame.stock.structureType, heatSinkType: frame.stock.heatSinkType, artemis: frame.stock.artemis } : row.build, r.layout);
  return code ? { code, layout: r.layout } : { problem: 'unknown upgrade type' };
}

export function layoutSummary(ctx, layout) {
  return COMPONENTS.map((c) => {
    const counts = new Map(); for (const id of layout.items[c] ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    const rear = layout.rear[c] !== undefined ? ` / ${layout.rear[c]} rear` : '';
    return { label: COMP_LABEL[c], armor: `${layout.front[c]}${rear}`, items: [...counts].map(([id, n]) => `${n > 1 ? `${n}× ` : ''}${ctx.item.get(id)?.label ?? id}`) };
  });
}
