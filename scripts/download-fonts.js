#!/usr/bin/env node
// scripts/download-fonts.js
// Downloads all control-panel fonts for fully offline use.
// Run once: node scripts/download-fonts.js
// Output: public/fonts/<family>/*.woff2  +  public/fonts/fonts.css

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const FONTS_DIR = path.join(__dirname, '..', 'public', 'fonts');

// Modern Chrome UA — Google Fonts returns WOFF2 (not TTF) for this UA
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Fonts to pull from Google Fonts
const GOOGLE_FONTS = [
  { family: 'Barlow',           dir: 'barlow',           query: 'Barlow:wght@400;500' },
  { family: 'Barlow Condensed', dir: 'barlow-condensed', query: 'Barlow+Condensed:wght@400;600;700;800' },
  { family: 'Inter',            dir: 'inter',            query: 'Inter:wght@400;500' },
  { family: 'Hubot Sans',       dir: 'hubot-sans',       query: 'Hubot+Sans:wght@400;500' },
  { family: 'Space Grotesk',    dir: 'space-grotesk',    query: 'Space+Grotesk:wght@400;500' },
  { family: 'Figtree',          dir: 'figtree',          query: 'Figtree:wght@400;500' },
  { family: 'Poppins',          dir: 'poppins',          query: 'Poppins:wght@400;500' },
  { family: 'Outfit',           dir: 'outfit',           query: 'Outfit:wght@400;500' },
  { family: 'Darker Grotesque', dir: 'darker-grotesque', query: 'Darker+Grotesque:wght@400;500;700' },
  { family: 'Sora',             dir: 'sora',             query: 'Sora:wght@400;500' },
  { family: 'Oxygen',           dir: 'oxygen',           query: 'Oxygen:wght@400;700' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fetch(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location, headers).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
  });
}

const fetchText = (url, headers) => fetch(url, headers).then(b => b.toString('utf8'));

async function downloadFile(url, dest, headers = {}) {
  if (fs.existsSync(dest)) return false; // skip if already downloaded
  const data = await fetch(url, headers);
  fs.writeFileSync(dest, data);
  return true;
}

// ── Google Fonts CSS parser ───────────────────────────────────────────────────
// Google Fonts CSS2 structure:
//   /* <subset> */
//   @font-face { font-family: ...; font-weight: ...; src: url(...woff2); unicode-range: ...; }
//
// We only keep the 'latin' subset to minimise file count.

function parseGoogleFontsFaces(css) {
  const faces = [];
  // Match comment + @font-face block as a pair
  const re = /\/\*\s*([^*]+?)\s*\*\/\s*@font-face\s*\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const subset = m[1].trim();
    if (subset !== 'latin') continue;

    const block = m[2];
    const wt    = block.match(/font-weight:\s*(\d+)/);
    const st    = block.match(/font-style:\s*(\w+)/);
    const src   = block.match(/url\((https?:\/\/[^)]+\.woff2)\)/);
    const uc    = block.match(/unicode-range:\s*([^;]+);/);

    if (wt && src) {
      faces.push({
        weight:       wt[1],
        style:        st ? st[1] : 'normal',
        srcUrl:       src[1],
        unicodeRange: uc ? uc[1].trim() : null,
      });
    }
  }
  return faces;
}

// Some fonts have no subset comments (single-script or all-in-one).
// Fall back to parsing all @font-face blocks.
// Handles both absolute (https://...) and protocol-relative (//...) URLs.
function parseFontFacesFallback(css) {
  const faces = [];
  const re = /@font-face\s*\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const block = m[1];
    const wt  = block.match(/font-weight:\s*(\d+)/);
    const st  = block.match(/font-style:\s*(\w+)/);
    // Match protocol-relative //... or absolute https?://...
    const src = block.match(/url\('?((?:https?:)?\/\/[^)']+\.woff2)'?\)/);
    const uc  = block.match(/unicode-range:\s*([^;]+);/);
    if (wt && src) {
      const rawUrl = src[1];
      // Normalise protocol-relative URLs to https
      const srcUrl = rawUrl.startsWith('//') ? 'https:' + rawUrl : rawUrl;
      faces.push({
        weight:       wt[1],
        style:        st ? st[1] : 'normal',
        srcUrl,
        unicodeRange: uc ? uc[1].trim() : null,
      });
    }
  }
  return faces;
}

