'use strict';
// scripts/sync-assets.js
// Downloads LoL champion images and role icons from DDragon GitHub repo.
//
// Usage (standalone):
//   node scripts/sync-assets.js            — download all missing files
//   node scripts/sync-assets.js --check    — report what's missing, no downloads
//   node scripts/sync-assets.js --force-roles  — re-download role icons (resolution upgrade)
//
// Also required() by the server for the admin sync endpoint.

const fs    = require('fs');
const path  = require('path');
const fetch = require('node-fetch');

const REPO     = 'noxelisdev/LoL_DDragon';
const API_BASE = `https://api.github.com/repos/${REPO}/contents`;
const ROOT     = path.join(__dirname, '..');

// DDragon uses full position names; our codebase uses short ones
const LANE_RENAMES = {
  'bottom.png': 'bot.png',
  'middle.png':  'mid.png',
};

const TARGETS = [
  {
    key:    'tiles',
    label:  'Champion tiles (draft picker)',
    remote: 'img/champion/tiles',
    local:  path.join(ROOT, 'public', 'champions'),
    filter: f => f.type === 'file' && f.name.endsWith('_0.jpg'),
    rename: null,
    extra:  null,
    alwaysUpdate: false,
  },
  {
    key:    'centered',
    label:  'Champion centered (h2h / player-intro / caster)',
    remote: 'img/champion/centered',
    local:  path.join(ROOT, 'public', 'graphics', 'head2head', 'champions'),
    filter: f => f.type === 'file' && f.name.endsWith('_0.jpg'),
    rename: null,
    extra:  null,
    alwaysUpdate: false,
  },
  {
    key:    'roles',
    label:  'Role / lane icons',
    remote: 'extras/lanes',
    local:  path.join(ROOT, 'public', 'graphics', 'draft', 'roles'),
    filter: f => f.type === 'file' && f.name.endsWith('.png'),
    rename: LANE_RENAMES,
    // Copied here too so caster view role icons resolve correctly
    extra:  path.join(ROOT, 'public', 'graphics', 'head2head', 'roles'),
    alwaysUpdate: false, // set true via --force-roles to upgrade resolution
  },
];

async function listRemote(remotePath) {
  const url = `${API_BASE}/${remotePath}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'MetaGFX/asset-sync' } });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${remotePath}`);
  return res.json();
}

async function downloadFile(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': 'MetaGFX/asset-sync' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.buffer();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

// Sync a single target. Returns a result object.
// opts.dryRun      — list missing but don't download
// opts.forceRoles  — overwrite existing role icons (resolution upgrade)
// opts.onProgress  — fn(key, n, total, name) called per file downloaded
async function syncTarget(target, opts = {}) {
  const { dryRun = false, forceRoles = false, onProgress = null } = opts;

  const remoteFiles = await listRemote(target.remote);
  const items = remoteFiles
    .filter(target.filter)
    .map(f => ({
      localName:   target.rename ? (target.rename[f.name] || f.name) : f.name,
      downloadUrl: f.download_url,
    }));

  fs.mkdirSync(target.local, { recursive: true });
  const existing = new Set(fs.readdirSync(target.local));

  const forceThis = target.key === 'roles' && forceRoles;
  const toDownload = forceThis
    ? items
    : items.filter(item => !existing.has(item.localName));

  const result = {
    key:        target.key,
    label:      target.label,
    total:      items.length,
    existing:   existing.size,
    missing:    toDownload.map(i => i.localName),
    downloaded: 0,
    errors:     [],
  };

  if (dryRun || toDownload.length === 0) return result;

  for (let i = 0; i < toDownload.length; i++) {
    const item = toDownload[i];
    if (onProgress) onProgress(target.key, i + 1, toDownload.length, item.localName);
    try {
      const dest = path.join(target.local, item.localName);
      await downloadFile(item.downloadUrl, dest);
      if (target.extra) {
        fs.mkdirSync(target.extra, { recursive: true });
        fs.copyFileSync(dest, path.join(target.extra, item.localName));
      }
      result.downloaded++;
    } catch (e) {
      result.errors.push({ name: item.localName, error: e.message });
    }
  }

  return result;
}

// Sync all targets sequentially. Returns array of result objects.
async function syncAll(opts = {}) {
  const results = [];
  for (const target of TARGETS) {
    results.push(await syncTarget(target, opts));
  }
  return results;
}

module.exports = { syncAll, syncTarget, TARGETS };

// ── Standalone script entry point ──────────────────────────────────────────────
if (require.main === module) {
  const args       = process.argv.slice(2);
  const dryRun     = args.includes('--check');
  const forceRoles = args.includes('--force-roles');

  const onProgress = (key, n, total, name) => {
    const pad = ' '.repeat(Math.max(0, 45 - name.length));
    process.stdout.write(`\r  [${String(n).padStart(3)} / ${total}] ${name}${pad}`);
  };

  console.log('\n  MetaGFX Asset Sync');
  console.log('  ─────────────────────────────────────────────');
  if (dryRun) console.log('  Mode: CHECK ONLY  (run without --check to download)\n');
  else        console.log('  Mode: DOWNLOAD MISSING' + (forceRoles ? ' + force-roles' : '') + '\n');

  syncAll({ dryRun, forceRoles, onProgress }).then(results => {
    let anyProgress = false;
    for (const r of results) {
      if (!dryRun && r.downloaded > 0 && !anyProgress) {
        process.stdout.write('\n'); anyProgress = true;
      }
      const status = r.missing.length === 0
        ? `✓ up to date (${r.existing} files)`
        : `${r.missing.length} missing`;
      console.log(`  ${r.label}`);
      console.log(`    remote: ${r.total}  |  local: ${r.existing}  |  ${status}`);
      if (!dryRun && r.downloaded > 0) console.log(`    → Downloaded ${r.downloaded}`);
      if (r.errors.length) r.errors.forEach(e => console.log(`    ✗ ${e.name}: ${e.error}`));
      console.log('');
    }
    console.log('  Done.\n');
  }).catch(err => {
    process.stdout.write('\n');
    console.error('  Error:', err.message);
    process.exit(1);
  });
}
