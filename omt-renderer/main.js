// MetaGFX OMT renderer — turns graphics pages into native OMT video sources
// (Open Media Transport: open, royalty-free NDI alternative) with a real alpha
// channel, so vMix/OBS receive key+fill without a browser source.
//
// One Electron process hosts every configured output: a transparent offscreen
// BrowserWindow per output (GPU-composited — software rendering collapses on
// full-frame content like the COMP win screen), frames pushed to a libomt
// sender on every paint, with a keepalive resend while the page is static.
//
// Runs two ways (same code — the render node story):
//   electron omt-renderer --server=http://host:3000 --token=GFXTOKEN
//       fetch outputs from <server>/api/omt/config?token= (how the app spawns it,
//       and how a REMOTE render-node PC points at EXTERNAL_URL)
//   electron omt-renderer --config=path/to/config.json
//       explicit config file (dev / fully manual)
//
// Config: { namePrefix?: string, outputs: [{ id, name, url, fps?, width?, height? }] }
//   `url` may be relative when --server is given (resolved against it).
//
// Talks to its parent over stdio: one JSON object per stdout line —
//   {type:'ready'|'stats'|'error'|'fatal', ...} — and exits when stdin closes
//   (orphan protection: if the server dies, the renderer follows).
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const MAX_OUTPUTS = 4;                 // perf guardrail — see omt-spike/README.md baselines
const STATS_EVERY_MS = 2000;

const argv = Object.fromEntries(process.argv.filter(a => a.startsWith('--')).map(a => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));

function emit(obj) { try { process.stdout.write(JSON.stringify(obj) + '\n'); } catch {} }
function fatal(message, code = 1) { emit({ type: 'fatal', message: String(message) }); app.exit(code); }

// This is a headless service: it must NEVER show Electron's uncaught-exception
// dialog. Windows delivers broken-pipe errors as stream 'error' events (they
// bypass emit()'s try/catch) — a dead stdout means the parent is gone, so exit.
process.stdout.on('error', () => { try { app.exit(0); } catch { process.exit(0); } });
process.stderr.on('error', () => {});
process.on('uncaughtException', e => {
  if (e && (e.code === 'EPIPE' || e.code === 'ERR_STREAM_DESTROYED')) { try { app.exit(0); } catch { process.exit(0); } return; }
  fatal('uncaught: ' + (e && e.stack || e));
});

// GPU compositing is required: the COMP win screen (and any WebGL background)
// drops to ~37fps at 3× the CPU under software rendering. --software is a
// diagnostic escape hatch only.
app.commandLine.appendSwitch('force-device-scale-factor', '1');
if (argv.software) app.disableHardwareAcceleration();

let omt;                               // loaded after app config so errors report cleanly

// ── Config ────────────────────────────────────────────────────────────────────
async function loadConfig() {
  if (argv.config) {
    return JSON.parse(fs.readFileSync(argv.config, 'utf8'));
  }
  if (argv.server && argv.token) {
    const u = new URL('/api/omt/config', argv.server);
    u.searchParams.set('token', argv.token);
    const r = await fetch(u);
    if (!r.ok) throw new Error(`config fetch failed: HTTP ${r.status} from ${u.origin}${u.pathname}`);
    return await r.json();
  }
  throw new Error('no config: pass --config=<file> or --server=<url> --token=<graphics token>');
}

