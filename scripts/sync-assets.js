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
    key:    'splash',
    label:  'Champion splash — full uncentered art (player spotlight)',
    remote: 'img/champion/splash',
    local:  path.join(ROOT, 'public', 'graphics', 'head2head', 'champions-splash'),
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

const GH_HEADERS = { 'User-Agent': 'MetaGFX/asset-sync' };

// Cache the repo's default branch (for building raw download URLs).
let _branch = null;
async function defaultBranch() {
  if (_branch) return _branch;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}`, { headers: GH_HEADERS });
    if (r.ok) { const j = await r.json(); _branch = j.default_branch; }
  } catch (_) { /* fall through */ }
  return (_branch = _branch || 'master');
}

// List a remote directory via the Git Trees API rather than the Contents API.
// The Contents API caps directory listings at 1,000 entries — and img/champion/splash
// holds every skin (Champ_0, _1, _2 …), well over 1,000, so a Contents listing was
// silently truncated (~champs A→M only). The Trees API returns the whole subtree.
// Returns objects shaped like Contents entries: { name, type, download_url }.
async function listRemote(remotePath) {
  const branch = await defaultBranch();
  const slash  = remotePath.lastIndexOf('/');
  const parent = slash >= 0 ? remotePath.slice(0, slash) : '';
  const name   = slash >= 0 ? remotePath.slice(slash + 1) : remotePath;

  // 1) find the directory's tree SHA from its (small) parent listing
  const pres = await fetch(`${API_BASE}${parent ? '/' + parent : ''}`, { headers: GH_HEADERS });
  if (!pres.ok) throw new Error(`GitHub API ${pres.status} for ${parent || '/'}`);
  const parentEntries = await pres.json();
  const dir = Array.isArray(parentEntries) && parentEntries.find(e => e.name === name && e.type === 'dir');
  if (!dir) throw new Error(`remote dir not found: ${remotePath}`);

  // 2) list the subtree (flat — immediate children only)
  const tres = await fetch(`https://api.github.com/repos/${REPO}/git/trees/${dir.sha}`, { headers: GH_HEADERS });
  if (!tres.ok) throw new Error(`GitHub Trees API ${tres.status} for ${remotePath}`);
  const tjson = await tres.json();
  if (tjson.truncated) console.warn(`  ⚠ tree listing truncated for ${remotePath}`);
  return (tjson.tree || [])
    .filter(t => t.type === 'blob')
    .map(t => ({
      name: t.path,
      type: 'file',
      download_url: `https://raw.githubusercontent.com/${REPO}/${branch}/${remotePath}/${t.path}`,
    }));
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
  // Case-insensitive set — Windows preserves original casing in readdirSync even after
  // overwriting (e.g. FiddleSticks_0.jpg stays named that after writing Fiddlesticks_0.jpg).
  const existing = new Set(fs.readdirSync(target.local).map(f => f.toLowerCase()));

  const forceThis = target.key === 'roles' && forceRoles;
  const toDownload = forceThis
    ? items
    : items.filter(item => !existing.has(item.localName.toLowerCase()));

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
