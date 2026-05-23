// control.js — Esports GFX Control Panel

const socket = io();
window._state = {};
let bracketRounds = [];
let bracketType   = 'single';
const _pickerContainers = {};
const DEFAULT_ROLES = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];
const OPGG_REGIONS  = ['kr','euw','na','eune','jp','oce','br','las','lan','ru','tr'];

// ── Profile dirty tracking ─────────────────────────────────────────────────────
// Produces a consistent JSON string regardless of object key insertion order.
function stableStr(v) {
  if (v === null || v === undefined) return String(v);
  if (typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStr).join(',') + ']';
  return '{' + Object.keys(v).sort().map(function(k) { return JSON.stringify(k) + ':' + stableStr(v[k]); }).join(',') + '}';
}

let _savedProfileSnapshotStr = null; // stableStr of last saved/loaded profile data
let _dirtyCheckTimer = null;

function profileSnapshotStr(state) {
  if (!state || !state.match || !state.tournament) return null;
  const m = state.match;
  return stableStr({
    tournament: state.tournament,
    bracket:    { title: state.bracket && state.bracket.title, rounds: state.bracket && state.bracket.rounds },
    match: {
      team1: m.team1, team2: m.team2, game: m.game, format: m.format,
      tournament: m.tournament, tournamentLogo: m.tournamentLogo, sponsorLogos: m.sponsorLogos,
      fearlessDraft: m.fearlessDraft, currentGameNum: m.currentGameNum, seriesGames: m.seriesGames,
      scheduleDayId: m.scheduleDayId, scheduleGameId: m.scheduleGameId,
    },
    players: state.players,
  });
}

function setProfileSnapshot(snapshotData) {
  _savedProfileSnapshotStr = snapshotData ? stableStr(snapshotData) : null;
  updateProfileDirtyBar(false);
}

function checkProfileDirty() {
  if (!window._activeProfileId || !_savedProfileSnapshotStr) return;
  const current = profileSnapshotStr(window._state);
  updateProfileDirtyBar(current !== null && current !== _savedProfileSnapshotStr);
}

function updateProfileDirtyBar(dirty) {
  const bar = g('profile-save-bar'); if (!bar) return;
  if (!window._activeProfileId || !_savedProfileSnapshotStr) { bar.style.display = 'none'; return; }
  bar.style.display = dirty ? 'flex' : 'none';
  if (dirty) {
    const nameEl = g('psb-name');
    if (nameEl) {
      const profNameEl = g('prof-name-' + window._activeProfileId);
      nameEl.textContent = (profNameEl && profNameEl.textContent) || '';
    }
  }
}

function saveActiveProfileChanges() {
  const id = window._activeProfileId; if (!id) return;
  api('/api/profiles/update', { id }).then(function(data) {
    if (data && data.ok) {
      if (data.savedSnapshot) setProfileSnapshot(data.savedSnapshot);
      loadProfilesTab();
    } else alert((data && data.error) || 'Failed to update profile.');
  });
}

// ── Connection ─────────────────────────────────────────────────────────────────
socket.on('connect', () => {
  const el = g('conn-status');
  el.textContent = '⬤ Connected';
  el.className = 'connection-status connected';
});
socket.on('disconnect', () => {
  const el = g('conn-status');
  el.textContent = '⬤ Disconnected';
  el.className = 'connection-status disconnected';
});
socket.on('state', (state) => {
  window._state = state;
  syncUI(state);
  // Debounced dirty check — runs 2 s after state settles
  clearTimeout(_dirtyCheckTimer);
  _dirtyCheckTimer = setTimeout(checkProfileDirty, 2000);
});

// ── Navigation ─────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(navEl => {
  navEl.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    navEl.classList.add('active');
    const tab = g('tab-' + navEl.dataset.tab);
    if (tab) tab.classList.add('active');
    if (navEl.dataset.tab === 'teams')    renderTeamsList();
    if (navEl.dataset.tab === 'schedule') renderSchedule();
    if (navEl.dataset.tab === 'home')     renderDashboard(window._state);
    localStorage.setItem('gfx_ctrl_tab', navEl.dataset.tab);
  });
});

// Output URL chips
const GFX_PAGES = [
  ['Head to Head',  'graphics/head2head/'],
  ['Pre-show',      'graphics/pre-show/'],
  ['Draft',         'graphics/draft/'],
  ['Bracket',       'graphics/bracket/'],
  ['Group Stage',           'graphics/group-stage/'],
  ['Tournament Structure',  'graphics/tournament-structure/'],
  ['Prizepool',  'graphics/prizepool/'],
  ['BG Output',  'graphics/bg-output/'],
  ['Break Screen',          'graphics/break-screen/'],
  ['Win Screen',    'graphics/win-screen/'],
  ['Scoreboard',    'graphics/scoreboard/'],
  ['Lower Third',   'graphics/lower-third/'],
];
const urlList = g('url-list');
GFX_PAGES.forEach(([label, p]) => {
  const url = window.location.origin + '/' + p;
  const chip = document.createElement('div');
  chip.className = 'url-chip';
  chip.title = 'Click to copy';
  chip.textContent = label;
  chip.addEventListener('click', () => {
    navigator.clipboard.writeText(url).then(() => {
      chip.textContent = '✓ Copied!';
      setTimeout(() => { chip.textContent = label; }, 1500);
    });
  });
  urlList.appendChild(chip);
});

// ── API helper ─────────────────────────────────────────────────────────────────
async function api(path, body) {
  try {
    const res  = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) console.error('API error', path, res.status, data);
    return data;
  } catch (e) { console.error('Fetch error', path, e); }
}

// ── Graphics token + output URLs ───────────────────────────────────────────────
const GFX_OUTPUTS = [
  { label: 'Head to Head',          path: 'graphics/head2head/' },
  { label: 'Pre-show',              path: 'graphics/pre-show/' },
  { label: 'Draft Overlay',         path: 'graphics/draft/' },
  { label: 'Bracket',               path: 'graphics/bracket/' },
  { label: 'Group Stage',           path: 'graphics/group-stage/' },
  { label: 'Tournament Structure',  path: 'graphics/tournament-structure/' },
  { label: 'Prizepool',             path: 'graphics/prizepool/' },
  { label: 'BG Output',             path: 'graphics/bg-output/' },
  { label: 'Break Screen',          path: 'graphics/break-screen/' },
  { label: 'Win Screen',            path: 'graphics/win-screen/' },
  { label: 'Scoreboard',            path: 'graphics/scoreboard/' },
  { label: 'Lower Third',           path: 'graphics/lower-third/' },
];

function syncGfxToken(settings) {
  const token   = (settings || {}).graphicsToken || '';
  const tokenEl = g('gfx-token-display');
  if (tokenEl) tokenEl.value = token;

  const listEl  = g('gfx-url-list'); if (!listEl) return;
  const base    = window.location.origin + '/';
  listEl.innerHTML = GFX_OUTPUTS.map(o =>
    '<div style="display:flex;align-items:center;gap:8px">' +
    '<span style="font-family:\'Barlow Condensed\',sans-serif;font-size:11px;font-weight:700;letter-spacing:0.1em;color:var(--text-dim);width:130px;flex-shrink:0">' + escHtml(o.label) + '</span>' +
    '<input type="text" readonly value="' + escHtml(base + o.path + (token ? '?token=' + token : '')) + '" style="flex:1;font-family:monospace;font-size:11px" onclick="this.select()">' +
    '<button class="btn btn-sm" onclick="navigator.clipboard.writeText(this.previousElementSibling.value)">Copy</button>' +
    '</div>'
  ).join('');
}

function copyGfxToken() {
  const el = g('gfx-token-display');
  if (el) navigator.clipboard.writeText(el.value);
}
function regenerateGfxToken() {
  if (!confirm('Regenerate graphics token? All current OBS/vMix browser source URLs will stop working until updated.')) return;
  api('/api/settings/regenerate-token', {});
}

