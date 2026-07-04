'use strict';
// scripts/sync-heroes.js
// Downloads Dota 2 hero portraits + icons from Valve's CDN, using OpenDota's hero list as the
// canonical name↔slug source. Mirrors scripts/sync-assets.js (same result shape) so the admin
// /api/heroes/* endpoints + the control "Hero Assets" card reuse the asset-sync UI.
//
// Usage (standalone):
//   node scripts/sync-heroes.js            — download all missing hero images + write manifest
//   node scripts/sync-heroes.js --check    — report what's missing, no downloads
//
// Also required() by the server for the admin sync endpoint.

const fs    = require('fs');
const path  = require('path');
const fetch = require('node-fetch');

const ROOT       = path.join(__dirname, '..');
const HERO_DIR   = path.join(ROOT, 'public', 'heroes');
const ICON_DIR   = path.join(HERO_DIR, 'icons');
const MANIFEST   = path.join(HERO_DIR, 'heroes.json');

const OPENDOTA_HEROES = 'https://api.opendota.com/api/heroStats';
const CDN_BASE        = 'https://cdn.cloudflare.steamstatic.com';
const HEADERS = { 'User-Agent': 'MetaGFX/hero-sync' };

// Fetch + normalise the hero list once per run: { slug, name, imgUrl, iconUrl }.
// slug = npc_dota_hero_<slug>; img/icon paths come straight from OpenDota (Valve CDN-relative).
let _heroes = null;
async function heroList() {
  if (_heroes) return _heroes;
  const res = await fetch(OPENDOTA_HEROES, { headers: HEADERS });
  if (!res.ok) throw new Error(`OpenDota ${res.status}`);
  const arr = await res.json();
  _heroes = (Array.isArray(arr) ? arr : [])
    .filter(h => h && h.name && h.img)
    .map(h => ({
      slug:    String(h.name).replace(/^npc_dota_hero_/, ''),
      name:    h.localized_name || String(h.name).replace(/^npc_dota_hero_/, ''),
      imgUrl:  CDN_BASE + String(h.img).replace(/\?$/, ''),
      iconUrl: CDN_BASE + String(h.icon || '').replace(/\?$/, ''),
    }))
    .filter(h => h.slug)
    .sort((a, b) => a.name.localeCompare(b.name));
  return _heroes;
}

async function downloadFile(url, dest) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.buffer();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

// Two targets (portraits + icons) so the progress UI reads like the champion sync.
const TARGET_DEFS = [
  { key: 'heroes',     label: 'Hero portraits (draft / picks)', dir: HERO_DIR, pick: h => ({ name: h.slug + '.png', url: h.imgUrl }) },
  { key: 'hero-icons', label: 'Hero icons (ban row)',           dir: ICON_DIR, pick: h => h.iconUrl ? ({ name: h.slug + '.png', url: h.iconUrl }) : null },
];
// Exposed like sync-assets.TARGETS (label/key) for the endpoint's init event.
const TARGETS = TARGET_DEFS.map(t => ({ key: t.key, label: t.label }));

async function syncTarget(def, opts = {}) {
  const { dryRun = false, onProgress = null } = opts;
  const heroes = await heroList();
  const items = heroes.map(def.pick).filter(Boolean);

  fs.mkdirSync(def.dir, { recursive: true });
  const existing = new Set(fs.readdirSync(def.dir).filter(f => f.toLowerCase().endsWith('.png')).map(f => f.toLowerCase()));
  const toDownload = items.filter(it => !existing.has(it.name.toLowerCase()));

  const result = { key: def.key, label: def.label, total: items.length, existing: existing.size,
    missing: toDownload.map(i => i.name), downloaded: 0, errors: [] };
  if (dryRun || !toDownload.length) return result;

  for (let i = 0; i < toDownload.length; i++) {
    const item = toDownload[i];
    if (onProgress) onProgress(def.key, i + 1, toDownload.length, item.name);
    try { await downloadFile(item.url, path.join(def.dir, item.name)); result.downloaded++; }
    catch (e) { result.errors.push({ name: item.name, error: e.message }); }
  }
  return result;
}

// Write the name↔slug manifest the server / graphics read (the filenames alone can't recover
// "Anti-Mage" from "antimage"). Written on a real sync so /api/heroes has names + image paths.
function writeManifest(heroes) {
  fs.mkdirSync(HERO_DIR, { recursive: true });
  const list = heroes.map(h => ({ slug: h.slug, name: h.name, img: '/heroes/' + h.slug + '.png', icon: '/heroes/icons/' + h.slug + '.png' }));
  fs.writeFileSync(MANIFEST, JSON.stringify(list, null, 2));
  return list;
}

async function syncAll(opts = {}) {
  const results = [];
  for (const def of TARGET_DEFS) results.push(await syncTarget(def, opts));
  if (!opts.dryRun) writeManifest(await heroList());
  return results;
}

// syncTargetByKey — used by the endpoint to emit per-target progress like sync-assets.
async function syncTargetByKey(key, opts = {}) {
  const def = TARGET_DEFS.find(t => t.key === key);
  if (!def) throw new Error('unknown hero target ' + key);
  return syncTarget(def, opts);
}

module.exports = { syncAll, syncTargetByKey, TARGETS, writeManifest, heroList, MANIFEST, HERO_DIR };

// ── Standalone entry point ──────────────────────────────────────────────────────
if (require.main === module) {
  const dryRun = process.argv.slice(2).includes('--check');
  const onProgress = (key, n, total, name) => {
    const pad = ' '.repeat(Math.max(0, 30 - name.length));
    process.stdout.write(`\r  [${String(n).padStart(3)} / ${total}] ${name}${pad}`);
  };
  console.log('\n  MetaGFX Dota 2 Hero Sync');
  console.log('  ─────────────────────────────────────────────');
  console.log('  Mode: ' + (dryRun ? 'CHECK ONLY' : 'DOWNLOAD MISSING') + '\n');
  syncAll({ dryRun, onProgress }).then(results => {
    if (!dryRun) process.stdout.write('\n');
    for (const r of results) {
      const status = r.missing.length === 0 ? `✓ up to date (${r.existing} files)` : `${r.missing.length} missing`;
      console.log(`  ${r.label}\n    remote: ${r.total}  |  local: ${r.existing}  |  ${status}`);
      if (!dryRun && r.downloaded) console.log(`    → Downloaded ${r.downloaded}`);
      if (r.errors.length) r.errors.slice(0, 5).forEach(e => console.log(`    ✗ ${e.name}: ${e.error}`));
    }
    if (!dryRun) console.log(`\n  Manifest: ${MANIFEST}`);
    console.log('\n  Done.\n');
  }).catch(err => { process.stdout.write('\n'); console.error('  Error:', err.message); process.exit(1); });
}
