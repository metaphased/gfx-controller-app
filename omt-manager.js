// OMT output manager — owns the omt-renderer sidecar (see omt-renderer/README.md):
// install state, the in-app installer (pinned downloads → omt-renderer/vendor/),
// process lifecycle (spawn/watchdog/backoff) and runtime status from the
// renderer's stdout heartbeats. Windows-first, like the OMT binaries themselves.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Pinned component downloads. Electron stays on 38.x — Electron 39 has an
// offscreen-rendering transparency regression (electron/electron#48931).
const ELECTRON_VERSION = '38.2.1';
const ELECTRON_URL = `https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-win32-x64.zip`;
const OMT_VERSION = 'v1.0.0.16';
const OMT_URL = `https://github.com/openmediatransport/libomtnet/releases/download/${OMT_VERSION}/OpenMediaTransport.Binaries.Release.${OMT_VERSION}.zip`;

const RENDERER_DIR = path.join(__dirname, 'omt-renderer');
const VENDOR_DIR = path.join(RENDERER_DIR, 'vendor');
const ELECTRON_EXE = path.join(VENDOR_DIR, 'electron', 'electron.exe');
const OMT_DLL = path.join(VENDOR_DIR, 'omt', 'libomt.dll');

const MAX_OUTPUTS = 4;
const BACKOFF_MS = [5000, 10000, 20000, 40000, 60000];
const STABLE_RESET_MS = 5 * 60 * 1000;   // uptime that resets the backoff ladder

