'use strict';
// scripts/sync-items.js
// Downloads Dota 2 item icons from Valve's CDN, using OpenDota's item constants as the canonical
// slug↔name↔image source. Mirrors scripts/sync-heroes.js (same result shape) so the admin
// /api/items/* endpoints + the Settings "Item Assets" card reuse the asset-sync UI.
//
// GSI reports inventory items as `item_<slug>` (e.g. item_blink); stripping the `item_` prefix
// yields the OpenDota key / CDN filename (blink.png), which is how the post-game board resolves
// an item icon from a GSI slot.
//
// Usage (standalone):
//   node scripts/sync-items.js            — download all missing item icons + write manifest
//   node scripts/sync-items.js --check    — report what's missing, no downloads
//
// Also required() by the server for the admin sync endpoint.

const fs    = require('fs');
const path  = require('path');
const fetch = require('node-fetch');

const ROOT     = path.join(__dirname, '..');
const ITEM_DIR = path.join(ROOT, 'public', 'items');
const MANIFEST = path.join(ITEM_DIR, 'items.json');

const OPENDOTA_ITEMS = 'https://raw.githubusercontent.com/odota/dotaconstants/master/build/items.json';
const CDN_BASE       = 'https://cdn.cloudflare.steamstatic.com';
const HEADERS = { 'User-Agent': 'MetaGFX/item-sync' };

// Fetch + normalise the item list once per run: { slug, name, imgUrl }. slug = OpenDota key ==
// GSI name without the `item_` prefix. Skips recipes (generic recipe.png icon, never shown as a
// finished item on the board) and entries without an image.
let _items = null;
async function itemList() {
  if (_items) return _items;
  const res = await fetch(OPENDOTA_ITEMS, { headers: HEADERS });
  if (!res.ok) throw new Error(`OpenDota items ${res.status}`);
  const obj = await res.json();
  _items = Object.keys(obj || {})
    .filter(slug => slug && !/^recipe_/.test(slug))
    .map(slug => {
      const it = obj[slug] || {};
      const img = String(it.img || '').replace(/\?.*$/, '');   // drop the ?t= cache-buster
      return { slug, name: it.dname || slug, imgUrl: img ? CDN_BASE + img : '' };
    })
    .filter(it => it.imgUrl && !/\/recipe\.png$/.test(it.imgUrl))
    .sort((a, b) => a.name.localeCompare(b.name));
  return _items;
}

async function downloadFile(url, dest) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.buffer();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

// One target (item icons) — the progress UI reads like the hero / champion sync.
const TARGET_DEFS = [
  { key: 'items', label: 'Item icons (post-game board)', dir: ITEM_DIR, pick: it => ({ name: it.slug + '.png', url: it.imgUrl }) },
];
const TARGETS = TARGET_DEFS.map(t => ({ key: t.key, label: t.label }));

async function syncTarget(def, opts = {}) {
  const { dryRun = false, onProgress = null } = opts;
  const items = (await itemList()).map(def.pick).filter(Boolean);

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

// Write the slug↔name↔image manifest the server / graphics read (the filenames alone can't recover
// "Blink Dagger" from "blink"). Written on a real sync so /api/items has names + image paths.
function writeManifest(items) {
  fs.mkdirSync(ITEM_DIR, { recursive: true });
  const list = items.map(it => ({ slug: it.slug, name: it.name, img: '/items/' + it.slug + '.png' }));
  fs.writeFileSync(MANIFEST, JSON.stringify(list, null, 2));
  return list;
}

async function syncAll(opts = {}) {
  const results = [];
  for (const def of TARGET_DEFS) results.push(await syncTarget(def, opts));
  if (!opts.dryRun) writeManifest(await itemList());
  return results;
}

// syncTargetByKey — used by the endpoint to emit per-target progress like sync-heroes.
async function syncTargetByKey(key, opts = {}) {
  const def = TARGET_DEFS.find(t => t.key === key);
  if (!def) throw new Error('unknown item target ' + key);
  return syncTarget(def, opts);
}

module.exports = { syncAll, syncTargetByKey, TARGETS, writeManifest, itemList, MANIFEST, ITEM_DIR };

// ── Standalone entry point ──────────────────────────────────────────────────────
if (require.main === module) {
  const dryRun = process.argv.slice(2).includes('--check');
  const onProgress = (key, n, total, name) => {
    const pad = ' '.repeat(Math.max(0, 30 - name.length));
    process.stdout.write(`\r  [${String(n).padStart(3)} / ${total}] ${name}${pad}`);
  };
  console.log('\n  MetaGFX Dota 2 Item Sync');
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