// ── Top bar sync ───────────────────────────────────────────────────────────────
function syncTopBar(s) {
  const meta = s.meta || {};

  // Profile name
  const profileNameEl = g('mtb-profile-name');
  if (profileNameEl) {
    profileNameEl.textContent = meta.activeProfileName || 'No profile loaded';
    profileNameEl.style.color = meta.activeProfileName ? 'var(--primary)' : 'var(--text-dim)';
  }

  // Sync client-side active profile ID from server state (persists through refreshes)
  const newId = meta.activeProfileId || null;
  if (newId !== window._activeProfileId) {
    window._activeProfileId = newId;
    updateProfileDirtyBar(false);
    if (newId && !_savedProfileSnapshotStr) _pendingSnapshotRestore = true;
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function renderDashboard(s) {
  if (!s) return;
  var homeTab = g('tab-home');
  if (!homeTab || !homeTab.classList.contains('active')) return;
  var m = s.match || {};
  var t = s.tournament || {};
  var todayGames = s.todayGames || [];

  // Match card
  var matchEl = g('dash-match');
  if (matchEl) {
    var sg = m.seriesGames || [];
    var sc1 = sg.filter(function(x) { return x.winner === 'team1'; }).length;
    var sc2 = sg.filter(function(x) { return x.winner === 'team2'; }).length;
    var t1 = m.team1 || {}, t2 = m.team2 || {};
    var hasTeams = !!(t1.name || t2.name);
    matchEl.innerHTML = '<div class="card-title">Active Match</div>' +
      (hasTeams
        ? '<div class="dash-match-teams">' +
            '<div class="dash-team-block">' +
              (t1.logo ? '<img class="dash-team-logo" src="' + escHtml(t1.logo) + '" onerror="this.style.display=\'none\'">' : '') +
              '<div class="dash-team-name">' + escHtml(t1.name || t1.tag || '—') + '</div>' +
            '</div>' +
            '<div class="dash-score-val">' + sc1 + ' – ' + sc2 + '</div>' +
            '<div class="dash-team-block">' +
              (t2.logo ? '<img class="dash-team-logo" src="' + escHtml(t2.logo) + '" onerror="this.style.display=\'none\'">' : '') +
              '<div class="dash-team-name">' + escHtml(t2.name || t2.tag || '—') + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="dash-match-meta">' + escHtml(m.format || '') + (m.tournament ? ' · ' + escHtml(m.tournament) : '') + '</div>'
        : '<p class="dash-empty">No active match set up.</p>');
  }

  // Tournament card
  var tournEl = g('dash-tournament');
  if (tournEl) {
    var hasTournament = !!(t.name || m.tournament);
    tournEl.innerHTML = '<div class="card-title">Tournament</div>' +
      (hasTournament
        ? '<div class="dash-tourn-name">' + escHtml(t.name || m.tournament || '') + '</div>' +
          '<div class="dash-tourn-meta">' +
            (m.game    ? 'Game: ' + escHtml(m.game) + '<br>' : '') +
            (m.format  ? 'Format: ' + escHtml(m.format) + '<br>' : '') +
          '</div>'
        : '<p class="dash-empty">No tournament configured.</p>');
  }

  // Schedule card
  var schedEl = g('dash-schedule');
  if (schedEl) {
    schedEl.innerHTML = '<div class="card-title">Today\'s Schedule</div>' +
      (todayGames.length
        ? '<div class="dash-sched-list">' +
            todayGames.map(function(sg) {
              var r = sg.result;
              var cls = 'dash-sched-row' + (sg.isCurrent ? ' is-current' : '');
              var resultHtml = (r && r.completed)
                ? '<span class="dash-sched-result">' + r.team1SeriesScore + '–' + r.team2SeriesScore + '</span>'
                : '';
              return '<div class="' + cls + '">' +
                escHtml(sg.team1.name || sg.team1.tag || '?') +
                '<span class="dash-sched-vs">vs</span>' +
                escHtml(sg.team2.name || sg.team2.tag || '?') +
                resultHtml +
              '</div>';
            }).join('') +
          '</div>'
        : '<p class="dash-empty">No schedule day loaded.</p>');
  }

  // Graphics card
  var gfxEl = g('dash-graphics');
  if (gfxEl) {
    gfxEl.innerHTML = '<div class="card-title">Live Graphics</div>' +
      '<div class="dash-gfx-grid">' +
        GRAPHIC_MAP.map(function(gfx) {
          var active = s[gfx.key] && s[gfx.key].visible;
          return '<div class="dash-gfx-item">' +
            '<div class="dash-gfx-dot' + (active ? ' is-live' : '') + '"></div>' +
            escHtml(gfx.label) +
          '</div>';
        }).join('') +
      '</div>';
  }
}

// ── Sync UI ────────────────────────────────────────────────────────────────────
let _pendingSnapshotRestore = false;

function syncUI(s) {
  if (!s || !s.match || !s.lowerThird || !s.draft || !s.breakScreen || !s.winScreen || !s.bracket || !s.players) {
    console.warn('Incomplete state', s); return;
  }
  const m = s.match, p = s.players;

  // Tournament Setup tab
  const t = s.tournament || {};
  setInpSafe('ts-name',  m.tournament);
  setInpSafe('ts-logo',  m.tournamentLogo);
  setInp('ts-game', m.game);
  syncTournamentStructure(t);

  // Game Setup tab
  setInpSafe('gs-format', m.format);
  const fearlessEl = g('gs-fearless'); if (fearlessEl) fearlessEl.checked = !!m.fearlessDraft;
  renderSeriesTracker(s);
  renderGsDaySelect(s);
  syncActiveGameIndicator(m);

  // Re-render schedule unless a text/date/number field inside it is actively being edited
  const schedTab = g('tab-schedule');
  if (schedTab && schedTab.classList.contains('active')) {
    const focused = document.activeElement;
    const editableInSchedule = focused && schedTab.contains(focused) &&
      (focused.tagName === 'TEXTAREA' ||
       (focused.tagName === 'INPUT' && ['text','number','date','email','search','url'].includes((focused.type||'').toLowerCase())));
    if (!editableInSchedule) renderSchedule();
  }

  // Standings + seedings (lightweight, always safe to update)
  renderStandingsAndSeedings(s);

  syncTeamDisplay(1, m.team1);
  syncTeamDisplay(2, m.team2);

  setText('players-t1-label', m.team1.name + ' Roster');
  setText('players-t2-label', m.team2.name + ' Roster');

  setInpSafe('lt-text', s.lowerThird.text); setInpSafe('lt-sub', s.lowerThird.subtext); setInpSafe('lt-super', s.lowerThird.supertext);
  setInpSafe('break-msg', s.breakScreen.message); setInpSafe('break-sub', s.breakScreen.subtext); setInpSafe('break-next', s.breakScreen.nextMatch);
  const _bls = s.breakScreen.centerLogoScale || 8;
  setInpSafe('break-logo-scale', _bls);
  const _blsVal = g('break-logo-scale-val'); if (_blsVal) _blsVal.textContent = _bls + 'vh';
  const bstnEl = g('break-show-tourn-name'); if (bstnEl) bstnEl.checked = !!(s.breakScreen.showTournName);
  // ── Head to Head sync ──────────────────────────────────────────────────────
  const h2h        = s.headToHead || {};
  const h2hMode    = h2h.mode || 'spotlight';
  const h2hRole    = h2h.spotlightRole !== undefined ? h2h.spotlightRole : 0;
  for (var _ri = 0; _ri < 5; _ri++) {
    const _rb = g('h2h-role-' + _ri);
    if (_rb) _rb.className = 'btn btn-sm ' + (h2hMode === 'spotlight' && h2hRole === _ri ? 'btn-active-gfx' : 'btn-dim');
  }
  const _h2hLb = g('h2h-lineup-btn');
  if (_h2hLb) _h2hLb.className = 'btn ' + (h2hMode === 'lineup' ? 'btn-active-gfx' : 'btn-primary');
  const h2hAnim = h2h.animStyle || 'standard';
  ['standard', 'impact', 'drop'].forEach(function(s2) {
    const btn = g('h2h-anim-' + s2);
    if (btn) btn.className = 'btn btn-sm ' + (h2hAnim === s2 ? 'btn-active-gfx' : 'btn-dim');
  });
  const _h2hPrev = g('h2h-match-preview');
  if (_h2hPrev) {
    const _mt1 = (s.match && s.match.team1) || {}; const _mt2 = (s.match && s.match.team2) || {};
    _h2hPrev.textContent = (_mt1.name || _mt1.tag || '—') + ' vs ' + (_mt2.name || _mt2.tag || '—');
  }
  syncH2hChampStatsUI((s.settings || {}).h2hChampStats || {});

  // ── Pre-show sync ──────────────────────────────────────────────────────────
  syncPreShowUI(s.preShow || {}, s.settings || {}, s.todayGames || [], s.ticker || {});

  const pipActive = !!(s.breakScreen && s.breakScreen.pipMode);
  const pipShowBtn = g('showbtn-pip'); const pipHideBtn = g('hidebtn-pip');
  if (pipShowBtn) pipShowBtn.className = 'btn btn-sm ' + (pipActive ? 'btn-active-gfx' : 'btn-primary');
  if (pipHideBtn) pipHideBtn.className = 'btn btn-sm ' + (pipActive ? 'btn-danger' : 'btn-dim');
  const tickerActive = !!(s.ticker && s.ticker.visible);
  const tickerShowBtn = g('showbtn-ticker'); const tickerHideBtn = g('hidebtn-ticker');
  if (tickerShowBtn) tickerShowBtn.className = 'btn btn-sm ' + (tickerActive ? 'btn-active-gfx' : 'btn-primary');
  if (tickerHideBtn) tickerHideBtn.className = 'btn btn-sm ' + (tickerActive ? 'btn-danger' : 'btn-dim');
  syncTickerUI(s.ticker || {}, s);
  syncWinTab(s.winScreen || {}, s.match || {});
  syncBgoTab(s.bgOutput || {});

  renderSponsors(m.sponsorLogos || []);
  renderPlayerEditors(p);
  renderIntelPanel(s);
  renderLTQuickGrid(p, m);
  renderDraftTab(s.draft, s);
  syncGraphicIndicators(s);
  syncOperatorPage(s);
  syncLiveBar(s);

  if (s.bracket) {
    bracketRounds = s.bracket.rounds || [];
    bracketType   = (s.tournament && s.tournament.playoffFormat === 'doubleElim') ? 'double' : 'single';
    renderBracketEditor();
    const bls = s.bracket.logoScale != null ? s.bracket.logoScale : 7;
    setInp('bracket-logo-scale', bls);
    setText('bracket-logo-scale-val', bls + 'vh');
    const lp = s.bracket.logoPosition || 'left';
    ['left','center'].forEach(function(v) { const b = g('bracket-logo-pos-' + v); if (b) b.classList.toggle('btn-active', lp === v); });
    const bsl = !!s.bracket.showLogo;
    const bOn = g('bracket-logo-show-on'), bOff = g('bracket-logo-show-off');
    if (bOn)  bOn.classList.toggle('btn-active', bsl);
    if (bOff) bOff.classList.toggle('btn-active', !bsl);
    renderBracketLogoPicker(s);
  }

  syncTopBar(s);
  renderDashboard(s);
  if (s.settings) syncThemeTab(s.settings);
  if (s.settings) syncGfxToken(s.settings);
  if (s.settings) renderBreakCenterLogoPicker(s.settings);
  if (s.settings) renderH2HLogoPicker(s.settings);
  if (s.settings) renderBracketLogoPicker(s);
  if (s.groupStage)          syncGroupStageGfxUI(s);
  if (s.tournamentStructure) syncTournamentStructureGfxUI(s);
  if (s.prizepool) syncPrizepoolTab(s);
  renderThemeSponsorPreview(m.sponsorLogos);
  syncDraftGfxTab(s.draft || {}, s.settings || {});
}

// ── DOM helpers ────────────────────────────────────────────────────────────────
function g(id) { return document.getElementById(id); }
function setInp(id, val) { const e = g(id); if (e && document.activeElement !== e) e.value = val != null ? val : ''; }
function setInpSafe(id, val) { setInp(id, val); }
function setText(id, val) { const e = g(id); if (e) e.textContent = val != null ? val : ''; }
function setSpan(id, val) { setText(id, val); }
function setColorPicker(id, val) { const e = g(id); if (e && val && /^#[0-9a-fA-F]{6}$/.test(val)) e.value = val; }
function setDotColor(id, color) { const e = g(id); if (e) e.style.background = color || '#1ffaff'; }

// ── Match ──────────────────────────────────────────────────────────────────────
function patchMatch(data) { api('/api/match', data); }
function getLTColor(k) { return (window._state&&window._state.match&&window._state.match[k]&&window._state.match[k].color)||'#1ffaff'; }
function patchScore(team, delta) { api('/api/score', { team, delta }); }
function resetState() { if (confirm('Reset ALL state? Cannot be undone.')) api('/api/state/reset', {}); }

function syncTeamDisplay(n, team) {
  const prefix = 't' + n;
  setText(prefix + '-name-disp', team.name || 'No team loaded');
  setText(prefix + '-tag-disp',  team.tag  || '');
  setDotColor(prefix + '-dot',   team.color);
  setSpan(prefix + '-score',     team.score);
  const thumb = g(prefix + '-logo-thumb');
  if (thumb) {
    thumb.style.backgroundImage = team.logo ? 'url(' + team.logo + ')' : '';
    thumb.classList.toggle('has-img', !!team.logo);
  }
  // Scoreboard tab mirrors
  setText('ls-t' + n + '-name',  team.name);
  setText('ls-t' + n + '-score', team.score);
}

// ── Graphics ───────────────────────────────────────────────────────────────────
function showGraphic(name) { fetch('/api/graphic/'+name+'/show',{method:'POST'}).catch(console.error); }
function hideGraphic(name) { fetch('/api/graphic/'+name+'/hide',{method:'POST'}).catch(console.error); }

// ── Lower Third ────────────────────────────────────────────────────────────────
function patchLT(data) { api('/api/lowerThird', data); }

function renderLTQuickGrid(players, match) {
  const grid = g('lt-player-grid'); if (!grid) return;
  const all = [];
  (players.team1||[]).forEach(p => { if (p.handle||p.name) all.push({...p, teamName:match.team1.name, teamTag:match.team1.tag, teamColor:match.team1.color}); });
  (players.team2||[]).forEach(p => { if (p.handle||p.name) all.push({...p, teamName:match.team2.name, teamTag:match.team2.tag, teamColor:match.team2.color}); });
  grid._players = all;
  grid.innerHTML = all.map((p,i) =>
    '<button class="player-quick-btn" onclick="quickLT('+i+')">' +
    '<span class="pqb-handle">'+esc(p.handle||p.name)+'</span>' +
    '<span class="pqb-team">'+esc(p.teamTag||p.teamName)+(p.role?' · '+p.role:'')+'</span>' +
    '</button>'
  ).join('');
}

function quickLT(i) {
  const grid = g('lt-player-grid');
  const p = grid&&grid._players&&grid._players[i]; if (!p) return;
  api('/api/lowerThird', { text:p.handle||p.name, subtext:(p.role?p.role+' · ':'')+p.teamName, supertext:(window._state&&window._state.match&&window._state.match.tournament)||'', teamColor:p.teamColor||'', visible:true });
}

// ── Draft ──────────────────────────────────────────────────────────────────────

// LoL draft order: 20 steps total
const DRAFT_SEQUENCE = [
  // Phase 1 Bans (B-R-B-R-B-R)
  { phase:'bans1',  type:'ban',  side:'blue' }, // 0
  { phase:'bans1',  type:'ban',  side:'red'  }, // 1
  { phase:'bans1',  type:'ban',  side:'blue' }, // 2
  { phase:'bans1',  type:'ban',  side:'red'  }, // 3
  { phase:'bans1',  type:'ban',  side:'blue' }, // 4
  { phase:'bans1',  type:'ban',  side:'red'  }, // 5
  // Phase 1 Picks (B-R-R-B-B-R)
  { phase:'picks1', type:'pick', side:'blue' }, // 6
  { phase:'picks1', type:'pick', side:'red'  }, // 7
  { phase:'picks1', type:'pick', side:'red'  }, // 8
  { phase:'picks1', type:'pick', side:'blue' }, // 9
  { phase:'picks1', type:'pick', side:'blue' }, // 10
  { phase:'picks1', type:'pick', side:'red'  }, // 11
  // Phase 2 Bans (R-B-R-B)
  { phase:'bans2',  type:'ban',  side:'red'  }, // 12
  { phase:'bans2',  type:'ban',  side:'blue' }, // 13
  { phase:'bans2',  type:'ban',  side:'red'  }, // 14
  { phase:'bans2',  type:'ban',  side:'blue' }, // 15
  // Phase 2 Picks (R-B-B-R)
  { phase:'picks2', type:'pick', side:'red'  }, // 16
  { phase:'picks2', type:'pick', side:'blue' }, // 17
  { phase:'picks2', type:'pick', side:'blue' }, // 18
  { phase:'picks2', type:'pick', side:'red'  }, // 19
];

const DRAFT_PHASE_LABELS = {
  notstarted: 'Not Started',
  bans1:  'Phase 1 — Bans',
  picks1: 'Phase 1 — Picks',
  bans2:  'Phase 2 — Bans',
  picks2: 'Phase 2 — Picks',
  complete: 'Draft Complete',
};

// Blue picks: indices 6,9,10,17,18 | Red picks: indices 7,8,11,16,19
const BLUE_PICK_IDX = [6,9,10,17,18];
const RED_PICK_IDX  = [7,8,11,16,19];
const BLUE_BAN_IDX  = [0,2,4,13,15];
const RED_BAN_IDX   = [1,3,5,12,14];

const _draftPickerContainers = {};

let _draftTabTimerInterval = null;
let _draftTabTimerEnd = null;
let _draftTabTimerDur = 60;

function _tickDraftTabTimer() {
  if (!_draftTabTimerEnd) return;
  const rem      = Math.max(0, _draftTabTimerEnd - Date.now());
  const fraction = Math.max(0, Math.min(1, rem / (_draftTabTimerDur * 1000)));
  const secs     = Math.ceil(rem / 1000);
  const secsEl   = g('draft-tab-timer-secs');
  const barEl    = g('draft-tab-timer-bar');
  const timerRow = g('draft-tab-timer-row');
  if (secsEl) {
    secsEl.textContent = secs;
    secsEl.style.color = fraction > 0.5 ? 'var(--primary)' : fraction > 0.25 ? '#f0a000' : 'var(--danger)';
  }
  if (barEl) {
    barEl.style.width = (fraction * 100) + '%';
    barEl.style.background = fraction > 0.5 ? 'var(--primary)' : fraction > 0.25 ? '#f0a000' : 'var(--danger)';
  }
  if (rem <= 0) {
    clearInterval(_draftTabTimerInterval);
    _draftTabTimerInterval = null;
    if (timerRow) timerRow.style.display = 'none';
  }
}

function renderDraftTab(draft, state) {
  if (!draft) return;
  const board = g('draft-board'); if (!board) return;
  const m = state.match;
  const blueSideTeam = draft.blueSideTeam || 'team1';
  const picks = draft.picks || Array(20).fill('');
  const currentStep = draft.currentStep || 0; // 1-indexed; 0 = not started

  const blueTeam     = blueSideTeam === 'team1' ? m.team1 : m.team2;
  const redTeam      = blueSideTeam === 'team1' ? m.team2 : m.team1;
  const banFirstTeam = draft.banFirstTeam || 'blue';
  // firstSlot = team slot that acts first in the draft sequence (bans first)
  const firstSlot    = banFirstTeam === 'blue' ? blueSideTeam : (blueSideTeam === 'team1' ? 'team2' : 'team1');

  // Build board DOM once, or rebuild if banFirstTeam changed
  if (!board.dataset.built || board.dataset.banFirst !== banFirstTeam) {
    board.dataset.built   = '1';
    board.dataset.banFirst = banFirstTeam;
    let html = '';
    let lastPhase = null;
    DRAFT_SEQUENCE.forEach(function(step, i) {
      if (step.phase !== lastPhase) {
        if (lastPhase !== null) html += '</div>';
        html += '<div class="draft-phase-section"><div class="draft-phase-header">' + DRAFT_PHASE_LABELS[step.phase] + '</div>';
        lastPhase = step.phase;
      }
      // physicalSide: 'blue' = step.side matches banFirstTeam (first actor is that side)
      const physSide = step.side === banFirstTeam ? 'blue' : 'red';
      html +=
        '<div class="draft-step-row" id="draft-step-' + i + '">' +
          '<span class="draft-step-num">' + (i+1) + '</span>' +
          '<span class="draft-side-badge draft-side-' + physSide + '">' + physSide.toUpperCase() + '</span>' +
          '<span class="draft-type-badge draft-type-' + step.type + '">' + step.type.toUpperCase() + '</span>' +
          '<span class="draft-step-team" id="draft-team-' + i + '">—</span>' +
          '<div class="draft-picker-wrap" id="draft-picker-' + i + '"></div>' +
          '<span class="draft-clock-badge" id="draft-clock-' + i + '" style="display:none">ON THE CLOCK</span>' +
        '</div>';
    });
    if (lastPhase !== null) html += '</div>';
    board.innerHTML = html;

    // Build champion pickers for all steps
    DRAFT_SEQUENCE.forEach(function(_, i) {
      const pc = g('draft-picker-' + i);
      if (!pc) return;
      Champions.buildPicker(pc, function(champ) { draftSetPick(i, champ ? (champ.url || '') : ''); }, picks[i] || '');
      _draftPickerContainers[i] = pc;
    });
  } else {
    // Update picker values only
    DRAFT_SEQUENCE.forEach(function(_, i) {
      const pc = _draftPickerContainers[i];
      if (pc) Champions.updatePickerValue(pc, picks[i] || '');
    });
  }

  // Compute fearless pool for disabled champion highlighting
  const fearless = !!(state.match && state.match.fearlessDraft);
  const usedForFearless = new Set();
  if (fearless) {
    ((state.match && state.match.seriesGames) || []).forEach(function(sg) {
      [...(sg.t1Picks||[]), ...(sg.t2Picks||[])].forEach(function(p) {
        if (p) usedForFearless.add(champNameFromUrl(p).toLowerCase());
      });
    });
  }

  // Update dynamic content every tick
  DRAFT_SEQUENCE.forEach(function(step, i) {
    const physSide = step.side === banFirstTeam ? 'blue' : 'red';
    const team = physSide === 'blue' ? blueTeam : redTeam;
    const teamEl = g('draft-team-' + i);
    if (teamEl) teamEl.textContent = team.tag || team.name || physSide;

    const row = g('draft-step-' + i);
    if (row) {
      row.className = 'draft-step-row' +
        (i + 1 === currentStep ? ' draft-step-active' : '') +
        (picks[i] ? ' draft-step-done' : '');
    }

    const clockEl = g('draft-clock-' + i);
    if (clockEl) clockEl.style.display = (i + 1 === currentStep) ? 'inline-block' : 'none';

    // Update disabled champion list for fearless enforcement
    const pc = _draftPickerContainers[i];
    if (pc) pc._disabledNames = fearless && usedForFearless.size > 0 ? usedForFearless : null;
  });

  // Role assignment card (shown when draft is complete)
  renderRoleAssignment(draft, state);

  // Sync blue-side, side-chooser, and ban-first radios
  const r1 = g('draft-blue-t1'), r2 = g('draft-blue-t2');
  if (r1 && document.activeElement !== r1) r1.checked = blueSideTeam === 'team1';
  if (r2 && document.activeElement !== r2) r2.checked = blueSideTeam === 'team2';
  const l1 = g('draft-t1-label'), l2 = g('draft-t2-label');
  if (l1) l1.textContent = m.team1.name || 'Team 1';
  if (l2) l2.textContent = m.team2.name || 'Team 2';

  const sc1 = g('draft-sc-t1'), sc2 = g('draft-sc-t2');
  const sideChooser = draft.sideChooser || '';
  if (sc1) sc1.checked = sideChooser === 'team1';
  if (sc2) sc2.checked = sideChooser === 'team2';
  const scl1 = g('draft-sc-t1-label'), scl2 = g('draft-sc-t2-label');
  if (scl1) scl1.textContent = m.team1.name || 'Team 1';
  if (scl2) scl2.textContent = m.team2.name || 'Team 2';

  const bfb = g('draft-ban-first-blue'), bfr = g('draft-ban-first-red');
  if (bfb) bfb.checked = banFirstTeam === 'blue';
  if (bfr) bfr.checked = banFirstTeam === 'red';

  // Step status indicator
  const ind = g('draft-step-indicator');
  if (ind) {
    if (currentStep === 0) {
      ind.textContent = 'Draft not started — assign sides then fill picks in order';
    } else if (currentStep > 20) {
      ind.textContent = '✓ Draft complete';
    } else {
      const s = DRAFT_SEQUENCE[currentStep - 1];
      const physSide = s.side === banFirstTeam ? 'blue' : 'red';
      const nm = physSide === 'blue' ? (blueTeam.tag || blueTeam.name || 'Blue') : (redTeam.tag || redTeam.name || 'Red');
      ind.textContent = 'Step ' + currentStep + ' / 20 — ' + nm + ' · ' + s.type.toUpperCase() + ' (' + DRAFT_PHASE_LABELS[s.phase] + ')';
    }
  }

  // Live timer bar on draft tab
  const timerRow = g('draft-tab-timer-row');
  const showTabTimer = !!(draft.timerVisible && draft.timerEnd && currentStep > 0 && currentStep <= 20);
  _draftTabTimerEnd = showTabTimer ? draft.timerEnd : null;
  _draftTabTimerDur = draft.timerDuration || 60;
  if (timerRow) timerRow.style.display = showTabTimer ? 'flex' : 'none';
  if (showTabTimer) {
    if (!_draftTabTimerInterval) _draftTabTimerInterval = setInterval(_tickDraftTabTimer, 100);
    _tickDraftTabTimer();
  } else if (_draftTabTimerInterval) {
    clearInterval(_draftTabTimerInterval);
    _draftTabTimerInterval = null;
  }

  // GFX overlay status
  const gfxSt = g('draft-gfx-status');
  if (gfxSt) {
    const p = draft.phase || 'notstarted';
    gfxSt.textContent = DRAFT_PHASE_LABELS[p] || p;
  }
}

function draftSetPick(stepIndex, champUrl) {
  const d = window._state && window._state.draft;
  const picks = d ? (d.picks || Array(20).fill('')).slice() : Array(20).fill('');
  picks[stepIndex] = champUrl;
  // Current step = first empty slot (1-indexed), or 21 if all filled
  let next = picks.findIndex(function(p) { return !p; });
  next = next === -1 ? 21 : next + 1;
  const phase = next > 20 ? 'complete' : DRAFT_SEQUENCE[next - 1].phase;
  api('/api/draft', { picks: picks, currentStep: next, phase: phase });
}

function startDraftPhase() {
  // Pushes phase to 'bans1' so the overlay shows the first team on the clock
  // before any ban has been made. Timer starts automatically if timerVisible is set.
  const draft = (window._state || {}).draft || {};
  if (draft.phase !== 'notstarted') return; // already started
  // currentStep=1 (1-indexed) = step index 0 active = blue's first ban showing on overlay
  api('/api/draft', { phase: 'bans1', currentStep: 1 });
}

function resetDraft() {
  if (!confirm('Reset the current draft? All picks will be cleared.')) return;
  const board = g('draft-board');
  if (board) { board.innerHTML = ''; board.removeAttribute('data-built'); }
  Object.keys(_draftPickerContainers).forEach(function(k) { delete _draftPickerContainers[k]; });
  _raState.t1 = Array(5).fill(null); _raState.t2 = Array(5).fill(null); _raSig = '';
  const raEl = g('draft-role-assign'); if (raEl) raEl.innerHTML = '';
  const d = window._state && window._state.draft;
  api('/api/draft', {
    picks: Array(20).fill(''),
    currentStep: 0,
    phase: 'notstarted',
    timerEnd: null,
    committedT1Picks: [],
    committedT2Picks: [],
    team1RolePicks: [],
    team2RolePicks: [],
    blueSideTeam: (d && d.blueSideTeam) || 'team1',
    replayIntro: true,
  });
}

function replayDraftIntro() {
  api('/api/draft', { replayIntro: true });
}

function commitDraftToSeries() {
  const d = window._state && window._state.draft;
  if (!d) return;
  const picks        = d.picks || Array(20).fill('');
  const blueSideTeam = d.blueSideTeam || 'team1';
  const banFirst     = d.banFirstTeam || 'blue';
  const firstSlot    = banFirst === 'blue' ? blueSideTeam : (blueSideTeam === 'team1' ? 'team2' : 'team1');
  const firstPicks   = BLUE_PICK_IDX.map(function(i) { return picks[i] || ''; });
  const secondPicks  = RED_PICK_IDX.map(function(i)  { return picks[i] || ''; });
  const t1Picks = firstSlot === 'team1' ? firstPicks : secondPicks;
  const t2Picks = firstSlot === 'team1' ? secondPicks : firstPicks;
  api('/api/draft', { committedT1Picks: t1Picks, committedT2Picks: t2Picks }).then(function() {
    const msg = g('draft-commit-msg');
    if (msg) { msg.style.display = 'block'; msg.textContent = '✓ Picks pushed to series tracker'; }
    setTimeout(function() { const m = g('draft-commit-msg'); if (m) m.style.display = 'none'; }, 3000);
  });
}

const DRAFT_ROLES = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];

// Role assignment drag-drop state
const _raState = { t1: Array(5).fill(null), t2: Array(5).fill(null) };
let _raSig = '';
let _dragInfo = null; // { role, team, fromIdx } — fromIdx=-1 means from source row

function renderRoleAssignment(draft, state) {
  const container = g('draft-role-assign'); if (!container) return;
  if (!draft || draft.phase !== 'complete') {
    if (container.innerHTML) { container.innerHTML = ''; _raSig = ''; }
    return;
  }

  const picks = draft.picks || Array(20).fill('');
  const sig   = picks.join('|');

  if (sig === _raSig) return; // already built for this set of picks — don't re-render mid-drag
  _raSig = sig;

  const blueSideTeam = draft.blueSideTeam || 'team1';
  const banFirst     = draft.banFirstTeam || 'blue';
  const firstSlot    = banFirst === 'blue' ? blueSideTeam : (blueSideTeam === 'team1' ? 'team2' : 'team1');
  const m = state.match;
  const firstPicks  = BLUE_PICK_IDX.map(function(i) { return picks[i] || ''; });
  const secondPicks = RED_PICK_IDX.map(function(i)  { return picks[i] || ''; });
  const t1DraftPicks = firstSlot === 'team1' ? firstPicks : secondPicks;
  const t2DraftPicks = firstSlot === 'team1' ? secondPicks : firstPicks;

  // Restore assignments from saved role picks, or start fresh
  ['t1', 't2'].forEach(function(prefix, ti) {
    const draftPicks = ti === 0 ? t1DraftPicks : t2DraftPicks;
    const rolePicks  = draft[ti === 0 ? 'team1RolePicks' : 'team2RolePicks'] || [];
    if (rolePicks.some(Boolean)) {
      _raState[prefix] = draftPicks.map(function(champUrl) {
        const ri = rolePicks.indexOf(champUrl);
        return ri >= 0 ? DRAFT_ROLES[ri] : null;
      });
    } else {
      _raState[prefix] = Array(5).fill(null);
    }
  });

  const t1Label   = m.team1.tag || m.team1.name || 'Team 1';
  const t2Label   = m.team2.tag || m.team2.name || 'Team 2';
  const t1SideLbl = blueSideTeam === 'team1' ? 'Blue' : 'Red';
  const t2SideLbl = blueSideTeam === 'team1' ? 'Red'  : 'Blue';

  buildRaDOM(container, draft, t1DraftPicks, t2DraftPicks, t1Label, t2Label, t1SideLbl, t2SideLbl);
}

function buildRaDOM(container, draft, t1DraftPicks, t2DraftPicks, t1Label, t2Label, t1SideLbl, t2SideLbl) {
  function teamHtml(draftPicks, prefix, label, sideLbl) {
    const assigned  = _raState[prefix];
    const usedRoles = new Set(assigned.filter(Boolean));

    const pills = DRAFT_ROLES.map(function(role) {
      const used = usedRoles.has(role);
      return '<div class="ra-pill' + (used ? ' ra-pill-used' : '') + '" draggable="' + (!used) + '" ' +
        'data-ra-role="' + role + '" data-ra-team="' + prefix + '" data-ra-from="-1">' + role + '</div>';
    }).join('');

    const rows = draftPicks.map(function(champUrl, di) {
      const name  = champNameFromUrl(champUrl);
      const thumb = champUrl
        ? '<div class="ra-thumb" style="background-image:url(' + champUrl + ')"></div>'
        : '<div class="ra-thumb empty"></div>';
      const role  = assigned[di];
      const inner = role
        ? '<span class="ra-assigned-pill" draggable="true" data-ra-role="' + role + '" data-ra-team="' + prefix + '" data-ra-from="' + di + '">' + role + '</span>'
        : '<span class="ra-hint">drop role</span>';
      return '<div class="ra-row" data-ra-team="' + prefix + '" data-ra-idx="' + di + '">' +
        thumb +
        '<span class="ra-champ-name">' + escHtml(name || '—') + '</span>' +
        '<div class="ra-drop">' + inner + '</div>' +
      '</div>';
    }).join('');

    return '<div class="ra-col">' +
      '<div class="ra-col-label">' + escHtml(label) +
        '<span class="ra-side-tag ra-side-' + sideLbl.toLowerCase() + '">' + sideLbl + '</span>' +
      '</div>' +
      '<div class="ra-pills-row">' + pills + '</div>' +
      rows +
    '</div>';
  }

  container.innerHTML =
    '<div class="card" style="margin-top:16px">' +
      '<div class="card-title" style="display:flex;align-items:center;justify-content:space-between">' +
        '<span>Role Assignment</span>' +
        '<button class="btn btn-primary btn-sm" onclick="applyDraftRoles()">Apply Roles →</button>' +
      '</div>' +
      '<p class="hint" style="margin-bottom:10px">Drag a role onto a champion. Assigned roles dim in the source row and can be re-dragged to swap.</p>' +
      '<div class="ra-grid">' +
        teamHtml(t1DraftPicks, 't1', t1Label, t1SideLbl) +
        teamHtml(t2DraftPicks, 't2', t2Label, t2SideLbl) +
      '</div>' +
      '<div id="role-assign-msg" style="display:none;margin-top:10px;font-size:12px;color:var(--primary);font-family:\'Barlow Condensed\',sans-serif;letter-spacing:0.06em"></div>' +
    '</div>';

  // Drag sources (source pills + assigned pills)
  container.querySelectorAll('[data-ra-role]').forEach(function(el) {
    if (el.draggable === false || el.getAttribute('draggable') === 'false') return;
    el.addEventListener('dragstart', function(e) {
      _dragInfo = { role: el.dataset.raRole, team: el.dataset.raTeam, fromIdx: parseInt(el.dataset.raFrom) };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', el.dataset.raRole);
      setTimeout(function() { el.classList.add('ra-dragging'); }, 0);
    });
    el.addEventListener('dragend', function() { el.classList.remove('ra-dragging'); });
  });

  // Drop zones — whole row is the target; .ra-drop is the visual slot
  container.querySelectorAll('.ra-row[data-ra-idx]').forEach(function(row) {
    const slot = row.querySelector('.ra-drop');
    row.addEventListener('dragover', function(e) {
      if (!_dragInfo || _dragInfo.team !== row.dataset.raTeam) return;
      e.preventDefault();
      if (slot) slot.classList.add('ra-over');
    });
    row.addEventListener('dragleave', function(e) {
      if (row.contains(e.relatedTarget)) return; // still inside the row
      if (slot) slot.classList.remove('ra-over');
    });
    row.addEventListener('drop', function(e) {
      e.preventDefault();
      if (slot) slot.classList.remove('ra-over');
      if (!_dragInfo || _dragInfo.team !== row.dataset.raTeam) { _dragInfo = null; return; }

      const team    = row.dataset.raTeam;
      const toIdx   = parseInt(row.dataset.raIdx);
      const role    = _dragInfo.role;
      const fromIdx = _dragInfo.fromIdx;
      _dragInfo = null;

      const asgn = _raState[team];
      const displaced = asgn[toIdx]; // role already at target (may be null)

      if (fromIdx >= 0) {
        // Dragging from another pick slot — swap
        asgn[fromIdx] = displaced;
      }
      // If fromIdx === -1 (source pill), displaced is simply freed (unassigned)

      asgn[toIdx] = role;

      // Rebuild UI with updated assignments
      const d = window._state && window._state.draft;
      const s = window._state;
      if (d && s) {
        const { t1dp, t2dp } = raDraftPicks(d);
        const bst = d.blueSideTeam || 'team1';
        const t1l = s.match.team1.tag || s.match.team1.name || 'Team 1';
        const t2l = s.match.team2.tag || s.match.team2.name || 'Team 2';
        buildRaDOM(container, d, t1dp, t2dp, t1l, t2l,
          bst === 'team1' ? 'Blue' : 'Red', bst === 'team1' ? 'Red' : 'Blue');
      }
    });
  });
}

// Returns team1/team2 draft picks arrays, accounting for banFirstTeam
function raDraftPicks(draft) {
  const picks     = draft.picks || Array(20).fill('');
  const bst       = draft.blueSideTeam || 'team1';
  const banFirst  = draft.banFirstTeam || 'blue';
  const firstSlot = banFirst === 'blue' ? bst : (bst === 'team1' ? 'team2' : 'team1');
  const fp  = BLUE_PICK_IDX.map(function(i) { return picks[i] || ''; }); // first-actor picks
  const sp  = RED_PICK_IDX.map(function(i)  { return picks[i] || ''; }); // second-actor picks
  return {
    t1dp: firstSlot === 'team1' ? fp : sp,
    t2dp: firstSlot === 'team1' ? sp : fp,
  };
}

function applyDraftRoles() {
  const d = window._state && window._state.draft;
  if (!d || d.phase !== 'complete') return;
  const { t1dp, t2dp } = raDraftPicks(d);

  const t1RolePicks = Array(5).fill('');
  const t2RolePicks = Array(5).fill('');
  _raState.t1.forEach(function(role, di) {
    const ri = role ? DRAFT_ROLES.indexOf(role) : -1;
    if (ri >= 0) t1RolePicks[ri] = t1dp[di] || '';
  });
  _raState.t2.forEach(function(role, di) {
    const ri = role ? DRAFT_ROLES.indexOf(role) : -1;
    if (ri >= 0) t2RolePicks[ri] = t2dp[di] || '';
  });

  api('/api/draft', {
    team1RolePicks: t1RolePicks, team2RolePicks: t2RolePicks,
    committedT1Picks: t1RolePicks, committedT2Picks: t2RolePicks,
  }).then(function() {
    const msg = g('role-assign-msg');
    if (msg) { msg.style.display = 'block'; msg.textContent = '✓ Roles applied — graphic and series tracker updated'; }
    setTimeout(function() { const m2 = g('role-assign-msg'); if (m2) m2.style.display = 'none'; }, 3000);
    // Auto-fetch champion stats for each player's drafted champion
    fetchDraftChampStats();
  });
}

async function fetchDraftChampStats() {
  const msg = g('role-assign-msg');
  try {
    const r = await fetch('/api/champstats/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!r.ok) return;
    const res = await r.json();
    if (msg && res.updated && res.updated.length) {
      msg.style.display = 'block';
      msg.textContent = '✓ Champ stats fetched: ' + res.updated.join(', ');
      setTimeout(function() { if (msg) msg.style.display = 'none'; }, 4000);
    }
  } catch(e) { /* non-critical, fail silently */ }
}

// ── Head to Head ───────────────────────────────────────────────────────────────
const H2H_STAT_TOKENS = [
  { key: 'winRate', label: 'Win Rate' },
  { key: 'games',   label: 'Games'    },
  { key: 'kda',     label: 'KDA'      },
  { key: 'cs',      label: 'CS/g'     },
  { key: 'kp',      label: 'KP%'      },
  { key: 'damage',  label: 'DMG/g'    },
  { key: 'vision',  label: 'Vision'   },
];
const H2H_ROLES = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];

function patchH2hChampStats(data) { api('/api/settings', { h2hChampStats: Object.assign({}, ((window._state||{}).settings||{}).h2hChampStats, data) }); }

function toggleH2hStatToken(role, token, enabled) {
  const cfg = JSON.parse(JSON.stringify(((window._state||{}).settings||{}).h2hChampStats || {}));
  const current = cfg[role] || [];
  cfg[role] = enabled ? [...new Set([...current, token])] : current.filter(function(t) { return t !== token; });
  api('/api/settings', { h2hChampStats: cfg });
}

function syncH2hChampStatsUI(cfg) {
  const el = g('h2h-champ-stats-enabled');
  if (el) el.checked = !!cfg.enabled;

  const grid = g('h2h-champ-stats-grid');
  if (!grid) return;
  if (grid.dataset.built) {
    // Just update checkbox states
    H2H_ROLES.forEach(function(role) {
      const active = cfg[role] || [];
      H2H_STAT_TOKENS.forEach(function(tok) {
        const cb = g('h2h-stat-' + role + '-' + tok.key);
        if (cb) cb.checked = active.indexOf(tok.key) !== -1;
      });
    });
    return;
  }
  grid.dataset.built = '1';

  // Header row
  var html = '<div style="display:grid;grid-template-columns:70px repeat('+H2H_STAT_TOKENS.length+',1fr);gap:4px;align-items:center;font-size:10px;color:var(--text-dim);font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px">';
  html += '<div></div>';
  H2H_STAT_TOKENS.forEach(function(tok) { html += '<div style="text-align:center">'+tok.label+'</div>'; });
  html += '</div>';

  H2H_ROLES.forEach(function(role) {
    const active = cfg[role] || [];
    html += '<div style="display:grid;grid-template-columns:70px repeat('+H2H_STAT_TOKENS.length+',1fr);gap:4px;align-items:center;margin-bottom:4px">';
    html += '<div style="font-size:11px;font-weight:700;color:var(--text-dim);letter-spacing:0.08em">'+role.toUpperCase()+'</div>';
    H2H_STAT_TOKENS.forEach(function(tok) {
      const checked = active.indexOf(tok.key) !== -1 ? 'checked' : '';
      html += '<div style="text-align:center"><input type="checkbox" id="h2h-stat-'+role+'-'+tok.key+'" '+checked+
        ' onchange="toggleH2hStatToken(\''+role+'\',\''+tok.key+'\',this.checked)"></div>';
    });
    html += '</div>';
  });

  grid.innerHTML = html;
}

function patchH2H(data) { api('/api/headToHead', data); }
function setH2HSpotlight(roleIdx) { patchH2H({ mode: 'spotlight', spotlightRole: roleIdx }); }
function setH2HAnimStyle(style) { patchH2H({ animStyle: style }); }
function setH2HLineup()           { patchH2H({ mode: 'lineup' }); }
function setH2HNext() {
  const h2h  = (window._state || {}).headToHead || {};
  const next = ((h2h.spotlightRole !== undefined ? h2h.spotlightRole : -1) + 1);
  if (next >= 5) setH2HLineup();
  else patchH2H({ mode: 'spotlight', spotlightRole: next });
}
function setH2HPrev() {
  const h2h  = (window._state || {}).headToHead || {};
  const prev = Math.max(0, (h2h.spotlightRole || 0) - 1);
  patchH2H({ mode: 'spotlight', spotlightRole: prev });
}

// ── Break / Win ────────────────────────────────────────────────────────────────
function patchBreak(data) { api('/api/breakScreen', data); }
function _calcTargetTimeMs(val) {
  if (!val) return null;
  var parts = val.split(':');
  var hh = parseInt(parts[0]) || 0, mm = parseInt(parts[1]) || 0;
  var t = new Date(); t.setHours(hh, mm, 0, 0);
  var diff = t.getTime() - Date.now();
  // Only roll to tomorrow if more than 5 minutes in the past (genuine next-day target).
  // If it just passed, return now so the graphic shows 00:00 rather than ~23:59:59.
  if (diff < -300000) t.setDate(t.getDate() + 1);
  else if (diff < 0) return Date.now();
  return t.getTime();
}
function setBreakTargetTime() {
  var ms = _calcTargetTimeMs((g('break-target-time') || {}).value);
  if (ms) api('/api/breakScreen', { timerEnd: ms });
}
function startBreakTimer() { const m=parseInt(g('break-timer-min').value)||0, s=parseInt(g('break-timer-sec').value)||0; api('/api/breakScreen',{timerEnd:Date.now()+(m*60+s)*1000}); }
function clearBreakTimer() { api('/api/breakScreen',{timerEnd:null}); }
function extendBreakTimer(mins) {
  const cur = window._state && window._state.breakScreen && window._state.breakScreen.timerEnd;
  const base = (cur && cur > Date.now()) ? cur : Date.now();
  api('/api/breakScreen', { timerEnd: base + mins * 60 * 1000 });
}
function lbarTogglePip() {
  const pip = !!(window._state && window._state.breakScreen && window._state.breakScreen.pipMode);
  api('/api/breakScreen', { pipMode: !pip });
}

// ── Pre-show ───────────────────────────────────────────────────────────────────
function patchPreShow(patch) { api('/api/preShow', patch); }
function setPreShowTargetTime() {
  var ms = _calcTargetTimeMs((g('ps-target-time') || {}).value);
  if (ms) patchPreShow({ timerEnd: ms });
}
function startPreShowTimer() {
  const m = parseInt(g('ps-timer-min').value) || 0;
  const s = parseInt(g('ps-timer-sec').value) || 0;
  const dur = (m * 60 + s) * 1000;
  if (dur <= 0) return;
  patchPreShow({ timerEnd: Date.now() + dur });
}
function clearPreShowTimer() { patchPreShow({ timerEnd: null }); }
function extendPreShowTimer(mins) {
  const cur = window._state && window._state.preShow && window._state.preShow.timerEnd;
  const base = (cur && cur > Date.now()) ? cur : Date.now();
  patchPreShow({ timerEnd: base + mins * 60 * 1000 });
}
function renderPreShowLogoPicker(ps, settings) {
  const grid = g('ps-logo-grid');
  if (!grid) return;
  const logos = ((settings && settings.logoSet && settings.logoSet.logos) || []);
  const selectedUrl = (ps && ps.logoUrl) || '';
  const tiles = [{ url: '', label: 'Auto' }].concat(
    logos.map(function(l) { return { url: l.url || '', label: l.name || '' }; })
  );
  grid.innerHTML = tiles.map(function(t) {
    const active = t.url === '' ? !selectedUrl : t.url === selectedUrl;
    return '<div class="draft-logo-tile' + (active ? ' is-active' : '') + '"' +
      ' data-logo-url="' + escHtml(t.url) + '"' +
      ' onclick="patchPreShow({logoUrl:this.dataset.logoUrl})">' +
      (t.url
        ? '<div class="draft-logo-tile-img" style="background-image:url(' + escHtml(t.url) + ')"></div>'
        : '<div class="draft-logo-tile-img"><span style="font-size:9px;font-family:\'Barlow Condensed\',sans-serif;color:var(--text-dim);letter-spacing:0.08em">AUTO</span></div>') +
      '<div class="draft-logo-tile-label">' + escHtml(t.label) + '</div>' +
      '</div>';
  }).join('');
}
function syncPreShowUI(ps, settings, todayGames, ticker) {
  // Layout buttons
  const _plc = g('ps-layout-center'), _pls = g('ps-layout-side');
  const _isSide = ps.layout === 'side';
  if (_plc) _plc.className = 'btn btn-sm ' + (_isSide ? 'btn-dim'     : 'btn-primary');
  if (_pls) _pls.className = 'btn btn-sm ' + (_isSide ? 'btn-primary' : 'btn-dim');
  // Logo controls
  const _showLogoChk = g('ps-show-logo');
  if (_showLogoChk) _showLogoChk.checked = !ps.hideLogo;
  const _scaleInp = g('ps-logo-scale'), _scaleVal = g('ps-logo-scale-val');
  const _scale = ps.logoScale || 8;
  if (_scaleInp) _scaleInp.value = _scale;
  if (_scaleVal) _scaleVal.textContent = _scale + 'vh';
  // Header text controls
  const _showTextChk = g('ps-show-header-text');
  if (_showTextChk) _showTextChk.checked = !ps.hideHeaderText;
  setInpSafe('ps-header-text',       ps.headerText  || '');
  setInpSafe('ps-timer-label-input', ps.timerLabel  || '');
  renderPreShowLogoPicker(ps, settings);
  const statusEl = g('ps-timer-status');
  if (statusEl) {
    if (ps.timerEnd && ps.timerEnd > Date.now()) {
      const rem = Math.max(0, ps.timerEnd - Date.now()) / 1000;
      const m = Math.floor(rem / 60), s = Math.floor(rem % 60);
      const target = new Date(ps.timerEnd);
      const hh = String(target.getHours()).padStart(2,'0');
      const mm = String(target.getMinutes()).padStart(2,'0');
      statusEl.textContent = 'Target ' + hh + ':' + mm + '  ·  ' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0') + ' remaining';
    } else if (ps.timerEnd) {
      statusEl.textContent = 'Timer finished';
    } else {
      statusEl.textContent = 'No timer set';
    }
  }
  // Ticker show/hide buttons
  const _tsb = g('ps-ticker-show-btn'), _thb = g('ps-ticker-hide-btn');
  const _tickerOn = !!(ticker && ticker.visible);
  if (_tsb) _tsb.className = 'btn ' + (_tickerOn ? 'btn-active-gfx' : 'btn-primary');
  if (_thb) _thb.className = 'btn ' + (_tickerOn ? 'btn-danger'     : 'btn-dim');

  const prevEl = g('ps-schedule-preview');
  if (prevEl) {
    if (!todayGames.length) {
      prevEl.textContent = 'No schedule loaded — go to Schedule tab and load a day.';
    } else {
      prevEl.innerHTML = todayGames.map(function(game) {
        const t1 = game.team1 || {}, t2 = game.team2 || {};
        const n1 = t1.name || t1.tag || '?', n2 = t2.name || t2.tag || '?';
        const badge = game.isCurrent
          ? ' <span style="color:var(--primary);font-size:11px">● CURRENT</span>'
          : (game.result && game.result.completed ? ' <span style="color:var(--text-dim);font-size:11px">✓ DONE</span>' : '');
        return '<div style="padding:3px 0">' + escHtml(n1) + ' vs ' + escHtml(n2) +
               ' <span style="color:var(--text-dim)">(' + escHtml(game.format||'') + ')</span>' + badge + '</div>';
      }).join('');
    }
  }
}

// ── Ticker ─────────────────────────────────────────────────────────────────────
function addTickerItem() {
  const items = JSON.parse(JSON.stringify(((window._state||{}).ticker||{}).items||[]));
  items.push({ text: '', url: '' });
  api('/api/ticker', { items });
}
function removeTickerItem(i) {
  const items = JSON.parse(JSON.stringify(((window._state||{}).ticker||{}).items||[]));
  items.splice(i, 1);
  api('/api/ticker', { items });
}
function patchTickerItem(i, key, val) {
  const items = JSON.parse(JSON.stringify(((window._state||{}).ticker||{}).items||[]));
  if (!items[i]) items[i] = { text: '', url: '' };
  items[i][key] = val;
  api('/api/ticker', { items });
}
function selectTickerLabelLogo(url) { api('/api/ticker', { labelLogoUrl: url }); }

function renderBreakCenterLogoPicker(settings) {
  const grid = g('break-center-logo-grid');
  if (!grid) return;
  const logos = ((settings && settings.logoSet && settings.logoSet.logos) || []);
  const selectedUrl = (settings && settings.breakCenterLogoUrl) || '';
  const tiles = [{ url: '', label: 'Auto' }].concat(
    logos.map(function(l) { return { url: l.url || '', label: l.name || '' }; })
  );
  grid.innerHTML = tiles.map(function(t) {
    const active = t.url === '' ? !selectedUrl : t.url === selectedUrl;
    return '<div class="draft-logo-tile' + (active ? ' is-active' : '') + '"' +
      ' data-logo-url="' + escHtml(t.url) + '"' +
      ' onclick="patchSettings({breakCenterLogoUrl:this.dataset.logoUrl})">' +
      (t.url
        ? '<div class="draft-logo-tile-img" style="background-image:url(' + escHtml(t.url) + ')"></div>'
        : '<div class="draft-logo-tile-img"><span style="font-size:9px;font-family:\'Barlow Condensed\',sans-serif;color:var(--text-dim);letter-spacing:0.08em">AUTO</span></div>') +
      '<div class="draft-logo-tile-label">' + escHtml(t.label) + '</div>' +
      '</div>';
  }).join('');
}
function renderBracketLogoPicker(state) {
  const grid = g('bracket-logo-grid'); if (!grid) return;
  const logos    = ((state.settings && state.settings.logoSet && state.settings.logoSet.logos) || []);
  const selected = (state.bracket && state.bracket.logoUrl) || '';
  const tiles    = [{ url: '', label: 'Auto' }].concat(logos.map(function(l) { return { url: l.url || '', label: l.name || '' }; }));
  grid.innerHTML = tiles.map(function(t) {
    const active = t.url === '' ? !selected : t.url === selected;
    return '<div class="draft-logo-tile' + (active ? ' is-active' : '') + '"' +
      ' data-logo-url="' + escHtml(t.url) + '"' +
      ' onclick="patchBracket({logoUrl:this.dataset.logoUrl})">' +
      (t.url
        ? '<div class="draft-logo-tile-img" style="background-image:url(' + escHtml(t.url) + ')"></div>'
        : '<div class="draft-logo-tile-img"><span style="font-size:9px;font-family:\'Barlow Condensed\',sans-serif;color:var(--text-dim);letter-spacing:0.08em">AUTO</span></div>') +
      '<div class="draft-logo-tile-label">' + escHtml(t.label) + '</div>' +
      '</div>';
  }).join('');
}

function renderH2HLogoPicker(settings) {
  const grid = g('h2h-logo-grid');
  if (!grid) return;
  const logos = ((settings && settings.logoSet && settings.logoSet.logos) || []);
  const selectedUrl = (settings && settings.h2hLogoUrl) || '';
  const tiles = [{ url: '', label: 'Auto' }].concat(
    logos.map(function(l) { return { url: l.url || '', label: l.name || '' }; })
  );
  grid.innerHTML = tiles.map(function(t) {
    const active = t.url === '' ? !selectedUrl : t.url === selectedUrl;
    return '<div class="draft-logo-tile' + (active ? ' is-active' : '') + '"' +
      ' data-logo-url="' + escHtml(t.url) + '"' +
      ' onclick="patchSettings({h2hLogoUrl:this.dataset.logoUrl})">' +
      (t.url
        ? '<div class="draft-logo-tile-img" style="background-image:url(' + escHtml(t.url) + ')"></div>'
        : '<div class="draft-logo-tile-img"><span style="font-size:9px;font-family:\'Barlow Condensed\',sans-serif;color:var(--text-dim);letter-spacing:0.08em">AUTO</span></div>') +
      '<div class="draft-logo-tile-label">' + escHtml(t.label) + '</div>' +
      '</div>';
  }).join('');
}

function setTickerLabelLogo() {
  const ticker = (window._state && window._state.ticker) || {};
  const logos  = ((window._state && window._state.settings && window._state.settings.logoSet && window._state.settings.logoSet.logos) || []);
  const payload = { labelMode: 'logo' };
  // Auto-select first logo if none already chosen
  if (!ticker.labelLogoUrl && logos.length) payload.labelLogoUrl = logos[0].url;
  api('/api/ticker', payload);
}

function renderTickerItems(ticker) {
  const list = g('ticker-items-list'); if (!list) return;
  const items = (ticker || {}).items || [];
  if (!items.length) { list.innerHTML = '<p class="hint">No items yet. Click + Add Item.</p>'; return; }
  list.innerHTML = items.map(function(item, i) {
    return '<div class="ticker-item-row">' +
      '<span class="ticker-item-num">' + (i + 1) + '</span>' +
      '<input type="text" class="ticker-item-text" value="' + escHtml(item.text || '') + '" placeholder="Ticker text…" onchange="patchTickerItem(' + i + ',\'text\',this.value)">' +
      '<button class="btn btn-sm btn-danger" onclick="removeTickerItem(' + i + ')">×</button>' +
      '</div>';
  }).join('');
}

function syncTickerUI(ticker, state) {
  // Ticker nav dot
  const _tickerDot = g('nav-dot-ticker');
  if (_tickerDot) _tickerDot.className = 'nav-status-dot' + (ticker.visible ? ' active' : '');

  const autoMode = !!ticker.autoMode;

  // Content mode radios
  document.querySelectorAll('input[name="ticker-content"]').forEach(function(r) { r.checked = (r.value === 'auto') === autoMode; });

  // Show auto preview or manual section
  const autoPreview   = g('ticker-auto-preview');
  const manualSection = g('ticker-manual-section');
  if (autoPreview)   autoPreview.style.display   = autoMode ? '' : 'none';
  if (manualSection) manualSection.style.display = autoMode ? 'none' : '';

  if (autoMode) {
    // Render read-only auto item preview
    const autoList = g('ticker-auto-items-list');
    if (autoList) {
      const autoItems = ticker.autoItems || [];
      autoList.innerHTML = autoItems.length
        ? autoItems.map(function(item, i) {
            return '<div class="ticker-item-row">' +
              '<span class="ticker-item-num">' + (i + 1) + '</span>' +
              '<span class="ticker-item-text" style="opacity:0.6;pointer-events:none">' + escHtml(item.text || '') + '</span>' +
              '</div>';
          }).join('')
        : '<p class="hint">No schedule loaded — load a game from Game Setup first.</p>';
    }
  } else {
    renderTickerItems(ticker);
  }

  // Label section
  const lmode = ticker.labelMode || 'text';
  document.querySelectorAll('input[name="ticker-label-mode"]').forEach(function(r) { r.checked = r.value === lmode; });
  const textRow = g('ticker-label-text-row');
  const logoRow = g('ticker-label-logo-row');
  if (textRow) textRow.style.display = lmode === 'text' ? '' : 'none';
  if (logoRow) logoRow.style.display = lmode === 'logo' ? '' : 'none';
  setInpSafe('ticker-label-text', ticker.labelText || 'NEWS');

  // Logo grid (for logo mode) — read directly from window._state so it's never stale
  const logoGrid = g('ticker-label-logo-grid');
  if (logoGrid) {
    const _settings = (window._state && window._state.settings) || {};
    const logoSet = _settings.logoSet || {};
    const logos = Array.isArray(logoSet) ? logoSet : (logoSet.logos || []);
    const selectedUrl = ticker.labelLogoUrl || '';
    logoGrid.innerHTML = logos.length
      ? logos.map(function(l) {
          const active = l.url === selectedUrl;
          return '<div class="draft-logo-tile' + (active ? ' is-active' : '') + '"' +
            ' data-logo-url="' + escHtml(l.url || '') + '"' +
            ' onclick="selectTickerLabelLogo(this.dataset.logoUrl)">' +
            '<div class="draft-logo-tile-img" style="background-image:url(' + escHtml(l.url || '') + ')"></div>' +
            '<div class="draft-logo-tile-label">' + escHtml(l.name || '') + '</div>' +
            '</div>';
        }).join('')
      : '<p class="hint" style="margin:0">No logos yet — add them in <a onclick="switchToTab(\'theme\')" style="color:var(--primary);cursor:pointer;text-decoration:underline">Broadcast Theme</a>.</p>';
  }
}
function patchWin(data) { api('/api/winScreen', data); }

function syncWinTab(ws, match) {
  // Team name labels
  const t1 = match.team1 || {}, t2 = match.team2 || {};
  const t1label = t1.tag || t1.name || 'Team 1';
  const t2label = t2.tag || t2.name || 'Team 2';
  setText('win-t1-label', t1label);
  setText('win-t2-label', t2label);

  // Winning team radio
  ['team1','team2'].forEach(v => {
    const r = document.querySelector('input[name="win-team"][value="' + v + '"]');
    if (r) r.checked = ws.team === v;
  });

  // Message
  setInpSafe('win-msg', ws.message || '');

  // Animation style radios — migrate legacy 'surge' → 'burst'
  const style = (ws.style === 'surge' ? 'burst' : ws.style) || 'blade';
  ['blade','burst','slam','split','spotlight','wipe'].forEach(v => {
    const r = document.querySelector('input[name="win-style"][value="' + v + '"]');
    if (r) r.checked = style === v;
  });

  // Auto-status hint
  const statusEl = g('win-auto-status');
  if (statusEl) {
    const winner = ws.team === 'team1' ? t1label : t2label;
    const score  = ws.seriesScore || '';
    statusEl.textContent = ws.message
      ? winner + ' · ' + ws.message + (score ? ' (' + score + ')' : '') + ' — auto-populated from game result'
      : 'Auto-populated from last game result.';
  }
}

// ── Group Stage GFX ────────────────────────────────────────────────────────────
function patchGroupStage(data) { api('/api/groupStage', data); }

function renderGroupsLogoPicker(state) {
  const grid = g('groups-logo-grid'); if (!grid) return;
  const logos    = ((state.settings && state.settings.logoSet && state.settings.logoSet.logos) || []);
  const selected = (state.groupStage && state.groupStage.logoUrl) || '';
  const tiles    = [{ url: '', label: 'Auto' }].concat(logos.map(function(l) { return { url: l.url || '', label: l.name || '' }; }));
  grid.innerHTML = tiles.map(function(t) {
    const active = t.url === '' ? !selected : t.url === selected;
    return '<div class="draft-logo-tile' + (active ? ' is-active' : '') + '"' +
      ' data-logo-url="' + escHtml(t.url) + '"' +
      ' onclick="patchGroupStage({logoUrl:this.dataset.logoUrl})">' +
      (t.url
        ? '<div class="draft-logo-tile-img" style="background-image:url(' + escHtml(t.url) + ')"></div>'
        : '<div class="draft-logo-tile-img"><span style="font-size:9px;font-family:\'Barlow Condensed\',sans-serif;color:var(--text-dim);letter-spacing:0.08em">AUTO</span></div>') +
      '<div class="draft-logo-tile-label">' + escHtml(t.label) + '</div>' +
      '</div>';
  }).join('');
}

function syncGroupStageGfxUI(state) {
  const gs = state.groupStage || {};
  const scale = gs.logoScale != null ? gs.logoScale : 7;
  setInp('groups-logo-scale', scale);
  setText('groups-logo-scale-val', scale + 'vh');
  const pos = gs.logoPosition || 'left';
  ['left', 'center'].forEach(function(v) {
    const b = g('groups-logo-pos-' + v);
    if (b) b.classList.toggle('btn-active', pos === v);
  });
  const mode = gs.mode || 'live';
  const liveBtn  = g('groups-mode-live');
  const finalBtn = g('groups-mode-final');
  if (liveBtn)  liveBtn.classList.toggle('btn-active', mode === 'live');
  if (finalBtn) finalBtn.classList.toggle('btn-active', mode === 'final');
  const gsl = !!gs.showLogo;
  const gOn = g('groups-logo-show-on'), gOff = g('groups-logo-show-off');
  if (gOn)  gOn.classList.toggle('btn-active', gsl);
  if (gOff) gOff.classList.toggle('btn-active', !gsl);
  renderGroupsLogoPicker(state);
}

// ── Tournament Structure GFX ───────────────────────────────────────────────────
function patchTournamentStructureGfx(data) { api('/api/tournamentStructure', data); }

function syncTournamentStructureGfxUI(state) {
  const ts = state.tournamentStructure || {};
  const t  = state.tournament || {};

  // Logo
  const scale = ts.logoScale != null ? ts.logoScale : 7;
  setInp('ts-gfx-logo-scale', scale);
  setText('ts-gfx-logo-scale-val', scale + 'vh');
  const pos = ts.logoPosition || 'left';
  ['left', 'center'].forEach(function(v) {
    const b = g('ts-gfx-logo-pos-' + v);
    if (b) b.classList.toggle('btn-active', pos === v);
  });

  const align = ts.infoBarAlign || 'left';
  ['left', 'center'].forEach(function(v) {
    const b = g('ts-gfx-align-' + v);
    if (b) b.classList.toggle('btn-active', align === v);
  });

  const dfmtEl = g('ts-gfx-date-fmt');
  if (dfmtEl) dfmtEl.value = ts.dateFormat || 'mond';

  const yrOn = g('ts-gfx-year-on'), yrOff = g('ts-gfx-year-off');
  if (yrOn)  yrOn.classList.toggle('btn-active',  !!ts.showYear);
  if (yrOff) yrOff.classList.toggle('btn-active', !ts.showYear);
  const sl = !!ts.showLogo;
  const on = g('ts-gfx-logo-on'), off = g('ts-gfx-logo-off');
  if (on)  on.classList.toggle('btn-active', sl);
  if (off) off.classList.toggle('btn-active', !sl);

  // Display title
  setInp('ts-gfx-display-title', ts.displayTitle || '');
  const st = !!ts.showTitle;
  const ston = g('ts-gfx-title-on'), stoff = g('ts-gfx-title-off');
  if (ston)  ston.classList.toggle('btn-active', st);
  if (stoff) stoff.classList.toggle('btn-active', !st);

  // Content visibility toggles (On/Off button pairs, values from state.tournament)
  var togBtn = function(baseId, active) {
    var on  = g(baseId + '-on'),  off = g(baseId + '-off');
    if (on)  on.classList.toggle('btn-active', !!active);
    if (off) off.classList.toggle('btn-active', !active);
  };
  togBtn('ts-gfx-dates',      t.showDates);
  togBtn('ts-gfx-region',     t.showRegion);
  togBtn('ts-gfx-patch',      t.showPatch);
  togBtn('ts-gfx-tiebreaker', t.showTiebreaker);
  const tbRow = g('ts-gfx-tiebreaker-row');
  if (tbRow) tbRow.style.display = t.hasGroupStage ? '' : 'none';
  togBtn('ts-gfx-tech',       t.showLocation);

  // Tournament Setup fields (data entry, lives in that tab)
  setInp('ts-players-per-team', t.playersPerTeam != null ? t.playersPerTeam : 5);
  setInp('ts-max-subs',         t.maxSubsPerTeam != null ? t.maxSubsPerTeam : 0);
  setInp('ts-start-date',   t.startDate    || '');
  setInp('ts-end-date',     t.endDate      || '');
  setInp('ts-region',       t.region       || '');
  setInp('ts-patch-version', t.patchVersion || '');
  setInp('ts-tiebreaker',   t.tiebreaker   || '');
  setInp('ts-technology',   t.location     || '');
  const chk = function(id, val) { const el = g(id); if (el) el.checked = !!val; };
  chk('ts-has-prizepool', t.hasPrizepool);
}

// ── Bracket match label helpers ────────────────────────────────────────────────
function _isLowerRound(round) {
  var rl = (round.label || '').toUpperCase().trim();
  return rl.indexOf('LB ') === 0 || rl.indexOf('LOWER') === 0;
}

// Mirrors the auto-normalisation in renderDouble (bracket.js): renames the
// penultimate LB round to "LB Semifinals" so dropdowns stay in sync with the graphic.
function _normalizeRoundLabel(round) {
  var label = round.label || '';
  if (_isLowerRound(round) && label.toLowerCase().indexOf('semi') === -1) {
    var lbRounds = (bracketRounds || []).filter(function(r) { return _isLowerRound(r); });
    if (lbRounds.indexOf(round) === lbRounds.length - 2) return 'LB Semifinals';
  }
  return label;
}

// Returns a human label for a bracket match: "UB Semifinals Match 2", "LB Final", etc.
function getBracketMatchLabel(ri, mi) {
  const round = (bracketRounds || [])[ri];
  if (!round) return 'Match ' + (mi + 1);
  const label = _normalizeRoundLabel(round) || ('Round ' + (ri + 1));
  return (round.matches || []).length === 1 ? label : label + ' Match ' + (mi + 1);
}

// Returns options for the "insert bracket reference" selects in schedule forms.
function getBracketRefOptions() {
  const opts = [];
  (bracketRounds || []).forEach(function(round, ri) {
    const isLower = _isLowerRound(round);
    (round.matches || []).forEach(function(match, mi) {
      const label = getBracketMatchLabel(ri, mi);
      opts.push('Winner of ' + label);
      if (!isLower) opts.push('Loser of ' + label);
    });
  });
  return opts;
}

// Renders a small "Insert bracket ref…" select that populates the target input.
function bracketRefSelectHtml(targetId) {
  const opts = getBracketRefOptions();
  if (!opts.length) return '';
  return '<select class="bracket-ref-sel" onchange="if(this.value){var t=g(\'' + targetId + '\');if(t)t.value=this.value;this.selectedIndex=0}">' +
    '<option value="">↗ Bracket ref…</option>' +
    opts.map(function(o) { return '<option value="' + escHtml(o) + '">' + escHtml(o) + '</option>'; }).join('') +
    '</select>';
}

// ── Bracket ────────────────────────────────────────────────────────────────────
function patchBracket(data) { api('/api/bracket', data); }
function syncBracket() { api('/api/bracket', { rounds: bracketRounds }); }
function addBracketRound() {
  bracketRounds.push({ label:'Round '+(bracketRounds.length+1), matches:[{team1:{name:'',score:0},team2:{name:'',score:0},complete:false}] });
  renderBracketEditor(); syncBracket();
}
function addBracketMatch(ri) {
  if (!bracketRounds[ri]) return;
  bracketRounds[ri].matches.push({team1:{name:'',score:0},team2:{name:'',score:0},complete:false});
  renderBracketEditor(); syncBracket();
}
function removeBracketMatch(ri, mi) {
  if (!bracketRounds[ri]) return;
  bracketRounds[ri].matches.splice(mi, 1);
  renderBracketEditor(); syncBracket();
}
function removeBracketRound(ri) { bracketRounds.splice(ri,1); renderBracketEditor(); syncBracket(); }

// Build a team <select> for bracket slots — options from teams DB + bracket progression refs
function bracketTeamSelect(ri, mi, side, currentName) {
  const teams = window._bracketTeams || [];
  let opts = '<option value="">— TBD —</option>';
  opts += teams.map(t => '<option value="'+esc(t.name)+'"'+(t.name===currentName?' selected':'')+'>'+esc(t.name)+'</option>').join('');

  // Bracket progression references — all other matches as Winner/Loser options
  // LB losers are eliminated so we never offer "Loser of LB X" as a feed slot
  const refs = [];
  (bracketRounds || []).forEach(function(round, ri2) {
    const isLower = _isLowerRound(round);
    (round.matches || []).forEach(function(match, mi2) {
      if (ri2 === ri && mi2 === mi) return; // skip self
      const label = getBracketMatchLabel(ri2, mi2);
      refs.push({ val: 'Winner of ' + label });
      if (!isLower) refs.push({ val: 'Loser of ' + label });
    });
  });
  if (refs.length) {
    opts += '<optgroup label="Bracket references">' +
      refs.map(function(r) {
        return '<option value="'+esc(r.val)+'"'+(r.val===currentName?' selected':'')+'>'+esc(r.val)+'</option>';
      }).join('') + '</optgroup>';
  }

  // If currentName isn't matched anywhere, keep it as a selected free-text option
  const knownVals = teams.map(t => t.name).concat(refs.map(r => r.val)).concat(['']);
  if (currentName && !knownVals.includes(currentName)) {
    opts += '<option value="'+esc(currentName)+'" selected>'+esc(currentName)+'</option>';
  }

  return '<select class="br-'+side+'name-sel" data-ri="'+ri+'" data-mi="'+mi+'" data-side="'+side+'">'+opts+'</select>';
}

function renderBracketEditor() {
  const container = g('bracket-rounds'); if (!container) return;
  const isDouble  = bracketType === 'double';

  const TRACK_LABELS = { upper: 'Upper', lower: 'Lower', final: 'Final' };
  const TRACK_COLORS = { upper: '#4ab7ff', lower: '#ff9f4a', final: 'var(--primary)' };

  const roundsHtml = bracketRounds.map(function(round, ri) {
    const matchesHtml = round.matches.map(function(match, mi) {
      const done  = !!match.complete;
      const t1s   = (match.team1 && match.team1.score != null) ? match.team1.score : '';
      const t2s   = (match.team2 && match.team2.score != null) ? match.team2.score : '';
      const t1n   = (match.team1 && match.team1.name && match.team1.name !== 'TBD') ? match.team1.name : 'TBD';
      const t2n   = (match.team2 && match.team2.name && match.team2.name !== 'TBD') ? match.team2.name : 'TBD';

      if (_playoffsEditMode) {
        return '<div class="bracket-match' + (done ? ' br-match-done' : '') + '">' +
          '<span class="br-match-label">' + escHtml(getBracketMatchLabel(ri, mi)) + '</span>' +
          bracketTeamSelect(ri, mi, 't1', match.team1 && match.team1.name) +
          '<input type="number" class="br-t1score score-in" data-ri="'+ri+'" data-mi="'+mi+'" placeholder="S" min="0" value="'+t1s+'">' +
          '<span style="color:var(--accent);font-weight:700;padding:0 6px">vs</span>' +
          bracketTeamSelect(ri, mi, 't2', match.team2 && match.team2.name) +
          '<input type="number" class="br-t2score score-in" data-ri="'+ri+'" data-mi="'+mi+'" placeholder="S" min="0" value="'+t2s+'">' +
          '<button class="br-remove-match" onclick="removeBracketMatch('+ri+','+mi+')" title="Remove this match">×</button>' +
          '</div>';
      } else {
        const t1win = done && Number(t1s) > Number(t2s);
        const t2win = done && Number(t2s) > Number(t1s);
        return '<div class="br-view-match' + (done ? ' br-view-done-row' : '') + '">' +
          '<span class="br-match-label">' + escHtml(getBracketMatchLabel(ri, mi)) + '</span>' +
          '<span class="br-view-team' + (t1win ? ' br-view-winner' : '') + '">' + escHtml(t1n) + '</span>' +
          '<span class="br-view-score">' + (t1s !== '' ? t1s : '–') + '</span>' +
          '<span class="br-view-sep">–</span>' +
          '<span class="br-view-score">' + (t2s !== '' ? t2s : '–') + '</span>' +
          '<span class="br-view-team br-view-team-r' + (t2win ? ' br-view-winner' : '') + '">' + escHtml(t2n) + '</span>' +
          (done ? '<span class="br-view-complete">✓</span>' : '') +
          '</div>';
      }
    }).join('');

    // Track badge (read-only, shown in double-elim mode)
    const track      = round.track || '';
    const trackBadge = (isDouble && track)
      ? '<span class="br-track-badge" style="color:' + (TRACK_COLORS[track] || '#aaa') + '">' + (TRACK_LABELS[track] || track) + '</span>'
      : '';

    return '<div class="bracket-round">' +
      '<div class="bracket-round-header">' +
        (_playoffsEditMode
          ? '<input type="text" class="br-label" data-ri="'+ri+'" value="'+esc(round.label||'')+'" style="flex:1;font-weight:700" placeholder="Round name">'
          : '<span class="br-round-label-view">' + escHtml(round.label || ('Round ' + (ri + 1))) + '</span>'
        ) +
        trackBadge +
        (_playoffsEditMode ? '<button class="btn btn-sm btn-danger" onclick="removeBracketRound('+ri+')" style="margin-left:auto">Remove</button>' : '') +
      '</div>' +
      matchesHtml +
      (_playoffsEditMode ? '<button class="btn btn-sm" style="margin-top:6px" onclick="addBracketMatch('+ri+')">+ Add Match</button>' : '') +
      '</div>';
  }).join('');

  container.innerHTML = roundsHtml;
  container.oninput  = _playoffsEditMode ? handleBracketInput : null;
  container.onchange = _playoffsEditMode ? handleBracketInput : null;
}

function handleBracketInput(e) {
  const t = e.target;
  const ri = parseInt(t.dataset.ri);
  const mi = parseInt(t.dataset.mi);
  if (isNaN(ri)||!bracketRounds[ri]) return;
  if (t.classList.contains('br-label')) { bracketRounds[ri].label = t.value; }
  else if (!isNaN(mi) && bracketRounds[ri].matches[mi]) {
    const match = bracketRounds[ri].matches[mi];
    if (t.classList.contains('br-t1name-sel')) match.team1.name  = t.value;
    if (t.classList.contains('br-t1score'))    match.team1.score = parseInt(t.value)||0;
    if (t.classList.contains('br-t2name-sel')) match.team2.name  = t.value;
    if (t.classList.contains('br-t2score'))    match.team2.score = parseInt(t.value)||0;
  }
  syncBracket();
}


// Load teams into bracket selects cache then re-render
async function refreshBracketTeams() {
  const res = await fetch('/api/teams').then(r=>r.json()).catch(()=>({teams:[]}));
  window._bracketTeams = res.teams || [];
}

// ── Players + Subs ─────────────────────────────────────────────────────────────
function renderPlayerEditors(players) {
  ['team1','team2'].forEach(function(team) {
    const prefix = team==='team1'?'t1':'t2';
    const container = g(prefix+'-roster'); if (!container) return;
    const list    = players[team] || [];
    const subList = players[team+'subs'] || [];

    // ── Build DOM structure once only ──
    if (!container.dataset.built) {
      container.dataset.built = '1';

      let html = '<div class="roster-section-label">STARTING LINEUP</div>';
      html += list.map(function(p, i) {
        return '<div class="player-row-edit">' +
          '<div><div class="player-num">'+DEFAULT_ROLES[i]+'</div>' +
            '<div style="display:flex;align-items:center;gap:5px">' +
              '<input type="text" data-team="'+team+'" data-index="'+i+'" data-field="handle" placeholder="Handle / IGN" style="flex:1;min-width:0">' +
              '<a class="opgg-link" data-team="'+team+'" data-index="'+i+'" href="#" target="_blank" rel="noopener" style="display:none">op.gg ↗</a>' +
            '</div>' +
          '</div>' +
          '<div><div class="player-num">Role</div>' +
            '<input type="text" data-team="'+team+'" data-index="'+i+'" data-field="role" placeholder="Role"></div>' +
          '<div><div class="player-num">Swap Sub</div>' +
            '<select class="sub-swap-sel" data-team="'+team+'" data-player-index="'+i+'" title="Swap with sub">' +
              '<option value="">—</option>' +
            '</select>' +
          '</div>' +
          '</div>';
      }).join('');

      html += '<div class="roster-section-label" style="margin-top:14px">SUBSTITUTES</div>';
      html += subList.map(function(s, i) {
        return '<div class="player-row-edit sub-row">' +
          '<div><div class="player-num">Sub '+(i+1)+'</div>' +
            '<input type="text" data-team="'+team+'" data-subindex="'+i+'" data-field="handle" placeholder="Handle / IGN"></div>' +
          '<div><div class="player-num">Role</div>' +
            '<input type="text" data-team="'+team+'" data-subindex="'+i+'" data-field="role" placeholder="Role"></div>' +
          '<div></div>' +
          '</div>';
      }).join('');

      container.innerHTML = html;

      // Input handler
      container.addEventListener('input', function(e) {
        const inp = e.target; if (inp.tagName !== 'INPUT') return;
        if (inp.dataset.subindex !== undefined) {
          api('/api/subs', { team, index: parseInt(inp.dataset.subindex), data: { [inp.dataset.field]: inp.value } });
        } else if (inp.dataset.index !== undefined) {
          api('/api/players', { team, index: parseInt(inp.dataset.index), data: { [inp.dataset.field]: inp.value } });
        }
      });

      // Swap select handler — reads current list/subList from state at time of change
      container.addEventListener('change', function(e) {
        const sel = e.target;
        if (!sel.classList.contains('sub-swap-sel')) return;
        const playerIndex = parseInt(sel.dataset.playerIndex);
        const subIndex    = parseInt(sel.value);
        if (isNaN(subIndex)) return;
        const currentList    = (window._state && window._state.players && window._state.players[team]) || [];
        const currentSubList = (window._state && window._state.players && window._state.players[team+'subs']) || [];
        const pName = (currentList[playerIndex]    && (currentList[playerIndex].handle    || currentList[playerIndex].name))    || ('Player '+(playerIndex+1));
        const sName = (currentSubList[subIndex]    && (currentSubList[subIndex].handle    || currentSubList[subIndex].name))    || ('Sub '+(subIndex+1));
        if (confirm('Swap ' + pName + ' with ' + sName + '?')) {
          api('/api/players/swap', { team, playerIndex, subIndex });
        }
        sel.value = '';
      });
    } // end if !container.dataset.built

    // Update values every state tick — skip focused inputs to preserve typing
    container.querySelectorAll('input').forEach(function(inp) {
      if (document.activeElement === inp) return;
      if (inp.dataset.subindex !== undefined) {
        const s = subList[inp.dataset.subindex];
        if (s) inp.value = s[inp.dataset.field] || '';
      } else if (inp.dataset.index !== undefined) {
        const p = list[inp.dataset.index];
        if (p) inp.value = p[inp.dataset.field] || '';
      }
    });

    // Update op.gg profile links
    container.querySelectorAll('.opgg-link').forEach(function(link) {
      const p = list[parseInt(link.dataset.index)];
      const url = p ? opggUrl(p.opggRegion, p.riotId) : '';
      if (url) { link.href = url; link.style.display = ''; }
      else      { link.href = '#'; link.style.display = 'none'; }
    });

    // Refresh swap dropdown options with current sub names
    container.querySelectorAll('.sub-swap-sel').forEach(function(sel) {
      sel.innerHTML = '<option value="">Swap sub...</option>' +
        subList.map(function(s, si) {
          return (s.handle || s.name)
            ? '<option value="' + si + '">⇕ ' + (s.handle || s.name).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</option>'
            : '';
        }).join('');
    });

  });
}

function updatePlayer(team, index, field, value) { api('/api/players', { team, index, data: { [field]: value } }); }

// ── Match Intel Panel ──────────────────────────────────────────────────────────
var _intelExpanded = {}; // key → true, persists across rebuilds

function _intelWrClass(pct)  { return pct >= 60 ? 'it-wr-high' : pct >= 50 ? 'it-wr-mid' : 'it-wr-low'; }
function _intelWrColor(pct)  { return pct >= 60 ? '#4dcc90'    : pct >= 50 ? '#f0cc44'    : '#f07070';   }

function toggleIntelPlayer(key) {
  var card = document.querySelector('[data-intel-key="' + key + '"]');
  if (!card) return;
  var isExpanded = card.classList.toggle('expanded');
  _intelExpanded[key] = isExpanded;
}

function _intelRankSummaryHtml(rank) {
  if (!rank || !rank.tier) return '<span class="intel-no-rank">Unranked</span>';
  const tier   = rank.tier;
  const noDiv  = tier === 'MASTER' || tier === 'GRANDMASTER' || tier === 'CHALLENGER';
  const divStr = (!noDiv && rank.division && rank.division !== 'I') ? ' ' + rank.division : '';
  const total  = (rank.wins || 0) + (rank.losses || 0);
  const wr     = total ? Math.round(rank.wins / total * 100) : 0;
  return '<span class="intel-tier it-' + escHtml(tier) + '">' + escHtml(tier) + escHtml(divStr) + '</span>' +
         '<span class="intel-lp">' + (rank.lp || 0) + ' LP</span>' +
         '<span class="intel-record">' + (rank.wins || 0) + 'W&nbsp;/&nbsp;' + (rank.losses || 0) + 'L</span>' +
         '<span class="intel-wr ' + _intelWrClass(wr) + '">' + wr + '%</span>';
}

function _intelChampsHtml(pool) {
  if (!pool || !pool.length) return '<span class="intel-no-data">No champion data fetched</span>';
  const rows = pool.slice(0, 7).map(function(c) {
    const wr = Math.round(c.wins / c.games * 100);
    return '<tr>' +
      '<td class="col-name">' + escHtml(c.name) + '</td>' +
      '<td class="col-games">' + c.games + '</td>' +
      '<td class="col-bar"><div class="intel-wr-bar"><div class="intel-wr-fill" style="width:' + wr + '%;background:' + _intelWrColor(wr) + '"></div></div></td>' +
      '<td class="col-wr ' + _intelWrClass(wr) + '">' + wr + '%</td>' +
    '</tr>';
  }).join('');
  return '<table class="intel-champ-table">' +
    '<thead class="intel-champ-thead"><tr>' +
      '<th class="col-name icht-left">Champion Pool</th>' +
      '<th class="col-games icht-center">Games</th>' +
      '<th class="col-bar icht-center" colspan="2">Win Rate</th>' +
    '</tr></thead>' +
    '<tbody class="intel-champ-tbody">' + rows + '</tbody>' +
  '</table>';
}

function _intelDraftKv(label, value, cls) {
  return '<div><div class="intel-draft-kv-label">' + label + '</div>' +
    '<div class="intel-draft-kv-value' + (cls ? ' ' + cls : '') + '">' + value + '</div></div>';
}

function _intelDraftHtml(ds) {
  if (!ds) return '<div class="intel-draft-section"><span class="intel-draft-no-data">No draft data</span></div>';
  const kda = ds.kda ? escHtml(ds.kda.k) + '/' + escHtml(ds.kda.d) + '/' + escHtml(ds.kda.a) : '—';
  return '<div class="intel-draft-section">' +
    '<div class="intel-section-label">Draft Pick</div>' +
    '<div class="intel-draft-champ-name">' + escHtml(ds.champ) + '</div>' +
    '<div class="intel-draft-kv-list">' +
      _intelDraftKv('Win Rate',  escHtml(String(ds.winRate)) + '%', _intelWrClass(ds.winRate)) +
      _intelDraftKv('K / D / A', kda) +
      _intelDraftKv('Games',     escHtml(String(ds.games))) +
      _intelDraftKv('CS / Game', escHtml(String(ds.cs))) +
    '</div>' +
  '</div>';
}

function _intelPlayerCard(p, cardKey) {
  const isExpanded = !!_intelExpanded[cardKey];
  const riotId     = p.riotId ? escHtml(p.riotId) + ' &nbsp;·&nbsp; ' + escHtml((p.opggRegion || '').toUpperCase()) : '';
  const hasDraft   = !!p.draftChampStats;

  const header = '<div class="intel-player-header">' +
    '<span class="intel-role">' + escHtml(p.role || '') + '</span>' +
    '<span class="intel-handle">' + escHtml(p.handle || '—') + '</span>' +
    '<div class="intel-rank-summary">' + _intelRankSummaryHtml(p.rank || null) + '</div>' +
    '<span class="intel-toggle">▼</span>' +
  '</div>';

  const body = '<div class="intel-player-body">' +
    '<div class="intel-body-left">' +
      (riotId ? '<div class="intel-riot-id">' + riotId + '</div>' : '') +
      _intelChampsHtml(p.champPool || null) +
    '</div>' +
    (hasDraft ? '<div class="intel-body-right">' + _intelDraftHtml(p.draftChampStats) + '</div>' : '') +
  '</div>';

  return '<div class="intel-player-card' + (isExpanded ? ' expanded' : '') + '" data-intel-key="' + escHtml(cardKey) + '" onclick="toggleIntelPlayer(\'' + cardKey + '\')">' +
    header + body +
  '</div>';
}

function _intelTeamCol(team, players, teamKey) {
  const logoHtml = team.logo ? '<img class="intel-team-logo" src="' + escHtml(team.logo) + '" alt="">' : '<div class="intel-team-logo"></div>';
  const border   = escHtml(team.color || '#1ffaff');
  const cards    = (players || []).map(function(p, i) { return _intelPlayerCard(p, teamKey + '_' + i); }).join('');
  return '<div class="intel-team-col">' +
    '<div class="intel-team-header" style="border-left:3px solid ' + border + '">' +
      logoHtml +
      '<div><div class="intel-team-name">' + escHtml(team.name || 'Team') + '</div>' +
           '<div class="intel-team-tag">' + escHtml(team.tag || '') + '</div></div>' +
    '</div>' +
    cards +
  '</div>';
}

function renderIntelPanel(state) {
  const grid = g('intel-grid');
  if (!grid) return;
  const match   = state.match   || {};
  const players = state.players || {};
  const makeKey = function(pl) {
    return (pl || []).map(function(p) {
      return (p.handle || '') + '|' + ((p.rank && p.rank.tier) || '') + '|' + ((p.rank && p.rank.lp) || '') + '|' + ((p.champPool || []).length) + '|' + (p.draftChampStats ? p.draftChampStats.champ : '');
    }).join(';');
  };
  const key = ((match.team1 && match.team1.name) || '') + '|' + ((match.team2 && match.team2.name) || '') + '||' + makeKey(players.team1) + '|' + makeKey(players.team2);
  if (grid.dataset.key === key) return;
  grid.dataset.key = key;
  grid.innerHTML = _intelTeamCol(match.team1 || {}, players.team1 || [], 'team1') + _intelTeamCol(match.team2 || {}, players.team2 || [], 'team2');
}

async function refreshChampPool() {
  const btns = Array.from(document.querySelectorAll('[onclick="refreshChampPool()"]'));
  const statEls = [g('ranks-status'), g('intel-status')].filter(Boolean);
  btns.forEach(function(b) { b._origText = b.textContent; b.disabled = true; b.textContent = '↻ Fetching…'; });
  statEls.forEach(function(el) { el.textContent = 'Contacting op.gg…'; });
  try {
    const r = await fetch('/api/champpool/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (!r.ok) { statEls.forEach(function(el) { el.textContent = 'Server error ' + r.status + ' — try restarting the server.'; }); return; }
    const res = await r.json();
    const msg = (res && res.ok)
      ? (res.updated.length ? '✓ Champ pools: ' + res.updated.join(', ') + (res.errors.length ? ' — Errors: ' + res.errors.join(', ') : '') : (res.errors.length ? 'Errors: ' + res.errors.join(', ') : 'No players with Riot ID found.'))
      : 'Error: ' + ((res && res.error) || JSON.stringify(res));
    statEls.forEach(function(el) { el.textContent = msg; });
  } catch(e) {
    statEls.forEach(function(el) { el.textContent = 'Request failed: ' + e.message; });
  }
  btns.forEach(function(b) { b.disabled = false; b.textContent = b._origText || '↻ Champ Pools'; });
}

async function refreshRanks() {
  const btns = Array.from(document.querySelectorAll('[onclick="refreshRanks()"]'));
  const statEls = [g('ranks-status'), g('intel-status')].filter(Boolean);
  btns.forEach(function(b) { b._origText = b.textContent; b.disabled = true; b.textContent = '↻ Fetching…'; });
  statEls.forEach(function(el) { el.textContent = 'Contacting Riot API…'; });
  try {
    const res = await api('/api/ranks/refresh', {});
    const msg = (res && res.ok)
      ? (res.updated.length ? '✓ Ranks: ' + res.updated.join(', ') + (res.errors.length ? ' — Errors: ' + res.errors.join(', ') : '') : (res.errors.length ? 'Errors: ' + res.errors.join(', ') : 'No players with Riot ID found.'))
      : 'Error: ' + ((res && res.error) || 'Unknown error');
    statEls.forEach(function(el) { el.textContent = msg; });
  } catch(e) {
    statEls.forEach(function(el) { el.textContent = 'Request failed.'; });
  }
  btns.forEach(function(b) { b.disabled = false; b.textContent = b._origText || '↻ Ranks'; });
}

// ── Sponsors ───────────────────────────────────────────────────────────────────
function renderSponsors(logos) {
  const el = g('sponsor-list'); if (!el) return;
  el.innerHTML = logos.map(function(url, i) {
    return '<div class="sponsor-chip"><img src="'+url+'" alt=""><button onclick="removeSponsor('+i+')" title="Remove">✕</button></div>';
  }).join('');
}
function addSponsor() { triggerUpload('sponsor-file', function(url) { const logos=((window._state&&window._state.match&&window._state.match.sponsorLogos)||[]).concat([url]); api('/api/match',{sponsorLogos:logos}); }); }
function removeSponsor(i) { const logos=((window._state&&window._state.match&&window._state.match.sponsorLogos)||[]).slice(); logos.splice(i,1); api('/api/match',{sponsorLogos:logos}); }

// ── Upload ─────────────────────────────────────────────────────────────────────
function triggerUpload(inputId, callback) {
  const inp = g(inputId); if (!inp) return;
  inp.onchange = async function() {
    const file = inp.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    try { const res = await fetch('/api/upload',{method:'POST',body:fd}); const data = await res.json(); if (data.url) callback(data.url); }
    catch(e) { console.error('Upload error',e); }
    inp.value = '';
  };
  inp.click();
}

// ── Import ─────────────────────────────────────────────────────────────────────
async function importGSheets() {
  const sheetId=(g('gsheets-id').value||'').trim(), apiKey=(g('gsheets-key').value||'').trim(), range=(g('gsheets-range').value||'Sheet1').trim();
  if (!sheetId||!apiKey) return showImportResult('gsheets-result','Sheet ID and API Key required.',true);
  showImportResult('gsheets-result','Importing…',false);
  const res = await api('/api/import/gsheets',{sheetId,apiKey,range});
  if (!res||res.error) return showImportResult('gsheets-result','Error: '+(res&&res.error?res.error:'unknown'),true);
  const stats = await importBuildTeams(res.data||[]);
  showImportResult('gsheets-result', importSummary(stats));
  renderTeamsList();
}
async function importJson() {
  const file=g('json-file')&&g('json-file').files[0]; if (!file) return showImportResult('import-result','Select a JSON file.',true);
  const fd=new FormData(); fd.append('file',file);
  const res=await fetch('/api/import/json',{method:'POST',body:fd}).then(r=>r.json()).catch(()=>({error:'Upload failed'}));
  if (res.error) return showImportResult('import-result','Error: '+res.error,true);
  const rows = Array.isArray(res.data) ? res.data : [res.data];
  const stats = await importBuildTeams(rows);
  showImportResult('import-result', importSummary(stats));
  renderTeamsList();
}
async function importCsv() {
  const file=g('csv-file')&&g('csv-file').files[0]; if (!file) return showImportResult('import-result','Select a CSV file.',true);
  const fd=new FormData(); fd.append('file',file);
  const res=await fetch('/api/import/csv',{method:'POST',body:fd}).then(r=>r.json()).catch(()=>({error:'Upload failed'}));
  if (res.error) return showImportResult('import-result','Error: '+res.error,true);
  const stats = await importBuildTeams(res.data||[]);
  showImportResult('import-result', importSummary(stats));
  renderTeamsList();
}

// Build or update teams in the Teams Database from imported rows.
// Expected columns: team, handle (player IGN), role
async function importBuildTeams(rows) {
  if (!Array.isArray(rows) || !rows.length) return { created: 0, updated: 0 };

  // Group players by team name
  const teamMap = {};
  rows.forEach(function(row) {
    const teamName = (row.team || '').trim();
    if (!teamName) return;
    if (!teamMap[teamName]) teamMap[teamName] = [];
    const handle = (row.handle || row.ign || '').trim();
    const role   = (row.role   || '').trim();
    if (handle) teamMap[teamName].push({ handle, role });
  });

  const teamNames = Object.keys(teamMap);
  if (!teamNames.length) return { created: 0, updated: 0 };

  // Fetch existing teams so we can merge rather than duplicate
  const existing = (await fetch('/api/teams').then(function(r) { return r.json(); }).catch(function() { return { teams: [] }; })).teams || [];

  let created = 0, updated = 0;
  for (let t = 0; t < teamNames.length; t++) {
    const teamName = teamNames[t];
    const players  = teamMap[teamName].slice(0, 5).map(function(p, i) {
      return { handle: p.handle, name: '', role: p.role || DEFAULT_ROLES[i] || '' };
    });
    const match = existing.find(function(x) { return x.name.toLowerCase() === teamName.toLowerCase(); });
    const teamData = {
      name:    teamName,
      tag:     match ? (match.tag   || '') : '',
      color:   match ? (match.color || '#1ffaff') : '#1ffaff',
      logo:    match ? (match.logo  || '') : '',
      players: players,
      subs:    match ? (match.subs  || []) : [],
    };
    if (match) { teamData.id = match.id; updated++; } else { created++; }
    await api('/api/teams/save', teamData);
  }
  return { created, updated };
}

function importSummary(stats) {
  if (!stats) return '✓ Import complete';
  const parts = [];
  if (stats.created) parts.push(stats.created + ' team' + (stats.created !== 1 ? 's' : '') + ' created');
  if (stats.updated) parts.push(stats.updated + ' updated');
  return '✓ ' + (parts.length ? parts.join(', ') : 'No teams found in data') + ' — fill in logos and acronyms in Teams Database';
}
function showImportResult(id, msg, isError) {
  const el=g(id); if(!el)return; el.textContent=msg; el.className='import-result show'+(isError?' error':'');
  setTimeout(function(){el.className='import-result';},5000);
}

// ── Teams Database ─────────────────────────────────────────────────────────────
async function renderTeamsList() {
  const container=g('teams-list'), empty=g('teams-empty'); if(!container)return;
  const res=await fetch('/api/teams').then(r=>r.json()).catch(()=>({teams:[]}));
  const teams=res.teams||[];
  if(!teams.length){container.innerHTML='';if(empty)empty.style.display='block';return;}
  if(empty)empty.style.display='none';
  container.innerHTML=teams.map(function(team){
    const logo=team.logo?'<img src="'+team.logo+'" style="width:44px;height:44px;object-fit:contain;flex-shrink:0">':'<div style="width:44px;height:44px;background:var(--bg3);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--text-dim);flex-shrink:0">LOGO</div>';
    const dot='width:10px;height:10px;border-radius:50%;background:'+(team.color||'#1ffaff')+';display:inline-block;margin-right:6px;flex-shrink:0';
    const pc=(team.players||[]).filter(function(p){return p.handle||p.name;}).length;
    const sc=(team.subs||[]).filter(function(s){return s.handle||s.name;}).length;
    return '<div class="team-db-row">'+logo+
      '<div style="flex:1;min-width:0">'+
        '<div style="display:flex;align-items:center;gap:6px"><div style="'+dot+'"></div>'+
          '<span style="font-family:\'Barlow Condensed\',sans-serif;font-size:18px;font-weight:800;color:#fff;text-transform:uppercase">'+esc(team.name)+'</span>'+
          '<span style="font-size:11px;color:var(--accent);letter-spacing:0.12em">'+esc(team.tag||'')+'</span></div>'+
        '<div style="font-size:11px;color:var(--text-dim);margin-top:2px">'+pc+' player'+(pc!==1?'s':'')+' · '+sc+' sub'+(sc!==1?'s':'')+'</div>'+
      '</div>'+
      '<div style="display:flex;gap:8px;flex-shrink:0">'+
        '<button class="btn btn-sm" onclick="openTeamEditor(\''+team.id+'\')">Edit</button>'+
      '</div></div>';
  }).join('');
}

async function loadTeamIntoSlot(teamId, slot) {
  const res = await api('/api/match/load-team', { slot, teamId });
  if (res&&res.ok) {
    const prefix = slot==='team1'?'t1':'t2';
    const rosterEl = g(prefix+'-roster');
    if (rosterEl) { delete rosterEl.dataset.built; delete rosterEl.dataset.sig; }
  }
}

async function openTeamEditor(teamId) {
  const editor=g('team-editor'), title=g('team-editor-title'), deleteBtn=g('delete-team-btn');
  if (!editor) return;
  editor.style.display='block';
  setTimeout(function(){editor.scrollIntoView({behavior:'smooth',block:'start'});},50);

  if (teamId) {
    const res=await fetch('/api/teams').then(r=>r.json()).catch(()=>({teams:[]}));
    const team=(res.teams||[]).find(function(t){return t.id===teamId;});
    if (!team) return;
    title.textContent='Edit Team — '+team.name;
    g('edit-team-id').value=team.id; g('edit-team-name').value=team.name||''; g('edit-team-tag').value=team.tag||'';
    g('edit-team-color').value=team.color||'#1ffaff'; g('edit-team-color-text').value=team.color||'#1ffaff';
    g('edit-team-logo').value=team.logo||''; updateEditLogoPreview(team.logo||'');
    renderEditPlayers(team.players||[], team.subs||[]);
    deleteBtn.style.display='block';
  } else {
    title.textContent='New Team';
    g('edit-team-id').value=''; g('edit-team-name').value=''; g('edit-team-tag').value='';
    g('edit-team-color').value='#1ffaff'; g('edit-team-color-text').value='#1ffaff';
    g('edit-team-logo').value=''; updateEditLogoPreview('');
    renderEditPlayers([], []);
    deleteBtn.style.display='none';
  }
}

function closeTeamEditor() { const e=g('team-editor'); if(e)e.style.display='none'; }

function updateEditLogoPreview(url) {
  const p=g('edit-team-logo-preview'); if(!p)return;
  p.innerHTML=url?'<img src="'+url+'" style="max-width:100%;max-height:100%;object-fit:contain">':'<span style="color:var(--text-dim);font-size:12px">Logo preview</span>';
}

function opggUrl(region, riotId) {
  if (!region || !riotId) return '';
  const parts = riotId.split('#');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return '';
  return 'https://www.op.gg/summoners/' + region + '/' + encodeURIComponent(parts[0]) + '-' + encodeURIComponent(parts[1]);
}
function opggRegionSelect(cls, dataAttr, selected) {
  return '<select class="' + cls + '" ' + dataAttr + '>' +
    '<option value="">Region</option>' +
    OPGG_REGIONS.map(function(r) {
      return '<option value="' + r + '"' + (r === selected ? ' selected' : '') + '>' + r.toUpperCase() + '</option>';
    }).join('') +
  '</select>';
}

function renderEditPlayers(players, subs) {
  const container=g('edit-team-players'); if(!container)return;

  // Starting 5 with auto-roles
  let html='<div class="roster-section-label">STARTING LINEUP</div>';
  html+=DEFAULT_ROLES.map(function(role,i){
    const p=players[i]||{};
    return '<div class="player-row-edit">'+
      '<div><div class="player-num">'+role+'</div><input type="text" class="ep-handle" data-index="'+i+'" placeholder="Handle / IGN" value="'+esc(p.handle||'')+'"></div>'+
      '<div><div class="player-num">Role</div><input type="text" class="ep-role" data-index="'+i+'" value="'+esc(p.role||role)+'" placeholder="'+role+'"></div>'+
      '<div><div class="player-num">Region</div>'+
        opggRegionSelect('ep-opgg-region','data-index="'+i+'"',p.opggRegion||'')+
      '</div>'+
      '<div><div class="player-num">Riot ID</div>'+
        '<input type="text" class="ep-riot-id" data-index="'+i+'" placeholder="Name#TAG" value="'+esc(p.riotId||'')+'">'+
      '</div>'+
      '</div>';
  }).join('');

  // Substitutes (up to 3)
  html+='<div class="roster-section-label" style="margin-top:14px">SUBSTITUTES (up to 3)</div>';
  html+=[0,1,2].map(function(i){
    const s=subs[i]||{};
    return '<div class="player-row-edit sub-row">'+
      '<div><div class="player-num">Sub '+(i+1)+'</div><input type="text" class="ep-sub-handle" data-subindex="'+i+'" placeholder="Handle / IGN" value="'+esc(s.handle||'')+'"></div>'+
      '<div><div class="player-num">Role</div><input type="text" class="ep-sub-role" data-subindex="'+i+'" placeholder="e.g. Top, Flex" value="'+esc(s.role||'')+'"></div>'+
      '</div>';
  }).join('');

  container.innerHTML=html;
}

async function saveTeamEditor() {
  const name=(g('edit-team-name').value||'').trim();
  if (!name){alert('Team name is required.');return;}
  const players=DEFAULT_ROLES.map(function(_,i){
    const c=g('edit-team-players');
    return {
      handle:     (c.querySelector('.ep-handle[data-index="'+i+'"]')      ||{}).value||'',
      name:       '',
      role:       (c.querySelector('.ep-role[data-index="'+i+'"]')        ||{}).value||DEFAULT_ROLES[i],
      opggRegion: (c.querySelector('.ep-opgg-region[data-index="'+i+'"]') ||{}).value||'',
      riotId:     (c.querySelector('.ep-riot-id[data-index="'+i+'"]')     ||{}).value||'',
    };
  });
  const subs=[0,1,2].map(function(i){
    return {
      handle:(g('edit-team-players').querySelector('.ep-sub-handle[data-subindex="'+i+'"]')||{}).value||'',
      name:'',
      role:  (g('edit-team-players').querySelector('.ep-sub-role[data-subindex="'+i+'"]')  ||{}).value||'',
    };
  });
  const idVal=g('edit-team-id').value;
  const team={name,tag:(g('edit-team-tag').value||'').trim().toUpperCase(),color:g('edit-team-color').value||'#1ffaff',logo:(g('edit-team-logo').value||'').trim(),players,subs};
  if(idVal)team.id=idVal;
  const res=await api('/api/teams/save',team);
  if(res&&res.ok){closeTeamEditor();renderTeamsList();}
}

async function deleteEditingTeam() {
  const id=g('edit-team-id').value; if(!id)return;
  const name=g('edit-team-name').value||'this team';
  if(!confirm('Delete '+name+'? Cannot be undone.'))return;
  const res=await api('/api/teams/delete',{id});
  if(res&&res.ok){closeTeamEditor();renderTeamsList();}
}

// ── Team picker modal ──────────────────────────────────────────────────────────
let _teamPickerSlot=null;

async function openTeamPicker(slot) {
  _teamPickerSlot=slot;
  const modal=g('team-picker-modal'), label=g('team-picker-slot-label'), list=g('team-picker-list');
  if(!modal||!list)return;
  label.textContent=slot==='team1'?'TEAM 1':'TEAM 2';
  list.innerHTML='<div style="color:var(--text-dim);font-size:13px;padding:12px">Loading…</div>';
  modal.style.display='flex';
  const res=await fetch('/api/teams').then(r=>r.json()).catch(()=>({teams:[]}));
  const teams=res.teams||[];
  if(!teams.length){
    list.innerHTML='<div style="color:var(--text-dim);font-size:13px;padding:20px;text-align:center">No teams saved yet.<br><br>Go to <strong style="color:var(--text)">Teams Database</strong> to create your first team.</div>';
    return;
  }
  list.innerHTML=teams.map(function(team){
    const logo=team.logo?'<img src="'+team.logo+'" style="width:52px;height:52px;object-fit:contain;flex-shrink:0">':'<div style="width:52px;height:52px;background:var(--bg3);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--text-dim);flex-shrink:0">LOGO</div>';
    const dot='width:10px;height:10px;border-radius:50%;background:'+(team.color||'#1ffaff')+';display:inline-block;margin-right:6px;flex-shrink:0';
    const pc=(team.players||[]).filter(function(p){return p.handle||p.name;}).length;
    return '<div class="team-picker-option" onclick="selectTeamFromPicker(\''+team.id+'\')">' +
      logo+'<div style="flex:1;min-width:0">'+
        '<div style="display:flex;align-items:center;gap:6px"><div style="'+dot+'"></div>'+
          '<span style="font-family:\'Barlow Condensed\',sans-serif;font-size:22px;font-weight:800;color:#fff;text-transform:uppercase">'+esc(team.name)+'</span>'+
          '<span style="font-size:11px;color:var(--accent);letter-spacing:0.12em">'+esc(team.tag||'')+'</span></div>'+
        '<div style="font-size:11px;color:var(--text-dim);margin-top:2px">'+pc+' players</div>'+
      '</div><div style="color:var(--primary);font-size:20px;flex-shrink:0">›</div></div>';
  }).join('');
}

async function selectTeamFromPicker(teamId) {
  if(!_teamPickerSlot)return;
  const res=await api('/api/match/load-team',{slot:_teamPickerSlot,teamId});
  if(res&&res.ok){
    const prefix=_teamPickerSlot==='team1'?'t1':'t2';
    const rosterEl=g(prefix+'-roster');
    if(rosterEl){delete rosterEl.dataset.built;delete rosterEl.dataset.sig;}
    closeTeamPicker();
  }
}

function closeTeamPicker() { const m=g('team-picker-modal'); if(m)m.style.display='none'; _teamPickerSlot=null; }
g('team-picker-modal').addEventListener('click', function(e){ if(e.target===this)closeTeamPicker(); });

// ── Utility ────────────────────────────────────────────────────────────────────
function esc(str) { return String(str||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Init ───────────────────────────────────────────────────────────────────────
Champions.load();
refreshBracketTeams();

// ── Graphic status indicators ──────────────────────────────────────────────────
// Maps state key -> sidebar nav data-tab and operator card id
const GRAPHIC_MAP = [
  { key: 'scoreboard',  tab: 'scoreboard',  label: 'Scoreboard'  },
  { key: 'lowerThird',  tab: 'lowerthird',  label: 'Lower Third' },
  { key: 'headToHead',  tab: 'h2h',         label: 'Head to Head'},
  { key: 'draft',       tab: 'draft-gfx',   label: 'Draft'       },
  { key: 'bracket',     tab: 'bracket',     label: 'Bracket'     },
  { key: 'groupStage',          tab: 'groups-gfx',               label: 'Group Stage'          },
  { key: 'tournamentStructure', tab: 'tournament-structure-gfx', label: 'Tournament Structure' },
  { key: 'prizepool',           tab: 'prizepool',                label: 'Prizepool'            },
  { key: 'breakScreen',         tab: 'break',                    label: 'Break Screen'         },
  { key: 'ticker',      tab: 'ticker',      label: 'Ticker'      },
  { key: 'winScreen',   tab: 'win',         label: 'Win Screen'  },
];

// ── Draft GFX tab ─────────────────────────────────────────────────────────────
let _draftTimerInterval = null;

function startDraftTimer() {
  const durEl = g('draft-timer-dur');
  const dur   = parseInt(durEl && durEl.value) || 60;
  api('/api/draft', { timerEnd: Date.now() + dur * 1000, timerDuration: dur });
}

function syncDraftGfxTab(draft, settings) {
  // Layout radio — treat legacy 'arena' value as 'standard'
  const rawLayout = (settings || {}).draftLayout || 'standard';
  const layout = rawLayout === 'arena' ? 'standard' : rawLayout;
  document.querySelectorAll('input[name="draft-layout"]').forEach(r => {
    r.checked = r.value === layout;
  });

  // Phase label contrast pills
  const phaseContrast = (settings || {}).draftPhaseContrast || 'subtle';
  document.querySelectorAll('[data-phase-contrast]').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.phaseContrast === phaseContrast);
  });

  // Timer duration + visible
  const durEl = g('draft-timer-dur');
  if (durEl && document.activeElement !== durEl) durEl.value = draft.timerDuration || 60;
  const visEl = g('draft-timer-visible');
  if (visEl) visEl.checked = !!draft.timerVisible;

  // Live countdown display
  if (_draftTimerInterval) clearInterval(_draftTimerInterval);
  const dispEl = g('draft-timer-display');
  if (draft.timerEnd && draft.timerVisible) {
    _draftTimerInterval = setInterval(() => {
      if (!dispEl) return;
      const rem  = Math.max(0, draft.timerEnd - Date.now());
      const secs = Math.ceil(rem / 1000);
      dispEl.textContent = rem > 0 ? '⏱ ' + secs + 's remaining' : '⏱ Time up';
    }, 250);
  } else {
    if (dispEl) dispEl.textContent = '';
  }

  // Centre logo picker
  const logos = (settings && settings.logoSet && settings.logoSet.logos) || [];
  renderDraftLogoPicker(logos, (settings && settings.draftCenterLogoUrl) || '');

  // Phase status hint
  const phaseLabels = {
    notstarted:'Not started', bans1:'Phase 1 — Bans', picks1:'Phase 1 — Picks',
    bans2:'Phase 2 — Bans', picks2:'Phase 2 — Picks', complete:'Draft complete',
  };
  const statEl = g('draft-gfx-status');
  if (statEl) statEl.textContent = phaseLabels[draft.phase || 'notstarted'] || '—';
}

function renderDraftLogoPicker(logos, selectedUrl) {
  const grid = g('draft-logo-grid');
  if (!grid) return;
  const tiles = [{ url: '', label: 'Auto' }].concat(
    (logos || []).map(l => ({ url: l.url || '', label: l.name || l.url.split('/').pop().replace(/\.[^.]+$/, '') || '' }))
  );
  grid.innerHTML = tiles.map(tile => {
    const active = tile.url === '' ? !selectedUrl : tile.url === selectedUrl;
    return '<div class="draft-logo-tile' + (active ? ' is-active' : '') + '" onclick="selectDraftLogo(' + JSON.stringify(tile.url) + ')">' +
      '<div class="draft-logo-tile-img"' + (tile.url ? ' style="background-image:url(' + escHtml(tile.url) + ')"' : '') + '>' +
      (tile.url ? '' : '<span style="font-size:9px;font-family:\'Barlow Condensed\',sans-serif;color:var(--text-dim);letter-spacing:0.08em">AUTO</span>') +
      '</div>' +
      '<div class="draft-logo-tile-label">' + escHtml(tile.label) + '</div>' +
      '</div>';
  }).join('');
}

function selectDraftLogo(url) {
  patchSettings({ draftCenterLogoUrl: url });
}

function syncGraphicIndicators(s) {
  GRAPHIC_MAP.forEach(function(gfx) {
    const active = s[gfx.key] && s[gfx.key].visible;
    // Sidebar dot
    const dot = g('nav-dot-' + gfx.tab);
    if (dot) {
      dot.className = 'nav-status-dot' + (active ? ' active' : '');
    }
    // Individual tab SHOW/HIDE buttons
    const showBtn = g('showbtn-' + gfx.key);
    const hideBtn = g('hidebtn-' + gfx.key);
    if (showBtn) showBtn.className = 'btn ' + (active ? 'btn-active-gfx' : 'btn-primary');
    if (hideBtn) hideBtn.className = 'btn ' + (active ? 'btn-danger' : 'btn-dim');
  });
}

// ── Operator page sync ─────────────────────────────────────────────────────────
function syncOperatorPage(s) {
  const m = s.match;

  // Score displays
  setText('ops-t1-name',  m.team1.name);
  setText('ops-t2-name',  m.team2.name);
  setText('ops-t1-score', m.team1.score);
  setText('ops-t2-score', m.team2.score);

  // Lower third fields
  setInpSafe('ops-lt-text',  s.lowerThird.text);
  setInpSafe('ops-lt-sub',   s.lowerThird.subtext);
  setInpSafe('ops-lt-super', s.lowerThird.supertext);

  // Break screen fields
  setInpSafe('ops-break-msg',  s.breakScreen.message);
  setInpSafe('ops-break-next', s.breakScreen.nextMatch);

  // Win screen
  const wr1 = g('ops-win-team1'); if (wr1) wr1.checked = s.winScreen.team === 'team1';
  const wr2 = g('ops-win-team2'); if (wr2) wr2.checked = s.winScreen.team === 'team2';

  // Active graphic highlights on operator cards
  GRAPHIC_MAP.forEach(function(gfx) {
    const active = s[gfx.key] && s[gfx.key].visible;
    const card = g('ops-card-' + gfx.key);
    if (card) {
      card.classList.toggle('ops-card-active', !!active);
    }
    const showBtn = g('ops-show-' + gfx.key);
    const hideBtn = g('ops-hide-' + gfx.key);
    if (showBtn) showBtn.className = 'ops-btn ops-btn-show' + (active ? ' is-active' : '');
    if (hideBtn) hideBtn.className = 'ops-btn ops-btn-hide' + (active ? ' is-active' : '');
  });

  // Win team names
  syncOpsWinTeamNames(m);
  // Quick player buttons
  renderOpsLTQuickGrid(s.players, m);
}

// LT quick grid for operator page — same logic, different container
function renderOpsLTQuickGrid(players, match) {
  const grid = g('ops-lt-player-grid');
  if (!grid) return;
  const all = [];
  (players.team1||[]).forEach(p => { if (p.handle||p.name) all.push({...p, teamName:match.team1.name, teamTag:match.team1.tag, teamColor:match.team1.color}); });
  (players.team2||[]).forEach(p => { if (p.handle||p.name) all.push({...p, teamName:match.team2.name, teamTag:match.team2.tag, teamColor:match.team2.color}); });
  grid._players = all;
  // Only rebuild if player list changed
  const sig = all.map(p=>p.handle+p.name+p.role+p.teamName).join('|');
  if (grid.dataset.sig === sig) return;
  grid.dataset.sig = sig;
  grid.innerHTML = all.map((p,i) =>
    '<button class="player-quick-btn ops-player-btn" onclick="opsQuickLT('+i+')">' +
    '<span class="pqb-handle">'+esc(p.handle||p.name)+'</span>' +
    '<span class="pqb-team">'+esc(p.teamTag||p.teamName)+(p.role?' · '+p.role:'')+'</span>' +
    '</button>'
  ).join('');
}

function opsQuickLT(i) {
  const grid = g('ops-lt-player-grid');
  const p = grid&&grid._players&&grid._players[i]; if (!p) return;
  api('/api/lowerThird', { text:p.handle||p.name, subtext:(p.role?p.role+' · ':'')+p.teamName, supertext:(window._state&&window._state.match&&window._state.match.tournament)||'', teamColor:p.teamColor||'', visible:true });
}

// ── Operator page timer helper ─────────────────────────────────────────────────
function opsStartTimer() {
  const mins = parseInt(g('ops-break-min') && g('ops-break-min').value) || 0;
  const secs = parseInt(g('ops-break-sec') && g('ops-break-sec').value) || 0;
  api('/api/breakScreen', { timerEnd: Date.now() + (mins * 60 + secs) * 1000 });
}

// Sync win team names in operator page
function syncOpsWinTeamNames(m) {
  const t1 = g('ops-win-t1-name'); if (t1) t1.textContent = m.team1.name || 'Team 1';
  const t2 = g('ops-win-t2-name'); if (t2) t2.textContent = m.team2.name || 'Team 2';
}

// ── Live Bar ───────────────────────────────────────────────────────────────────
function syncLiveBar(s) {
  const m  = s.match;
  const t1 = m.team1 || {}, t2 = m.team2 || {};
  const t1label = t1.tag || t1.name || 'T1';
  const t2label = t2.tag || t2.name || 'T2';

  // Active game context
  const gameCtx = g('lbar-game-context');
  if (gameCtx) {
    const formatNum = parseInt((m.format || 'Bo3').replace('Bo', '')) || 3;
    gameCtx.textContent = 'GAME ' + (m.currentGameNum || 1) + ' OF ' + formatNum + ' · ' + t1label + ' VS ' + t2label;
  }

  // Win team quick-set buttons — show team tags, highlight active
  const wt = s.winScreen && s.winScreen.team;
  const wt1btn = g('lbar-win-t1'), wt2btn = g('lbar-win-t2');
  if (wt1btn) { wt1btn.textContent = t1label; wt1btn.classList.toggle('is-active', wt === 'team1'); }
  if (wt2btn) { wt2btn.textContent = t2label; wt2btn.classList.toggle('is-active', wt === 'team2'); }

  // PIP toggle — text changes + red when active
  const pipBtn = g('lbar-pip-btn');
  if (pipBtn) {
    const pipActive = !!(s.breakScreen && s.breakScreen.pipMode);
    pipBtn.className = 'lbar-toggle lbar-pip-toggle' + (pipActive ? ' is-on' : '');
    pipBtn.textContent = pipActive ? '● PIP' : 'PIP';
  }

  // All graphic toggles (scoreboard removed from GRAPHIC_MAP is fine — elements won't exist)
  GRAPHIC_MAP.forEach(function(gfx) {
    const active  = s[gfx.key] && s[gfx.key].visible;
    const group   = g('lbar-group-'  + gfx.key);
    const dot     = g('lbar-dot-'    + gfx.key);
    const toggleB = g('lbar-toggle-' + gfx.key);
    if (group)   group.classList.toggle('lbar-group-active', !!active);
    if (dot)     dot.classList.toggle('active', !!active);
    if (toggleB) toggleB.className = 'lbar-toggle' + (active ? ' is-on' : '');
  });
}

function lbarSetWinTeam(team) {
  api('/api/winScreen', { team });
}

function toggleGraphic(key) {
  const btn = g('lbar-toggle-' + key);
  if (btn && btn.classList.contains('is-on')) hideGraphic(key);
  else showGraphic(key);
}

let _lbarTimerSetMs = 0;

function lbarStartTimer() {
  const mins = parseInt(g('lbar-break-min') && g('lbar-break-min').value) || 0;
  const secs = parseInt(g('lbar-break-sec') && g('lbar-break-sec').value) || 0;
  const newDuration = (mins * 60 + secs) * 1000;
  const currentEnd = window._state.breakScreen && window._state.breakScreen.timerEnd;
  const timerActive = currentEnd && currentEnd > Date.now();

  let newEnd;
  if (timerActive && _lbarTimerSetMs > 0) {
    newEnd = currentEnd + (newDuration - _lbarTimerSetMs);
  } else {
    newEnd = Date.now() + newDuration;
  }
  _lbarTimerSetMs = newDuration;
  api('/api/breakScreen', { timerEnd: newEnd });
}

// ── User management ────────────────────────────────────────────────────────────
function loadUsersTab() {
  fetch('/api/users').then(r => r.json()).then(data => {
    const list = g('users-list');
    if (!list) return;
    if (!data.users || data.users.length === 0) { list.innerHTML = '<p class="hint">No users found.</p>'; return; }
    list.innerHTML = data.users.map(u =>
      '<div class="user-row" id="user-row-' + u.id + '">' +
      '<span class="user-name">' + escHtml(u.username) + '</span>' +
      '<span class="user-role user-role-' + u.role + '">' + u.role + '</span>' +
      '<button class="btn btn-sm" onclick="openChpwPanel(\'' + u.id + '\',\'' + escHtml(u.username) + '\')">Change Password</button>' +
      '<button class="btn btn-sm btn-danger" onclick="deleteUser(\'' + u.id + '\',\'' + escHtml(u.username) + '\')">Delete</button>' +
      '</div>'
    ).join('');
  }).catch(() => { const l = g('users-list'); if (l) l.innerHTML = '<p class="hint" style="color:var(--danger)">Failed to load users.</p>'; });
}

function openNewUserForm() {
  g('new-user-form').style.display = 'block';
  g('nu-username').value = ''; g('nu-password').value = '';
  g('nu-role').value = 'operator';
  showUsersMsg('nu-msg', '', '');
  g('nu-username').focus();
}
function closeNewUserForm() { g('new-user-form').style.display = 'none'; }

async function submitNewUser() {
  const username = g('nu-username').value.trim();
  const password = g('nu-password').value;
  const role     = g('nu-role').value;
  if (!username || !password) { showUsersMsg('nu-msg', 'Username and password are required.', 'error'); return; }
  const data = await api('/api/users/create', { username, password, role });
  if (data && data.ok) { closeNewUserForm(); loadUsersTab(); }
  else showUsersMsg('nu-msg', (data && data.error) || 'Failed to create user.', 'error');
}

function openChpwPanel(uid, username) {
  g('chpw-uid').value = uid;
  g('chpw-label').textContent = username;
  g('chpw-new').value = ''; g('chpw-confirm').value = '';
  showUsersMsg('chpw-msg', '', '');
  g('chpw-panel').style.display = 'block';
  g('chpw-new').focus();
}
function closeChpwPanel() { g('chpw-panel').style.display = 'none'; }

function submitChangePassword() {
  const uid = g('chpw-uid').value;
  const pw  = g('chpw-new').value;
  const pw2 = g('chpw-confirm').value;
  if (pw.length < 6) { showUsersMsg('chpw-msg', 'Password must be at least 6 characters.', 'error'); return; }
  if (pw !== pw2)    { showUsersMsg('chpw-msg', 'Passwords do not match.', 'error'); return; }
  fetch('/api/users/change-password', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ userId: uid, newPassword: pw }) })
    .then(r => r.json()).then(data => {
      if (data.ok) { showUsersMsg('chpw-msg', 'Password updated.', 'ok'); g('chpw-new').value = ''; g('chpw-confirm').value = ''; }
      else showUsersMsg('chpw-msg', data.error || 'Failed.', 'error');
    });
}

