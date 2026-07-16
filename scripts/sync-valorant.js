'use strict';
// scripts/sync-valorant.js
// Downloads VALORANT agent art + map art from valorant-api.com (free, no key — a Riot content
// mirror). Agents → public/agents (portraits) + public/agents/icons + agents.json manifest.
// Maps → public/valmaps/<slug>.webp (splash, sharp→WebP) + maps.json. Mirrors sync-heroes.js
// (same result shape) so the admin /api/valorant/* endpoints + the "VALORANT Assets" card
// reuse the asset-sync UI.
//
// Usage (standalone):
//   node scripts/sync-valorant.js          — download all missing agent + map art + manifests
//   node scripts/sync-valorant.js --check  — report what's missing, no downloads
//
// Also required() by the server for the admin sync endpoint.

const fs    = require('fs');
const path  = require('path');
const fetch = require('node-fetch');
let sharp = null; try { sharp = require('sharp'); } catch (e) { /* maps fall back to raw PNG */ }

const ROOT           = path.join(__dirname, '..');
const AGENT_DIR      = path.join(ROOT, 'public', 'agents');
const AGENT_ICON_DIR = path.join(AGENT_DIR, 'icons');
const MAP_DIR        = path.join(ROOT, 'public', 'valmaps');
const AGENT_MANIFEST = path.join(AGENT_DIR, 'agents.json');
const MAP_MANIFEST   = path.join(MAP_DIR, 'maps.json');

const API     = 'https://valorant-api.com/v1';
const HEADERS = { 'User-Agent': 'MetaGFX/valorant-sync' };
function slugify(name) { return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

// ── Remote lists (fetched once per run) ─────────────────────────────────────────
let _agents = null, _maps = null;
async function agentList() {
  if (_agents) return _agents;
  const res = await fetch(API + '/agents?isPlayableCharacter=true', { headers: HEADERS });
  if (!res.ok) throw new Error(`valorant-api agents ${res.status}`);
  const j = await res.json();
  _agents = (j.data || [])
    .filter(a => a && a.displayName && a.displayIcon)
    .map(a => ({ slug: slugify(a.displayName), name: a.displayName, role: (a.role && a.role.displayName) || '',
      portraitUrl: a.fullPortrait || a.bustPortrait || a.displayIcon, iconUrl: a.displayIcon }))
    .filter(a => a.slug)
    .sort((x, y) => x.name.localeCompare(y.name));
  return _agents;
}
async function mapList() {
  if (_maps) return _maps;
  const res = await fetch(API + '/maps', { headers: HEADERS });
  if (!res.ok) throw new Error(`valorant-api maps ${res.status}`);
  const j = await res.json();
  // tacticalDescription ("BOMB SITES: …") is present only on real 5v5 competitive maps —
  // it filters out TDM / practice / tutorial maps (District, Skirmish, The Range, …).
  _maps = (j.data || [])
    .filter(m => m && m.displayName && m.splash && m.tacticalDescription)
    .map(m => ({ slug: slugify(m.displayName), name: m.displayName, splashUrl: m.splash, iconUrl: m.displayIcon || '' }))
    .filter(m => m.slug)
    .sort((x, y) => x.name.localeCompare(y.name));
  return _maps;
}

async function downloadFile(url, dest, toWebp) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.buffer();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (toWebp && sharp) await sharp(buf).webp({ quality: 88 }).toFile(dest);
  else fs.writeFileSync(dest, buf);
}

// Derive a head+shoulders bust from each full agent portrait — the full portraits are tall
// full-body renders that don't read in the compact player-intro rows, so we trim to the
// character and take the top ~55% (head+torso), re-framed square. Used by the Player Intro
// agent strip. Needs sharp; skips files that already have a bust.
const BUST_DIR = path.join(AGENT_DIR, 'bust');
async function buildBusts() {
  if (!sharp) return { built: 0, skipped: 'no sharp' };
  fs.mkdirSync(BUST_DIR, { recursive: true });
  const pngs = fs.existsSync(AGENT_DIR) ? fs.readdirSync(AGENT_DIR).filter(f => f.toLowerCase().endsWith('.png')) : [];
  let built = 0;
  for (const f of pngs) {
    const dest = path.join(BUST_DIR, f.replace(/\.png$/i, '.webp'));
    if (fs.existsSync(dest)) continue;
    try {
      // Trim to the character, take head+torso (top ~62%) at the character's natural width so
      // the bust is tight (no transparent padding) → the graphic can anchor it flush to the
      // centre divider. Fade the bottom to transparent so the torso cut is never a hard line.
      const { data, info } = await sharp(path.join(AGENT_DIR, f)).trim({ threshold: 10 }).toBuffer({ resolveWithObject: true });
      const cropH = Math.round(info.height * 0.62);
      const head = await sharp(data).extract({ left: 0, top: 0, width: info.width, height: cropH }).resize({ height: 640 }).png().toBuffer();
      const m = await sharp(head).metadata();
      const fade = Buffer.from('<svg width="' + m.width + '" height="' + m.height + '" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0.72" stop-color="white"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient></defs><rect width="' + m.width + '" height="' + m.height + '" fill="url(#g)"/></svg>');
      await sharp(head).composite([{ input: fade, blend: 'dest-in' }]).webp({ quality: 90 }).toFile(dest);
      built++;
    } catch (e) { /* skip a bad portrait */ }
  }
  return { built };
}

