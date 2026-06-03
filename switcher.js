/* ============================================================================
   switcher.js — live on-air detection from the production switcher (OBS / vMix)

   Reports a single snapshot:
     { type, connected, streamLive, recording, liveGraphics[], previewGraphics[] }
   - streamLive   : is the broadcast actually streaming (on air)
   - liveGraphics : our graphic keys VISIBLE on the program output right now
   - previewGraphics : graphic keys in preview (only populated when showPreview)

   App-specific mapping is injected by the caller via `matchers`:
     byUrl(url)     -> graphicKey | null   (OBS browser-source URL → graphic)
     byTitle(title) -> graphicKey | null   (vMix input title → graphic)

   The module is defensive: any switcher error degrades to disconnected and a
   reconnect loop; it never throws into the server.
   ============================================================================ */

let OBSWebSocket = null;
try { const m = require('obs-websocket-js'); OBSWebSocket = m.OBSWebSocket || m.default || null; }
catch (e) { /* dependency optional — OBS support simply disabled if missing */ }

const RECONNECT_MS   = 5000;
const OBS_RESYNC_MS  = 3000;
const VMIX_POLL_MS   = 1000;

let cfg        = { type: 'none', enabled: false, showPreview: false, obs: {}, vmix: {} };
let matchers   = { byUrl: () => null, byTitle: () => null };
let onChangeCb = () => {};

let snapshot = emptySnapshot('none');

let obs = null;
let obsResyncTimer = null;
let vmixTimer = null;
let reconnectTimer = null;
let generation = 0;            // bumped on every (re)configure to cancel stale async work

function emptySnapshot(type, connected) {
  return { type: type || 'none', connected: !!connected, streamLive: false, recording: false, liveGraphics: [], previewGraphics: [] };
}

function getSnapshot() { return snapshot; }

function setSnapshot(next) {
  const a = JSON.stringify({ ...snapshot, _: 0 });
  const b = JSON.stringify({ ...next, _: 0 });
  if (a === b) return;            // no change — don't spam clients
  snapshot = next;
  try { onChangeCb(snapshot); } catch (e) { /* never let a listener break us */ }
}

function configure(opts) {
  if (opts.matchers) matchers = opts.matchers;
  if (opts.onChange) onChangeCb = opts.onChange;
  reconfigure(opts.settings);
}

function reconfigure(settings) {
  const s = (settings && settings.switcher) || {};
  cfg = {
    type:        ['obs', 'vmix'].includes(s.type) ? s.type : 'none',
    enabled:     !!s.enabled,
    showPreview: !!s.showPreview,
    obs:  s.obs  || {},
    vmix: s.vmix || {},
  };
  generation++;
  teardown();
  if (!cfg.enabled || cfg.type === 'none') { setSnapshot(emptySnapshot(cfg.type, false)); return; }
  if (cfg.type === 'obs')  connectOBS(generation);
  if (cfg.type === 'vmix') startVmix(generation);
}

function teardown() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (obsResyncTimer) { clearInterval(obsResyncTimer); obsResyncTimer = null; }
  if (vmixTimer)      { clearInterval(vmixTimer); vmixTimer = null; }
  if (obs) { try { obs.disconnect(); } catch (e) {} obs = null; }
}

function scheduleReconnect(gen) {
  if (gen !== generation || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (gen !== generation) return;
    if (cfg.type === 'obs')  connectOBS(gen);
    if (cfg.type === 'vmix') startVmix(gen);
  }, RECONNECT_MS);
}

/* ── OBS (obs-websocket v5) ──────────────────────────────────────────────────── */
async function connectOBS(gen) {
  if (!OBSWebSocket) { setSnapshot(emptySnapshot('obs', false)); return; }
  const o = new OBSWebSocket();
  obs = o;
  let urlMap = {};               // input name -> browser source url

  const recompute = () => { if (gen === generation) recomputeOBS(o, urlMap).catch(() => {}); };

  o.on('ConnectionClosed', () => { if (gen === generation) { setSnapshot(emptySnapshot('obs', false)); scheduleReconnect(gen); } });
  ['CurrentProgramSceneChanged', 'CurrentPreviewSceneChanged', 'SceneItemEnableStateChanged',
   'SceneItemCreated', 'SceneItemRemoved', 'StudioModeStateChanged', 'SceneListChanged',
  ].forEach(ev => o.on(ev, recompute));
  o.on('StreamStateChanged', recompute);
  o.on('RecordStateChanged', recompute);
  o.on('InputSettingsChanged', async () => { try { urlMap = await buildObsUrlMap(o); recompute(); } catch (e) {} });

  try {
    const host = cfg.obs.host || '127.0.0.1';
    const port = cfg.obs.port || 4455;
    await o.connect(`ws://${host}:${port}`, cfg.obs.password || undefined);
    if (gen !== generation) { try { o.disconnect(); } catch (e) {} return; }
    urlMap = await buildObsUrlMap(o);
    await recomputeOBS(o, urlMap);
    obsResyncTimer = setInterval(recompute, OBS_RESYNC_MS);
  } catch (e) {
    if (gen === generation) { setSnapshot(emptySnapshot('obs', false)); scheduleReconnect(gen); }
  }
}