function deleteUser(uid, username) {
  if (!confirm('Delete user "' + username + '"? This cannot be undone.')) return;
  fetch('/api/users/delete', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ userId: uid }) })
    .then(r => r.json()).then(data => {
      if (data.ok) loadUsersTab();
      else alert(data.error || 'Failed to delete user.');
    });
}

function showUsersMsg(id, text, type) {
  const el = g(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'users-msg' + (type ? ' users-msg-' + type : '');
  el.style.display = text ? 'block' : 'none';
}

function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Profiles ───────────────────────────────────────────────────────────────────
function loadProfilesTab() {
  fetch('/api/profiles').then(r => r.json()).then(data => {
    const profiles = data.profiles || [];
    renderProfilesList(profiles);
    // Restore dirty-tracking snapshot after a page refresh
    if (_pendingSnapshotRestore && window._activeProfileId && !_savedProfileSnapshotStr) {
      _pendingSnapshotRestore = false;
      const p = profiles.find(function(x) { return x.id === window._activeProfileId; });
      if (p && p.data) setProfileSnapshot(p.data);
    }
  }).catch(() => {
    const el = g('profiles-list'); if (el) el.innerHTML = '<p class="hint" style="color:var(--danger)">Failed to load profiles.</p>';
  });
}

function renderProfilesList(profiles) {
  const el = g('profiles-list'); if (!el) return;
  if (!profiles.length) {
    el.innerHTML = '<p class="hint">No profiles saved yet. Use "+ Save as New Profile" to capture the current tournament setup.</p>';
    return;
  }
  const gameLabels = { lol: 'LoL', valorant: 'VAL', cs2: 'CS2', generic: 'GEN' };
  el.innerHTML = profiles.map(p => {
    const d = p.data || {};
    const t = d.tournament || {};
    const m = d.match || {};
    const tournName = m.tournament || p.name;
    const game = gameLabels[m.game] || m.game || '—';
    // Summary info
    const parts = [];
    if (t.hasGroupStage && t.numGroups > 0) {
      parts.push(t.numGroups + ' group' + (t.numGroups > 1 ? 's' : ''));
    }
    const totalTeams = (t.hasGroupStage && t.numGroups > 0)
      ? t.numGroups * (t.qualifiersPerGroup || 2)
      : (t.totalTeams || 0);
    if (totalTeams > 0) parts.push(totalTeams + '-team ' + (t.playoffFormat === 'doubleElim' ? 'double elim' : 'playoff'));
    const schedDays = (t.schedule || []).length;
    const schedGames = (t.schedule || []).reduce((s, day) => s + (day.games || []).length, 0);
    if (schedGames > 0) parts.push(schedGames + ' game' + (schedGames > 1 ? 's' : '') + ' scheduled');
    const created = new Date(p.createdAt).toLocaleDateString();
    const updated = new Date(p.updatedAt).toLocaleDateString();
    const isActive = window._activeProfileId === p.id;

    return '<div class="profile-card' + (isActive ? ' profile-card-active' : '') + '" id="prof-card-' + p.id + '">' +
      '<div class="profile-card-header">' +
        '<div>' +
          '<div class="profile-name" id="prof-name-' + p.id + '">' + escHtml(tournName) + '</div>' +
          '<div class="profile-meta">' +
            '<span class="profile-game-badge">' + escHtml(game) + '</span>' +
            (parts.length ? '<span class="profile-summary">' + escHtml(parts.join(' · ')) + '</span>' : '') +
          '</div>' +
          '<div class="profile-dates">Saved ' + escHtml(created) + (updated !== created ? ' · Updated ' + escHtml(updated) : '') + '</div>' +
        '</div>' +
        '<div class="profile-card-btns">' +
          (isActive && _savedProfileSnapshotStr && profileSnapshotStr(window._state) !== _savedProfileSnapshotStr
            ? '<span class="profile-dirty-badge">⚠ Unsaved</span>' : '') +
          '<button class="btn btn-sm btn-primary" onclick="loadProfile(\'' + p.id + '\')">' + (isActive ? '● Active' : 'Load') + '</button>' +
          '<button class="btn btn-sm' + (isActive && _savedProfileSnapshotStr && profileSnapshotStr(window._state) !== _savedProfileSnapshotStr ? ' btn-primary' : '') + '" onclick="updateProfile(\'' + p.id + '\')">Update</button>' +
          '<button class="btn btn-sm" onclick="renameProfileInline(\'' + p.id + '\')">Rename</button>' +
          '<button class="btn btn-sm btn-danger" onclick="deleteProfile(\'' + p.id + '\')">Delete</button>' +
        '</div>' +
      '</div>' +
      '</div>';
  }).join('');
}

function openSaveProfileForm() {
  const el = g('save-profile-form'); if (!el) return;
  el.style.display = 'block';
  const nameEl = g('new-profile-name');
  if (nameEl) {
    const tournName = (window._state.match || {}).tournament || '';
    nameEl.value = tournName;
    nameEl.focus();
    nameEl.select();
  }
  const msg = g('save-profile-msg'); if (msg) { msg.textContent = ''; msg.style.display = 'none'; }
}
function closeSaveProfileForm() {
  const el = g('save-profile-form'); if (el) el.style.display = 'none';
}

function submitSaveProfile() {
  const name = g('new-profile-name') && g('new-profile-name').value.trim();
  if (!name) { showProfileMsg('save-profile-msg', 'Please enter a profile name.', 'error'); return; }
  fetch('/api/profiles/save', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name }) })
    .then(r => r.json()).then(data => {
      if (data.ok) {
        if (data.savedSnapshot) setProfileSnapshot(data.savedSnapshot);
        closeSaveProfileForm();
        loadProfilesTab();
      } else {
        showProfileMsg('save-profile-msg', data.error || 'Failed to save.', 'error');
      }
    });
}

