import { load } from './store.js';

const views = {
  meta: () => import('./views/meta.js'),
  mechs: () => import('./views/mechs.js'),
  weapons: () => import('./views/weapons.js'),
  maps: () => import('./views/maps.js'),
  changes: () => import('./views/changes.js'),
};

const root = document.getElementById('view');
let current = null;

async function route() {
  const [, name = 'meta', ...rest] = location.hash.split('/');
  const view = views[name] ? name : 'meta';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.view === view));
  if (current?.name === view && current.mod.update) { current.mod.update(rest); return; }
  current?.mod.dispose?.();
  root.innerHTML = '<div class="empty">Loading…</div>';
  const mod = await views[view]();
  current = { name: view, mod };
  await mod.mount(root, rest);
}

window.addEventListener('hashchange', route);
load().then((s) => {
  const el = document.getElementById('buildinfo');
  if (s.index?.latest) {
    const p = s.index.patches.find((x) => x.key === s.index.latest);
    el.textContent = `Game build ${p.version} · scanned ${new Date(p.scannedAt).toLocaleDateString()}`;
  } else el.textContent = 'No scan yet';
});
route();