// ── Process a single Google Font ──────────────────────────────────────────────

async function processGoogleFont(font) {
  const cssUrl = `https://fonts.googleapis.com/css2?family=${font.query}&display=swap`;
  process.stdout.write(`  ${font.family}... `);

  const css = await fetchText(cssUrl, { 'User-Agent': UA });

  let faces = parseGoogleFontsFaces(css);
  if (faces.length === 0) faces = parseFontFacesFallback(css); // fallback

  if (faces.length === 0) {
    console.log('⚠ no faces found — skipping');
    return [];
  }

  const dir = path.join(FONTS_DIR, font.dir);
  fs.mkdirSync(dir, { recursive: true });

  const declarations = [];

  for (const face of faces) {
    const suffix   = face.style !== 'normal' ? `-${face.style}` : '';
    const filename = `${font.dir}-${face.weight}${suffix}.woff2`;
    const dest     = path.join(dir, filename);
    const local    = `/fonts/${font.dir}/${filename}`;

    await downloadFile(face.srcUrl, dest);

    let decl = `@font-face {\n  font-family: '${font.family}';\n  font-style: ${face.style};\n  font-weight: ${face.weight};\n  font-display: swap;\n  src: url('${local}') format('woff2');`;
    if (face.unicodeRange) decl += `\n  unicode-range: ${face.unicodeRange};`;
    decl += '\n}';
    declarations.push(decl);
  }

  console.log(`✓ (${faces.length} variants)`);
  return declarations;
}

// ── Switzer via Fontshare ─────────────────────────────────────────────────────

async function processSwitzer() {
  const cssUrl = 'https://api.fontshare.com/v2/css?f[]=switzer@400,500&display=swap';
  process.stdout.write('  Switzer (Fontshare)... ');

  const css = await fetchText(cssUrl, { 'User-Agent': UA });

  const faces = parseFontFacesFallback(css);
  if (faces.length === 0) {
    console.log('⚠ no faces found — skipping');
    return [];
  }

  const dir = path.join(FONTS_DIR, 'switzer');
  fs.mkdirSync(dir, { recursive: true });

  const declarations = [];

  for (const face of faces) {
    const filename = `switzer-${face.weight}.woff2`;
    const dest     = path.join(dir, filename);
    await downloadFile(face.srcUrl, dest);

    declarations.push(
      `@font-face {\n  font-family: 'Switzer';\n  font-style: ${face.style};\n  font-weight: ${face.weight};\n  font-display: swap;\n  src: url('/fonts/switzer/${filename}') format('woff2');\n}`
    );
  }

  console.log(`✓ (${faces.length} variants)`);
  return declarations;
}

// ── Nacelle @font-face (already self-hosted as OTF) ───────────────────────────

function nancelleDeclarations() {
  const weights = [
    { weight: 400, file: 'Nacelle-Regular.otf' },
    { weight: 600, file: 'Nacelle-SemiBold.otf' },
    { weight: 700, file: 'Nacelle-Bold.otf' },
    { weight: 800, file: 'Nacelle-Heavy.otf' },
  ];
  return weights.map(w =>
    `@font-face {\n  font-family: 'Nacelle';\n  font-style: normal;\n  font-weight: ${w.weight};\n  font-display: swap;\n  src: url('/fonts/nacelle/${w.file}') format('opentype');\n}`
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nDownloading fonts for offline use...\n');
  fs.mkdirSync(FONTS_DIR, { recursive: true });

  const all = [];

  for (const font of GOOGLE_FONTS) {
    try {
      all.push(...await processGoogleFont(font));
    } catch (e) {
      console.log(`✗ error: ${e.message}`);
    }
  }

  try {
    all.push(...await processSwitzer());
  } catch (e) {
    console.log(`✗ Switzer error: ${e.message}`);
  }

  all.push(...nancelleDeclarations());

  const css = [
    '/* Auto-generated by scripts/download-fonts.js — do not edit manually */',
    '/* Re-run the script to refresh font files from upstream. */',
    '',
    ...all,
    '',
  ].join('\n\n');

  const outPath = path.join(FONTS_DIR, 'fonts.css');
  fs.writeFileSync(outPath, css);

  console.log(`\n✓ Wrote public/fonts/fonts.css`);
  console.log('  All fonts are now self-hosted. control.css @imports have been updated.\n');
}

main().catch(err => { console.error('\nFatal:', err.message); process.exit(1); });
