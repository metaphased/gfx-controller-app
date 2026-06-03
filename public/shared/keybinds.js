/* ============================================================================
   keybinds.js — per-user keyboard shortcuts for surfaces outside the control
   panel (currently the Operator view).

   Reuses the SAME bindable actions as the control-panel keybinds and Bitfocus
   Companion (window.ActionRegistry, /shared/action-registry.js) and the SAME
   storage (GET /api/auth/me → user.keybinds, POST /api/users/me/keybinds).
   Self-contained: builds its own editor modal + styles, so the host page only
   needs a trigger that calls MetaKeybinds.openEditor().

   Requires /shared/action-registry.js to be loaded first.
   ============================================================================ */
(function () {
  'use strict';

  let _binds = {};        // saved   { actionId: combo }
  let _staged = {};       // editing copy
  let _dirty = false;
  let _listening = null;  // { actionId, btn }
  let _openSection = null;
  let _built = false;

  function comboFromEvent(e) {
    const parts = [];
    if (e.ctrlKey)  parts.push('ctrl');
    if (e.altKey)   parts.push('alt');
    if (e.shiftKey) parts.push('shift');
    if (e.metaKey)  parts.push('meta');
    const key = (e.key || '').toLowerCase();
    if (!['control', 'alt', 'shift', 'meta'].includes(key)) parts.push(key);
    return parts.join('+');
  }
  const prettyCombo = (c) => c ? c.split('+').map(p => p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)).join(' + ') : '';

  // ── Firing ─────────────────────────────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (_listening) {
      if (e.key === 'Escape') { e.preventDefault(); cancelListening(); return; }
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
      e.preventDefault();
      applyRecorded(e);
      return;
    }
    if (_editorOpen()) return;   // don't fire actions while the editor is open
    const tag = (document.activeElement || {}).tagName || '';
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    if (!window.ActionRegistry) return;
    const combo = comboFromEvent(e);
    const actionId = Object.keys(_binds).find(id => _binds[id] === combo);
    if (!actionId) return;
    const action = ActionRegistry.getById(actionId);
    if (!action) return;
    e.preventDefault();
    action.handler();
  });

  // ── Persistence ──────────────────────────────────────────────────────────────
  function load() {
    return fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { _binds = (d && d.user && d.user.keybinds) || {}; })
      .catch(() => {});
  }
  function save(silent) {
    _binds = Object.assign({}, _staged);
    _dirty = false;
    return fetch('/api/users/me/keybinds', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keybinds: _binds }),
    }).then(() => { if (!silent) _msg('Saved'); }).catch(() => _msg('Save failed', true));
  }

  // ── Editor modal ─────────────────────────────────────────────────────────────
  function _editorOpen() { const o = document.getElementById('mkb-overlay'); return !!(o && o.classList.contains('active')); }

  function openEditor() {
    ensureBuilt();
    _staged = Object.assign({}, _binds);
    _dirty = false;
    renderTable();
    document.getElementById('mkb-overlay').classList.add('active');
  }
  function closeEditor() {
    cancelListening();
    if (_dirty) save(true);
    const o = document.getElementById('mkb-overlay'); if (o) o.classList.remove('active');
  }

  function ensureBuilt() {
    if (_built) return;
    const style = document.createElement('style');
    style.textContent = `
      #mkb-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:400; align-items:center; justify-content:center; }
      #mkb-overlay.active { display:flex; }
      .mkb-modal { background:var(--bg2,#16181c); border:1px solid var(--border-strong,rgba(255,255,255,.2)); border-radius:var(--radius,2px); width:560px; max-width:calc(100vw - 40px); max-height:84vh; display:flex; flex-direction:column; box-shadow:var(--shadow-modal,0 16px 48px rgba(0,0,0,.7)); }
      .mkb-head { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid var(--border,rgba(255,255,255,.1)); }
      .mkb-title { font-size:13px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; color:var(--text-strong,#f5f7fa); }
      .mkb-x { background:none; border:none; color:var(--text-dim,#8a8f98); font-size:18px; cursor:pointer; line-height:1; }
      .mkb-x:hover { color:var(--text-strong,#fff); }
      .mkb-body { overflow-y:auto; padding:10px 14px; }
      .mkb-hint { font-size:12px; color:var(--text-dim,#8a8f98); padding:0 4px 10px; }
      .mkb-sec { border:1px solid var(--border,rgba(255,255,255,.1)); border-radius:var(--radius,2px); margin-bottom:8px; overflow:hidden; }
      .mkb-sec-hd { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; cursor:pointer; background:var(--bg3,#1b1e23); font-size:11px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; color:var(--label,rgba(255,255,255,.78)); }
      .mkb-sec-hd:hover { color:var(--text-strong,#fff); }
      .mkb-sec-count { color:var(--accent,#b3b3b3); font-weight:700; }
      .mkb-rows { display:none; }
      .mkb-sec.open .mkb-rows { display:block; }
      .mkb-row { display:flex; align-items:center; gap:10px; padding:6px 12px; border-top:1px solid var(--border,rgba(255,255,255,.08)); }
      .mkb-row-label { flex:1; font-size:13px; color:var(--text,#d7dbe2); }
      .mkb-combo { font-size:11px; font-weight:700; letter-spacing:.04em; padding:4px 9px; border:1px solid var(--border-strong,rgba(255,255,255,.22)); border-radius:var(--radius,2px); background:var(--bg3,#1b1e23); color:var(--text,#d7dbe2); cursor:pointer; white-space:nowrap; min-width:74px; text-align:center; }
      .mkb-combo:hover { border-color:var(--accent,#b3b3b3); color:var(--text-strong,#fff); }
      .mkb-combo.listening { border-color:var(--accent,#b3b3b3); color:var(--accent,#b3b3b3); animation:mkb-pulse .9s ease-in-out infinite; }
      .mkb-combo.empty { color:var(--text-dim,#8a8f98); }
      .mkb-clear { background:none; border:none; color:var(--text-dim,#8a8f98); cursor:pointer; font-size:14px; padding:2px 4px; }
      .mkb-clear:hover { color:var(--danger,#ff4d4d); }
      @keyframes mkb-pulse { 0%,100%{opacity:1} 50%{opacity:.45} }
      .mkb-foot { display:flex; align-items:center; justify-content:space-between; padding:12px 18px; border-top:1px solid var(--border,rgba(255,255,255,.1)); }
      .mkb-msg { font-size:12px; color:var(--ok,#2ecc71); }
    `;
    document.head.appendChild(style);

    const ov = document.createElement('div');
    ov.id = 'mkb-overlay';
    ov.addEventListener('click', (e) => { if (e.target === ov) closeEditor(); });
    ov.innerHTML =
      '<div class="mkb-modal">' +
        '<div class="mkb-head"><span class="mkb-title">Keyboard Shortcuts</span><button class="mkb-x" id="mkb-close">&times;</button></div>' +
        '<div class="mkb-body"><div class="mkb-hint">Click a shortcut, then press the key combo. Shortcuts fire only when no text field is focused. Saved to your account.</div><div id="mkb-sections"></div></div>' +
        '<div class="mkb-foot"><span class="mkb-msg" id="mkb-msg"></span><button class="mkb-combo" id="mkb-done">Done</button></div>' +
      '</div>';
    document.body.appendChild(ov);
    document.getElementById('mkb-close').addEventListener('click', closeEditor);
    document.getElementById('mkb-done').addEventListener('click', closeEditor);
    _built = true;
  }

  function _groups() {
    const all = (window.ActionRegistry ? ActionRegistry.getAll() : []);
    const cats = {};
    all.forEach(a => { (cats[a.category] = cats[a.category] || []).push(a); });
    return cats;
  }

  function renderTable() {
    const host = document.getElementById('mkb-sections'); if (!host) return;
    const cats = _groups();
    const names = Object.keys(cats);
    if (!_openSection || !cats[_openSection]) _openSection = names[0];
    host.innerHTML = names.map(cat => {
      const bound = cats[cat].filter(a => _staged[a.id]).length;
      const open = cat === _openSection;
      const rows = cats[cat].map(a => {
        const combo = _staged[a.id] || '';
        const listening = _listening && _listening.actionId === a.id;
        return '<div class="mkb-row">' +
          '<span class="mkb-row-label">' + a.label + '</span>' +
          '<button class="mkb-combo' + (listening ? ' listening' : (combo ? '' : ' empty')) + '" data-act="' + a.id + '">' +
            (listening ? 'Press keys…' : (combo ? prettyCombo(combo) : 'Set')) + '</button>' +
          (combo ? '<button class="mkb-clear" data-clear="' + a.id + '" title="Clear">&times;</button>' : '<span style="width:22px"></span>') +
          '</div>';
      }).join('');
      return '<div class="mkb-sec' + (open ? ' open' : '') + '" data-cat="' + cat + '">' +
        '<div class="mkb-sec-hd" data-sec="' + cat + '"><span>' + cat + '</span><span class="mkb-sec-count">' + bound + ' set</span></div>' +
        '<div class="mkb-rows">' + rows + '</div></div>';
    }).join('');

    host.querySelectorAll('.mkb-sec-hd').forEach(el => el.addEventListener('click', () => {
      cancelListening();
      _openSection = (_openSection === el.dataset.sec) ? null : el.dataset.sec;
      renderTable();
    }));
    host.querySelectorAll('.mkb-combo[data-act]').forEach(el => el.addEventListener('click', () => startListening(el.dataset.act, el)));
    host.querySelectorAll('.mkb-clear[data-clear]').forEach(el => el.addEventListener('click', () => { delete _staged[el.dataset.clear]; _dirty = true; renderTable(); }));
  }

  function startListening(actionId, btn) {
    cancelListening();
    _listening = { actionId, btn };
    btn.classList.add('listening');
    btn.textContent = 'Press keys…';
  }
  function cancelListening() {
    if (!_listening) return;
    _listening = null;
    renderTable();
  }
  function applyRecorded(e) {
    const combo = comboFromEvent(e);
    const actionId = _listening.actionId;
    // keep combos unique — clear it from any other action
    Object.keys(_staged).forEach(id => { if (_staged[id] === combo) delete _staged[id]; });
    _staged[actionId] = combo;
    _dirty = true;
    _listening = null;
    renderTable();
  }
  function _msg(t, err) { const el = document.getElementById('mkb-msg'); if (!el) return; el.textContent = t; el.style.color = err ? 'var(--danger,#ff4d4d)' : 'var(--ok,#2ecc71)'; clearTimeout(el._t); el._t = setTimeout(() => el.textContent = '', 2500); }

  window.MetaKeybinds = { load, openEditor, closeEditor };
})();
