// 3D mech preview for the build page. Loads the exported chassis geometry
// (data/mechs/<chassis>/) and shows the pieces a variant actually uses.
import { fetchJson } from './store.js';
import { DATA } from './lib/bin.js';

export async function createMechView(canvas, mech, weapons) {
  const meta = await fetchJson(`${DATA}/mechs/${mech.chassis}/mech.json`).catch(() => null);
  if (!meta) return null;
  const { buildMechScene } = await import('./mechscene.js');
  return buildMechScene(canvas, mech, meta, weapons);
}