async function buildObsUrlMap(o) {
  const map = {};
  const { inputs } = await o.call('GetInputList');
  for (const inp of inputs || []) {
    const kind = (inp.inputKind || '').toLowerCase();
    if (!kind.includes('browser')) continue;
    try {
      const { inputSettings } = await o.call('GetInputSettings', { inputName: inp.inputName });
      if (inputSettings && inputSettings.url) map[inp.inputName] = inputSettings.url;
    } catch (e) {}
  }
  return map;
}

// Collect source names that are actually visible (enabled, through enabled groups) in a scene.
async function collectVisibleSources(o, sceneName, acc) {
  if (!sceneName) return;
  let items = [];
  try { items = (await o.call('GetSceneItemList', { sceneName })).sceneItems || []; } catch (e) { return; }
  for (const it of items) {
    if (!it.sceneItemEnabled) continue;
    if (it.isGroup) {
      try {
        const grp = (await o.call('GetGroupSceneItemList', { sceneName: it.sourceName })).sceneItems || [];
        for (const gi of grp) { if (gi.sceneItemEnabled) acc.add(gi.sourceName); }
      } catch (e) {}
    }
    acc.add(it.sourceName);
  }
}

async function recomputeOBS(o, urlMap) {
  let streamLive = false, recording = false, studio = false, programScene = null, previewScene = null;
  try { streamLive = (await o.call('GetStreamStatus')).outputActive; } catch (e) {}
  try { recording  = (await o.call('GetRecordStatus')).outputActive; } catch (e) {}
  try { studio     = (await o.call('GetStudioModeEnabled')).studioModeEnabled; } catch (e) {}
  try { programScene = (await o.call('GetCurrentProgramScene')).sceneName || (await o.call('GetCurrentProgramScene')).currentProgramSceneName; } catch (e) {}

  const liveSet = new Set();
  await collectVisibleSources(o, programScene, liveSet);
  const liveGraphics = sourcesToGraphics(liveSet, urlMap);

  let previewGraphics = [];
  if (cfg.showPreview && studio) {
    try { previewScene = (await o.call('GetCurrentPreviewScene')).sceneName || (await o.call('GetCurrentPreviewScene')).currentPreviewSceneName; } catch (e) {}
    const pvwSet = new Set();
    await collectVisibleSources(o, previewScene, pvwSet);
    previewGraphics = sourcesToGraphics(pvwSet, urlMap);
  }

  setSnapshot({ type: 'obs', connected: true, streamLive: !!streamLive, recording: !!recording, liveGraphics, previewGraphics });
}

function sourcesToGraphics(sourceSet, urlMap) {
  const keys = new Set();
  sourceSet.forEach(name => { const k = matchers.byUrl(urlMap[name]); if (k) keys.add(k); });
  return Array.from(keys);
}

/* ── vMix (HTTP API polling) ─────────────────────────────────────────────────── */
function startVmix(gen) {
  const tick = () => { if (gen === generation) pollVmix(gen).catch(() => {}); };
  tick();
  vmixTimer = setInterval(tick, VMIX_POLL_MS);
}

async function pollVmix(gen) {
  const host = cfg.vmix.host || '127.0.0.1';
  const port = cfg.vmix.port || 8088;
  let xml;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(`http://${host}:${port}/api`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    xml = await r.text();
  } catch (e) {
    if (gen === generation) setSnapshot(emptySnapshot('vmix', false));
    return;
  }
  if (gen !== generation) return;

  const streamLive = /<streaming>true<\/streaming>/i.test(xml) || /<external>true<\/external>/i.test(xml);
  const recording  = /<recording>true<\/recording>/i.test(xml);

  // Map input number -> title
  const titleByNum = {};
  const inputRe = /<input\b[^>]*\bnumber="(\d+)"[^>]*\btitle="([^"]*)"[^>]*>/gi;
  let m;
  while ((m = inputRe.exec(xml)) !== null) titleByNum[m[1]] = m[2];

  const active  = (xml.match(/<active>(\d+)<\/active>/i)  || [])[1];
  const preview = (xml.match(/<preview>(\d+)<\/preview>/i) || [])[1];

  // Active overlay channels → input numbers currently composited on program
  const overlayNums = [];
  const ovRe = /<overlay\b[^>]*>(\d+)<\/overlay>/gi;
  while ((m = ovRe.exec(xml)) !== null) overlayNums.push(m[1]);

  const liveNums = [active, ...overlayNums].filter(Boolean);
  const liveGraphics = numsToGraphics(liveNums, titleByNum);
  const previewGraphics = cfg.showPreview ? numsToGraphics([preview].filter(Boolean), titleByNum) : [];

  setSnapshot({ type: 'vmix', connected: true, streamLive, recording, liveGraphics, previewGraphics });
}

function numsToGraphics(nums, titleByNum) {
  const keys = new Set();
  nums.forEach(n => { const k = matchers.byTitle(titleByNum[n]); if (k) keys.add(k); });
  return Array.from(keys);
}

module.exports = { configure, reconfigure, getSnapshot };