// Targets mirror sync-heroes/sync-assets (label/key + progress) so the sync UI reads the same.
const TARGET_DEFS = [
  { key: 'agents',      label: 'Agent portraits (intros)',   dir: AGENT_DIR,      ext: '.png',  list: agentList, pick: a => ({ name: a.slug + '.png', url: a.portraitUrl }) },
  { key: 'agent-icons', label: 'Agent icons (scoreboard)',   dir: AGENT_ICON_DIR, ext: '.png',  list: agentList, pick: a => ({ name: a.slug + '.png', url: a.iconUrl }) },
  { key: 'maps',        label: 'Map art (veto / intro)',     dir: MAP_DIR,        ext: '.webp', webp: true, list: mapList, pick: m => ({ name: m.slug + '.webp', url: m.splashUrl }) },
];
const TARGETS = TARGET_DEFS.map(t => ({ key: t.key, label: t.label }));

async function syncTarget(def, opts = {}) {
  const { dryRun = false, onProgress = null } = opts;
  const items = (await def.list()).map(def.pick).filter(Boolean);
  fs.mkdirSync(def.dir, { recursive: true });
  const existing = new Set(fs.readdirSync(def.dir).filter(f => f.toLowerCase().endsWith(def.ext)).map(f => f.toLowerCase()));
  const toDownload = items.filter(it => !existing.has(it.name.toLowerCase()));
  const result = { key: def.key, label: def.label, total: items.length, existing: existing.size,
    missing: toDownload.map(i => i.name), downloaded: 0, errors: [] };
  if (dryRun || !toDownload.length) return result;
  for (let i = 0; i < toDownload.length; i++) {
    const item = toDownload[i];
    if (onProgress) onProgress(def.key, i + 1, toDownload.length, item.name);
    try { await downloadFile(item.url, path.join(def.dir, item.name), def.webp); result.downloaded++; }
    catch (e) { result.errors.push({ name: item.name, error: e.message }); }
  }
  return result;
}

// Name↔slug manifests the server / graphics read (filenames alone can't recover "KAY/O").
function writeManifests(agents, maps) {
  fs.mkdirSync(AGENT_DIR, { recursive: true });
  fs.writeFileSync(AGENT_MANIFEST, JSON.stringify(agents.map(a => ({ slug: a.slug, name: a.name, role: a.role,
    img: '/agents/' + a.slug + '.png', icon: '/agents/icons/' + a.slug + '.png' })), null, 2));
  fs.mkdirSync(MAP_DIR, { recursive: true });
  fs.writeFileSync(MAP_MANIFEST, JSON.stringify(maps.map(m => ({ slug: m.slug, name: m.name,
    image: '/valmaps/' + m.slug + '.webp' })), null, 2));
}

async function syncAll(opts = {}) {
  const results = [];
  for (const def of TARGET_DEFS) results.push(await syncTarget(def, opts));
  if (!opts.dryRun) { await buildBusts(); writeManifests(await agentList(), await mapList()); }
  return results;
}
async function syncTargetByKey(key, opts = {}) {
  const def = TARGET_DEFS.find(t => t.key === key);
  if (!def) throw new Error('unknown valorant target ' + key);
  return syncTarget(def, opts);
}

module.exports = { syncAll, syncTargetByKey, buildBusts, TARGETS, writeManifests, agentList, mapList,
  AGENT_MANIFEST, MAP_MANIFEST, AGENT_DIR, MAP_DIR };

// ── Standalone entry point ──────────────────────────────────────────────────────
if (require.main === module) {
  const dryRun = process.argv.slice(2).includes('--check');
  const onProgress = (key, n, total, name) => {
    const pad = ' '.repeat(Math.max(0, 30 - name.length));
    process.stdout.write(`\r  [${String(n).padStart(3)} / ${total}] ${name}${pad}`);
  };
  console.log('\n  MetaGFX VALORANT Asset Sync');
  console.log('  ─────────────────────────────────────────────');
  console.log('  Mode: ' + (dryRun ? 'CHECK ONLY' : 'DOWNLOAD MISSING') + (sharp ? '' : '  (sharp missing — maps saved as raw PNG)') + '\n');
  syncAll({ dryRun, onProgress }).then(results => {
    if (!dryRun) process.stdout.write('\n');
    for (const r of results) {
      const status = r.missing.length === 0 ? `✓ up to date (${r.existing} files)` : `${r.missing.length} missing`;
      console.log(`  ${r.label}\n    remote: ${r.total}  |  local: ${r.existing}  |  ${status}`);
      if (!dryRun && r.downloaded) console.log(`    → Downloaded ${r.downloaded}`);
      if (r.errors.length) r.errors.slice(0, 5).forEach(e => console.log(`    ✗ ${e.name}: ${e.error}`));
    }
    if (!dryRun) console.log(`\n  Manifests: ${AGENT_MANIFEST}\n             ${MAP_MANIFEST}`);
    console.log('\n  Done.\n');
  }).catch(err => { process.stdout.write('\n'); console.error('  Error:', err.message); process.exit(1); });
}
