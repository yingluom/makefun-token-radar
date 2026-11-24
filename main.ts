// Token launch radar: the runner.
//
// Reads the sealed snapshot (default /input/snapshot.json, or --input <file|dir>), scores every
// protocol that records no token with the model in lib/model.ts, and writes into the output
// directory (--output, else $MAKEFUN_OUTPUT_DIR, else /output):
//
//   board.json    the ranked board the gate reads
//   data.js       window.RADAR, everything the dashboard renders
//   dashboard/    a copy of this repository's dashboard/
//   screenshots/  a copy of this repository's screenshots/
//   dossier.json  the judge's summary, written by vendor/makefun-board.ts from the files above
//
// Node 22+, standard library only, no network. Every output byte derives from the snapshot alone:
// the snapshot's as_of is the only "today" the program knows, so two runs agree byte for byte.
// During development screenshots/ may still be empty; the dossier is then skipped with a note,
// because the dossier library refuses an empty screenshots directory. A graded run always has
// the screenshots in place.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));

/** Read `--name value` or `--name=value` from the arguments, else the fallback. */
function argValue(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1]!;
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

/** Copy a flat directory's regular files, skipping dot-names; returns the names copied. */
function copyFlat(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(to, name));
    names.push(name);
  }
  return names;
}

const inputArg = argValue('input', '/input/snapshot.json');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token-radar: no snapshot at ${inputFile} (pass --input <snapshot.json|dir>)\n`);
  process.exit(2);
}
const outDir = argValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token-radar: refusing to write a board the gate would refuse: ${issue}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));
const dashFiles = copyFlat(join(repoDir, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyFlat(join(repoDir, 'screenshots'), join(outDir, 'screenshots'));

let dossierNote = 'skipped (no screenshots yet)';
if (shots.length > 0) {
  const dossier = buildDossier(outDir, {
    text_max_bytes: 65_536,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  });
  writeFileSync(join(outDir, 'dossier.json'), dossier);
  dossierNote = `written (${shots.length} screenshots)`;
}

process.stdout.write(
  `token-radar: snapshot ${snapshot.as_of}: ${snapshot.protocols.length} protocols scanned, ` +
    `${board.length} pre-token ranked, ${snapshot.watchlist.length} watchlist covered, ` +
    `${radar.live.length} live tokens set aside\n` +
    `token-radar: wrote board.json, data.js, dashboard/ (${dashFiles.length} files), ` +
    `screenshots/ (${shots.length} files); dossier ${dossierNote}\n`,
);