let _loadProfilePending = null;

function loadProfile(id) {
  _loadProfilePending = id;
  const nameEl = g('plm-name');
  const profNameEl = g('prof-name-' + id);
  if (nameEl) nameEl.textContent = (profNameEl && profNameEl.textContent) || 'Profile';
  const modal = g('profile-load-modal'); if (modal) modal.style.display = 'flex';
}

function confirmLoadProfile() {
  const id = _loadProfilePending; if (!id) return;
  const restoreScheduleEl = g('plm-restore-schedule');
  const keepSchedule = restoreScheduleEl ? !restoreScheduleEl.checked : false;
  closeProfileLoadModal();
  fetch('/api/profiles/load', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id, keepSchedule }) })
    .then(r => r.json()).then(data => {
      if (data.ok) {
        if (data.savedSnapshot) setProfileSnapshot(data.savedSnapshot);
        loadProfilesTab();
      } else alert(data.error || 'Failed to load profile.');
    });
}

function closeProfileLoadModal() {
  const m = g('profile-load-modal'); if (m) m.style.display = 'none';
  _loadProfilePending = null;
}

// Close on backdrop click
// Suppress browser autocomplete/autofill on all inputs.
// Runs on existing inputs and watches for dynamically-added ones (rendered via JS).
(function() {
  function disableAutofill(root) {
    (root || document).querySelectorAll('input:not([autocomplete]), textarea:not([autocomplete]), select:not([autocomplete])').forEach(function(el) {
      el.setAttribute('autocomplete', 'off');
    });
  }
  document.addEventListener('DOMContentLoaded', function() {
    disableAutofill();
    new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        m.addedNodes.forEach(function(node) {
          if (node.nodeType !== 1) return;
          if (node.matches('input, textarea, select')) disableAutofill(node.parentElement);
          else disableAutofill(node);
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
  });
})();

// ── Font picker ──────────────────────────────────────────────────────────────
var FONT_OPTIONS = [
  { name: 'Inter',            label: 'Inter',            sample: 'Default — clean neo-grotesque, screen-optimised' },
  { name: 'Barlow',           label: 'Barlow',           sample: 'Humanist grotesque' },
  { name: 'Hubot Sans',       label: 'Hubot Sans',       sample: 'GitHub\'s open-source variable font' },
  { name: 'Switzer',          label: 'Switzer',          sample: 'Contemporary geometric grotesque' },
  { name: 'Space Grotesk',    label: 'Space Grotesk',    sample: 'Technical geometric, distinct forms' },
  { name: 'Figtree',          label: 'Figtree',          sample: 'Rounded, approachable geometric' },
  { name: 'Poppins',          label: 'Poppins',          sample: 'Geometric, uniform stroke weight' },
  { name: 'Outfit',           label: 'Outfit',           sample: 'Geometric variable, clean numerals' },
  { name: 'Darker Grotesque', label: 'Darker Grotesque', sample: 'Condensed grotesque with personality' },
  { name: 'Sora',             label: 'Sora',             sample: 'Japanese-influenced geometric sans' },
  { name: 'Oxygen',           label: 'Oxygen',           sample: 'KDE project — crisp and legible' },
  { name: 'Nacelle',          label: 'Nacelle',          sample: 'Self-hosted — clean geometric grotesque' },
];

function initFontPicker() {
  var saved = localStorage.getItem('gfx_ui_font');
  if (saved) applyUiFont(saved, false);
  renderFontPicker();
}

function applyUiFont(fontName, save) {
  document.documentElement.style.setProperty('--ui-font', "'" + fontName + "'");
  if (save !== false) localStorage.setItem('gfx_ui_font', fontName);
}

function setUiFont(fontName) {
  applyUiFont(fontName, true);
  renderFontPicker();
}

function renderFontPicker() {
  var grid = g('font-picker-grid');
  if (!grid) return;
  var current = localStorage.getItem('gfx_ui_font') || 'Inter';
  grid.innerHTML = FONT_OPTIONS.map(function(f) {
    var active = f.name === current ? ' is-active' : '';
    return '<button class="font-option' + active + '" onclick="setUiFont(\'' + f.name.replace(/'/g, "\\'") + '\')" style="font-family:\'' + f.name + '\',sans-serif">'
      + '<span class="font-option-name">' + f.label + '</span>'
      + '<span class="font-option-sample">' + f.sample + '</span>'
      + '</button>';
  }).join('');
}

document.addEventListener('DOMContentLoaded', function() {
  const m = g('profile-load-modal');
  if (m) m.addEventListener('click', function(e) { if (e.target === m) closeProfileLoadModal(); });

  initFontPicker();

  // Restore last active tab from previous session
  const savedTab = localStorage.getItem('gfx_ctrl_tab');
  if (savedTab) {
    const navEl = document.querySelector('.nav-item[data-tab="' + savedTab + '"]');
    if (navEl) {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      navEl.classList.add('active');
      const tabEl = g('tab-' + savedTab);
      if (tabEl) tabEl.classList.add('active');
    }
    if (savedTab === 'users')    loadUsersTab();
    if (savedTab === 'profiles') loadProfilesTab();
    if (savedTab === 'home')     renderDashboard(window._state);
  }
});

function updateProfile(id) {
  if (!confirm('Update this profile with the current tournament state? This overwrites the saved data.')) return;
  api('/api/profiles/update', { id }).then(function(data) {
    if (data && data.ok) {
      if (data.savedSnapshot) setProfileSnapshot(data.savedSnapshot);
      loadProfilesTab();
    } else alert((data && data.error) || 'Failed to update.');
  });
}

function renameProfileInline(id) {
  const nameEl = g('prof-name-' + id); if (!nameEl) return;
  const current = nameEl.textContent;
  const input = document.createElement('input');
  input.type = 'text'; input.value = current;
  input.className = 'profile-rename-input';
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmRename(id, input);
    if (e.key === 'Escape') loadProfilesTab();
  });
  input.addEventListener('blur', () => confirmRename(id, input));
  nameEl.replaceWith(input);
  input.focus(); input.select();
}

function confirmRename(id, input) {
  const name = input.value.trim();
  if (!name) { loadProfilesTab(); return; }
  fetch('/api/profiles/rename', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id, name }) })
    .then(r => r.json()).then(data => {
      if (!data.ok) alert(data.error || 'Failed to rename.');
      loadProfilesTab();
    });
}

