# MWO Tactics

**Live site: https://pryme8.github.io/mwo-tactics/**

A site that reads your installed MechWarrior Online files and turns them into:

- **Meta** – every mech's best generated build, ranked into S/A/B/C tiers per weight class and engagement range.
- **Mechs & Builds** – hardpoints, quirks, generated build variations scored against each other and against stock, a damage-by-range chart, and a Babylon.js 3D view of the mech with the build's weapons mounted and a hit-location colouring.
- **Weapons** – live weapon numbers (damage, DPS, heat, range, ghost-heat limits).
- **Maps** – Babylon.js 3D viewer for every level: terrain with the in-game overhead image, all placed objects, the physics colliders as a toggle, invisible walls, spawns and objectives per game mode, free-fly and cockpit-height cameras.
- **Patch Changes** – field-by-field diff between scans.

Converted data is written to `web/public/data` (about 720 MB with every map and mech). It is not kept in the `main` branch; `npm run deploy` publishes it with the built site to the `gh-pages` branch.

This is an unofficial fan tool. MechWarrior Online and its game data, models and images belong to Piranha Games and their licensors; this project is not affiliated with or endorsed by them.

## Use

```
npm install
npm run update     # scan stats, generate builds, convert maps (about 4 minutes)
npm run dev        # open http://localhost:5183
```

After a game patch, run `npm run update` again. A new snapshot is stored beside the old one and the Patch Changes page lists what moved.

| Command | What it does |
| --- | --- |
| `npm run scan` | Stats snapshot (`data/patches/<build>/db.json`) plus a diff against the previous one |
| `npm run builds` | Runs the optimizer over every mech and writes the meta tiers |
| `npm run scan:maps [level ...]` | Converts levels (all if none named) |
| `npm run scan:mechs [chassis ...]` | Pre-exports mech models; when running locally each chassis is otherwise exported the first time you open it |
| `npm run deploy` | Builds the site and force-pushes it, data included, to the `gh-pages` branch (GitHub Pages) |

To update the hosted site after a game patch: `npm run update`, `npm run scan:mechs`, `npm run deploy`.

The game folder is found from the registry / Steam. To point at it by hand, set `gamePath` in `mwo.config.json`.

## How it works

- `scanner/lib/pak.mjs` – `.pak` files are plain zip archives.
- `scanner/lib/cgf.mjs` – CryEngine `.cgf/.cga` geometry, including the physics chunks (the real colliders).
- `scanner/lib/terrain.mjs` – `terrain.dat`: heightmap sectors and the octree of placed objects.
- `scanner/lib/image.mjs` – DDS decode and PNG encode for the overhead images.
- `scanner/lib/models.mjs` / `web/src/lib/bin.js` – the compact `.cbin` geometry format (gzip; 16-bit quantised positions, 16-bit indices, 3×4 instance matrices, delta-coded heights).
- `web/src/lib/buildmath.js` – weapon maths, quirks, heat, slot/tonnage validation, scoring and the optimizer. Shared by the site and the batch generator.

## Assumptions worth knowing

These are not in the game's data files, so they live in `TUNING` at the top of `web/src/lib/buildmath.js`:

- Heat capacity = 30 + per-sink values from the data (first 10 sinks use the engine values).
- Ghost heat scale table (penalty multiplier by number of weapons fired).
- The scoring weights (how much durability, speed, alpha and range matter). The Mechs page shows each factor for every build, so a rating can always be traced.

Not modelled yet: jump jets, MASC, AMS, Artemis/TAG/NARC bonuses, omnipod swapping (omnimechs use their own pod set), per-node skill tree choices (a full firepower/operations investment is assumed when "Skill tree bonuses" is on). Models are flat-coloured from each material's average texture colour rather than fully textured.