function createOmtManager({ io, getSettings, getPort, log }) {
  const runtime = {
    desired: false,        // should the renderer be running?
    proc: null,
    ready: false,
    startedAt: 0,
    restarts: 0,
    lastStats: null,
    lastError: '',
    installing: false,
  };
  let restartTimer = null;
  let applyTimer = null;

  const say = (level, msg) => { try { log(level, msg); } catch {} };

  // ── Install state ─────────────────────────────────────────────────────────
  function installed() {
    return {
      electron: fs.existsSync(ELECTRON_EXE),
      omt: fs.existsSync(OMT_DLL),
      electronVersion: ELECTRON_VERSION,
      omtVersion: OMT_VERSION,
    };
  }
  const isInstalled = () => { const i = installed(); return i.electron && i.omt; };

  // ── Installer: pinned zips → vendor/ (progress over Socket.io 'omt:install') ─
  const emitInstall = ev => { try { io.emit('omt:install', ev); } catch {} };

  async function downloadTo(url, dest, label) {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) throw new Error(`${label}: HTTP ${r.status} from ${new URL(url).host}`);
    const total = parseInt(r.headers.get('content-length') || '0', 10);
    const file = fs.createWriteStream(dest);
    let got = 0, lastPct = -1;
    for await (const chunk of r.body) {
      file.write(chunk);
      got += chunk.length;
      const pct = total ? Math.floor(got / total * 100) : 0;
      if (pct !== lastPct) { lastPct = pct; emitInstall({ phase: 'download', component: label, pct, mb: +(got / 1e6).toFixed(1) }); }
    }
    await new Promise((res, rej) => file.end(err => err ? rej(err) : res()));
    if (total && got !== total) throw new Error(`${label}: incomplete download (${got}/${total} bytes)`);
  }

  function expandZip(zip, dest) {
    return new Promise((resolve, reject) => {
      const p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`],
        { windowsHide: true });
      let err = '';
      p.stderr.on('data', d => err += d);
      p.on('close', code => code === 0 ? resolve() : reject(new Error('extract failed: ' + err.slice(0, 300))));
    });
  }

  async function install() {
    if (runtime.installing) throw new Error('install already running');
    if (process.platform !== 'win32') throw new Error('OMT output is currently Windows-only');
    runtime.installing = true;
    const work = path.join(os.tmpdir(), 'metagfx-omt-install');
    try {
      fs.rmSync(work, { recursive: true, force: true });
      fs.mkdirSync(work, { recursive: true });
      fs.mkdirSync(VENDOR_DIR, { recursive: true });

      if (!installed().electron) {
        emitInstall({ phase: 'start', component: 'Electron runtime', mbTotal: 115 });
        const zip = path.join(work, 'electron.zip');
        await downloadTo(ELECTRON_URL, zip, 'Electron runtime');
        emitInstall({ phase: 'extract', component: 'Electron runtime' });
        const dest = path.join(VENDOR_DIR, 'electron');
        fs.rmSync(dest, { recursive: true, force: true });
        await expandZip(zip, dest);
        if (!fs.existsSync(ELECTRON_EXE)) throw new Error('Electron extract did not produce electron.exe');
      }

      if (!installed().omt) {
        emitInstall({ phase: 'start', component: 'OMT libraries', mbTotal: 8 });
        const zip = path.join(work, 'omt.zip');
        await downloadTo(OMT_URL, zip, 'OMT libraries');
        emitInstall({ phase: 'extract', component: 'OMT libraries' });
        const unpack = path.join(work, 'omt');
        await expandZip(zip, unpack);
        // release layout: Libraries/Winx64/*.dll + LICENSE.txt at the root
        const src = path.join(unpack, 'Libraries', 'Winx64');
        if (!fs.existsSync(path.join(src, 'libomt.dll'))) throw new Error('OMT zip did not contain Libraries/Winx64/libomt.dll');
        const dest = path.join(VENDOR_DIR, 'omt');
        fs.rmSync(dest, { recursive: true, force: true });
        fs.mkdirSync(dest, { recursive: true });
        for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dest, f));
        const lic = path.join(unpack, 'LICENSE.txt');
        if (fs.existsSync(lic)) fs.copyFileSync(lic, path.join(dest, 'LICENSE.txt'));
      }

      emitInstall({ phase: 'done' });
      say('info', 'OMT components installed (Electron ' + ELECTRON_VERSION + ', OMT ' + OMT_VERSION + ')');
    } catch (e) {
      emitInstall({ phase: 'error', message: String(e.message || e) });
      throw e;
    } finally {
      runtime.installing = false;
      fs.rmSync(work, { recursive: true, force: true });
    }
  }

  // ── Renderer lifecycle ────────────────────────────────────────────────────
  function treeKill(proc) {
    if (!proc || proc.exitCode !== null) return;
    try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }); } catch {}
  }

  function handleLine(line) {
    let ev; try { ev = JSON.parse(line); } catch { return; }
    if (ev.type === 'ready') { runtime.ready = true; runtime.lastError = ''; say('info', 'OMT renderer up: ' + ev.outputs.map(o => o.address).join(', ')); }
    else if (ev.type === 'stats') runtime.lastStats = { at: Date.now(), ...ev };
    else if (ev.type === 'error') { runtime.lastError = ev.message || ''; say('warn', 'OMT renderer: ' + runtime.lastError); }
    else if (ev.type === 'fatal') { runtime.lastError = ev.message || ''; say('error', 'OMT renderer fatal: ' + runtime.lastError); }
  }

  function start() {
    if (runtime.proc || !runtime.desired) return;
    if (!isInstalled()) { runtime.lastError = 'OMT components not installed'; return; }
    const token = (getSettings().graphicsToken) || '';
    // ELECTRON_RUN_AS_NODE must be fully ABSENT (VS Code shells set it; Electron
    // checks presence, not value — even '' makes it run as plain Node and die).
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const proc = spawn(ELECTRON_EXE, [
      RENDERER_DIR,
      `--server=http://127.0.0.1:${getPort()}`,
      `--token=${token}`,
      `--parent-pid=${process.pid}`,
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
    runtime.proc = proc;
    runtime.ready = false;
    runtime.startedAt = Date.now();

    let buf = '';
    proc.stdout.on('data', d => {
      buf += d;
      let i; while ((i = buf.indexOf('\n')) >= 0) { handleLine(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
    });
    let errTail = '';
    proc.stderr.on('data', d => { errTail = (errTail + d).slice(-400); });
    proc.on('exit', code => {
      if (code && errTail.trim()) runtime.lastError = 'exit ' + code + ': ' + errTail.trim().slice(-200);
      const uptime = Date.now() - runtime.startedAt;
      runtime.proc = null;
      runtime.ready = false;
      runtime.lastStats = null;
      if (!runtime.desired) return;
      if (uptime > STABLE_RESET_MS) runtime.restarts = 0;
      const delay = BACKOFF_MS[Math.min(runtime.restarts, BACKOFF_MS.length - 1)];
      runtime.restarts++;
      say('warn', `OMT renderer exited (code ${code}) — restarting in ${delay / 1000}s`);
      clearTimeout(restartTimer);
      restartTimer = setTimeout(start, delay);
    });
  }

  function stop() {
    runtime.desired = false;
    clearTimeout(restartTimer);
    if (runtime.proc) { const p = runtime.proc; runtime.proc = null; treeKill(p); }
    runtime.ready = false;
    runtime.lastStats = null;
  }

  // Called on boot and whenever settings.omt changes: reconcile the process with
  // the config. Config changes while running are applied by RESTARTING the
  // renderer (receivers reconnect within a couple of seconds).
  function applyConfig() {
    const cfg = getSettings().omt || {};
    const wantRunning = !!cfg.enabled && (cfg.outputs || []).length > 0;
    clearTimeout(applyTimer);
    applyTimer = setTimeout(() => {
      if (!wantRunning) { stop(); return; }
      runtime.desired = true;
      runtime.restarts = 0;
      if (runtime.proc) { const p = runtime.proc; runtime.proc = null; treeKill(p); setTimeout(start, 1200); }
      else start();
    }, 400);   // debounce rapid settings edits
  }

  function status() {
    const inst = installed();
    return {
      installed: inst.electron && inst.omt,
      components: inst,
      installing: runtime.installing,
      running: !!runtime.proc,
      ready: runtime.ready,
      restarts: runtime.restarts,
      lastError: runtime.lastError,
      stats: runtime.lastStats,
      maxOutputs: MAX_OUTPUTS,
    };
  }

  return { install, isInstalled, applyConfig, stop, status, MAX_OUTPUTS };
}

module.exports = { createOmtManager, MAX_OUTPUTS };
