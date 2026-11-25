import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

// Mech geometry is exported from the game files the first time a chassis is opened,
// then served from web/public/data/mechs like any other static file.
function mechsOnDemand() {
  let gfs = null;
  return {
    name: 'mwo-mechs-on-demand',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const m = /^\/data\/mechs\/([a-z0-9_]+)\/(mech\.json|geo\.cbin)/i.exec(req.url ?? '');
        if (!m) return next();
        const chassis = m[1].toLowerCase();
        const file = path.join(here, 'public', 'data', 'mechs', chassis, m[2]);
        try {
          if (!fs.existsSync(file)) {
            const { GameFS } = await import('../scanner/lib/pak.mjs');
            const { exportMech } = await import('../scanner/lib/mechexport.mjs');
            const { findInstall } = await import('../scanner/lib/game.mjs');
            gfs ??= new GameFS(path.join(findInstall(), 'Game'));
            if (!exportMech(gfs, chassis)) { res.statusCode = 404; return res.end('no model'); }
          }
          res.setHeader('Content-Type', m[2].endsWith('.json') ? 'application/json' : 'application/octet-stream');
          fs.createReadStream(file).pipe(res);
        } catch (e) { res.statusCode = 500; res.end(String(e?.message ?? e)); }
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [mechsOnDemand()],
  server: { port: 5183, strictPort: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