function deleteProfile(id) {
  if (!confirm('Delete this profile? This cannot be undone.')) return;
  fetch('/api/profiles/delete', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id }) })
    .then(r => r.json()).then(data => {
      if (data.ok) {
        // state.meta is cleared by server; syncTopBar will update window._activeProfileId
        if (window._activeProfileId === id) { _savedProfileSnapshotStr = null; updateProfileDirtyBar(false); }
        loadProfilesTab();
      } else alert(data.error || 'Failed to delete.');
    });
}

function showProfileMsg(id, text, type) {
  const el = g(id); if (!el) return;
  el.textContent = text;
  el.className = 'profile-msg profile-msg-' + type;
  el.style.display = 'block';
}

window._activeProfileId = null; // updated from state.meta by syncTopBar on every broadcast

// Load profiles when tab is opened
document.querySelectorAll('.nav-item[data-tab="profiles"]').forEach(el => {
  el.addEventListener('click', loadProfilesTab);
});

// Load users when the users tab is opened
document.querySelectorAll('.nav-item[data-tab="users"]').forEach(el => {
  el.addEventListener('click', function() { loadUsersTab(); renderFontPicker(); });
});

// Populate session info in top bar
fetch('/api/auth/me').then(r => r.json()).then(data => {
  const el = g('mtb-session');
  if (el && data.user) el.textContent = data.user.username;
}).catch(() => {});

// ── Tournament Setup ───────────────────────────────────────────────────────────
function patchTournamentInfo(data) { api('/api/tournament', data); }

function patchTournamentStructure() {
  const hasGroups  = !!(g('ts-has-groups') && g('ts-has-groups').checked);
  const playoffFmt = (document.querySelector('input[name="ts-playoff"]:checked') || {}).value || 'singleElim';
  api('/api/tournament', { hasGroupStage: hasGroups, playoffFormat: playoffFmt });
}

const PLAYOFF_STAGES_SINGLE = [
  { key: 'roundOf16',     label: 'Round of 16' },
  { key: 'quarterfinals', label: 'Quarterfinals' },
  { key: 'semifinals',    label: 'Semifinals' },
  { key: 'finals',        label: 'Finals' },
  { key: 'thirdPlace',    label: '3rd Place Match' },
];
const PLAYOFF_STAGES_DOUBLE = [
  { key: 'upperBracket',      label: 'Upper Bracket' },
  { key: 'lowerBracket',      label: 'Lower Bracket' },
  { key: 'lowerBracketFinal', label: 'LB Final' },
  { key: 'grandFinals',       label: 'Grand Finals' },
];

// Returns a display label for any stage key, including bracket-round-N keys
function getStageLabelFromKey(stageKey) {
  if (!stageKey) return '';
  if (STAGE_LABEL_MAP[stageKey]) return STAGE_LABEL_MAP[stageKey];
  if (stageKey.startsWith('bracket-round-')) {
    const idx = parseInt(stageKey.replace('bracket-round-', ''));
    const round = (window._state && window._state.bracket && (window._state.bracket.rounds || []))[idx];
    return round ? (round.label || ('Round ' + (idx + 1))) : stageKey;
  }
  return stageKey;
}

// Returns stage options for the add-game form, preferring live bracket rounds over hardcoded keys
function getScheduleStageOptions(t) {
  const hasGroups = t && t.hasGroupStage;
  const rounds = (window._state && window._state.bracket && window._state.bracket.rounds) || [];
  const opts = [];
  if (hasGroups) opts.push({ key: 'groupStage', label: 'Group Stage' });
  rounds.forEach(function(round, idx) {
    const hasTeam = (round.matches || []).some(function(m) {
      return (m.team1 && m.team1.name && m.team1.name.trim()) ||
             (m.team2 && m.team2.name && m.team2.name.trim());
    });
    if (hasTeam) opts.push({ key: 'bracket-round-' + idx, label: round.label || ('Round ' + (idx + 1)) });
  });
  // Fallback to hardcoded stages if no bracket rounds have teams yet
  if (!opts.some(function(o) { return o.key.startsWith('bracket-round-'); })) {
    const playoffFmt = (t && t.playoffFormat) || 'singleElim';
    (playoffFmt === 'doubleElim' ? PLAYOFF_STAGES_DOUBLE : PLAYOFF_STAGES_SINGLE)
      .forEach(function(s) { opts.push({ key: s.key, label: s.label }); });
  }
  return opts;
}

function syncTournamentStructure(t) {
  if (!t) return;
  const hasGroups   = !!t.hasGroupStage;
  const playoffFmt  = t.playoffFormat || 'singleElim';
  const seeding     = t.playoffSeeding || 'manual';

  // Group stage checkbox + group config section
  const hasGroupsEl = g('ts-has-groups'); if (hasGroupsEl) hasGroupsEl.checked = hasGroups;
  const groupConfig = g('ts-group-config'); if (groupConfig) groupConfig.style.display = hasGroups ? 'block' : 'none';
  const ngEl = g('ts-num-groups');  if (ngEl && document.activeElement !== ngEl) ngEl.value = t.numGroups || '';
  const qualEl = g('ts-qualifiers'); if (qualEl && document.activeElement !== qualEl) qualEl.value = t.qualifiersPerGroup || 2;
  document.querySelectorAll('input[name="ts-seeding"]').forEach(r => { r.checked = r.value === seeding; });

  // Playoff format radios
  document.querySelectorAll('input[name="ts-playoff"]').forEach(r => { r.checked = r.value === playoffFmt; });

  // 3rd place checkbox (hidden for double elim)
  const tpWrap = g('ts-third-place-wrap');
  if (tpWrap) tpWrap.style.display = (playoffFmt === 'doubleElim') ? 'none' : '';
  const tpEl = g('ts-third-place'); if (tpEl) tpEl.checked = !!t.thirdPlaceMatch;

  // Groups nav item visibility
  const gNav = g('nav-item-groups'); if (gNav) gNav.style.display = hasGroups ? 'block' : 'none';
  // Groups hint in tournament tab
  const gh = g('ts-groups-hint'); if (gh) gh.style.display = hasGroups ? 'block' : 'none';

  // Total teams — sync both fields, show the correct one
  const ttEl  = g('ts-total-teams');      if (ttEl  && document.activeElement !== ttEl)  ttEl.value  = t.totalTeams || '';
  const ttEl2 = g('ts-total-teams-solo'); if (ttEl2 && document.activeElement !== ttEl2) ttEl2.value = t.totalTeams || '';
  const soloRow = g('ts-total-teams-solo-row');
  if (soloRow) soloRow.style.display = hasGroups ? 'none' : 'flex';
  updateBracketSizeInfo(t);

  // Stage formats — group stage row (if applicable) + playoff stages
  const container = g('ts-stage-formats'); if (!container) return;
  const stages = t.stages || {};
  const playoffDefs = playoffFmt === 'doubleElim' ? PLAYOFF_STAGES_DOUBLE : PLAYOFF_STAGES_SINGLE;
  const allDefs = [
    ...(hasGroups ? [{ key: 'groupStage', label: 'Group Stage', section: 'Groups' }] : []),
    ...playoffDefs.map(d => ({ ...d, section: 'Playoffs' })),
  ].filter(d => d.key !== 'thirdPlace' || t.thirdPlaceMatch);

  // Group by section with a divider
  let lastSection = null;
  container.innerHTML = allDefs.map(d => {
    const fmt = (stages[d.key] || {}).format || 'Bo3';
    let html = '';
    if (d.section !== lastSection) {
      if (lastSection !== null) html += '</div>';
      html += '<div class="stage-section"><div class="stage-section-label">' + escHtml(d.section) + '</div>';
      lastSection = d.section;
    }
    html += '<div class="stage-format-row">' +
      '<span class="stage-format-label">' + escHtml(d.label) + '</span>' +
      '<select class="stage-format-select" onchange="patchStageFormat(\'' + d.key + '\',this.value)">' +
      ['Bo1','Bo3','Bo5'].map(f => '<option' + (fmt===f?' selected':'') + '>' + f + '</option>').join('') +
      '</select></div>';
    return html;
  }).join('') + (lastSection !== null ? '</div>' : '');

  // Groups list
  renderGroupsList(t);
}

function patchStageFormat(stageKey, format) {
  api('/api/tournament', { stages: { [stageKey]: { format } } });
}

function updateBracketSizeInfo(t) {
  const el = g('ts-bracket-size-info'); if (!el) return;
  const totalTeams = t.totalTeams || 0;
  if (!totalTeams) { el.textContent = ''; return; }

  if (t.hasGroupStage) {
    const numGroups = t.numGroups || 0;
    if (!numGroups) { el.textContent = '→ Set number of groups above'; return; }
    const base = Math.floor(totalTeams / numGroups);
    const extra = totalTeams % numGroups;
    let groupInfo = extra === 0
      ? numGroups + ' groups of ' + base
      : (numGroups - extra) + ' groups of ' + base + ' + ' + extra + ' groups of ' + (base + 1) + ' (uneven — use BYE slots)';
    const playoffTeams = numGroups * (t.qualifiersPerGroup || 2);
    const bSize = Math.pow(2, Math.ceil(Math.log2(Math.max(playoffTeams, 2))));
    const byes = bSize - playoffTeams;
    el.textContent = '→ ' + groupInfo + ' · ' + playoffTeams + ' to playoffs' +
      (byes > 0 ? ' · ' + byes + ' playoff BYE' + (byes > 1 ? 's' : '') : '');
  } else {
    const bracketSize = Math.pow(2, Math.ceil(Math.log2(Math.max(totalTeams, 2))));
    const byes = bracketSize - totalTeams;
    el.textContent = byes === 0
      ? '→ ' + bracketSize + '-team bracket, no BYEs'
      : '→ ' + bracketSize + '-slot bracket · ' + byes + ' BYE' + (byes > 1 ? 's' : '') + ' (top seed' + (byes > 1 ? 's' : '') + ' advance automatically)';
  }
}

let _gsEditMode      = false;
let _schedEditMode   = false;
let _groupsEditMode  = false;
let _playoffsEditMode = false;

function _applyEditMode(on, btnId, extraIds, renderFn, label) {
  const btn = g(btnId);
  if (btn) { btn.textContent = on ? 'Done Editing' : label; btn.classList.toggle('btn-primary', on); }
  (extraIds || []).forEach(function(id) {
    const el = g(id);
    if (!el) return;
    el.style.display = on ? (el.dataset.editDisplay || '') : 'none';
  });
  if (renderFn) renderFn();
}

function setGsEditMode(on) {
  _gsEditMode = on;
  const btn = g('gs-edit-btn');
  if (btn) { btn.textContent = on ? 'Done Editing' : 'Edit'; btn.classList.toggle('btn-primary', on); }
  // Reset Series only in edit mode
  const resetBtn = g('gs-reset-series-btn');
  if (resetBtn) resetBtn.style.display = on ? '' : 'none';
  // Load Team buttons visible only in edit mode
  document.querySelectorAll('.gs-load-team-btn').forEach(function(el) { el.style.display = on ? '' : 'none'; });
  // Format select and Fearless checkbox editable only in edit mode
  const fmtEl = g('gs-format');   if (fmtEl)  fmtEl.disabled  = !on;
  const fearEl = g('gs-fearless'); if (fearEl) fearEl.disabled = !on;
  // Re-render series tracker to show/hide edit-only controls
  if (window._state) renderSeriesTracker(window._state);
}

// Saves format/fearless edits to both match state and linked schedule game
function gsEditSave(patch) { api('/api/match/edit-save', patch); }

function setSchedEditMode(on) {
  _schedEditMode = on;
  _applyEditMode(on, 'sched-edit-btn', ['sched-add-day-btn'], renderSchedule, 'Edit Schedule');
}
function setGroupsEditMode(on) {
  _groupsEditMode = on;
  _applyEditMode(on, 'groups-edit-btn', ['groups-add-btn'],
    function() { if (window._state) renderGroupsList(window._state.tournament); }, 'Edit Groups');
}
function setPlayoffsEditMode(on) {
  _playoffsEditMode = on;
  _applyEditMode(on, 'playoffs-edit-btn', ['playoffs-edit-btns'], renderBracketEditor, 'Edit Bracket');
}

function _guardEditMode(tabKey) {
  const guards = [
    { mode: _gsEditMode,       tab: 'game',     clear: function() { setGsEditMode(false); } },
    { mode: _schedEditMode,    tab: 'schedule', clear: function() { setSchedEditMode(false); } },
    { mode: _groupsEditMode,   tab: 'groups',   clear: function() { setGroupsEditMode(false); } },
    { mode: _playoffsEditMode, tab: 'playoffs',  clear: function() { setPlayoffsEditMode(false); } },
  ];
  for (var i = 0; i < guards.length; i++) {
    var g = guards[i];
    if (g.mode && tabKey !== g.tab) {
      if (!confirm('You have ' + g.tab.charAt(0).toUpperCase() + g.tab.slice(1) + ' editing enabled — exit edit mode?')) return false;
      g.clear();
    }
  }
  return true;
}