function resolveUrl(u) {
  if (/^https?:\/\//i.test(u)) return u;
  if (!argv.server) throw new Error(`relative output url "${u}" needs --server`);
  return new URL(u, argv.server).href;
}

// ── Output unit: one OSR window + one OMT sender ─────────────────────────────
const units = [];

function makeFrame(u) {
  return {
    Type: omt.FrameType.Video,
    Timestamp: BigInt(Date.now()) * 10000n,          // real pts (1s = 10,000,000)
    Codec: omt.Codec.BGRA,
    Width: u.width, Height: u.height, Stride: u.width * 4,
    Flags: omt.VideoFlags.Alpha | omt.VideoFlags.PreMultiplied,
    FrameRateN: u.fps, FrameRateD: 1,
    AspectRatio: u.width / u.height, ColorSpace: 709,
    SampleRate: 0, Channels: 0, SamplesPerChannel: 0,
    Data: u.native, DataLength: u.width * u.height * 4,
    CompressedData: null, CompressedLength: 0, FrameMetadata: null, FrameMetadataLength: 0,
  };
}

function sendLatest(u) {
  if (!u.hasFrame || u.closed) return;
  try {
    omt.fns.send(u.inst, makeFrame(u));
    u.lastSendAt = Date.now();
    u.sends++;
  } catch (e) {
    u.sendErrors++;
    if (u.sendErrors === 1) emit({ type: 'error', output: u.id, message: 'omt_send failed: ' + e.message });
  }
}

// Steady-cadence transmit. OMT/NDI receivers expect a CONSTANT frame stream at
// the declared rate and schedule presentation against it; an irregular feed
// (a 1fps idle keepalive that then jumps to a 60fps burst) makes the receiver
// drop the in-between frames and snap to the latest — animations "snap" on the
// receive side even though every frame was rendered.
//
// Animating content is sent straight off the compositor's paint event (a
// naturally even cadence — see the paint handler). This timer only fills the
// GAPS: when the page is static and stops painting, it re-sends the last frame
// at the configured fps so the receiver's clock never starves (VMX compresses
// the identical frames to almost nothing). It never double-sends a fresh paint.
function startSendLoop(u) {
  const period = 1000 / u.fps;
  u.sendTimer = setInterval(() => {
    if (u.closed || !u.hasFrame) return;
    if (Date.now() - u.lastSendAt >= period - 2) sendLatest(u);
  }, period);
}

async function startOutput(cfg, namePrefix) {
  const u = {
    id: cfg.id || cfg.name,
    name: cfg.name || cfg.id,
    url: resolveUrl(cfg.url),
    fps: Math.min(60, Math.max(1, cfg.fps | 0 || 30)),
    width: cfg.width | 0 || 1920,
    height: cfg.height | 0 || 1080,
    hasFrame: false, closed: false,
    paints: 0, sends: 0, sendErrors: 0, lastSendAt: 0,
  };
  u.native = omt.nativeBuffer(u.width * u.height * 4);
  // ASCII-only sender names: DNS-SD discovery mangles non-ASCII (an em-dash made
  // receivers unable to resolve the source at all)
  const senderName = `${namePrefix} - ${u.name}`.replace(/[^\x20-\x7E]/g, '-');
  u.inst = omt.fns.sendCreate(senderName, omt.Quality.Default);
  if (!u.inst) throw new Error(`omt_send_create failed for "${u.name}"`);
  const addrBuf = Buffer.alloc(1024);
  omt.fns.sendGetAddress(u.inst, addrBuf, addrBuf.length);
  u.address = omt.readCString(addrBuf);

  u.win = new BrowserWindow({
    width: u.width, height: u.height, show: false, frame: false, transparent: true,
    webPreferences: { offscreen: true, backgroundThrottling: false, paintWhenInitiallyHidden: true },
  });
  u.win.webContents.setFrameRate(u.fps);
  // Animating content: send straight off the compositor's paint event — an even
  // cadence at the OSR frame rate. The gap-filler timer (startSendLoop) covers
  // the static case when painting stops.
  u.win.webContents.on('paint', (e, dirty, image) => {
    if (u.closed) return;
    const bmp = image.toBitmap();                       // full-frame premultiplied BGRA
    if (bmp.length !== u.width * u.height * 4) return;  // DPI/size mismatch guard
    omt.memcpy(u.native, bmp, bmp.length);
    u.hasFrame = true;
    u.paints++;
    sendLatest(u);
  });

  // Self-heal the page: renderer crash → reload; failed load → retry.
  u.win.webContents.on('render-process-gone', (e, details) => {
    emit({ type: 'error', output: u.id, message: 'page renderer gone (' + details.reason + ') — reloading' });
    if (!u.closed) u.win.webContents.reload();
  });
  u.win.webContents.on('did-fail-load', (e, code, desc) => {
    emit({ type: 'error', output: u.id, message: `page load failed (${desc}) — retrying in 3s` });
    if (!u.closed) setTimeout(() => { if (!u.closed) u.win.loadURL(u.url); }, 3000);
  });

  await u.win.loadURL(u.url);
  u.win.webContents.startPainting?.();
  startSendLoop(u);                                     // constant-cadence transmit
  units.push(u);
  return u;
}

function stopOutput(u) {
  u.closed = true;
  clearTimeout(u.sendTimer);
  try { u.win.destroy(); } catch {}
  try { omt.fns.sendDestroy(u.inst); } catch {}
}

// ── Stats heartbeat ───────────────────────────────────────────────────────────
let statsTimer = null;
function startStats() {
  app.getAppMetrics();                                  // prime CPU counters
  statsTimer = setInterval(() => {
    const cpu = {};
    for (const m of app.getAppMetrics()) cpu[m.type] = +(((cpu[m.type] || 0) + m.cpu.percentCPUUsage)).toFixed(1);
    const outputs = units.map(u => {
      const st = {};
      try { omt.fns.sendGetVideoStats(u.inst, st); } catch {}
      const o = {
        id: u.id, name: u.name, address: u.address,
        fps: +(u.sends / (STATS_EVERY_MS / 1000)).toFixed(1),
        paintsPerSec: +(u.paints / (STATS_EVERY_MS / 1000)).toFixed(1),
        connections: (() => { try { return omt.fns.sendConnections(u.inst); } catch { return 0; } })(),
        sendErrors: u.sendErrors,
        mbps: +((Number(st.BytesSentSinceLast || 0) * 8 / 1e6) / (STATS_EVERY_MS / 1000)).toFixed(1),
      };
      u.sends = 0; u.paints = 0;
      return o;
    });
    emit({ type: 'stats', cpuPercentOfCore: cpu, outputs });
  }, STATS_EVERY_MS);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
function shutdown(code = 0) {
  clearInterval(statsTimer);
  for (const u of units) stopOutput(u);
  app.exit(code);
}
// Orphan protection: the spawning server passes --parent-pid=<its pid>; if that
// process disappears, exit. (stdin-based watching is NOT reliable in Electron's
// main process on Windows — a piped stdin fires 'end' immediately.)
if (argv['parent-pid']) {
  const ppid = parseInt(argv['parent-pid'], 10);
  setInterval(() => {
    try { process.kill(ppid, 0); } catch { shutdown(0); }
  }, 3000);
}
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

app.whenReady().then(async () => {
  try {
    omt = require('./omt.js');                           // resolves + loads the DLLs
    const cfg = await loadConfig();
    let outs = Array.isArray(cfg.outputs) ? cfg.outputs.filter(o => o && o.url) : [];
    if (!outs.length) throw new Error('config has no outputs');
    if (outs.length > MAX_OUTPUTS) {
      emit({ type: 'error', message: `config has ${outs.length} outputs — capping at ${MAX_OUTPUTS}` });
      outs = outs.slice(0, MAX_OUTPUTS);
    }
    for (const o of outs) await startOutput(o, cfg.namePrefix || 'MetaGFX');
    emit({ type: 'ready', outputs: units.map(u => ({ id: u.id, name: u.name, address: u.address, fps: u.fps })) });
    startStats();
  } catch (e) {
    fatal(e.message || e);
  }
});
app.on('window-all-closed', () => { /* windows are managed explicitly */ });