function switchToTab(tabKey) {
  if (!_guardEditMode(tabKey)) return;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const navEl = document.querySelector('.nav-item[data-tab="' + tabKey + '"]');
  const tabEl = g('tab-' + tabKey);
  if (navEl) navEl.classList.add('active');
  if (tabEl) tabEl.classList.add('active');
  loadTeamsCache();
  if (tabKey === 'users')    loadUsersTab();
  if (tabKey === 'profiles') loadProfilesTab();
  if (tabKey === 'home')     renderDashboard(window._state);
  localStorage.setItem('gfx_ctrl_tab', tabKey);
}

function renderGroupsTab(state) {
  const t = state && state.tournament;
  if (!t) return;
  renderGroupsList(t);
  renderStandingsAndSeedings(state);
}

function renderGroupsList(t) {
  const list = g('groups-list'); if (!list) return;
  const groups = t.groups || [];
  const teams = window._cachedTeams || [];
  if (groups.length === 0) { list.innerHTML = '<p class="hint">No groups yet.</p>'; return; }

  // Build set of ALL team IDs already assigned to any group — each team can only be in one group
  const assignedIds = new Set(groups.flatMap(grp => grp.teamIds || []));

  list.innerHTML = groups.map(grp => {
    const teamIds = grp.teamIds || [];
    const lastIdx = teamIds.length - 1;

    const teamsHtml = _groupsEditMode
      // Edit mode: vertical list with ↑/↓ reorder + remove
      ? '<div class="group-team-list">' +
          teamIds.map((tid, idx) => {
            const tm = teams.find(x => x.id === tid);
            if (!tm) return '';
            return '<div class="group-team-row">' +
              '<span class="group-team-row-name">' + escHtml(tm.name || tm.tag) + '</span>' +
              '<button class="sched-reorder-btn" ' + (idx === 0 ? 'disabled style="opacity:0.25"' : '') +
                ' onclick="moveGroupTeam(\'' + grp.id + '\',\'' + tid + '\',\'up\')">↑</button>' +
              '<button class="sched-reorder-btn" ' + (idx === lastIdx ? 'disabled style="opacity:0.25"' : '') +
                ' onclick="moveGroupTeam(\'' + grp.id + '\',\'' + tid + '\',\'down\')">↓</button>' +
              '<button class="group-team-remove" onclick="removeGroupTeam(\'' + grp.id + '\',\'' + tid + '\')">×</button>' +
              '</div>';
          }).join('') +
          '<select class="group-add-team" onchange="addGroupTeam(\'' + grp.id + '\',this.value);this.value=\'\'">' +
          '<option value="">+ Add team</option>' +
          teams.filter(tm => !assignedIds.has(tm.id)).map(tm => '<option value="' + tm.id + '">' + escHtml(tm.name) + '</option>').join('') +
          '</select>' +
          '</div>'
      // View mode: compact chips
      : '<div class="group-teams">' +
          teamIds.map(tid => {
            const tm = teams.find(x => x.id === tid);
            return tm ? '<span class="group-team-chip">' + escHtml(tm.name || tm.tag) + '</span>' : '';
          }).join('') +
          '</div>';

    return '<div class="group-row">' +
      '<div class="group-header">' +
      '<input class="group-name-input" value="' + escHtml(grp.name) + '" onchange="api(\'/api/tournament/group/update\',{id:\'' + grp.id + '\',name:this.value})">' +
      (_groupsEditMode ? '<button class="btn btn-sm btn-danger" onclick="api(\'/api/tournament/group/delete\',{id:\'' + grp.id + '\'})">Delete</button>' : '') +
      '</div>' +
      teamsHtml +
      '</div>';
  }).join('');
}

function addGroup() { api('/api/tournament/group/add', { name: 'Group ' + String.fromCharCode(65 + ((window._state.tournament||{}).groups||[]).length) }); }

function addGroupTeam(groupId, teamId) {
  if (!teamId) return;
  const grp = ((window._state.tournament||{}).groups||[]).find(g => g.id === groupId);
  if (!grp) return;
  const ids = [...(grp.teamIds||[])];
  if (!ids.includes(teamId)) ids.push(teamId);
  api('/api/tournament/group/update', { id: groupId, teamIds: ids });
}
function removeGroupTeam(groupId, teamId) {
  const grp = ((window._state.tournament||{}).groups||[]).find(g => g.id === groupId);
  if (!grp) return;
  api('/api/tournament/group/update', { id: groupId, teamIds: (grp.teamIds||[]).filter(id => id !== teamId) });
}
function moveGroupTeam(groupId, teamId, direction) {
  const grp = ((window._state.tournament||{}).groups||[]).find(g => g.id === groupId);
  if (!grp) return;
  const ids = [...(grp.teamIds||[])];
  const idx = ids.indexOf(teamId);
  const ni  = direction === 'up' ? idx - 1 : idx + 1;
  if (idx < 0 || ni < 0 || ni >= ids.length) return;
  [ids[idx], ids[ni]] = [ids[ni], ids[idx]];
  api('/api/tournament/group/update', { id: groupId, teamIds: ids });
}

function generateGroups() {
  const numGroups = parseInt(g('ts-num-groups') && g('ts-num-groups').value) || 0;
  if (!numGroups) { alert('Set Number of Groups first.'); return; }
  const existing = ((window._state.tournament||{}).groups||[]);
  if (existing.length > 0 && !confirm('This will replace the ' + existing.length + ' existing group' + (existing.length > 1 ? 's' : '') + '. Continue?')) return;
  api('/api/tournament/generate-groups', { numGroups });
}

// ── Group Standings + Playoff Seedings ────────────────────────────────────────

function calculateGroupStandings(state) {
  const t = state.tournament;
  if (!t || !t.groups) return {};
  const teams = window._cachedTeams || [];
  const standings = {};

  t.groups.forEach(grp => {
    standings[grp.id] = (grp.teamIds || []).map(tid => {
      const tm = teams.find(x => x.id === tid);
      return { teamId: tid, name: tm ? tm.name : tid, tag: tm ? (tm.tag || tm.name) : tid, sw: 0, sl: 0, gw: 0, gl: 0 };
    });
  });

  (t.schedule || []).forEach(day => {
    (day.games || []).forEach(game => {
      if (game.stage !== 'groupStage' || !game.result || !game.result.completed) return;
      const r = game.result;
      Object.values(standings).forEach(grp => {
        const e1 = grp.find(e => e.teamId === game.team1Id);
        const e2 = grp.find(e => e.teamId === game.team2Id);
        if (!e1 || !e2) return;
        if (r.winner === 'team1') { e1.sw++; e2.sl++; } else { e2.sw++; e1.sl++; }
        e1.gw += r.team1SeriesScore || 0; e1.gl += r.team2SeriesScore || 0;
        e2.gw += r.team2SeriesScore || 0; e2.gl += r.team1SeriesScore || 0;
      });
    });
  });

  // Sort: series wins desc → game differential desc → head-to-head (simplified)
  Object.values(standings).forEach(grp => {
    grp.sort((a, b) => b.sw !== a.sw ? b.sw - a.sw : (b.gw - b.gl) - (a.gw - a.gl));
  });

  return standings;
}

function buildSeeds(state, standings) {
  const t = state.tournament;
  const qualN = t.qualifiersPerGroup || 2;
  const seeds = [];
  for (let pos = 0; pos < qualN; pos++) {
    (t.groups || []).forEach(grp => {
      const grpStandings = standings[grp.id] || [];
      const entry = grpStandings[pos];
      seeds.push(entry
        ? { name: entry.name, tag: entry.tag, teamId: entry.teamId, groupName: grp.name, groupPos: pos + 1, determined: entry.sw > 0 || entry.sl > 0 }
        : { name: 'TBD', tag: 'TBD', teamId: null, groupName: grp.name, groupPos: pos + 1, determined: false }
      );
    });
  }
  return seeds;
}

const getRoundName = n => ({ 1: 'Final', 2: 'Semifinals', 4: 'Quarterfinals', 8: 'Round of 16', 16: 'Round of 32' })[n] || ('Round of ' + n * 2);

function playoffTeamCount(t) {
  // When group stage: playoffs = numGroups × qualifiers per group
  if (t && t.hasGroupStage && t.numGroups > 0) return t.numGroups * (t.qualifiersPerGroup || 2);
  return (t && t.totalTeams) || 0;
}

function calcBracketSize(state, qualifierCount) {
  const t = state.tournament || {};
  const n = playoffTeamCount(t) || qualifierCount;
  return Math.pow(2, Math.ceil(Math.log2(Math.max(n, 2))));
}

let _generatedBracketRounds = null;

function renderStandingsAndSeedings(state) {
  const t = state && state.tournament;
  const hasGroups = t && t.hasGroupStage && t.groups && t.groups.length > 0;

  // ── Groups tab: standings tables ──────────────────────────────────
  const standingsEl = g('groups-standings-content');
  if (standingsEl && hasGroups) {
    const standings = calculateGroupStandings(state);
    const qualN = t.qualifiersPerGroup || 2;
    let html = '<div class="standings-grid">';
    (t.groups || []).forEach(grp => {
      const rows = standings[grp.id] || [];
      html += '<div class="standings-group"><div class="standings-group-title">' + escHtml(grp.name) + '</div>';
      html += '<table class="standings-table"><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>GD</th><th></th></tr></thead><tbody>';
      rows.forEach((e, i) => {
        const q = i < qualN, gd = e.gw - e.gl, played = e.sw + e.sl;
        html += '<tr class="' + (q ? 'standings-qualifies' : '') + '">' +
          '<td class="standings-rank">' + (i+1) + '</td>' +
          '<td class="standings-name">' + escHtml(e.tag) + '</td>' +
          '<td>' + e.sw + '</td><td>' + e.sl + '</td>' +
          '<td class="' + (gd > 0 ? 'standings-pos' : gd < 0 ? 'standings-neg' : '') + '">' + (played > 0 ? (gd > 0 ? '+' : '') + gd : '—') + '</td>' +
          '<td>' + (q ? '<span class="standings-q-badge">Q</span>' : '') + '</td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
    });
    html += '</div>';
    standingsEl.innerHTML = html;
  } else if (standingsEl) {
    standingsEl.innerHTML = '<p class="hint">Standings appear here as group stage games complete.</p>';
  }

  // ── Playoffs tab: bracket info bar ───────────────────────────────
  const biEl = g('po-bracket-info');
  if (biEl) {
    const totalTeams = (t && t.totalTeams) || 0;
    if (totalTeams > 0) {
      const bs = calcBracketSize(state, totalTeams);
      const byes = bs - totalTeams;
      biEl.textContent = bs + '-slot bracket · ' + totalTeams + ' teams' + (byes > 0 ? ' · ' + byes + ' BYE' + (byes > 1 ? 's' : '') : '');
      biEl.style.display = 'inline-block';
    } else {
      biEl.style.display = 'none';
    }
  }

  // ── Playoffs tab: seedings card ───────────────────────────────────
  const seedsCard = g('po-seedings-card');
  const manualCard = g('po-manual-hint-card');
  const seedsContent = g('po-seedings-content');
  const applyBtn = g('po-apply-btn');

  if (!hasGroups) {
    if (seedsCard) seedsCard.style.display = 'none';
    if (manualCard) manualCard.style.display = 'none';
    _generatedBracketRounds = null;
    return;
  }

  const standings2 = calculateGroupStandings(state);
  const seeds = buildSeeds(state, standings2);
  const seeding = t.playoffSeeding || 'manual';

  if (seeding === 'seeded') {
    if (seedsCard) seedsCard.style.display = 'block';
    if (manualCard) manualCard.style.display = 'none';
    if (!seedsContent) return;

    const bracketSize = calcBracketSize(state, seeds.length);
    const byes = bracketSize - seeds.length;
    const padded = [...seeds];
    for (let i = 0; i < byes; i++) padded.push({ name: 'BYE', tag: 'BYE', teamId: null, groupName: '', groupPos: 0, determined: false });

    let html = '';
    if (byes > 0) {
      html += '<p class="hint" style="margin-bottom:10px">Bracket size: ' + bracketSize + ' · Seeds: ' + seeds.length + ' · BYEs: ' + byes + ' — top ' + byes + ' seed' + (byes > 1 ? 's' : '') + ' advance automatically.</p>';
    }

    html += '<div class="seedings-list">';
    padded.forEach((s, i) => {
      const isBye = s.name === 'BYE';
      const posStr = s.groupPos === 1 ? '1st' : s.groupPos === 2 ? '2nd' : s.groupPos === 3 ? '3rd' : s.groupPos + 'th';
      html += '<div class="seed-row' + (!s.determined || isBye ? ' seed-tbd' : '') + '">' +
        '<span class="seed-num">' + (i + 1) + '</span>' +
        '<span class="seed-team">' + escHtml(isBye ? 'BYE' : s.determined ? s.tag : 'TBD') + '</span>' +
        '<span class="seed-group">' + (isBye ? '' : escHtml(s.groupName + ' ' + posStr)) + '</span>' +
        '</div>';
    });
    html += '</div>';

    const firstRoundMatchCount = bracketSize / 2;
    html += '<div class="seedings-matchups-title">' + escHtml(getRoundName(firstRoundMatchCount)) + ' Matchups</div>';
    html += '<div class="seedings-matchups">';
    for (let i = 0; i < firstRoundMatchCount; i++) {
      const hi = padded[i], lo = padded[bracketSize - 1 - i];
      const hiN = hi.name === 'BYE' ? 'BYE' : hi.determined ? hi.tag : 'TBD (' + hi.groupName + ' ' + (hi.groupPos === 1 ? '1st' : '2nd') + ')';
      const loN = lo.name === 'BYE' ? 'BYE' : lo.determined ? lo.tag : 'TBD (' + lo.groupName + ' ' + (lo.groupPos === 1 ? '1st' : '2nd') + ')';
      const isByeMatch = hi.name === 'BYE' || lo.name === 'BYE';
      html += '<div class="seedings-match' + (isByeMatch ? ' seedings-bye-match' : '') + '">' +
        '<span class="seedings-match-num">M' + (i + 1) + '</span>' +
        '<span class="seedings-match-teams">Seed ' + (i + 1) + ' <strong>' + escHtml(hiN) + '</strong>' +
        (isByeMatch ? ' <span class="bye-advance">— advances</span>' : ' vs Seed ' + (bracketSize - i) + ' <strong>' + escHtml(loN) + '</strong>') +
        '</span></div>';
    }
    html += '</div>';

    const rounds = generateBracketRounds(padded, bracketSize, t);
    _generatedBracketRounds = rounds;
    if (applyBtn) applyBtn.style.display = 'inline-flex';
    seedsContent.innerHTML = html;

  } else {
    if (seedsCard) seedsCard.style.display = 'none';
    if (manualCard) manualCard.style.display = 'block';
    if (applyBtn) applyBtn.style.display = 'none';
    _generatedBracketRounds = null;
  }
}

function generateBracketRounds(paddedSeeds, bracketSize, t) {
  const playoffFormat = t.playoffFormat || 'singleElim';
  const blank = () => ({ team1: { name: 'TBD', score: 0 }, team2: { name: 'TBD', score: 0 }, complete: false });

  if (playoffFormat === 'doubleElim') {
    const rounds = [];

    // Upper Bracket — same first-round seeding with BYEs
    const ubR1MatchCount = bracketSize / 2;
    const ubRounds = Math.log2(bracketSize);
    const ubR1 = { label: 'UB Round 1', track: 'upper', matches: [] };
    for (let i = 0; i < ubR1MatchCount; i++) {
      const hi = paddedSeeds[i], lo = paddedSeeds[bracketSize - 1 - i];
      const isBye = lo.name === 'BYE' || hi.name === 'BYE';
      ubR1.matches.push({
        team1: { name: hi.name === 'BYE' ? 'BYE' : hi.name, score: 0 },
        team2: { name: lo.name === 'BYE' ? 'BYE' : lo.name, score: 0 },
        complete: isBye,
        byeAdvance: isBye ? (hi.name === 'BYE' ? lo.name : hi.name) : ''
      });
    }
    rounds.push(ubR1);

    // Remaining UB rounds
    let ubMatches = Math.max(1, Math.floor(ubR1MatchCount / 2));
    for (let r = 1; r < ubRounds; r++) {
      const label = r === ubRounds - 2 ? 'UB Semifinals' : r === ubRounds - 1 ? 'UB Final' : 'UB Round ' + (r + 1);
      rounds.push({ label, track: 'upper', matches: Array.from({ length: ubMatches }, blank) });
      ubMatches = Math.max(1, Math.floor(ubMatches / 2));
    }

    // Lower Bracket
    const lbRoundCount = (ubRounds - 1) * 2;
    let lbMatches = Math.max(1, bracketSize / 4);
    for (let r = 0; r < lbRoundCount; r++) {
      const label = r === lbRoundCount - 1 ? 'LB Final' : 'LB Round ' + (r + 1);
      rounds.push({ label, track: 'lower', matches: Array.from({ length: Math.max(1, lbMatches) }, blank) });
      if (r % 2 === 1) lbMatches = Math.max(1, Math.floor(lbMatches / 2));
    }

    rounds.push({ label: 'Grand Finals', track: 'final', matches: [blank()] });
    return rounds;
  }

  // Single elimination
  const firstRoundMatchCount = bracketSize / 2;
  const firstRound = { label: getRoundName(firstRoundMatchCount), matches: [] };
  for (let i = 0; i < firstRoundMatchCount; i++) {
    const hi = paddedSeeds[i], lo = paddedSeeds[bracketSize - 1 - i];
    const isBye = lo.name === 'BYE' || hi.name === 'BYE';
    firstRound.matches.push({
      team1: { name: hi.name === 'BYE' ? 'BYE' : hi.name, score: 0 },
      team2: { name: lo.name === 'BYE' ? 'BYE' : lo.name, score: 0 },
      complete: isBye,
      byeAdvance: isBye ? (hi.name === 'BYE' ? lo.name : hi.name) : ''
    });
  }
  const rounds = [firstRound];
  let size = firstRoundMatchCount;
  while (size > 1) {
    size = Math.ceil(size / 2);
    rounds.push({ label: getRoundName(size), matches: Array.from({ length: size }, blank) });
  }
  if (t.thirdPlaceMatch) {
    rounds.push({ label: '3rd Place', matches: [blank()] });
  }
  return rounds;
}

function applyGeneratedBracket() {
  if (!_generatedBracketRounds) { alert('Generate seedings first.'); return; }
  const tournName = (window._state.match || {}).tournament || 'PLAYOFF BRACKET';
  if (!confirm('This will overwrite the current bracket rounds. Continue?')) return;
  api('/api/tournament/apply-bracket', { rounds: _generatedBracketRounds, title: tournName + ' — PLAYOFFS' });
}

// ── Bracket pre-generation from Tournament Setup ──────────────────────────────

let _previewBracketRounds = null;

function previewBracketGeneration() {
  const t = window._state && window._state.tournament;
  if (!t) return;
  const teamsInBracket = playoffTeamCount(t);
  if (!teamsInBracket) {
    alert(t.hasGroupStage
      ? 'Set Number of Groups and Teams Advancing per Group first.'
      : 'Set Total Teams in Tournament first.');
    return;
  }

  const playoffFormat = t.playoffFormat || 'singleElim';
  const thirdPlace = !!(t.thirdPlaceMatch && playoffFormat !== 'doubleElim');
  const bracketSize = Math.pow(2, Math.ceil(Math.log2(Math.max(teamsInBracket, 2))));
  const byes = bracketSize - teamsInBracket;

  let rounds = [];
  if (playoffFormat === 'singleElim') {
    let matchCount = bracketSize / 2;
    while (matchCount >= 1) {
      rounds.push({
        label: getRoundName(matchCount),
        matches: Array.from({ length: matchCount }, (_, i) => ({
          team1: { name: i < byes ? (rounds.length === 0 ? 'Seed ' + (i + 1) : 'TBD') : 'TBD', score: 0 },
          team2: { name: i < byes && rounds.length === 0 ? 'BYE' : 'TBD', score: 0 },
          complete: i < byes && rounds.length === 0
        }))
      });
      matchCount = Math.floor(matchCount / 2);
    }
    if (thirdPlace) rounds.push({ label: '3rd Place', matches: [{ team1: { name: 'TBD', score: 0 }, team2: { name: 'TBD', score: 0 }, complete: false }] });
  } else {
    // Double elimination skeleton
    const ubRounds = Math.log2(bracketSize); // number of UB rounds
    let ubMatches = bracketSize / 2;
    for (let r = 0; r < ubRounds; r++) {
      const label = r === 0 ? 'UB Round 1' : r === ubRounds - 2 ? 'UB Semifinals' : r === ubRounds - 1 ? 'UB Final' : 'UB Round ' + (r + 1);
      rounds.push({ label, track: 'upper', matches: Array.from({ length: ubMatches }, () => ({ team1: { name: 'TBD', score: 0 }, team2: { name: 'TBD', score: 0 }, complete: false })) });
      ubMatches = Math.max(1, Math.floor(ubMatches / 2));
    }
    // Lower bracket: roughly 2*(log2(bracketSize)-1) rounds
    const lbRoundCount = (ubRounds - 1) * 2;
    let lbMatches = bracketSize / 4;
    for (let r = 0; r < lbRoundCount; r++) {
      const label = r === lbRoundCount - 1 ? 'LB Final' : 'LB Round ' + (r + 1);
      rounds.push({ label, track: 'lower', matches: Array.from({ length: Math.max(1, lbMatches) }, () => ({ team1: { name: 'TBD', score: 0 }, team2: { name: 'TBD', score: 0 }, complete: false })) });
      if (r % 2 === 1) lbMatches = Math.max(1, Math.floor(lbMatches / 2));
    }
    rounds.push({ label: 'Grand Finals', track: 'final', matches: [{ team1: { name: 'TBD', score: 0 }, team2: { name: 'TBD', score: 0 }, complete: false }] });
  }

  _previewBracketRounds = rounds;

  // Build preview HTML
  const totalMatches = rounds.reduce((sum, r) => sum + r.matches.length, 0);
  let html = '<p style="margin-bottom:12px;font-size:1em;font-weight:500;color:var(--accent)">';
  html += bracketSize + '-slot bracket · ' + teamsInBracket + ' teams';
  if (byes > 0) html += ' · <strong>' + byes + ' BYE' + (byes > 1 ? 's' : '') + '</strong> (top seed' + (byes > 1 ? 's' : '') + ' advance round 1 automatically)';
  html += ' · ' + rounds.length + ' rounds · ' + totalMatches + ' total matches';
  html += '</p>';

  html += '<div class="bracket-preview-rounds">';
  rounds.forEach(r => {
    const bye = r.matches.filter(m => m.team2.name === 'BYE').length;
    html += '<div class="bracket-preview-round">' +
      '<span class="bpr-label">' + escHtml(r.label) + '</span>' +
      '<span class="bpr-count">' + r.matches.length + ' match' + (r.matches.length > 1 ? 'es' : '') + (bye > 0 ? ' · ' + bye + ' BYE' : '') + '</span>' +
      '</div>';
  });
  html += '</div>';

  if (bracketRounds && bracketRounds.length > 0) {
    html += '<p class="hint" style="margin-top:10px;color:var(--danger)">⚠ This will replace the ' + bracketRounds.length + ' existing round' + (bracketRounds.length > 1 ? 's' : '') + ' in the Playoffs tab.</p>';
  }

  const card = g('ts-bracket-preview-card');
  const content = g('ts-bracket-preview-content');
  if (content) content.innerHTML = html;
  if (card) {
    card.style.display = 'block';
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function confirmApplyBracket() {
  if (!_previewBracketRounds) return;
  const tournName = (window._state.match || {}).tournament || 'TOURNAMENT BRACKET';
  api('/api/tournament/apply-bracket', { rounds: _previewBracketRounds, title: tournName + ' — PLAYOFFS' }).then(() => {
    const card = g('ts-bracket-preview-card');
    if (card) card.style.display = 'none';
    _previewBracketRounds = null;
  });
}

// ── Schedule Tab ───────────────────────────────────────────────────────────────
window._cachedTeams = [];
loadTeamsCache();    // pre-warm on page load
loadProfilesTab();   // load profiles on startup (default landing tab)

function loadTeamsCache() {
  fetch('/api/teams').then(r => r.json()).then(d => {
    window._cachedTeams = d.teams || [];
    renderSchedule();
    const s = window._state;
    if (s && s.tournament) {
      renderGroupsList(s.tournament);
      renderStandingsAndSeedings(s);
    }
  }).catch(() => {});
}

// Load teams cache when schedule or tournament tab opened
document.querySelectorAll('.nav-item[data-tab="schedule"], .nav-item[data-tab="tournament"], .nav-item[data-tab="game"], .nav-item[data-tab="draft"], .nav-item[data-tab="groups"], .nav-item[data-tab="playoffs"]').forEach(el => {
  el.addEventListener('click', loadTeamsCache);
});
document.querySelectorAll('.nav-item[data-tab="groups"]').forEach(el => {
  el.addEventListener('click', () => renderGroupsTab(window._state));
});
document.querySelectorAll('.nav-item[data-tab="playoffs"]').forEach(el => {
  el.addEventListener('click', () => renderStandingsAndSeedings(window._state));
});

function renderSchedule() {
  const days = (window._state && window._state.tournament && window._state.tournament.schedule) || [];
  const container = g('schedule-days'); if (!container) return;
  const empty = g('schedule-empty');
  if (empty) empty.style.display = days.length === 0 ? 'block' : 'none';

  container.innerHTML = days.map(day => {
    const dateStr = day.date ? ' · ' + day.date : '';
    return '<div class="sched-day-card" id="sday-' + day.id + '">' +
      '<div class="sched-day-header">' +
      '<div class="sched-day-title">' +
      '<input class="sched-day-name-input" value="' + escHtml(day.label) + '" onchange="api(\'/api/schedule/day/update\',{id:\'' + day.id + '\',label:this.value})">' +
      '<input class="sched-day-date-input" type="date" value="' + escHtml(day.date||'') + '" onchange="api(\'/api/schedule/day/update\',{id:\'' + day.id + '\',date:this.value})" title="Broadcast date (optional)">' +
      '</div>' +
      '<div style="display:flex;gap:6px">' +
      (_schedEditMode ? '<button class="btn btn-sm btn-primary" onclick="openAddGameForm(\'' + day.id + '\')">+ Game</button>' : '') +
      (_schedEditMode ? '<button class="btn btn-sm btn-danger" onclick="if(confirm(\'Delete this broadcast day?\'))api(\'/api/schedule/day/delete\',{id:\'' + day.id + '\'})">Delete Day</button>' : '') +
      '</div></div>' +
      '<div class="sched-games-list" id="sgames-' + day.id + '">' + renderDayGames(day) + '</div>' +
      '<div class="sched-add-game-form" id="sadd-' + day.id + '" style="display:none"></div>' +
      '</div>';
  }).join('');
}

function renderDayGames(day) {
  const teams   = window._cachedTeams || [];
  const bRounds = (window._state && window._state.bracket && window._state.bracket.rounds) || [];

  // Resolves a display name for a schedule-game team slot.
  // Priority: direct teamId → bracket match team name → override label → TBD
  function resolveTeamName(gm, slot) {
    const teamId = gm[slot + 'Id'];
    if (teamId) {
      const t = teams.find(t => t.id === teamId);
      return t ? (t.tag || t.name) : '?';
    }
    if (gm.bracketRoundIdx != null && gm.bracketMatchIdx != null) {
      const bRound = bRounds[gm.bracketRoundIdx];
      const bMatch = bRound && (bRound.matches || [])[gm.bracketMatchIdx];
      if (bMatch) {
        const bName = (bMatch[slot] && bMatch[slot].name) || '';
        if (bName && bName.indexOf('Winner of ') !== 0 && bName.indexOf('Loser of ') !== 0) {
          return bName;
        }
      }
    }
    return (gm[slot + 'Override'] && gm[slot + 'Override'].trim()) || 'TBD';
  }

  if (!day.games || day.games.length === 0) return '<p class="hint" style="margin:8px 0 0">No games yet.</p>';
  return day.games.map((gm, idx) => {
    const t1n = resolveTeamName(gm, 'team1');
    const t2n = resolveTeamName(gm, 'team2');
    const resultStr = gm.result && gm.result.completed ? ' ✓ ' + gm.result.team1SeriesScore + '–' + gm.result.team2SeriesScore : '';
    const stageLabel = getStageLabelFromKey(gm.stage);

    const completedGames = gm.result && gm.result.completed && Array.isArray(gm.result.games) ? gm.result.games : [];
    const hasDraftHistory = completedGames.some(sg => (sg.draftPicks || []).some(Boolean));
    const histId = 'sch-dh-' + gm.id;

    const isCompleted = !!(gm.result && gm.result.completed);

    let out = '<div class="sched-game-wrap">';
    out += '<div class="sched-game-row">' +
      '<span class="sched-game-num">' + (idx+1) + '</span>' +
      '<span class="sched-game-vs">' + escHtml(t1n) + ' <span class="vs-sep">vs</span> ' + escHtml(t2n) + '</span>' +
      '<span class="sched-game-meta">' + gm.format + ' · ' + escHtml(stageLabel) + (gm.fearlessDraft ? ' · Fearless' : '') + escHtml(resultStr) + '</span>' +
      '<div class="sched-game-btns">' +
      (hasDraftHistory ? '<button class="btn btn-sm ds-toggle-btn" id="dh-btn-' + histId + '" onclick="toggleDraftHistory(\'' + histId + '\')">▼ Draft</button>' : '') +
      (!isCompleted ? '<button class="btn btn-sm" onclick="openEditGameForm(\'' + day.id + '\',\'' + gm.id + '\')">Edit</button>' : '') +
      (_schedEditMode && idx > 0 ? '<button class="sched-reorder-btn" onclick="api(\'/api/schedule/game/reorder\',{dayId:\'' + day.id + '\',gameId:\'' + gm.id + '\',direction:\'up\'})">↑</button>' : '') +
      (_schedEditMode && idx < day.games.length-1 ? '<button class="sched-reorder-btn" onclick="api(\'/api/schedule/game/reorder\',{dayId:\'' + day.id + '\',gameId:\'' + gm.id + '\',direction:\'down\'})">↓</button>' : '') +
      (_schedEditMode ? '<button class="btn btn-sm btn-danger" onclick="if(confirm(\'Remove this game?\'))api(\'/api/schedule/game/delete\',{dayId:\'' + day.id + '\',gameId:\'' + gm.id + '\'})">×</button>' : '') +
      '</div></div>' +
      '<div id="sedit-' + gm.id + '" class="sched-edit-game-form" style="display:none"></div>';

    if (hasDraftHistory) {
      out += '<div id="' + histId + '" class="sch-draft-history" style="display:none">';
      completedGames.forEach(function(sg) {
        if (!(sg.draftPicks || []).some(Boolean)) return;
        const winnerTag = sg.winner === 'team1' ? t1n : t2n;
        out += '<div class="sch-game-draft-section">';
        out += '<div class="sch-game-draft-header">Game ' + sg.gameNum + ' — ' + escHtml(winnerTag) + ' WON</div>';
        out += buildDraftSnapshot(sg, t1n, t2n);
        out += '</div>';
      });
      out += '</div>';
    }

    out += '</div>'; // sched-game-wrap
    return out;
  }).join('');
}

const STAGE_LABEL_MAP = {
  groupStage:'Group Stage', roundOf16:'Round of 16', quarterfinals:'Quarterfinals',
  semifinals:'Semifinals', finals:'Finals', thirdPlace:'3rd Place',
  upperBracket:'Upper Bracket', lowerBracket:'Lower Bracket', lowerBracketFinal:'LB Final', grandFinals:'Grand Finals'
};

function renderAddGameForm(dayId) {
  const teams = window._cachedTeams || [];
  const t = window._state && window._state.tournament;
  const stageDefs = getScheduleStageOptions(t);
  const stageOpts = stageDefs.map(function(d) { return '<option value="' + d.key + '">' + escHtml(d.label) + '</option>'; }).join('');
  const teamOpts  = teams.map(function(tm) { return '<option value="' + tm.id + '">' + escHtml(tm.name) + '</option>'; }).join('');
  const isLol = !t || t.game === 'lol' || window._state.match.game === 'lol';
  return '<div class="sadd-form">' +
    '<div class="sadd-row"><label>Stage</label><select id="sadd-stage-' + dayId + '" onchange="updateAddGameStage(\'' + dayId + '\',this.value)">' + stageOpts + '</select></div>' +
    '<div class="sadd-row" id="sadd-match-row-' + dayId + '" style="display:none"><label>Match</label>' +
      '<select id="sadd-match-' + dayId + '" onchange="onBracketMatchSelect(\'' + dayId + '\',this.value)"><option value="">— select match (optional) —</option></select></div>' +
    '<div class="sadd-row"><label>Team 1</label><select id="sadd-t1-' + dayId + '"><option value="">— select —</option>' + teamOpts + '</select></div>' +
    '<div class="sadd-row"><label>Team 2</label><select id="sadd-t2-' + dayId + '"><option value="">— select —</option>' + teamOpts + '</select></div>' +
    '<div class="sadd-row"><label>Format</label><select id="sadd-format-' + dayId + '"><option>Bo1</option><option selected>Bo3</option><option>Bo5</option></select></div>' +
    (isLol ? '<div class="sadd-row"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;text-transform:none;letter-spacing:0;font-weight:400;color:var(--text);font-size:13px"><input type="checkbox" id="sadd-fearless-' + dayId + '"> Fearless Draft</label></div>' : '') +
    '<div class="sadd-row sadd-row-override"><label title="Optional: overrides the team display name, e.g. \'Winner of Semifinals 1\' for undecided slots">Team 1 Label</label><div class="sadd-override-wrap"><input type="text" id="sadd-t1override-' + dayId + '" placeholder="e.g. Winner of Semifinals 1">' + bracketRefSelectHtml('sadd-t1override-' + dayId) + '</div></div>' +
    '<div class="sadd-row sadd-row-override"><label title="Optional: overrides the team display name">Team 2 Label</label><div class="sadd-override-wrap"><input type="text" id="sadd-t2override-' + dayId + '" placeholder="e.g. Loser of Semifinals 1">' + bracketRefSelectHtml('sadd-t2override-' + dayId) + '</div></div>' +
    '<div style="display:flex;gap:8px;margin-top:8px">' +
    '<button class="btn btn-primary btn-sm" onclick="submitAddGame(\'' + dayId + '\')">Add Game</button>' +
    '<button class="btn btn-sm" onclick="closeAddGameForm(\'' + dayId + '\')">Cancel</button>' +
    '</div></div>';
}

function updateAddGameStage(dayId, stageKey) {
  updateAddGameFormat(dayId, stageKey);
  _syncBracketMatchRow(dayId, stageKey);
}

function updateAddGameFormat(dayId, stageKey) {
  const t = window._state && window._state.tournament;
  const stages = t && t.stages;
  const fmtEl = g('sadd-format-' + dayId);
  if (!fmtEl) return;
  if (stageKey && stageKey.startsWith('bracket-round-')) {
    // Infer format from bracket round position: last = Finals, second-to-last = Semis, else default
    const rounds = (window._state && window._state.bracket && window._state.bracket.rounds) || [];
    const ri = parseInt(stageKey.replace('bracket-round-', ''));
    const last = rounds.length - 1;
    if (ri === last && stages && stages.finals) fmtEl.value = stages.finals.format || 'Bo5';
    else if (ri === last - 1 && stages && stages.semifinals) fmtEl.value = stages.semifinals.format || 'Bo3';
    else fmtEl.value = 'Bo3';
    return;
  }
  if (stages && stages[stageKey]) fmtEl.value = stages[stageKey].format || 'Bo3';
}

function _syncBracketMatchRow(dayId, stageKey) {
  const matchRow = g('sadd-match-row-' + dayId);
  if (!matchRow) return;
  if (!stageKey || !stageKey.startsWith('bracket-round-')) { matchRow.style.display = 'none'; return; }
  const ri = parseInt(stageKey.replace('bracket-round-', ''));
  const rounds = (window._state && window._state.bracket && window._state.bracket.rounds) || [];
  const round = rounds[ri];
  if (!round) { matchRow.style.display = 'none'; return; }
  const valid = (round.matches || []).filter(function(m) {
    return (m.team1 && m.team1.name && m.team1.name.trim()) || (m.team2 && m.team2.name && m.team2.name.trim());
  });
  if (valid.length === 0) { matchRow.style.display = 'none'; return; }
  const sel = g('sadd-match-' + dayId);
  if (!sel) return;
  sel.innerHTML = '<option value="">— select match (optional) —</option>' +
    valid.map(function(m) {
      const origIdx = round.matches.indexOf(m);
      return '<option value="' + ri + '-' + origIdx + '">' +
        escHtml((m.team1 && m.team1.name || 'TBD') + ' vs ' + (m.team2 && m.team2.name || 'TBD')) + '</option>';
    }).join('');
  matchRow.style.display = '';
}

function onBracketMatchSelect(dayId, value) {
  if (!value) return;
  const parts = value.split('-');
  const ri = parseInt(parts[0]), mi = parseInt(parts[1]);
  const rounds = (window._state && window._state.bracket && window._state.bracket.rounds) || [];
  const match = rounds[ri] && (rounds[ri].matches || [])[mi];
  if (!match) return;
  const teams = window._cachedTeams || [];
  function findId(name) {
    if (!name || !name.trim()) return '';
    const lo = name.trim().toLowerCase();
    const found = teams.find(function(t) {
      return (t.tag && t.tag.toLowerCase() === lo) || (t.name && t.name.toLowerCase() === lo);
    });
    return found ? found.id : '';
  }
  const t1Sel = g('sadd-t1-' + dayId), t2Sel = g('sadd-t2-' + dayId);
  if (t1Sel && match.team1 && match.team1.name) { const id = findId(match.team1.name); if (id) t1Sel.value = id; }
  if (t2Sel && match.team2 && match.team2.name) { const id = findId(match.team2.name); if (id) t2Sel.value = id; }
}

function openAddGameForm(dayId) {
  const form = g('sadd-' + dayId); if (!form) return;
  form.innerHTML = renderAddGameForm(dayId); // rebuild fresh to pick up latest bracket data
  form.style.display = 'block';
  const stageEl = g('sadd-stage-' + dayId);
  if (stageEl) { updateAddGameFormat(dayId, stageEl.value); _syncBracketMatchRow(dayId, stageEl.value); }
}
function closeAddGameForm(dayId) {
  const form = g('sadd-' + dayId); if (form) form.style.display = 'none';
}

function submitAddGame(dayId) {
  const t1El = g('sadd-t1-' + dayId);
  const t2El = g('sadd-t2-' + dayId);
  const stageEl = g('sadd-stage-' + dayId);
  const fmtEl = g('sadd-format-' + dayId);
  const fearlessEl = g('sadd-fearless-' + dayId);
  const matchEl = g('sadd-match-' + dayId);
  const t1OvEl = g('sadd-t1override-' + dayId);
  const t2OvEl = g('sadd-t2override-' + dayId);
  api('/api/schedule/game/add', {
    dayId, team1Id: t1El && t1El.value, team2Id: t2El && t2El.value,
    team1Override: (t1OvEl && t1OvEl.value.trim()) || '',
    team2Override: (t2OvEl && t2OvEl.value.trim()) || '',
    stage: stageEl && stageEl.value, format: fmtEl && fmtEl.value,
    fearlessDraft: fearlessEl && fearlessEl.checked,
    bracketMatchRef: matchEl && matchEl.value || '',
  }).then(() => closeAddGameForm(dayId));
}

// ── Schedule game inline editing ───────────────────────────────────────────────
function renderScheduleGameEditForm(dayId, game) {
  const teams  = window._cachedTeams || [];
  const t = window._state && window._state.tournament;
  const stageDefs = getScheduleStageOptions(t);
  const isLol = !t || t.game === 'lol' || window._state.match.game === 'lol';
  const gid   = game.id;
  const teamOpts = function(selectedId) {
    return '<option value="">— TBD —</option>' +
      teams.map(function(tm) {
        return '<option value="' + tm.id + '"' + (tm.id === selectedId ? ' selected' : '') + '>' + escHtml(tm.name) + '</option>';
      }).join('');
  };
  const stageOpts = stageDefs.map(function(d) {
    return '<option value="' + d.key + '"' + (d.key === game.stage ? ' selected' : '') + '>' + escHtml(d.label) + '</option>';
  }).join('');
  const fmts = ['Bo1','Bo3','Bo5'];
  const fmtOpts = fmts.map(function(f) { return '<option' + (f === game.format ? ' selected' : '') + '>' + f + '</option>'; }).join('');

  return '<div class="sadd-form sedit-form">' +
    '<div class="sadd-row"><label>Stage</label><select id="sedit-stage-' + gid + '">' + stageOpts + '</select></div>' +
    '<div class="sadd-row"><label>Team 1</label><select id="sedit-t1-' + gid + '">' + teamOpts(game.team1Id) + '</select></div>' +
    '<div class="sadd-row"><label>Team 2</label><select id="sedit-t2-' + gid + '">' + teamOpts(game.team2Id) + '</select></div>' +
    '<div class="sadd-row"><label>Format</label><select id="sedit-format-' + gid + '">' + fmtOpts + '</select></div>' +
    (isLol ? '<div class="sadd-row"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;text-transform:none;letter-spacing:0;font-weight:400;color:var(--text);font-size:13px"><input type="checkbox" id="sedit-fearless-' + gid + '"' + (game.fearlessDraft ? ' checked' : '') + '> Fearless Draft</label></div>' : '') +
    '<div class="sadd-row sadd-row-override"><label>Team 1 Label</label><div class="sadd-override-wrap"><input type="text" id="sedit-t1override-' + gid + '" value="' + escHtml(game.team1Override || '') + '" placeholder="e.g. Winner of Semifinals 1">' + bracketRefSelectHtml('sedit-t1override-' + gid) + '</div></div>' +
    '<div class="sadd-row sadd-row-override"><label>Team 2 Label</label><div class="sadd-override-wrap"><input type="text" id="sedit-t2override-' + gid + '" value="' + escHtml(game.team2Override || '') + '" placeholder="e.g. Loser of Semifinals 1">' + bracketRefSelectHtml('sedit-t2override-' + gid) + '</div></div>' +
    '<div style="display:flex;gap:8px;margin-top:8px">' +
    '<button class="btn btn-primary btn-sm" onclick="submitEditGame(\'' + dayId + '\',\'' + gid + '\')">Save</button>' +
    '<button class="btn btn-sm" onclick="closeEditGameForm(\'' + gid + '\')">Cancel</button>' +
    '</div></div>';
}

function openEditGameForm(dayId, gameId) {
  const container = g('sedit-' + gameId); if (!container) return;
  const s = window._state;
  const day  = s && s.tournament && (s.tournament.schedule || []).find(function(d) { return d.id === dayId; });
  const game = day && (day.games || []).find(function(g) { return g.id === gameId; });
  if (!game) return;
  container.innerHTML = renderScheduleGameEditForm(dayId, game);
  container.style.display = 'block';
}
function closeEditGameForm(gameId) {
  const c = g('sedit-' + gameId); if (c) { c.style.display = 'none'; c.innerHTML = ''; }
}
function submitEditGame(dayId, gameId) {
  const t1El    = g('sedit-t1-' + gameId);
  const t2El    = g('sedit-t2-' + gameId);
  const stEl    = g('sedit-stage-' + gameId);
  const fmtEl   = g('sedit-format-' + gameId);
  const fearEl  = g('sedit-fearless-' + gameId);
  const t1OvEl  = g('sedit-t1override-' + gameId);
  const t2OvEl  = g('sedit-t2override-' + gameId);
  api('/api/schedule/game/update', {
    dayId, gameId,
    team1Id:       t1El  && t1El.value,
    team2Id:       t2El  && t2El.value,
    stage:         stEl  && stEl.value,
    format:        fmtEl && fmtEl.value,
    fearlessDraft: !!(fearEl && fearEl.checked),
    team1Override: (t1OvEl && t1OvEl.value.trim()) || '',
    team2Override: (t2OvEl && t2OvEl.value.trim()) || '',
  }).then(function() { closeEditGameForm(gameId); });
}

function addScheduleDay() {
  api('/api/schedule/day/add', { label: 'Day ' + (((window._state.tournament||{}).schedule||[]).length + 1) });
}

// ── Game Setup ─────────────────────────────────────────────────────────────────
let _gsSelectedDayId = null; // persists across tab switches and state re-renders

function onGsDayChange(dayId) {
  _gsSelectedDayId = dayId || null;
  renderScheduleGamePicker(dayId);
}

function renderGsDaySelect(s) {
  const sel = g('gs-day-select'); if (!sel) return;
  const schedule = (s.tournament || {}).schedule || [];
  // Use the persisted value; fall back to whatever the DOM currently shows
  const prev = _gsSelectedDayId || sel.value;
  // Check if prev day still exists in the schedule (guard against deletion / Reset All)
  const prevStillValid = prev && schedule.some(d => d.id === prev);
  const target = prevStillValid ? prev : null;

  sel.innerHTML = '<option value="">— select a day —</option>' +
    schedule.map(d => '<option value="' + d.id + '"' + (d.id === target ? ' selected' : '') + '>' +
      escHtml(d.label) + (d.date ? ' · ' + d.date : '') + '</option>').join('');

  if (target) {
    _gsSelectedDayId = target;
    renderScheduleGamePicker(target);
  } else {
    _gsSelectedDayId = null;
    // Auto-select today's date if nothing was previously chosen
    const today = new Date().toISOString().slice(0,10);
    const todayDay = schedule.find(d => d.date === today);
    if (todayDay) { sel.value = todayDay.id; _gsSelectedDayId = todayDay.id; renderScheduleGamePicker(todayDay.id); }
    else { const list = g('gs-game-list'); if (list) list.innerHTML = ''; }
  }
}

function renderScheduleGamePicker(dayId) {
  const list = g('gs-game-list'); if (!list) return;
  if (!dayId) { list.innerHTML = ''; return; }
  const s = window._state;
  const day = ((s.tournament||{}).schedule||[]).find(d => d.id === dayId);
  if (!day || !day.games || day.games.length === 0) { list.innerHTML = '<p class="hint">No games scheduled for this day.</p>'; return; }
  const teams   = window._cachedTeams || [];
  const bRounds = (s.bracket && s.bracket.rounds) || [];
  const activeGameId = s.match && s.match.scheduleGameId;
  list.innerHTML = day.games.map((gm, i) => {
    // Same resolution logic as renderDayGames: ID → bracket match → override → TBD
    function resolveGsTeam(slot) {
      const id = gm[slot + 'Id'];
      if (id) { const t = teams.find(t => t.id === id); return t ? t.name : '?'; }
      if (gm.bracketRoundIdx != null && gm.bracketMatchIdx != null) {
        const bm = ((bRounds[gm.bracketRoundIdx] || {}).matches || [])[gm.bracketMatchIdx];
        const bn = bm && bm[slot] && bm[slot].name;
        if (bn && bn.indexOf('Winner of ') !== 0 && bn.indexOf('Loser of ') !== 0) return bn;
      }
      return (gm[slot + 'Override'] && gm[slot + 'Override'].trim()) || 'TBD';
    }
    const t1n = resolveGsTeam('team1');
    const t2n = resolveGsTeam('team2');
    const isCompleted = !!(gm.result && gm.result.completed);
    const isActive    = gm.id === activeGameId && !isCompleted;
    const resultStr   = isCompleted ? ' ✓ ' + gm.result.team1SeriesScore + '–' + gm.result.team2SeriesScore : '';
    const btnLabel    = isActive ? '● Active' : (isCompleted ? 'Restore' : 'Set Active');
    const btnCls      = isActive ? ' btn-primary' : (isCompleted ? ' btn-secondary' : '');
    return '<div class="gs-sched-game' + (isActive ? ' gs-sched-active' : '') + (isCompleted && !isActive ? ' gs-sched-done' : '') + '">' +
      '<span class="gs-sched-num">' + (i+1) + '</span>' +
      '<span class="gs-sched-teams">' + escHtml(t1n) + ' <span class="vs-sep">vs</span> ' + escHtml(t2n) + '</span>' +
      '<span class="gs-sched-meta">' + (gm.stage ? escHtml(getStageLabelFromKey(gm.stage)) + ' · ' : '') + gm.format + (gm.fearlessDraft ? ' · Fearless' : '') + escHtml(resultStr) + '</span>' +
      '<button class="btn btn-sm' + btnCls + '" onclick="loadScheduleGame(\'' + dayId + '\',\'' + gm.id + '\')">' + btnLabel + '</button>' +
      '</div>';
  }).join('');
}

function loadScheduleGame(dayId, gameId) {
  const s = window._state;
  const day = ((s.tournament||{}).schedule||[]).find(function(d) { return d.id === dayId; });
  const gm  = day && day.games.find(function(g) { return g.id === gameId; });
  const isCompleted = !!(gm && gm.result && gm.result.completed);

  if (isCompleted) {
    if (!confirm('This game is already completed.\n\nRestore its saved state (teams, scores, draft) so you can review or edit it?')) return;
    api('/api/match/load-schedule-game', { dayId, gameId, restore: true }).then(function() {
      fetch('/api/teams').then(function(r) { return r.json(); }).then(function(d) { window._cachedTeams = d.teams||[]; });
    });
  } else {
    if (!confirm('Load this game? This will replace the current team data and reset the series.')) return;
    api('/api/match/load-schedule-game', { dayId, gameId }).then(function() {
      fetch('/api/teams').then(function(r) { return r.json(); }).then(function(d) { window._cachedTeams = d.teams||[]; });
    });
  }
}

function syncActiveGameIndicator(m) {
  const el = g('gs-active-indicator'); if (!el) return;
  if (!m.scheduleGameId) { el.style.display = 'none'; return; }
  const s = window._state;
  const day = ((s.tournament||{}).schedule||[]).find(d => d.id === m.scheduleDayId);
  const gm = day && day.games.find(g => g.id === m.scheduleGameId);
  if (!gm) { el.style.display = 'none'; return; }
  if (gm.result && gm.result.completed) { el.style.display = 'none'; return; }
  const teams = window._cachedTeams || [];
  const t1 = teams.find(t => t.id === gm.team1Id);
  const t2 = teams.find(t => t.id === gm.team2Id);
  const t1n = t1 ? (t1.tag || t1.name) : m.team1.tag || m.team1.name || 'T1';
  const t2n = t2 ? (t2.tag || t2.name) : m.team2.tag || m.team2.name || 'T2';
  el.style.display = 'block';
  const stageStr = gm.stage ? getStageLabelFromKey(gm.stage).toUpperCase() + ' · ' : '';
  el.textContent = '● ACTIVE GAME — ' + t1n.toUpperCase() + ' vs ' + t2n.toUpperCase() + ' · ' + stageStr + m.format + (m.fearlessDraft ? ' · FEARLESS' : '') + (day ? ' · ' + day.label.toUpperCase() : '');
}

// ── Broadcast Theme tab ────────────────────────────────────────────────────────

function patchSettings(data) { api('/api/settings', data); }

function isValidHex(h) { return /^#[0-9a-fA-F]{6}$/.test(h); }

function syncPaletteSwatch(idx, val) {
  const hexEl = g('ts-phex-' + idx);
  if (hexEl && document.activeElement !== hexEl) hexEl.value = val;
  const pal = JSON.parse(JSON.stringify(((window._state || {}).settings || {}).palette || [{},{},{},{}]));
  if (!pal[idx]) pal[idx] = {};
  pal[idx].hex = val;
  patchSettings({ palette: pal });
}
function syncPaletteHex(idx, val) {
  if (!isValidHex(val)) return;
  const sw = g('ts-pswatch-' + idx); if (sw) sw.value = val;
  const pal = JSON.parse(JSON.stringify(((window._state || {}).settings || {}).palette || [{},{},{},{}]));
  if (!pal[idx]) pal[idx] = {};
  pal[idx].hex = val;
  patchSettings({ palette: pal });
}
function patchPaletteName(idx, name) {
  const pal = JSON.parse(JSON.stringify(((window._state || {}).settings || {}).palette || [{},{},{},{}]));
  if (!pal[idx]) pal[idx] = {};
  pal[idx].name = name;
  patchSettings({ palette: pal });
}

function syncAccentSwatch(side, val) {
  const hexEl = g('ts-' + side + '-hex');
  if (hexEl && document.activeElement !== hexEl) hexEl.value = val;
  patchSettings(side === 'blue' ? { blueAccent: val } : { redAccent: val });
}
function syncAccentHex(side, val) {
  if (!isValidHex(val)) return;
  const sw = g('ts-' + side + '-swatch'); if (sw) sw.value = val;
  patchSettings(side === 'blue' ? { blueAccent: val } : { redAccent: val });
}

function setBgType(type) {
  patchSettings({ bgType: type });
  ['color', 'image', 'animation'].forEach(t => {
    const row = g('ts-bg-' + t + '-row'); if (row) row.style.display = t === type ? 'block' : 'none';
  });
  ['transparent', 'color', 'image', 'animation'].forEach(t => {
    const btn = g('ts-bg-' + t); if (btn) btn.classList.toggle('is-active', t === type);
  });
  const bgSpeedRow = g('ts-bgspeed-row');
  if (bgSpeedRow) bgSpeedRow.style.display = type === 'animation' ? 'block' : 'none';
}
const _BG_ANIMS = ['particles', 'scanlines', 'grid', 'hexgrid', 'diamonds', 'dotwave', 'lines', 'rings', 'circuit', 'rain', 'fog', 'wave'];

function setBgAnim(val) {
  patchSettings({ bgAnimation: val });
  _BG_ANIMS.forEach(a => {
    const btn = g('ts-bganim-' + a); if (btn) btn.classList.toggle('is-active', a === val);
  });
}
function syncBgColor(val) {
  const hexBg   = g('ts-bgcolor-hex');    if (hexBg   && document.activeElement !== hexBg)   hexBg.value   = val;
  const hexAnim = g('ts-animcolor-hex');  if (hexAnim && document.activeElement !== hexAnim)  hexAnim.value = val;
  patchSettings({ bgColor: val });
}
function syncBgColorHex(val) {
  if (!isValidHex(val)) return;
  const swBg   = g('ts-bgcolor-swatch');   if (swBg)   swBg.value   = val;
  const swAnim = g('ts-animcolor-swatch'); if (swAnim) swAnim.value = val;
  patchSettings({ bgColor: val });
}

function setBgSpeed(val) {
  patchSettings({ animation: { bgSpeed: val } });
  ['slow','medium','fast'].forEach(v => {
    const btn = g('ts-bgspeed-' + v); if (btn) btn.classList.toggle('is-active', v === val);
  });
}

function uploadThemeBg(input) {
  if (!input.files || !input.files[0]) return;
  const fd = new FormData(); fd.append('file', input.files[0]);
  fetch('/api/upload', { method: 'POST', body: fd }).then(r => r.json()).then(d => {
    if (d.url) { const el = g('ts-bg-img-url'); if (el) el.value = d.url; patchSettings({ bgImage: d.url }); }
  });
}

// Logo library
function addThemeLogo() {
  const logos = JSON.parse(JSON.stringify((((window._state || {}).settings || {}).logoSet || {}).logos || []));
  logos.push({ name: '', url: '' });
  patchSettings({ logoSet: { logos } });
}
function removeThemeLogo(i) {
  const logos = JSON.parse(JSON.stringify((((window._state || {}).settings || {}).logoSet || {}).logos || []));
  logos.splice(i, 1);
  patchSettings({ logoSet: { logos } });
}
function patchThemeLogo(i, key, val) {
  const logos = JSON.parse(JSON.stringify((((window._state || {}).settings || {}).logoSet || {}).logos || []));
  if (!logos[i]) logos[i] = { name: '', url: '' };
  logos[i][key] = val;
  patchSettings({ logoSet: { logos } });
}
function uploadThemeLogo(i, input) {
  if (!input.files || !input.files[0]) return;
  const fd = new FormData(); fd.append('file', input.files[0]);
  fetch('/api/upload', { method: 'POST', body: fd }).then(r => r.json()).then(d => {
    if (d.url) patchThemeLogo(i, 'url', d.url);
  });
}
function renderThemeLogos(logos) {
  const list = g('ts-logos-list'); if (!list) return;
  if (!logos || logos.length === 0) { list.innerHTML = '<p class="hint">No logos added yet.</p>'; return; }
  list.innerHTML = logos.map((logo, i) =>
    '<div class="theme-logo-row">' +
    '<div class="theme-logo-thumb" style="background-image:url(' + escHtml(logo.url || '') + ')"></div>' +
    '<input type="text" class="theme-logo-name" value="' + escHtml(logo.name || '') + '" placeholder="Logo name" onchange="patchThemeLogo(' + i + ',\'name\',this.value)">' +
    '<input type="file" id="ts-lf-' + i + '" accept="image/*" style="display:none" onchange="uploadThemeLogo(' + i + ',this)">' +
    '<button class="btn btn-sm" onclick="g(\'ts-lf-' + i + '\').click()">Upload</button>' +
    '<button class="btn btn-sm btn-danger" onclick="removeThemeLogo(' + i + ')">×</button>' +
    '</div>'
  ).join('');
}

function syncThemeTab(st) {
  if (!st) return;
  const { palette = [], blueAccent = '#1e6fff', redAccent = '#ff3b3b',
          bgType = 'transparent', bgColor = '#070f12', bgImage = '',
          bgAnimation = 'none', animation = {}, logoSet = {} } = st;
  const { bgSpeed = 'medium' } = animation;

  // Palette
  [0,1,2,3].forEach(i => {
    const slot = palette[i] || {};
    const hex = slot.hex || '#000000';
    const nameEl = g('ts-pname-' + i);   if (nameEl && document.activeElement !== nameEl) nameEl.value = slot.name || '';
    const swEl   = g('ts-pswatch-' + i); if (swEl)   swEl.value = hex;
    const hexEl  = g('ts-phex-' + i);   if (hexEl && document.activeElement !== hexEl)   hexEl.value = hex;
  });

  // Accents
  const bSw = g('ts-blue-swatch'); if (bSw) bSw.value = blueAccent;
  const bHx = g('ts-blue-hex');    if (bHx && document.activeElement !== bHx) bHx.value = blueAccent;
  const rSw = g('ts-red-swatch');  if (rSw) rSw.value = redAccent;
  const rHx = g('ts-red-hex');     if (rHx && document.activeElement !== rHx) rHx.value = redAccent;

  // Background type pills + sub-rows
  ['transparent','color','image','animation'].forEach(t => {
    const btn = g('ts-bg-' + t); if (btn) btn.classList.toggle('is-active', t === bgType);
  });
  ['color','image','animation'].forEach(t => {
    const row = g('ts-bg-' + t + '-row'); if (row) row.style.display = t === bgType ? 'block' : 'none';
  });

  // Background colour + image
  const bgSw = g('ts-bgcolor-swatch');   if (bgSw) bgSw.value = bgColor;
  const bgHx = g('ts-bgcolor-hex');      if (bgHx && document.activeElement !== bgHx) bgHx.value = bgColor;
  const anSw = g('ts-animcolor-swatch'); if (anSw) anSw.value = bgColor;
  const anHx = g('ts-animcolor-hex');    if (anHx && document.activeElement !== anHx) anHx.value = bgColor;
  const imgEl = g('ts-bg-img-url');      if (imgEl && document.activeElement !== imgEl) imgEl.value = bgImage;

  // Background animation type
  _BG_ANIMS.forEach(a => {
    const btn = g('ts-bganim-' + a); if (btn) btn.classList.toggle('is-active', a === bgAnimation);
  });

  // Background animation speed pills
  ['slow','medium','fast'].forEach(v => {
    const btn = g('ts-bgspeed-' + v); if (btn) btn.classList.toggle('is-active', v === bgSpeed);
  });

  // Fog layer toggle + intensity
  const fogChk = g('ts-fog-layer');
  if (fogChk) fogChk.checked = !!(st.bgFogLayer);
  const fogIntRow = g('ts-fog-intensity-row');
  if (fogIntRow) fogIntRow.style.display = st.bgFogLayer ? 'flex' : 'none';
  const fogInt = g('ts-fog-intensity');
  if (fogInt && document.activeElement !== fogInt) fogInt.value = st.bgFogIntensity != null ? st.bgFogIntensity : 50;

  // Logo library
  renderThemeLogos((logoSet.logos || []));
}

// ── BG Output tab ─────────────────────────────────────────────────────────────
function patchBgo(data) { api('/api/bgOutput', data); }

function setBgoType(type) {
  patchBgo({ bgType: type });
  ['transparent','color','image','animation'].forEach(t => {
    const btn = g('bgo-bg-' + t); if (btn) btn.classList.toggle('is-active', t === type);
  });
  ['color','image','animation'].forEach(t => {
    const row = g('bgo-bg-' + t + '-row'); if (row) row.style.display = t === type ? 'block' : 'none';
  });
}

function setBgoAnim(val) {
  patchBgo({ bgAnimation: val });
  _BG_ANIMS.forEach(a => {
    const btn = g('bgo-anim-' + a); if (btn) btn.classList.toggle('is-active', a === val);
  });
}

function setBgoSpeed(val) {
  patchBgo({ animation: { bgSpeed: val } });
  ['slow','medium','fast'].forEach(v => {
    const btn = g('bgo-speed-' + v); if (btn) btn.classList.toggle('is-active', v === val);
  });
}

function uploadBgoImage(input) {
  if (!input.files || !input.files[0]) return;
  const fd = new FormData(); fd.append('file', input.files[0]);
  fetch('/api/upload', { method: 'POST', body: fd }).then(r => r.json()).then(d => {
    if (d.url) { const el = g('bgo-img-url'); if (el) el.value = d.url; patchBgo({ bgImage: d.url }); }
  });
}

function openBgoWindow() {
  const token = (window._state && window._state.settings && window._state.settings.graphicsToken) || '';
  window.open(window.location.origin + '/graphics/bg-output/?token=' + token, '_blank', 'width=1280,height=720');
}

function syncBgoTab(bgo) {
  if (!bgo) return;
  const bgType      = bgo.bgType      || 'animation';
  const bgAnimation = bgo.bgAnimation || 'particles';
  const bgColor     = bgo.bgColor     || '#070f12';
  const bgSpeed     = (bgo.animation  || {}).bgSpeed || 'medium';

  ['transparent','color','image','animation'].forEach(t => {
    const btn = g('bgo-bg-' + t); if (btn) btn.classList.toggle('is-active', t === bgType);
  });
  ['color','image','animation'].forEach(t => {
    const row = g('bgo-bg-' + t + '-row'); if (row) row.style.display = t === bgType ? 'block' : 'none';
  });

  const imgEl = g('bgo-img-url');
  if (imgEl && document.activeElement !== imgEl) imgEl.value = bgo.bgImage || '';

  const cSw = g('bgo-color-swatch');       if (cSw) cSw.value = bgColor;
  const cHx = g('bgo-color-hex');          if (cHx && document.activeElement !== cHx) cHx.value = bgColor;
  const aSw = g('bgo-animcolor-swatch');   if (aSw) aSw.value = bgColor;
  const aHx = g('bgo-animcolor-hex');      if (aHx && document.activeElement !== aHx) aHx.value = bgColor;

  _BG_ANIMS.forEach(a => {
    const btn = g('bgo-anim-' + a); if (btn) btn.classList.toggle('is-active', a === bgAnimation);
  });
  ['slow','medium','fast'].forEach(v => {
    const btn = g('bgo-speed-' + v); if (btn) btn.classList.toggle('is-active', v === bgSpeed);
  });

  const fogChk = g('bgo-fog-layer');
  if (fogChk) fogChk.checked = !!bgo.bgFogLayer;
  const fogIntRow = g('bgo-fog-intensity-row');
  if (fogIntRow) fogIntRow.style.display = bgo.bgFogLayer ? 'flex' : 'none';
  const fogInt = g('bgo-fog-intensity');
  if (fogInt && document.activeElement !== fogInt) fogInt.value = bgo.bgFogIntensity != null ? bgo.bgFogIntensity : 50;
}

function renderThemeSponsorPreview(sponsorLogos) {
  const el = g('ts-sponsors-preview'); if (!el) return;
  const logos = sponsorLogos || [];
  if (logos.length === 0) {
    el.innerHTML = '<p class="hint">No sponsors added yet.</p>';
    return;
  }
  el.innerHTML = '<div class="theme-sponsor-preview">' +
    logos.map(url => '<div class="theme-sponsor-thumb" style="background-image:url(' + escHtml(url) + ')" title="' + escHtml(url) + '"></div>').join('') +
    '</div>';
}

function champNameFromUrl(v) {
  if (!v) return '';
  return v.split('/').pop().replace(/\.[^.]+$/, '').replace(/_\d+$/, '');
}

function renderSeriesTracker(s) {
  const container = g('gs-series-tracker'); if (!container) return;
  const m = s.match;
  const format = m.format || 'Bo3';
  const formatNum = parseInt(format.replace('Bo','')) || 3;
  const winsNeeded = Math.ceil(formatNum / 2);
  const seriesGames = m.seriesGames || [];
  const t1wins = m.team1.score || 0;
  const t2wins = m.team2.score || 0;
  const seriesOver = t1wins >= winsNeeded || t2wins >= winsNeeded;
  const currentGame = m.currentGameNum || 1;
  const fearless = !!m.fearlessDraft;
  const draft = s.draft || {};

  // Collect used champion names for fearless (from all completed games)
  const usedChampNames = new Set();
  if (fearless) {
    seriesGames.forEach(function(sg) {
      [...(sg.t1Picks||[]), ...(sg.t2Picks||[])].forEach(function(p) {
        if (p) usedChampNames.add(champNameFromUrl(p).toLowerCase());
      });
    });
  }

  let html = '<div class="series-header"><span class="series-score-disp">' +
    escHtml(m.team1.tag||m.team1.name||'T1') + ' <strong>' + t1wins + '</strong> — <strong>' + t2wins + '</strong> ' +
    escHtml(m.team2.tag||m.team2.name||'T2') + '</span><span class="series-game-disp">' +
    format + (seriesOver ? ' · Series Complete' : ' · Game ' + currentGame) + '</span></div>';

  // Completed games
  seriesGames.forEach(function(sg) {
    const winner = sg.winner === 'team1' ? (m.team1.tag||m.team1.name||'T1') : (m.team2.tag||m.team2.name||'T2');
    const hasDraft = (sg.draftPicks || []).some(Boolean);
    const draftId  = 'dh-sg-' + sg.gameNum + '-' + (m.currentGameNum || 0);
    html += '<div class="series-game-row completed">';
    html += '<div class="sg-summary-row">';
    html += '<span class="sg-label">Game ' + sg.gameNum + '</span>';
    html += '<span class="sg-winner' + (sg.isBye ? ' sg-winner-bye' : '') + '">' + escHtml(winner) + ' WON' + (sg.isBye ? ' (BYE)' : '') + '</span>';
    html += '<span class="sg-sides">' + escHtml(m.team1.tag||'T1') + ': ' + (sg.t1Side||'?').toUpperCase() + ' · ' + escHtml(m.team2.tag||'T2') + ': ' + (sg.t2Side||'?').toUpperCase() + '</span>';
    if (hasDraft) {
      html += '<button class="btn btn-xs ds-toggle-btn" id="dh-btn-' + draftId + '" onclick="toggleDraftHistory(\'' + draftId + '\')">▼ Draft</button>';
    }
    html += '</div>';
    if (fearless && (sg.t1Picks||[]).some(Boolean)) {
      html += '<span class="sg-picks">' +
        (sg.t1Picks||[]).filter(Boolean).map(function(p) { return '<span class="sg-pick-chip">' + escHtml(champNameFromUrl(p)||p) + '</span>'; }).join('') +
        (sg.t2Picks||[]).filter(Boolean).map(function(p) { return '<span class="sg-pick-chip">' + escHtml(champNameFromUrl(p)||p) + '</span>'; }).join('') +
      '</span>';
    }
    if (hasDraft) {
      html += '<div id="' + draftId + '" class="ds-snapshot" style="display:none">' +
        buildDraftSnapshot(sg, m.team1.tag||m.team1.name||'T1', m.team2.tag||m.team2.name||'T2') +
        '</div>';
    }
    html += '</div>';
  });

  // Current game — always show the status row; winner/confirm only in edit mode
  if (!seriesOver) {
    const t1n = escHtml(m.team1.tag||m.team1.name||'T1'), t2n = escHtml(m.team2.tag||m.team2.name||'T2');
    const blueSideTeam = draft.blueSideTeam || 'team1';
    const sideChooser  = draft.sideChooser  || '';
    const banFirstTeam = draft.banFirstTeam || 'blue';
    const t1SideLbl = blueSideTeam === 'team1' ? 'BLUE' : 'RED';
    const t2SideLbl = blueSideTeam === 'team1' ? 'RED'  : 'BLUE';
    const chooserTag = sideChooser ? escHtml((m[sideChooser]||{}).tag||(m[sideChooser]||{}).name||sideChooser) : '';
    const chosenSide = sideChooser ? (sideChooser === blueSideTeam ? 'BLUE' : 'RED') : '';

    html += '<div class="series-game-row current"><div class="sg-current-header"><span class="sg-label">Game ' + currentGame + '</span><span class="sg-in-progress">IN PROGRESS</span></div>';
    html += '<div class="sg-current-form">';
    // Sides — always visible
    html += '<div class="sg-field-row"><label>Sides</label>' +
      '<span class="sg-side-badge sg-side-' + t1SideLbl.toLowerCase() + '">' + t1n + ' ' + t1SideLbl + '</span>' +
      '<span class="sg-side-badge sg-side-' + t2SideLbl.toLowerCase() + '" style="margin-left:6px">' + t2n + ' ' + t2SideLbl + '</span></div>';
    if (sideChooser) {
      html += '<div class="sg-field-row"><label>Side Choice</label><span class="sg-info-text">' + chooserTag + ' chose ' + chosenSide + ' · ' + banFirstTeam.toUpperCase() + ' bans first</span></div>';
    }
    // Winner radio + confirm — edit mode only
    if (_gsEditMode) {
      html += '<div class="sg-field-row" style="margin-top:8px"><label>Winner</label><div class="radio-group"><label><input type="radio" name="sg-winner" value="team1"> ' + t1n + '</label><label><input type="radio" name="sg-winner" value="team2"> ' + t2n + '</label></div></div>';
      if (fearless && m.game === 'lol') {
        html += '<div class="sg-picks-section"><div class="sg-picks-label">' + t1n + ' Picks</div><div class="sg-picks-row" id="sg-t1-picks">';
        for (let i = 0; i < 5; i++) html += '<div class="cs-picker-container" id="sg-t1-pick-' + i + '"></div>';
        html += '</div><div class="sg-picks-label">' + t2n + ' Picks</div><div class="sg-picks-row" id="sg-t2-picks">';
        for (let i = 0; i < 5; i++) html += '<div class="cs-picker-container" id="sg-t2-pick-' + i + '"></div>';
        html += '</div></div>';
      }
      html += '<button class="btn btn-primary" style="margin-top:10px" onclick="confirmGameResult()">Confirm Game ' + currentGame + ' Result</button>';
      html += '<div class="sg-bye-row">' +
        '<span class="sg-bye-label">BYE Win</span>' +
        '<button class="btn btn-sm" onclick="recordBye(\'team1\',false)">+ ' + t1n + '</button>' +
        '<button class="btn btn-sm" onclick="recordBye(\'team2\',false)">+ ' + t2n + '</button>' +
        '<span class="sg-bye-sep">|</span>' +
        '<button class="btn btn-sm btn-danger" onclick="recordBye(\'team1\',true)">' + t1n + ' wins series (walkover)</button>' +
        '<button class="btn btn-sm btn-danger" onclick="recordBye(\'team2\',true)">' + t2n + ' wins series (walkover)</button>' +
        '</div>';
    } else {
      html += '<p class="hint" style="margin-top:6px">Enter Edit mode to record a result or adjust settings.</p>';
    }
    html += '</div></div>';
  }

  // Edit mode — Draft Settings section (shows whether series is over or in progress)
  if (_gsEditMode) {
    const t1n = escHtml(m.team1.tag||m.team1.name||'T1'), t2n = escHtml(m.team2.tag||m.team2.name||'T2');
    const blueSideTeam = draft.blueSideTeam || 'team1';
    const sideChooser  = draft.sideChooser  || '';
    const banFirstTeam = draft.banFirstTeam || 'blue';
    html += '<div class="sg-edit-section">';
    html += '<div class="sg-edit-header">Draft Settings</div>';
    html += '<div class="sg-field-row"><label>Blue Side</label><div class="radio-group">' +
      '<label><input type="radio" name="gs-blue-side" value="team1" ' + (blueSideTeam==='team1'?'checked':'') + ' onchange="api(\'/api/draft\',{blueSideTeam:\'team1\'})"> ' + t1n + '</label>' +
      '<label><input type="radio" name="gs-blue-side" value="team2" ' + (blueSideTeam==='team2'?'checked':'') + ' onchange="api(\'/api/draft\',{blueSideTeam:\'team2\'})"> ' + t2n + '</label>' +
      '</div></div>';
    html += '<div class="sg-field-row"><label>Side Choice</label><div class="radio-group">' +
      '<label><input type="radio" name="gs-side-chooser" value="team1" ' + (sideChooser==='team1'?'checked':'') + ' onchange="api(\'/api/draft\',{sideChooser:\'team1\'})"> ' + t1n + '</label>' +
      '<label><input type="radio" name="gs-side-chooser" value="team2" ' + (sideChooser==='team2'?'checked':'') + ' onchange="api(\'/api/draft\',{sideChooser:\'team2\'})"> ' + t2n + '</label>' +
      '</div></div>';
    html += '<div class="sg-field-row"><label>Bans First</label><div class="radio-group">' +
      '<label><input type="radio" name="gs-ban-first" value="blue" ' + (banFirstTeam==='blue'?'checked':'') + ' onchange="api(\'/api/draft\',{banFirstTeam:\'blue\'})"> Blue side</label>' +
      '<label><input type="radio" name="gs-ban-first" value="red" '  + (banFirstTeam==='red' ?'checked':'') + ' onchange="api(\'/api/draft\',{banFirstTeam:\'red\'})"> Red side</label>' +
      '</div></div>';
    html += '</div>';
  }

  if (fearless && usedChampNames.size > 0) {
    html += '<div class="fearless-pool"><div class="fearless-pool-label">Fearless Pool — Unavailable Champions</div>' +
      '<div class="fearless-chips">' + [...usedChampNames].map(function(n) {
        return '<span class="fearless-chip">' + escHtml(n) + '</span>';
      }).join('') + '</div></div>';
  }

  container.innerHTML = html;

  // Build champion pickers for fearless picks — only rendered when in edit mode
  if (!seriesOver && fearless && m.game === 'lol' && _gsEditMode) {
    const committed = { team1: draft.committedT1Picks || [], team2: draft.committedT2Picks || [] };
    ['team1','team2'].forEach(function(team) {
      const prefix = team === 'team1' ? 'sg-t1-pick-' : 'sg-t2-pick-';
      for (let i = 0; i < 5; i++) {
        const el = g(prefix + i); if (!el) continue;
        const initialVal = committed[team][i] || '';
        Champions.buildPicker(el, function(champ) { el._selectedChamp = champ ? (champ.url || '') : ''; }, initialVal);
        if (initialVal) el._selectedChamp = initialVal;
      }
    });
  }
}

function toggleDraftHistory(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const isOpen = el.style.display !== 'none';
  el.style.display = isOpen ? 'none' : 'block';
  const btn = document.getElementById('dh-btn-' + id);
  if (btn) btn.textContent = isOpen ? '▼ Draft' : '▲ Draft';
}

function buildDraftSnapshot(sg, t1Tag, t2Tag) {
  const draftPicks = sg.draftPicks || [];
  if (!draftPicks.some(Boolean)) {
    return '<p class="hint" style="margin:4px 0;font-size:11px">No draft data recorded.</p>';
  }
  const banFirst = sg.banFirstTeam || 'blue';
  const blueSide = sg.blueSideTeam || 'team1';

  const physBlueBanIdx  = banFirst === 'blue' ? BLUE_BAN_IDX  : RED_BAN_IDX;
  const physRedBanIdx   = banFirst === 'blue' ? RED_BAN_IDX   : BLUE_BAN_IDX;
  const physBluePickIdx = banFirst === 'blue' ? BLUE_PICK_IDX : RED_PICK_IDX;
  const physRedPickIdx  = banFirst === 'blue' ? RED_PICK_IDX  : BLUE_PICK_IDX;

  const t1BanIdx  = blueSide === 'team1' ? physBlueBanIdx  : physRedBanIdx;
  const t2BanIdx  = blueSide === 'team1' ? physRedBanIdx   : physBlueBanIdx;
  const t1PickIdx = blueSide === 'team1' ? physBluePickIdx : physRedPickIdx;
  const t2PickIdx = blueSide === 'team1' ? physRedPickIdx  : physBluePickIdx;

  const t1Bans  = t1BanIdx.map(function(i)  { return draftPicks[i] || ''; });
  const t2Bans  = t2BanIdx.map(function(i)  { return draftPicks[i] || ''; });
  const t1Picks = t1PickIdx.map(function(i) { return draftPicks[i] || ''; });
  const t2Picks = t2PickIdx.map(function(i) { return draftPicks[i] || ''; });

  const t1RolePicks = sg.t1RolePicks || [];
  const t2RolePicks = sg.t2RolePicks || [];
  const t1Players   = (sg.players && sg.players.team1) || [];
  const t2Players   = (sg.players && sg.players.team2) || [];

  const t1Side = (sg.t1Side || (blueSide === 'team1' ? 'blue' : 'red')).toUpperCase();
  const t2Side = (sg.t2Side || (blueSide === 'team1' ? 'red'  : 'blue')).toUpperCase();

  function banThumb(url, num) {
    var b = '<span class="ds-num">' + num + '</span>';
    if (!url) return '<span class="ds-thumb-wrap"><span class="ds-ban-empty"></span>' + b + '</span>';
    return '<span class="ds-thumb-wrap"><img class="ds-ban-img" src="' + escHtml(url) + '" onerror="this.style.display=\'none\'">' + b + '</span>';
  }
  function pickThumb(url, num) {
    var b = '<span class="ds-num">' + num + '</span>';
    if (!url) return '<span class="ds-thumb-wrap"><span class="ds-pick-empty"></span>' + b + '</span>';
    return '<span class="ds-thumb-wrap"><img class="ds-pick-img" src="' + escHtml(url) + '" onerror="this.style.display=\'none\'">' + b + '</span>';
  }

  // Self-contained team column: header + bans + picks
  function teamCol(tag, side, bans, picks, rolePicks, players) {
    var col = '<div class="ds-team-col">';
    col += '<div class="ds-col-header">' + escHtml(tag) +
      ' <span class="ds-side-tag ds-side-' + side.toLowerCase() + '">' + side + '</span></div>';
    col += '<div class="ds-col-bans">' + bans.map(function(u, i) { return banThumb(u, i + 1); }).join('') + '</div>';
    for (var i = 0; i < 5; i++) {
      var url  = picks[i] || '';
      var ri   = url ? rolePicks.indexOf(url) : -1;
      var role   = ri >= 0 ? ((players[ri] && players[ri].role)   || '') : '';
      var player = ri >= 0 ? ((players[ri] && players[ri].handle) || '') : '';
      var champ  = url ? champNameFromUrl(url) : '—';
      col += '<div class="ds-pick-row">' + pickThumb(url, i + 1) +
        '<span class="ds-pick-info">' +
          '<span class="ds-pick-champ">' + escHtml(champ) + '</span>' +
          '<span class="ds-pick-sub">' + escHtml((role || '') + (role && player ? ' · ' : '') + (player || '')) + '</span>' +
        '</span></div>';
    }
    col += '</div>';
    return col;
  }

  let html = '<div class="ds-panel">';

  // Two self-contained team columns (bans + picks each)
  html += '<div class="ds-teams-grid">';
  html += teamCol(t1Tag, t1Side, t1Bans, t1Picks, t1RolePicks, t1Players);
  html += teamCol(t2Tag, t2Side, t2Bans, t2Picks, t2RolePicks, t2Players);
  html += '</div>';

  // Full draft order — two columns of 10 steps each
  html += '<div class="ds-section-label" style="margin-top:10px">Draft Order</div>';
  html += '<div class="ds-seq-grid"><div class="ds-seq-col">';
  DRAFT_SEQUENCE.forEach(function(step, idx) {
    if (idx === 10) { html += '</div><div class="ds-seq-col">'; }
    var champUrl  = draftPicks[idx] || '';
    var physSide  = step.side === banFirst ? 'blue' : 'red';
    var isT1      = (physSide === 'blue') === (blueSide === 'team1');
    var teamLabel = escHtml(isT1 ? t1Tag : t2Tag);
    var sideClass = 'ds-side-' + physSide;
    var img = champUrl
      ? '<img class="ds-seq-img" src="' + escHtml(champUrl) + '" onerror="this.style.display=\'none\'">'
      : '<span class="ds-seq-img-empty"></span>';
    html += '<div class="ds-seq-step ' + (step.type === 'ban' ? 'ds-seq-ban' : 'ds-seq-pick') + '">' +
      '<span class="ds-seq-n">' + (idx + 1) + '</span>' +
      '<span class="ds-seq-tag ' + sideClass + '">' + teamLabel + '</span>' +
      img +
      '<span class="ds-seq-name">' + escHtml(champUrl ? champNameFromUrl(champUrl) : '—') + '</span>' +
      '<span class="ds-seq-type">' + (step.type === 'ban' ? 'BAN' : 'PICK') + '</span>' +
    '</div>';
  });
  html += '</div></div></div>'; // ds-seq-col + ds-seq-grid + ds-panel
  return html;
}

function confirmGameResult() {
  const winnerEl = document.querySelector('input[name="sg-winner"]:checked');
  if (!winnerEl) { alert('Please select a winner.'); return; }
  const winner = winnerEl.value;

  // Sides come from the draft tab's blue-side assignment — no separate radio needed
  const draft = window._state && window._state.draft;
  const blueSideTeam = (draft && draft.blueSideTeam) || 'team1';
  const t1Side = blueSideTeam === 'team1' ? 'blue' : 'red';
  const t2Side = blueSideTeam === 'team1' ? 'red'  : 'blue';

  const m = window._state && window._state.match;
  const fearless = m && m.fearlessDraft && m.game === 'lol';
  const t1RolePicks = (draft && draft.team1RolePicks) || [];
  const t2RolePicks = (draft && draft.team2RolePicks) || [];
  let t1Picks = [], t2Picks = [];
  if (fearless) {
    for (let i = 0; i < 5; i++) {
      const c1 = g('sg-t1-pick-' + i); if (c1 && c1._selectedChamp) t1Picks.push(c1._selectedChamp);
      const c2 = g('sg-t2-pick-' + i); if (c2 && c2._selectedChamp) t2Picks.push(c2._selectedChamp);
    }
  }

  api('/api/match/record-game', { winner, t1Side, t2Side, t1Picks, t2Picks, t1RolePicks, t2RolePicks }).then(function(res) {
    if (!res) return;
    // Reset draft for the next game when series continues (keep blue side)
    if (!res.seriesOver) {
      const board = g('draft-board');
      if (board) { board.innerHTML = ''; board.removeAttribute('data-built'); }
      Object.keys(_draftPickerContainers).forEach(function(k) { delete _draftPickerContainers[k]; });
      _raState.t1 = Array(5).fill(null); _raState.t2 = Array(5).fill(null); _raSig = '';
      const raEl = g('draft-role-assign'); if (raEl) raEl.innerHTML = '';
      api('/api/draft', {
        picks: Array(20).fill(''),
        currentStep: 0,
        phase: 'notstarted',
        committedT1Picks: [],
        committedT2Picks: [],
        team1RolePicks: [],
        team2RolePicks: [],
      });
    }
  });
}

function recordBye(winner, seriesWalkover) {
  const m = window._state && window._state.match;
  const teamName = m && m[winner] ? (m[winner].tag || m[winner].name || winner) : winner;
  const msg = seriesWalkover
    ? 'Award series walkover (BYE) to ' + teamName + '? This will fill remaining games and end the series.'
    : 'Record Game ' + ((m && m.currentGameNum) || 1) + ' as a BYE win for ' + teamName + '?';
  if (!confirm(msg)) return;
  api('/api/match/record-bye', { winner, seriesWalkover: !!seriesWalkover }).then(function(res) {
    if (!res) return;
    if (!res.seriesOver) {
      // Reset draft board for next game (same as confirmGameResult)
      const board = g('draft-board');
      if (board) { board.innerHTML = ''; board.removeAttribute('data-built'); }
      Object.keys(_draftPickerContainers).forEach(function(k) { delete _draftPickerContainers[k]; });
      _raState.t1 = Array(5).fill(null); _raState.t2 = Array(5).fill(null); _raSig = '';
      const raEl = g('draft-role-assign'); if (raEl) raEl.innerHTML = '';
      api('/api/draft', { picks: Array(20).fill(''), currentStep: 0, phase: 'notstarted', committedT1Picks: [], committedT2Picks: [], team1RolePicks: [], team2RolePicks: [] });
    }
  });
}

// Countdown ticker for the live bar display
setInterval(function() {
  const el = g('lbar-break-countdown');
  if (!el) return;
  const timerEnd = window._state.breakScreen && window._state.breakScreen.timerEnd;
  if (!timerEnd) { el.textContent = ''; el.className = 'lbar-break-countdown'; return; }
  const remaining = Math.max(0, timerEnd - Date.now());
  const totalSecs = Math.ceil(remaining / 1000);
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  el.textContent = m + ':' + String(s).padStart(2, '0');
  el.className = 'lbar-break-countdown' + (remaining === 0 ? ' expired' : '');
}, 500);

// ── Prizepool GFX tab ─────────────────────────────────────────────────────────
function patchPrizepool(data) { api('/api/prizepool', data); }

function syncPrizepoolTab(state) {
  const pp = state.prizepool || {};
  const scale = pp.logoScale != null ? pp.logoScale : 7;
  setInp('pp-logo-scale', scale);
  setText('pp-logo-scale-val', scale + 'vh');
  const pos = pp.logoPosition || 'left';
  ['left','center'].forEach(function(v) {
    const b = g('pp-logo-pos-' + v);
    if (b) b.classList.toggle('btn-active', pos === v);
  });
  const on = g('pp-logo-on'), off = g('pp-logo-off');
  if (on)  on.classList.toggle('btn-active', !!pp.showLogo);
  if (off) off.classList.toggle('btn-active', !pp.showLogo);

  // Don't rebuild the entries list while an input inside the tab is focused —
  // rebuilding destroys the element mid-keypress and kills focus.
  const ppTab   = g('tab-prizepool');
  const focused = document.activeElement;
  const editingEntry = !!(focused && ppTab && ppTab.contains(focused) &&
    (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.tagName === 'SELECT'));
  if (!editingEntry) renderPrizepoolEntries(pp.entries || []);
}

function renderPrizepoolEntries(entries) {
  const list = g('pp-entries-list'); if (!list) return;
  if (!entries.length) {
    list.innerHTML = '<p class="hint" style="margin:0">No prize entries yet. Add a placement or bonus award above.</p>';
    return;
  }
  list.innerHTML = entries.map(function(e, i) {
    const typeCls = e.type === 'placement' ? 'pp-badge-placement' : 'pp-badge-bonus';
    const typeLabel = e.type === 'placement' ? 'Placement' : 'Bonus';
    return (
      '<div class="pp-entry-row" id="pp-row-' + escHtml(e.id) + '">' +
        '<div class="pp-entry-summary">' +
          '<span class="pp-entry-badge ' + typeCls + '">' + typeLabel + '</span>' +
          (e.highlight ? '<span class="pp-entry-badge pp-badge-gf">★ Grand Final</span>' : '') +
          '<span class="pp-entry-label">' + escHtml(e.label || '(no label)') + '</span>' +
          '<span class="pp-entry-value">' + escHtml(e.value || '') + '</span>' +
          '<div class="pp-entry-btns">' +
            (i > 0             ? '<button class="btn btn-sm" onclick="ppReorder(\'' + e.id + '\',\'up\')">↑</button>' : '') +
            (i < entries.length-1 ? '<button class="btn btn-sm" onclick="ppReorder(\'' + e.id + '\',\'down\')">↓</button>' : '') +
            '<button class="btn btn-sm" id="pp-editbtn-' + e.id + '" onclick="ppToggleEdit(\'' + e.id + '\')">Edit</button>' +
            '<button class="btn btn-sm btn-danger" onclick="ppDelete(\'' + e.id + '\')">×</button>' +
          '</div>' +
        '</div>' +
        '<div id="pp-edit-' + e.id + '" style="display:none">' + buildPpEditForm(e) + '</div>' +
      '</div>'
    );
  }).join('');
}

function buildPpEditForm(e) {
  const id = e.id;
  return (
    '<div class="pp-edit-form">' +
      '<div class="field-row"><label>Type</label><div class="radio-group">' +
        '<label><input type="radio" name="pp-t-' + id + '" value="placement" ' + (e.type==='placement'?'checked':'') + ' onchange="ppUpdate(\'' + id + '\',{type:\'placement\'})"> Placement</label>' +
        '<label><input type="radio" name="pp-t-' + id + '" value="bonus"     ' + (e.type==='bonus'    ?'checked':'') + ' onchange="ppUpdate(\'' + id + '\',{type:\'bonus\'})"> Bonus / Sponsor</label>' +
      '</div></div>' +
      '<div class="field-row"><label>Label</label>' +
        '<input type="text" value="' + escHtml(e.label||'') + '" placeholder="e.g. 1st Place or Top KDA Award" style="flex:1" oninput="ppUpdate(\'' + id + '\',{label:this.value})">' +
      '</div>' +
      '<div class="field-row"><label>Value / Prize</label>' +
        '<input type="text" value="' + escHtml(e.value||'') + '" placeholder="e.g. $5,000 or Logitech G Pro X" style="flex:1" oninput="ppUpdate(\'' + id + '\',{value:this.value})">' +
      '</div>' +
      '<div class="field-row"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;letter-spacing:0;font-size:13px;color:var(--text);font-weight:400">' +
        '<input type="checkbox" ' + (e.highlight?'checked':'') + ' onchange="ppUpdate(\'' + id + '\',{highlight:this.checked})"> Top prize treatment (accent row)</label></div>' +
      (e.type === 'bonus' ? (
        '<div class="field-row"><label>Sponsor Name</label>' +
          '<input type="text" value="' + escHtml(e.sponsorName||'') + '" placeholder="e.g. Logitech" style="flex:1" oninput="ppUpdate(\'' + id + '\',{sponsorName:this.value})">' +
        '</div>' +
        '<div class="field-row"><label>Sponsor Logo</label><div class="upload-row">' +
          '<input type="text" id="pp-sl-' + id + '" value="' + escHtml(e.sponsorLogo||'') + '" placeholder="URL or upload" style="flex:1" oninput="ppUpdate(\'' + id + '\',{sponsorLogo:this.value})">' +
          '<button class="btn btn-sm" onclick="triggerUpload(\'pp-slf-' + id + '\',function(u){ppUpdate(\'' + id + '\',{sponsorLogo:u});g(\'pp-sl-' + id + '\').value=u;})">Upload</button>' +
          '<input type="file" id="pp-slf-' + id + '" accept="image/*" style="display:none">' +
        '</div></div>' +
        '<div class="field-row"><label>Prize Image</label><div class="upload-row">' +
          '<input type="text" id="pp-pi-' + id + '" value="' + escHtml(e.prizeImage||'') + '" placeholder="Product photo URL or upload" style="flex:1" oninput="ppUpdate(\'' + id + '\',{prizeImage:this.value})">' +
          '<button class="btn btn-sm" onclick="triggerUpload(\'pp-pif-' + id + '\',function(u){ppUpdate(\'' + id + '\',{prizeImage:u});g(\'pp-pi-' + id + '\').value=u;})">Upload</button>' +
          '<input type="file" id="pp-pif-' + id + '" accept="image/*" style="display:none">' +
        '</div></div>' +
        (function() {
          var sc = e.imageScale != null ? e.imageScale : (e.imageSize === 'large' ? 26 : 15);
          return '<div class="field-row" style="gap:10px"><label style="white-space:nowrap">Image Scale</label>' +
            '<input type="range" id="pp-iscale-' + id + '" min="5" max="45" step="1" value="' + sc + '" style="flex:1" ' +
            'oninput="ppUpdate(\'' + id + '\',{imageScale:parseFloat(this.value)});g(\'pp-iscale-val-' + id + '\').textContent=this.value+\'vh\'">' +
            '<span id="pp-iscale-val-' + id + '" style="min-width:38px;text-align:right;font-size:12px;color:var(--text-dim)">' + sc + 'vh</span>' +
          '</div>';
        })()
      ) : '') +
    '</div>'
  );
}

function ppToggleEdit(id) {
  const el  = g('pp-edit-' + id);
  const btn = g('pp-editbtn-' + id);
  if (!el) return;
  const opening = el.style.display === 'none';
  el.style.display = opening ? 'block' : 'none';
  if (btn) btn.textContent = opening ? 'Save' : 'Edit';
}
function ppUpdate(id, fields) { api('/api/prizepool/entry/update', Object.assign({ id }, fields)); }
function ppDelete(id) { if (confirm('Remove this prize entry?')) api('/api/prizepool/entry/delete', { id }); }
function ppReorder(id, direction) { api('/api/prizepool/entry/reorder', { id, direction }); }
function ppAddEntry(type) { api('/api/prizepool/entry/add', { type: type || 'placement' }); }
