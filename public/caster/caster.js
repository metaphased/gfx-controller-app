'use strict';

const TOKEN = new URLSearchParams(window.location.search).get('token') || '';

const socket = io({ auth: { token: TOKEN }, query: { token: TOKEN } });

let _state = null;
let _teams = [];
let _activeTab = localStorage.getItem('casterTab') || 'roster';
let _tournamentStats = {};

// ── Draft constants (must match draft overlay exactly) ────────────────────────
const BLUE_BAN_IDX  = [0,2,4,13,15];
const RED_BAN_IDX   = [1,3,5,12,14];
const BLUE_PICK_IDX = [6,9,10,17,18];
const RED_PICK_IDX  = [7,8,11,16,19];

const DRAFT_SEQUENCE = [
  {team:'blue',type:'ban'}, {team:'red', type:'ban'},
  {team:'blue',type:'ban'}, {team:'red', type:'ban'},
  {team:'blue',type:'ban'}, {team:'red', type:'ban'},
  {team:'blue',type:'pick'},{team:'red', type:'pick'},
  {team:'red', type:'pick'},{team:'blue',type:'pick'},
  {team:'blue',type:'pick'},{team:'red', type:'pick'},
  {team:'red', type:'ban'}, {team:'blue',type:'ban'},
  {team:'red', type:'ban'}, {team:'blue',type:'ban'},
  {team:'red', type:'pick'},{team:'blue',type:'pick'},
  {team:'blue',type:'pick'},{team:'red', type:'pick'},
];

const DRAFT_PHASE_LABELS = {
  notstarted:'—', bans1:'Phase 1 Bans', picks1:'Phase 1 Picks',
  bans2:'Phase 2 Bans', picks2:'Phase 2 Picks', complete:'Complete',
};

let _draftTimerEnd = null;
setInterval(() => {
  const el = document.getElementById('draft-timer-val');
  if (!el) return;
  if (!_draftTimerEnd) { el.textContent = ''; return; }
  const secs = Math.max(0, Math.ceil((_draftTimerEnd - Date.now()) / 1000));
  el.textContent = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
}, 500);

// ── Countdown banner (time-to-live) ──────────────────────────────────────────────
// Mirrors the on-air pre-show / break countdowns so casters always see how long
// until the broadcast goes live / comes back, regardless of which tab they're on.
function fmtCountdown(secs) {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return (h > 0 ? h + ':' + String(m).padStart(2, '0') : String(m))
    + ':' + String(s).padStart(2, '0');
}

function computeCountdown(s) {
  if (!s) return null;
  const now = Date.now();
  const bs = s.breakScreen || {};
  const ps = s.preShow || {};
  // Break "back in" takes priority over pre-show when both are counting.
  if (bs.timerEnd && bs.timerEnd > now) {
    return { kind: 'break', endsAt: bs.timerEnd, label: 'BACK LIVE IN', note: bs.message || '' };
  }
  if (ps.timerEnd && ps.timerEnd > now) {
    return { kind: 'preshow', endsAt: ps.timerEnd, label: (ps.timerLabel || 'BROADCAST BEGINS IN'), note: '' };
  }
  return null;
}

let _ccKey = '';
function renderCountdown() {
  const bar = document.getElementById('caster-countdown');
  if (!bar) return;
  const c = computeCountdown(_state);
  if (!c) {
    if (_ccKey) { bar.className = 'caster-countdown'; bar.innerHTML = ''; _ccKey = ''; }
    return;
  }
  const secs = Math.max(0, Math.ceil((c.endsAt - Date.now()) / 1000));
  const key = c.kind + '|' + c.label + '|' + c.note;
  if (key !== _ccKey) {
    bar.innerHTML =
      '<span class="cc-dot"></span>' +
      '<span class="cc-label">' + esc(c.label) + '</span>' +
      '<span class="cc-time" id="cc-time"></span>' +
      (c.note ? '<span class="cc-note">' + esc(c.note) + '</span>' : '');
    _ccKey = key;
  }
  bar.className = 'caster-countdown show cc-' + c.kind + (secs <= 30 ? ' cc-soon' : '');
  const tEl = document.getElementById('cc-time');
  if (tEl) tEl.textContent = fmtCountdown(secs);
}
setInterval(renderCountdown, 500);

// ── Connection status ──────────────────────────────────────────────────────────
socket.on('connect', () => {
  const dot = document.getElementById('conn-dot');
  const lbl = document.getElementById('conn-label');
  dot.className = 'conn-dot live';
  lbl.textContent = 'Connected';
  socket.emit('presence:page', { page: 'Caster View' });
});

socket.on('disconnect', () => {
  const dot = document.getElementById('conn-dot');
  const lbl = document.getElementById('conn-label');
  dot.className = 'conn-dot dead';
  lbl.textContent = 'Disconnected';
});

socket.on('presence:list', users => {
  const strip = document.getElementById('presence-strip');
  if (!strip) return;
  const byUser = {};
  users.forEach(u => {
    const prev = byUser[u.username];
    if (!prev || (u.pageUpdatedAt || u.connectedAt) > (prev.pageUpdatedAt || prev.connectedAt)) {
      byUser[u.username] = u;
    }
  });
  strip.innerHTML = Object.values(byUser).map(u =>
    '<span class="presence-user"><span class="presence-user-dot">●</span>' +
    '<span>' + u.username + ' (' + u.role + ')' + (u.page ? ' — ' + u.page : '') + '</span></span>'
  ).join('');
});

async function refreshTournamentStats() {
  try {
    const r = await fetch('/api/tournament-stats');
    _tournamentStats = await r.json();
  } catch (_) {}
}

socket.on('state', async (s) => {
  // schedule is delivered separately — preserve the cached copy
  if (s.tournament && _state && _state.tournament && _state.tournament.schedule) {
    s.tournament.schedule = _state.tournament.schedule;
  }
  _state = s;
  _teams = s.teams || [];
  applyCasterAdapterUI();
  renderAll();
});

// Hide game-irrelevant caster surfaces (e.g. the Draft tab) for non-champ-draft games.
// Elements opt in by class; LoL keeps everything. If the active tab gets hidden, fall
// back to the Roster tab.
function applyCasterAdapterUI() {
  const a = (_state && _state.adapter) || null;
  const champDraft = a ? a.pregameKind === 'champ-draft' : true;
  const mapVeto    = a ? a.pregameKind === 'map-veto'    : false;
  const liveData   = a ? !!a.liveData                    : false;   // GSI feed (CS2 + Dota) → Live tab
  const heroDraft  = a ? a.pregameKind === 'hero-draft'  : false;   // Dota CM draft → Draft tab
  document.querySelectorAll('.cap-champ-draft').forEach(function(el){ el.style.display = champDraft ? '' : 'none'; });
  document.querySelectorAll('.cap-map-veto').forEach(function(el){ el.style.display = mapVeto ? '' : 'none'; });
  document.querySelectorAll('.cap-live-data').forEach(function(el){ el.style.display = liveData ? '' : 'none'; });
  document.querySelectorAll('.cap-hero-draft').forEach(function(el){ el.style.display = heroDraft ? '' : 'none'; });
  // If the active tab just got hidden by a game switch, fall back to Roster.
  const activeBtn = document.querySelector('.tab-btn.active');
  if (activeBtn && activeBtn.offsetParent === null) {
    const r = document.querySelector('.tab-btn[data-tab="roster"]'); if (r) r.click();
  }
}

// ── CS2 (map-veto) helpers ──────────────────────────────────────────────────────
function casterIsMapVeto() { const a = _state && _state.adapter; return a ? a.pregameKind === 'map-veto' : false; }
function casterNoRoles()   { const a = _state && _state.adapter; return a && a.positions ? !a.positions.some(function(p){return !!p;}) : false; }
function csNormName(s) { return String(s || '').toLowerCase().replace(/\s+/g, '').trim(); }
// Current series key, mirroring the server's csSeriesKey (server.js) so client aggregates
// split tournament vs this-series the same way.
function csCurrentSeriesKey() {
  const m = (_state && _state.match) || {};
  if (m.scheduleGameId) return 'sg:' + m.scheduleGameId;
  const norm = x => String(x || '').toLowerCase().trim();
  return 'tm:' + [norm((m.team1 || {}).name), norm((m.team2 || {}).name)].sort().join('__');
}
// Aggregate a roster player's accumulated CS lines into { tournament, series } from
// state.tournament.csStats — match by steamid (C3c) or normalized in-game name. Mirrors
// spotlight.js csAggForPlayer / server buildCsStats. Returns null when nothing matches.
function csAggForPlayer(p) {
  const lines = (_state && _state.tournament && _state.tournament.csStats) || [];
  if (!lines.length || !p) return null;
  const key = csNormName(p.handle || p.name), sid = p.steamid;
  if (!key && !sid) return null;
  const sk = csCurrentSeriesKey();
  const z = () => ({ maps: 0, kills: 0, deaths: 0, assists: 0, adr: 0, k3: 0, k4: 0, k5: 0 });
  const t = z(), se = z();
  let hit = false;
  lines.forEach(function(l){
    if (!((sid && l.steamid === sid) || (key && csNormName(l.name) === key))) return;
    hit = true;
    const acc = a => { a.maps++; a.kills += l.kills|0; a.deaths += l.deaths|0; a.assists += l.assists|0; a.adr += l.adr|0; a.k3 += l.k3|0; a.k4 += l.k4|0; a.k5 += l.k5|0; };
    acc(t); if (l.seriesKey === sk) acc(se);
  });
  if (!hit) return null;
  const fin = a => { a.kd = (a.kills / Math.max(1, a.deaths)).toFixed(2); a.adr = a.maps ? Math.round(a.adr / a.maps) : 0; return a; };
  return { tournament: fin(t), series: fin(se) };
}
// Find a roster player's live in-game line from state.live.players (by steamid or name).
function csLiveForPlayer(p) {
  const lp = (_state && _state.live && _state.live.players) || {};
  const key = csNormName(p && (p.handle || p.name)), sid = p && p.steamid;
  if (!key && !sid) return null;
  for (const id in lp) { const x = lp[id]; if ((sid && x.steamid === sid) || (key && csNormName(x.name) === key)) return x; }
  return null;
}

socket.on('stats:invalidated', () => refreshTournamentStats());

socket.on('schedule', (schedule) => {
  if (!_state) return;
  if (!_state.tournament) _state.tournament = {};
  _state.tournament.schedule = schedule;
  renderSchedule();
  renderStandings(); // standings tally from schedule results too
});

refreshTournamentStats();

// ── Tab switching ──────────────────────────────────────────────────────────────
function activateTab(tab) {
  _activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + tab));
}

activateTab(_activeTab);

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    localStorage.setItem('casterTab', btn.dataset.tab);
    activateTab(btn.dataset.tab);
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function champNameFromUrl(url) {
  if (!url) return '';
  return url.split('/').pop().replace(/\.[^.]+$/, '').replace(/_\d+$/, '');
}

function teamById(id) {
  return _teams.find(t => t.id === id) || null;
}

function resolveTeamName(id, override) {
  if (override && override.trim()) return override.trim();
  const t = teamById(id);
  return t ? (t.name || t.tag || id) : (id || 'TBD');
}

function roleIconUrl(role) {
  const ROLE_FILE = { adc: 'bot', 'ad carry': 'bot', bottom: 'bot', jg: 'jungle', jungle: 'jungle', mid: 'mid', middle: 'mid', top: 'top', support: 'support', sup: 'support', fill: 'fill' };
  const key = (role || '').toLowerCase();
  return '/graphics/head2head/roles/' + (ROLE_FILE[key] || key) + '.png';
}

// Per-player role marker. LoL has role icons (Top/Jungle/…); Dota has no such
// icons — show a numbered position badge (1–5) from the adapter's position order,
// full name in the tooltip. Only Dota diverges; every other game keeps the icon.
function playerRoleCell(p) {
  const role = (p && p.role) || '';
  if (casterIsDota()) {
    const positions = (_state && _state.adapter && _state.adapter.positions) || [];
    const i = positions.findIndex(function (pos) { return pos && pos.toLowerCase() === role.toLowerCase(); });
    if (i >= 0) return '<div class="player-pos-badge" title="' + esc(positions[i]) + '">' + (i + 1) + '</div>';
    return role ? '<div class="player-pos-badge player-pos-text" title="' + esc(role) + '">' + esc(role.slice(0, 3).toUpperCase()) + '</div>' : '<div class="player-pos-badge player-pos-empty"></div>';
  }
  return '<div class="player-role-icon" style="background-image:url(' + esc(roleIconUrl(role)) + ')"></div>';
}

function champIconUrl(key) {
  if (!key) return '';
  return '/graphics/head2head/champions/' + key + '_0.jpg';
}

function rankText(rank) {
  if (!rank || !rank.tier) return '';
  const tier = rank.tier.toUpperCase();
  const div  = rank.division && rank.division !== 'I' && rank.division !== '' ? ' ' + rank.division : '';
  const lp   = rank.lp != null ? ' ' + rank.lp + 'LP' : '';
  return tier + div + lp;
}

function rankShort(rank) {
  if (!rank || !rank.tier) return '';
  const abbr = { CHALLENGER:'CHAL', GRANDMASTER:'GM', MASTER:'MSTR', DIAMOND:'DIA', EMERALD:'EMR',
                  PLATINUM:'PLAT', GOLD:'GOLD', SILVER:'SLV', BRONZE:'BRZ', IRON:'IRON' };
  const short = abbr[rank.tier.toUpperCase()] || rank.tier.slice(0,4);
  const lp = rank.lp != null ? ' ' + rank.lp + 'LP' : '';
  return short + lp;
}

function stageLabel(key) {
  const map = { groupStage:'Group Stage', roundOf16:'Round of 16', quarterfinals:'Quarterfinals',
    semifinals:'Semifinals', finals:'Finals', thirdPlace:'3rd Place', upperBracket:'Upper Bracket',
    lowerBracket:'Lower Bracket', lowerBracketFinal:'LB Final', grandFinals:'Grand Finals' };
  if (map[key]) return map[key];
  if (key && key.startsWith('bracket-round-')) {
    const idx = parseInt(key.replace('bracket-round-', ''));
    const rounds = _state && _state.bracket && _state.bracket.rounds || [];
    return rounds[idx] ? (rounds[idx].label || 'Round ' + (idx+1)) : key;
  }
  return key || '';
}

function wrClass(wr) {
  if (wr == null) return '';
  const n = parseFloat(wr);
  return n >= 55 ? 'wr-good' : n <= 45 ? 'wr-bad' : '';
}

function calculateGroupStandings(state, teams) {
  const t = state.tournament || {};
  const standings = {};
  (t.groups || []).forEach(grp => {
    standings[grp.id] = (grp.teamIds || []).map(tid => {
      const tm = teams.find(x => x.id === tid);
      return { teamId: tid, name: tm ? (tm.name || tm.tag || tid) : tid, logo: tm ? (tm.logo || '') : '', color: tm ? (tm.color || '') : '', sw: 0, sl: 0 };
    });
  });
  (t.schedule || []).forEach(day => {
    (day.games || []).forEach(game => {
      if (game.stage !== 'groupStage' || !game.result || !game.result.completed) return;
      const r = game.result;
      Object.keys(standings).forEach(grpId => {
        const rows = standings[grpId];
        const e1 = rows.find(e => e.teamId === game.team1Id);
        const e2 = rows.find(e => e.teamId === game.team2Id);
        if (!e1 || !e2) return;
        if (r.winner === 'team1') { e1.sw++; e2.sl++; }
        else if (r.winner === 'team2') { e2.sw++; e1.sl++; }
      });
    });
  });
  Object.keys(standings).forEach(grpId => {
    standings[grpId].sort((a, b) => b.sw !== a.sw ? b.sw - a.sw : a.sl - b.sl);
  });
  return standings;
}

// ── Master render ─────────────────────────────────────────────────────────────
function renderAll() {
  if (!_state) return;
  renderHeader();
  renderCountdown();
  renderRoster();
  renderTeams();
  renderSeries();
  renderDraft();
  renderHeroDraft();
  renderMapVeto();
  renderLive();
  renderStandings();
  renderBracket();
  renderSchedule();
}

// ── Header ────────────────────────────────────────────────────────────────────
function renderHeader() {
  const s = _state;
  const m = s.match || {};
  const meta = s.meta || {};
  const tourn = s.tournament || {};

  document.getElementById('hdr-profile').textContent = meta.activeProfileName || '—';

  const t1name = (m.team1 && m.team1.name) || 'Team 1';
  const t2name = (m.team2 && m.team2.name) || 'Team 2';
  document.getElementById('hdr-t1').textContent = t1name;
  document.getElementById('hdr-t2').textContent = t2name;

  // Series score: map-veto games (CS2) track maps won on match.team{1,2}.score; LoL
  // counts winners in seriesGames.
  let t1wins, t2wins;
  if (casterIsMapVeto()) {
    t1wins = (m.team1 && m.team1.score) || 0; t2wins = (m.team2 && m.team2.score) || 0;
  } else {
    t1wins = 0; t2wins = 0;
    (m.seriesGames || []).forEach(g => { if (g.winner === 'team1') t1wins++; else if (g.winner === 'team2') t2wins++; });
  }
  document.getElementById('hdr-score').textContent = t1wins + ' : ' + t2wins;
  document.getElementById('hdr-format').textContent = m.format || '';
}

// ── ROSTER TAB ────────────────────────────────────────────────────────────────
function renderRoster() {
  const s = _state;
  const m = s.match || {};
  const players = s.players || {};
  const t1 = m.team1 || {};
  const t2 = m.team2 || {};

  const grid = document.getElementById('roster-grid');

  grid.innerHTML =
    renderTeamRosterCard(t1, players.team1 || [], 't1') +
    renderTeamRosterCard(t2, players.team2 || [], 't2');

  // Bind expand/collapse
  grid.querySelectorAll('.player-row').forEach(row => {
    row.addEventListener('click', () => row.classList.toggle('open'));
  });
  grid.querySelectorAll('.trn-champ-row').forEach(row => {
    row.addEventListener('click', e => {
      e.stopPropagation();
      const refsEl = document.getElementById(row.dataset.refsId);
      if (refsEl) {
        refsEl.classList.toggle('open');
        row.classList.toggle('open');
      }
    });
  });
}

function renderTeamRosterCard(team, players, slot) {
  const color = team.color || (slot === 't1' ? '#1ffaff' : '#ff4444');
  const logoStyle = team.logo ? 'background-image:url(' + esc(team.logo) + ')' : '';
  const colorStyle = '--team-color:' + esc(color);

  return '<div class="card roster-team-card" style="' + colorStyle + '">' +
    '<div class="card-header roster-team-hdr ' + slot + '-hdr" style="--t1-color:' + esc(color) + ';--t2-color:' + esc(color) + '">' +
      '<div class="roster-team-logo-bg" style="' + logoStyle + '"></div>' +
      '<div>' +
        '<div class="roster-team-name">' + esc(team.name || '—') + '</div>' +
        (team.tag ? '<div class="roster-team-tag">' + esc(team.tag) + '</div>' : '') +
      '</div>' +
    '</div>' +
    players.map(p => renderPlayerRow(p, color)).join('') +
  '</div>';
}

function opggUrl(region, riotId) {
  if (!region || !riotId) return '';
  const parts = riotId.split('#');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return '';
  return 'https://www.op.gg/summoners/' + region + '/' + encodeURIComponent(parts[0]) + '-' + encodeURIComponent(parts[1]);
}

function renderPlayerRow(p, color) {
  // VALORANT: agent + Riot ID row (manual data — no live stats feed, no HLTV/Steam).
  if (casterIsValorant()) return renderPlayerRowVal(p, color);
  // CS2 (role-less / no champion pick entity): show CS stats + HLTV instead of champ/rank/op.gg.
  if (casterIsMapVeto() || casterNoRoles()) return renderPlayerRowCS(p, color);
  const dota = casterIsDota();
  const rk = p.rank;
  const badge = (!dota && rk) ? '<span class="rank-badge" style="--team-color:' + esc(color) + '">' + esc(rankShort(rk)) + '</span>' : '';
  const pool = p.champPool || [];
  const ogUrl = dota ? '' : opggUrl(p.opggRegion, p.riotId);

  // Dota: OpenDota hero pool (most-played heroes + win rate) in place of champ pool + rank.
  let champRows = '';
  if (dota) {
    const heroes = p.heroPool || [];
    if (heroes.length > 0) {
      champRows = '<table class="champ-table">' +
        '<thead><tr><th>Hero</th><th class="right">Games</th><th class="right">Win Rate</th></tr></thead>' +
        '<tbody>' +
        heroes.map(h => {
          const icon = h.img ? '<div class="champ-icon-sm" style="background-image:url(' + esc(h.img) + ')"></div>' : '';
          const wrPct = h.games ? Math.round(h.win / h.games * 100) : null;
          return '<tr>' +
            '<td><div class="champ-icon-cell">' + icon + '<span class="champ-name">' + esc(h.name || h.slug || '') + '</span></div></td>' +
            '<td class="right">' + esc(h.games != null ? h.games : '—') + '</td>' +
            '<td class="right ' + wrClass(wrPct) + '">' + (wrPct != null ? wrPct + '%' : '—') + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';
    } else {
      champRows = '<div style="color:var(--text-faint);font-size:12px">No hero pool data — set a Steam ID and refresh from the control panel.</div>';
    }
  } else if (pool.length > 0) {
    champRows = '<table class="champ-table">' +
      '<thead><tr><th>Champion</th><th class="right">Games</th><th class="right">Win Rate</th></tr></thead>' +
      '<tbody>' +
      pool.map(c => {
        const icon = c.key ? '<div class="champ-icon-sm" style="background-image:url(' + esc(champIconUrl(c.key)) + ')"></div>' : '';
        const wrPct = c.winRate != null ? parseFloat(c.winRate)
                    : (c.wins != null && c.games ? Math.round(c.wins / c.games * 100) : null);
        const wr = wrPct != null ? wrPct.toFixed(0) + '%' : '—';
        return '<tr>' +
          '<td><div class="champ-icon-cell">' + icon + '<span class="champ-name">' + esc(c.name || c.key) + '</span></div></td>' +
          '<td class="right">' + esc(c.games != null ? c.games : '—') + '</td>' +
          '<td class="right ' + wrClass(wrPct) + '">' + esc(wr) + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>';
  } else {
    champRows = '<div style="color:var(--text-faint);font-size:12px">No champion pool data</div>';
  }

  // Draft pick stats block — shown when draftChampStats is populated after role commit
  let draftStatsHtml = '';
  const ds = p.draftChampStats;
  if (ds) {
    const iconUrl = champIconUrl(ds.champ);
    const kdaRatio = ds.kda && parseFloat(ds.kda.d) > 0
      ? ((parseFloat(ds.kda.k) + parseFloat(ds.kda.a)) / parseFloat(ds.kda.d)).toFixed(2)
      : 'Perfect';
    const kdaStr = ds.kda ? (ds.kda.k + ' / ' + ds.kda.d + ' / ' + ds.kda.a) : '—';
    const stats = [
      { val: ds.winRate != null ? ds.winRate + '%' : '—', key: 'Win Rate', cls: wrClass(ds.winRate) },
      { val: kdaStr,   key: 'Avg K/D/A', cls: '' },
      { val: kdaRatio, key: 'KDA Ratio', cls: '' },
      { val: ds.cs != null ? ds.cs : '—', key: 'CS/g', cls: '' },
      { val: ds.kp != null ? ds.kp + '%' : '—', key: 'Kill Part.', cls: '' },
      { val: ds.games != null ? ds.games : '—', key: 'Matches', cls: '' },
    ];
    draftStatsHtml =
      '<div class="dps-block">' +
        '<div class="dps-hdr">' +
          (iconUrl ? '<div class="dps-icon" style="background-image:url(' + esc(iconUrl) + ')"></div>' : '') +
          '<span class="dps-champ-name">' + esc(ds.champ) + '</span>' +
          '<span class="dps-label">DRAFT PICK</span>' +
        '</div>' +
        '<div class="dps-grid">' +
          stats.map(s =>
            '<div class="dps-cell">' +
              '<div class="dps-val ' + s.cls + '">' + esc(String(s.val)) + '</div>' +
              '<div class="dps-key">' + s.key + '</div>' +
            '</div>'
          ).join('') +
        '</div>' +
      '</div>';
  }

  const rankFull = rk ? '<div class="detail-rank-full">' + esc(rankText(rk)) + '</div>' : '';

  // Tournament history section
  let trnHistoryHtml = '';
  const champHistory = (_tournamentStats && p.handle && _tournamentStats[p.handle]) ? _tournamentStats[p.handle] : {};
  const champEntries = Object.entries(champHistory).sort((a, b) => b[1].games - a[1].games);
  if (champEntries.length > 0) {
    const rows = champEntries.map(([champ, entry]) => {
      const icon = entry.imgUrl ? '<div class="champ-icon-sm" style="background-image:url(' + esc(entry.imgUrl) + ')"></div>' : '';
      const refsId = 'trn-refs-' + esc(p.handle) + '-' + esc(champ);
      const refsHtml = (entry.matchRefs || []).map(ref =>
        '<div class="trn-ref-row ' + (ref.won ? 'trn-ref-win' : 'trn-ref-loss') + '">' +
          '<span class="trn-ref-result">' + (ref.won ? 'WIN' : 'LOSS') + '</span>' +
          '<span class="trn-ref-opp">vs ' + esc(ref.opponentName) + '</span>' +
          '<span class="trn-ref-meta">Game ' + esc(String(ref.gameNum)) + ' · ' + esc((ref.side || '').toUpperCase()) + '</span>' +
        '</div>'
      ).join('');
      return '<tr class="trn-champ-row" data-refs-id="' + esc(refsId) + '">' +
          '<td><div class="champ-icon-cell">' + icon + '<span class="champ-name">' + esc(champ) + '</span></div></td>' +
          '<td class="right">' + entry.games + '</td>' +
          '<td class="right">' + entry.wins + '/' + entry.losses + '</td>' +
          '<td class="right ' + wrClass(entry.winRate) + ' trn-wr-cell">' + entry.winRate + '% <span class="trn-expand-arrow">▼</span></td>' +
        '</tr>' +
        '<tr class="trn-champ-detail" id="' + esc(refsId) + '">' +
          '<td colspan="4"><div class="trn-refs">' + refsHtml + '</div></td>' +
        '</tr>';
    }).join('');
    trnHistoryHtml =
      '<div class="trn-history">' +
        '<div class="trn-history-label">Tournament History</div>' +
        '<table class="champ-table">' +
          '<thead><tr><th>Champion</th><th class="right">Games</th><th class="right">W / L</th><th class="right">Win%</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>';
  }

  return '<div class="player-row">' +
    '<div class="player-row-summary">' +
      playerRoleCell(p) +
      '<div class="player-handle">' + esc(p.handle || p.name || '—') + '</div>' +
      badge +
      (ogUrl ? '<a class="opgg-btn" href="' + esc(ogUrl) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">op.gg ↗</a>' : '') +
      '<div class="expand-arrow">▼</div>' +
    '</div>' +
    '<div class="player-detail">' +
      (!dota && p.riotId ? '<div class="detail-riot-id">' + esc(p.riotId) + (p.opggRegion ? ' <span class="detail-region">' + esc(p.opggRegion.toUpperCase()) + '</span>' : '') + '</div>' : '') +
      (dota ? '' : rankFull) +
      draftStatsHtml +
      trnHistoryHtml +
      champRows +
    '</div>' +
  '</div>';
}

// CS2 roster row: tournament & series K/D · ADR · maps (+ multikills) from accumulated
// csStats, the live current-map line when in progress, and an HLTV link (C3c). No champ
// pool / rank / op.gg.
function renderPlayerRowCS(p, color) {
  const agg = csAggForPlayer(p), live = csLiveForPlayer(p);
  const hltv = hltvUrlOf(p.hltvUrl);
  // Summary badge: tournament K/D if logged, else the live K/D/A.
  let badge = '';
  if (agg && agg.tournament.maps) badge = '<span class="cs-badge" style="--team-color:' + esc(color) + '">' + esc(agg.tournament.kd) + ' K/D</span>';
  else if (live) badge = '<span class="cs-badge" style="--team-color:' + esc(color) + '">' + ((live.kills|0) + '/' + (live.deaths|0) + '/' + (live.assists|0)) + '</span>';

  const mk = a => { const out = []; if (a.k3) out.push(a.k3 + '×3K'); if (a.k4) out.push(a.k4 + '×4K'); if (a.k5) out.push(a.k5 + '×ACE'); return out.join(' · '); };
  const statRow = (label, a) => a && a.maps
    ? '<div class="cs-stat-row"><span class="cs-stat-label">' + label + '</span>' +
        '<span class="cs-stat-vals"><b>' + a.kd + '</b> K/D · ' + a.adr + ' ADR · ' + a.kills + '/' + a.deaths + '/' + a.assists + ' · ' + a.maps + (a.maps === 1 ? ' map' : ' maps') +
        (mk(a) ? ' <span class="cs-mk">' + mk(a) + '</span>' : '') + '</span></div>'
    : '';
  const liveRow = live
    ? '<div class="cs-stat-row cs-live-row"><span class="cs-stat-label">Live map</span>' +
        '<span class="cs-stat-vals"><b>' + (live.kills|0) + ' / ' + (live.deaths|0) + ' / ' + (live.assists|0) + '</b>' + (live.adr ? ' · ' + (live.adr|0) + ' ADR' : '') +
        (live.side ? ' · ' + esc(live.side) : '') + '</span></div>'
    : '';

  let detail = statRow('Tournament', agg && agg.tournament) + statRow('This series', agg && agg.series) + liveRow;
  if (!detail) detail = '<div style="color:var(--text-faint);font-size:12px">No CS stats logged yet</div>';
  if (p.steamid) detail += '<div class="cs-steamid">Steam ID ' + esc(p.steamid) + '</div>';

  return '<div class="player-row">' +
    '<div class="player-row-summary">' +
      '<div class="player-handle">' + esc(p.handle || p.name || '—') + '</div>' +
      badge +
      (hltv ? '<a class="hltv-btn" href="' + esc(hltv) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">HLTV ↗</a>' : '') +
      '<div class="expand-arrow">▼</div>' +
    '</div>' +
    '<div class="player-detail">' + detail + '</div>' +
  '</div>';
}

// ── VALORANT roster row ─────────────────────────────────────────────────────────
// Agent + Riot ID — VALORANT data is manual (no live feed), so the caster row shows the
// player's assigned agent (icon + name, set per map on the control roster) and identity.
function casterIsValorant() { const a = _state && _state.adapter; return a ? a.assetSource === 'valorant' : false; }
function valAgentSlug(name) { return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function renderPlayerRowVal(p, color) {
  const slug = valAgentSlug(p.agent);
  const icon = slug ? '<div class="player-role-icon" style="background-image:url(/agents/icons/' + esc(slug) + '.png);filter:none;border-radius:3px"></div>' : '<div class="player-role-icon"></div>';
  const badge = p.agent ? '<span class="cs-badge" style="--team-color:' + esc(color) + '">' + esc(p.agent) + '</span>' : '';

  let detail = '';
  if (p.name && p.name !== p.handle) detail += '<div class="detail-riot-id">' + esc(p.name) + '</div>';
  if (p.riotId) detail += '<div class="detail-riot-id">' + esc(p.riotId) + '</div>';
  detail += p.agent
    ? '<div class="cs-stat-row"><span class="cs-stat-label">Agent</span><span class="cs-stat-vals"><b>' + esc(p.agent) + '</b></span></div>'
    : '<div style="color:var(--text-faint);font-size:12px">No agent assigned — set one on the control panel roster.</div>';

  return '<div class="player-row">' +
    '<div class="player-row-summary">' +
      icon +
      '<div class="player-handle">' + esc(p.handle || p.name || '—') + '</div>' +
      badge +
      '<div class="expand-arrow">▼</div>' +
    '</div>' +
    '<div class="player-detail">' + detail + '</div>' +
  '</div>';
}

// Normalize a manual HLTV link (mirror control.js hltvUrlOf): add https://, reject unsafe schemes.
function hltvUrlOf(raw) {
  const v = (raw || '').trim();
  if (!v) return '';
  if (/^(javascript|data|vbscript):/i.test(v)) return '';
  return /^https?:\/\//i.test(v) ? v : 'https://' + v;
}

// ── TEAMS TAB ─────────────────────────────────────────────────────────────────
// All competing teams (the tournament pool), available even for teams not in the
// active broadcast — so casters can pull up any team's roster on demand.
function renderTeams() {
  const s = _state;
  const tourn = s.tournament || {};
  const el = document.getElementById('teams-content');

  // Competing-teams pool = tournament.teamPool (array of team ids); fall back to
  // the whole teams DB when no pool is configured for this tournament.
  let pool = (tourn.teamPool || []).map(id => teamById(id)).filter(Boolean);
  if (pool.length === 0) pool = (_teams || []).slice();
  if (pool.length === 0) {
    el.innerHTML = '<div class="empty-state">No competing teams configured</div>';
    return;
  }

  // Flag the two teams currently on broadcast. The live match stores team names
  // (not ids), so match on name/tag rather than id.
  const m = s.match || {};
  const liveNames = new Set([ m.team1 && m.team1.name, m.team2 && m.team2.name ]
    .filter(Boolean).map(n => n.toLowerCase()));
  const isLive = t => liveNames.has((t.name || '').toLowerCase()) || liveNames.has((t.tag || '').toLowerCase());

  el.innerHTML =
    '<div class="section-label">' + pool.length + ' Competing Team' + (pool.length === 1 ? '' : 's') + '</div>' +
    '<div class="teams-grid">' +
      pool.map(t => renderTeamPoolCard(t, isLive(t))).join('') +
    '</div>';
}

function renderTeamPoolCard(t, isLive) {
  const color = t.color || '';
  const colorStyle = color ? '--team-color:' + esc(color) : '';
  const logoStyle = t.logo ? 'background-image:url(' + esc(t.logo) + ')' : '';
  const players = (t.players || []).filter(p => p.handle || p.name);
  const subs = (t.subs || []).filter(p => p.handle || p.name);

  return '<div class="card tp-card' + (isLive ? ' tp-live' : '') + '" style="' + colorStyle + '">' +
    '<div class="card-header tp-hdr">' +
      '<div class="tp-logo" style="' + logoStyle + '"></div>' +
      '<div class="tp-hdr-text">' +
        '<div class="tp-name">' + esc(t.name || '—') + '</div>' +
        (t.tag ? '<div class="tp-tag">' + esc(t.tag) + '</div>' : '') +
      '</div>' +
      (isLive ? '<span class="tp-live-badge">ON AIR</span>' : '') +
    '</div>' +
    '<div class="tp-players">' +
      (players.length ? players.map(p => renderPoolPlayer(p)).join('')
                      : '<div class="tp-empty">No players listed</div>') +
      (subs.length ? '<div class="tp-subs-label">Substitutes</div>' + subs.map(p => renderPoolPlayer(p, true)).join('') : '') +
    '</div>' +
  '</div>';
}

function renderPoolPlayer(p, isSub) {
  const ogUrl = opggUrl(p.opggRegion, p.riotId);
  return '<div class="tp-player' + (isSub ? ' tp-player-sub' : '') + '">' +
    playerRoleCell(p) +
    '<span class="tp-handle">' + esc(p.handle || p.name || '—') + '</span>' +
    (p.name && p.name !== p.handle ? '<span class="tp-realname">' + esc(p.name) + '</span>' : '') +
    '<span class="tp-spacer"></span>' +
    (p.riotId ? '<span class="tp-riot">' + esc(p.riotId) + '</span>' : '') +
    (p.opggRegion ? '<span class="tp-region">' + esc(p.opggRegion.toUpperCase()) + '</span>' : '') +
    (ogUrl ? '<a class="opgg-btn" href="' + esc(ogUrl) + '" target="_blank" rel="noopener">op.gg ↗</a>' : '') +
  '</div>';
}

// ── SERIES TAB ────────────────────────────────────────────────────────────────
function renderSeries() {
  const s = _state;
  const m = s.match || {};
  const t1name = (m.team1 && m.team1.name) || 'Team 1';
  const t2name = (m.team2 && m.team2.name) || 'Team 2';
  const el = document.getElementById('series-content');

  // Check we have an actual match loaded
  if (!m.team1 || !m.team1.name) {
    el.innerHTML = '<div class="empty-state">No active match</div>';
    return;
  }

  // CS2 (map-veto): per-map round scores + winners, not a draft series.
  if (casterIsMapVeto()) { renderSeriesCS(el, m, t1name, t2name); return; }
  // Dota (hero-draft): recorded games carry the CM draft + GSI stat snapshots.
  if (casterIsDota()) { renderSeriesDota(el, m, t1name, t2name); return; }

  const formatNum   = parseInt((m.format || 'Bo3').replace('Bo', '')) || 3;
  const winsNeeded  = Math.ceil(formatNum / 2);
  const t1wins      = (m.team1 && m.team1.score) || 0;
  const t2wins      = (m.team2 && m.team2.score) || 0;
  const seriesOver  = t1wins >= winsNeeded || t2wins >= winsNeeded;
  const currentGame = m.currentGameNum || 1;
  const seriesGames = m.seriesGames || [];
  const fearlessPill = m.fearlessDraft ? '<span class="pill pill-fearless">Fearless Draft</span>' : '';

  let html = '<div class="series-header">' +
    '<span class="series-title">' + esc(t1name) + ' vs ' + esc(t2name) + '</span>' +
    '<span class="series-title" style="color:var(--text-faint)">·</span>' +
    '<span class="series-title" style="font-size:15px;color:var(--text-dim)">' + esc(m.format || '') + '</span>' +
    fearlessPill +
  '</div>';

  // Build rows: completed games from seriesGames, current in-progress, then TBD slots
  const rows = [];

  // Completed games (recorded results)
  seriesGames.forEach((g, i) => {
    const isBye = g.isBye;
    const winnerName = g.winner === 'team1' ? t1name : t2name;
    const resultHtml = isBye
      ? '<span class="game-result bye">BYE — ' + esc(winnerName) + '</span>'
      : '<span class="game-result winner">' + esc(winnerName) + ' wins</span>';

    const detailHtml = !isBye ? renderDraftSnapshot(g, t1name, t2name) : '';
    const hasExpand = !isBye;

    rows.push('<div class="game-row card">' +
      '<div class="game-row-summary"' + (hasExpand ? ' onclick="this.parentElement.classList.toggle(\'open\')"' : '') + '>' +
        '<div class="game-num">GAME ' + (i + 1) + '</div>' +
        '<div class="game-teams">' + esc(t1name) + '<span class="game-vs">VS</span>' + esc(t2name) + '</div>' +
        resultHtml +
        (hasExpand ? '<div class="expand-arrow" style="margin-left:8px">▼</div>' : '') +
      '</div>' +
      (hasExpand ? '<div class="game-detail">' + detailHtml + '</div>' : '') +
    '</div>');
  });

  // Current in-progress game (not yet recorded)
  if (!seriesOver) {
    rows.push('<div class="game-row card">' +
      '<div class="game-row-summary">' +
        '<div class="game-num">GAME ' + currentGame + '</div>' +
        '<div class="game-teams">' + esc(t1name) + '<span class="game-vs">VS</span>' + esc(t2name) + '</div>' +
        '<span class="pill pill-live">IN PROGRESS</span>' +
      '</div>' +
    '</div>');
  }

  // Remaining TBD slots
  const gamesShown = seriesGames.length + (seriesOver ? 0 : 1);
  for (let i = gamesShown + 1; i <= formatNum; i++) {
    rows.push('<div class="game-row card">' +
      '<div class="game-row-summary">' +
        '<div class="game-num">GAME ' + i + '</div>' +
        '<div class="game-teams">' + esc(t1name) + '<span class="game-vs">VS</span>' + esc(t2name) + '</div>' +
        '<span class="game-result" style="color:var(--text-faint)">TBD</span>' +
      '</div>' +
    '</div>');
  }

  el.innerHTML = html + rows.join('');
}

function renderDraftSnapshot(g, t1name, t2name) {
  const draftPicks = g.draftPicks || [];
  const t1role = g.t1RolePicks || [];
  const t2role = g.t2RolePicks || [];

  // Extract bans using index arrays (draftPicks is a URL string array, not objects)
  const banFirst = g.banFirstTeam || 'blue';
  const blueSlot = g.blueSideTeam || 'team1';
  const physBlueBanIdx = banFirst === 'blue' ? BLUE_BAN_IDX : RED_BAN_IDX;
  const physRedBanIdx  = banFirst === 'blue' ? RED_BAN_IDX  : BLUE_BAN_IDX;
  const t1BanIdx = blueSlot === 'team1' ? physBlueBanIdx : physRedBanIdx;
  const t2BanIdx = blueSlot === 'team1' ? physRedBanIdx  : physBlueBanIdx;
  const t1bans = draftPicks.length ? t1BanIdx.map(i => draftPicks[i] || '').filter(Boolean) : [];
  const t2bans = draftPicks.length ? t2BanIdx.map(i => draftPicks[i] || '').filter(Boolean) : [];

  // Picks from role-indexed arrays — each entry is a champion URL
  const picks1 = t1role.filter(Boolean);
  const picks2 = t2role.filter(Boolean);

  const sideHtml = g.t1Side
    ? '<div style="font-size:11px;color:var(--text-faint);margin-bottom:10px">' +
        esc(t1name) + ' <strong style="color:var(--text-dim)">' + esc((g.t1Side||'').toUpperCase()) + '</strong>' +
        ' · ' +
        esc(t2name) + ' <strong style="color:var(--text-dim)">' + esc((g.t2Side||'').toUpperCase()) + '</strong>' +
      '</div>'
    : '';

  function champPills(urls, isBan) {
    if (!urls || urls.length === 0) return '<span style="color:var(--text-faint);font-size:11px">—</span>';
    return urls.map(url => {
      const name = champNameFromUrl(url);
      const icon = url ? '<div class="champ-pill-icon" style="background-image:url(' + esc(url) + ')"></div>' : '';
      return '<div class="champ-pill' + (isBan ? ' ban-pill' : '') + '">' + icon + esc(name || '?') + '</div>';
    }).join('');
  }

  return sideHtml +
    '<div class="draft-snapshot">' +
    '<div>' +
      '<div class="draft-col-label">' + esc(t1name) + '</div>' +
      '<div class="draft-col-label" style="color:var(--text-faint);font-size:10px;margin-top:8px">Picks</div>' +
      '<div class="draft-picks-list">' + champPills(picks1, false) + '</div>' +
      (t1bans.length ? '<div class="draft-col-label" style="color:var(--text-faint);font-size:10px;margin-top:8px">Bans</div><div class="draft-bans-list">' + champPills(t1bans, true) + '</div>' : '') +
    '</div>' +
    '<div class="draft-divider">VS</div>' +
    '<div>' +
      '<div class="draft-col-label">' + esc(t2name) + '</div>' +
      '<div class="draft-col-label" style="color:var(--text-faint);font-size:10px;margin-top:8px">Picks</div>' +
      '<div class="draft-picks-list">' + champPills(picks2, false) + '</div>' +
      (t2bans.length ? '<div class="draft-col-label" style="color:var(--text-faint);font-size:10px;margin-top:8px">Bans</div><div class="draft-bans-list">' + champPills(t2bans, true) + '</div>' : '') +
    '</div>' +
  '</div>';
}

// ── Series history for Draft tab ──────────────────────────────────────────────
function buildSeriesHistory(m, t1name, t2name) {
  const seriesGames = m.seriesGames || [];
  const fearless    = !!m.fearlessDraft;

  if (seriesGames.length === 0 && !fearless) return '';

  // Collect fearless pool (all champion names used across completed games)
  const fearlessNames = [];
  if (fearless) {
    const seen = new Set();
    seriesGames.forEach(sg => {
      [...(sg.t1RolePicks||[]), ...(sg.t2RolePicks||[])].forEach(url => {
        const n = champNameFromUrl(url);
        if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); fearlessNames.push({ name: n, url }); }
      });
    });
  }

  let html = '<div class="dhist-section">' +
    '<div class="dhist-hdr">Series History</div>';

  // Fearless pool
  if (fearless) {
    html += '<div class="dhist-fearless">' +
      '<div class="dhist-fearless-label">Fearless Pool — ' + fearlessNames.length + ' champions unavailable</div>' +
      '<div class="dhist-fearless-chips">' +
      (fearlessNames.length
        ? fearlessNames.map(c => {
            const img = c.url ? '<div class="dhist-f-icon" style="background-image:url(' + esc(c.url) + ')"></div>' : '';
            return '<span class="dhist-f-chip">' + img + esc(c.name) + '</span>';
          }).join('')
        : '<span style="color:var(--text-faint);font-size:12px">No games recorded yet</span>') +
      '</div></div>';
  }

  if (seriesGames.length === 0) {
    html += '</div>';
    return html;
  }

  seriesGames.forEach(sg => {
    const winnerName = sg.winner === 'team1' ? t1name : t2name;
    const hasDraft   = (sg.draftPicks || []).some(Boolean);
    const t1Side     = (sg.t1Side || 'blue').toUpperCase();
    const t2Side     = (sg.t2Side || 'red').toUpperCase();

    // Index arrays for this specific game's banFirst/blueSide
    const banFirst   = sg.banFirstTeam || 'blue';
    const blueSlot   = sg.blueSideTeam || 'team1';
    const physBlueBanIdx  = banFirst === 'blue' ? BLUE_BAN_IDX  : RED_BAN_IDX;
    const physRedBanIdx   = banFirst === 'blue' ? RED_BAN_IDX   : BLUE_BAN_IDX;
    const physBluePickIdx = banFirst === 'blue' ? BLUE_PICK_IDX : RED_PICK_IDX;
    const physRedPickIdx  = banFirst === 'blue' ? RED_PICK_IDX  : BLUE_PICK_IDX;
    const t1BanIdx  = blueSlot === 'team1' ? physBlueBanIdx  : physRedBanIdx;
    const t2BanIdx  = blueSlot === 'team1' ? physRedBanIdx   : physBlueBanIdx;

    const dp = sg.draftPicks || [];
    const t1Bans = dp.length ? t1BanIdx.map(i => dp[i] || '') : Array(5).fill('');
    const t2Bans = dp.length ? t2BanIdx.map(i => dp[i] || '') : Array(5).fill('');

    // Picks: prefer role-ordered, fall back to draft-order picks
    const t1Picks = (sg.t1RolePicks || []).some(Boolean) ? (sg.t1RolePicks || []) : [];
    const t2Picks = (sg.t2RolePicks || []).some(Boolean) ? (sg.t2RolePicks || []) : [];
    const t1Players = (sg.players && sg.players.team1) || [];
    const t2Players = (sg.players && sg.players.team2) || [];
    const roles = ['Top', 'Jg', 'Mid', 'Bot', 'Sup'];

    function banRow(bans) {
      return '<div class="dhist-bans-row">' + bans.map(url => {
        const img = url ? 'background-image:url(' + esc(url) + ')' : '';
        return '<div class="dhist-ban-slot' + (url ? ' filled' : '') + '">' +
          '<div class="dhist-ban-img" style="' + img + '"></div>' +
        '</div>';
      }).join('') + '</div>';
    }

    function pickList(picks, players) {
      if (!picks.some(Boolean)) return '<div style="color:var(--text-faint);font-size:12px;padding:6px 0">No pick data</div>';
      return picks.map((url, i) => {
        const name   = champNameFromUrl(url);
        const img    = url ? 'background-image:url(' + esc(url) + ')' : '';
        const p      = players[i] || {};
        const role   = p.role || roles[i] || '';
        const handle = p.handle || '';
        const sub    = [role, handle].filter(Boolean).join(' · ');
        return '<div class="dhist-pick-row' + (url ? ' filled' : '') + '">' +
          '<div class="dhist-pick-img" style="' + img + '"></div>' +
          '<div class="dhist-pick-info">' +
            '<div class="dhist-pick-name">' + esc(name || '—') + '</div>' +
            (sub ? '<div class="dhist-pick-sub">' + esc(sub) + '</div>' : '') +
          '</div>' +
        '</div>';
      }).join('');
    }

    html += '<div class="dhist-game card">' +
      '<div class="dhist-summary" onclick="this.closest(\'.dhist-game\').classList.toggle(\'open\')">' +
        '<span class="dhist-num">GAME ' + sg.gameNum + '</span>' +
        '<span class="dhist-winner' + (sg.isBye ? ' dhist-bye' : '') + '">' + esc(winnerName) + (sg.isBye ? ' (BYE)' : ' WON') + '</span>' +
        '<span class="dhist-sides">' +
          esc(t1name) + ' <strong class="side-' + t1Side.toLowerCase() + '">' + t1Side + '</strong>' +
          ' · ' + esc(t2name) + ' <strong class="side-' + t2Side.toLowerCase() + '">' + t2Side + '</strong>' +
        '</span>' +
        (hasDraft ? '<span class="dhist-toggle">▼</span>' : '') +
      '</div>';

    if (hasDraft) {
      html += '<div class="dhist-detail">' +
        '<div class="dhist-cols">' +
          '<div class="dhist-col">' +
            '<div class="dhist-col-hdr">' + esc(t1name) + ' <span class="draft-side-badge badge-' + t1Side.toLowerCase() + '">' + t1Side + '</span></div>' +
            '<div class="dhist-section-lbl">Bans</div>' +
            banRow(t1Bans) +
            '<div class="dhist-section-lbl">Picks</div>' +
            pickList(t1Picks, t1Players) +
          '</div>' +
          '<div class="dhist-col">' +
            '<div class="dhist-col-hdr">' + esc(t2name) + ' <span class="draft-side-badge badge-' + t2Side.toLowerCase() + '">' + t2Side + '</span></div>' +
            '<div class="dhist-section-lbl">Bans</div>' +
            banRow(t2Bans) +
            '<div class="dhist-section-lbl">Picks</div>' +
            pickList(t2Picks, t2Players) +
          '</div>' +
        '</div>' +
      '</div>';
    }

    html += '</div>';
  });

  html += '</div>';
  return html;
}

// ── SERIES TAB — CS2 variant (map results) ───────────────────────────────────────
function csLinesForMap(mapDisp) {
  const sk = csCurrentSeriesKey();
  return ((_state.tournament && _state.tournament.csStats) || []).filter(l => l.seriesKey === sk && l.map === mapDisp);
}
function renderSeriesCS(el, m, t1name, t2name) {
  const formatNum = parseInt((m.format || 'Bo3').replace('Bo', '')) || 3;
  const t1wins = (m.team1 && m.team1.score) || 0, t2wins = (m.team2 && m.team2.score) || 0;
  const seriesOver = t1wins >= Math.ceil(formatNum / 2) || t2wins >= Math.ceil(formatNum / 2);
  const rows = (m.mapResults || []).filter(r => r && r.map);

  let html = '<div class="series-header">' +
    '<span class="series-title">' + esc(t1name) + ' vs ' + esc(t2name) + '</span>' +
    '<span class="series-title" style="color:var(--text-faint)">·</span>' +
    '<span class="series-title" style="font-size:15px;color:var(--text-dim)">' + esc(m.format || '') + (seriesOver ? ' · Series complete' : '') + '</span>' +
  '</div>';
  html += '<div class="cs-series-score">' + esc(t1name) + ' <b>' + t1wins + '</b> — <b>' + t2wins + '</b> ' + esc(t2name) + '</div>';

  if (!rows.length) { el.innerHTML = html + '<div class="empty-state">No maps set yet — see Map Veto</div>'; return; }

  html += rows.map(r => {
    const st = (r.status || 'upcoming').toLowerCase();
    const winName = r.winner === 'team1' ? t1name : r.winner === 'team2' ? t2name : '';
    const score = (st === 'final' || r.t1Rounds || r.t2Rounds) ? '<b>' + (r.t1Rounds|0) + '</b> – <b>' + (r.t2Rounds|0) + '</b>' : '';
    const pill = st === 'final' ? '<span class="pill cs-pill-final">FINAL</span>' : st === 'live' ? '<span class="pill cs-pill-live">LIVE</span>' : '<span class="pill cs-pill-up">UPCOMING</span>';
    // Top fragger this map (from logged stats)
    const lines = csLinesForMap(r.map);
    let topHtml = '';
    if (lines.length) {
      const top = lines.slice().sort((a, b) => (b.kills|0) - (a.kills|0))[0];
      if (top) topHtml = '<div class="cs-map-top">Top: ' + esc(top.name) + ' ' + (top.kills|0) + '/' + (top.deaths|0) + '/' + (top.assists|0) + (top.adr ? ' · ' + (top.adr|0) + ' ADR' : '') + '</div>';
    }
    return '<div class="card cs-map-row">' +
      '<div class="cs-map-main">' +
        '<span class="cs-map-name">' + esc(r.map) + '</span>' + pill +
        (score ? '<span class="cs-map-score">' + score + '</span>' : '') +
        (winName ? '<span class="cs-map-win">' + esc(winName) + ' win</span>' : '') +
      '</div>' + topHtml +
    '</div>';
  }).join('');
  el.innerHTML = html;
}

// ── SERIES TAB (Dota) ─────────────────────────────────────────────────────────────
// One card per recorded game: winner + kill score + duration, the CM draft (picks + bans
// per team from the snapshot), and expandable per-player stat lines. Data = the snapshots
// /api/match/record-game attaches (heroDraft + GSI archive), so it survives feed loss.
function renderSeriesDota(el, m, t1name, t2name) {
  const formatNum  = parseInt((m.format || 'Bo3').replace('Bo', '')) || 3;
  const winsNeeded = Math.ceil(formatNum / 2);
  const t1wins = (m.team1 && m.team1.score) || 0, t2wins = (m.team2 && m.team2.score) || 0;
  const seriesOver = t1wins >= winsNeeded || t2wins >= winsNeeded;
  const games = m.seriesGames || [];

  let html = '<div class="series-header">' +
    '<span class="series-title">' + esc(t1name) + ' vs ' + esc(t2name) + '</span>' +
    '<span class="series-title" style="color:var(--text-faint)">·</span>' +
    '<span class="series-title" style="font-size:15px;color:var(--text-dim)">' + esc(m.format || '') + (seriesOver ? ' · Series complete' : '') + '</span>' +
  '</div>';
  html += '<div class="cs-series-score">' + esc(t1name) + ' <b>' + t1wins + '</b> — <b>' + t2wins + '</b> ' + esc(t2name) + '</div>';

  if (!games.length) { el.innerHTML = html + '<div class="empty-state">No games recorded yet</div>'; return; }

  const chip = st => '<span class="sd-chip' + (st.action === 'ban' ? ' sd-chip-ban' : '') + '">' +
    (st.img ? '<span class="sd-chip-img" style="background-image:url(' + esc(st.img) + ')"></span>' : '') +
    esc(st.hero || '—') + '</span>';
  const playerRows = ps => ps.map(p =>
    '<div class="sd-p-row">' +
      '<span class="sd-p-name">' + esc(p.name || p.hero || '?') + '<span class="sd-p-hero">' + esc(p.hero || '') + '</span></span>' +
      '<span class="sd-p-kda"><b>' + (p.kills | 0) + '</b> / ' + (p.deaths | 0) + ' / ' + (p.assists | 0) + '</span>' +
      '<span class="sd-p-nw">' + dlFmtNw(p.netWorth) + '</span>' +
      '<span class="sd-p-gpm">' + (p.gpm | 0) + '</span>' +
    '</div>').join('');

  html += games.map(gm => {
    const winName = gm.winner === 'team1' ? t1name : t2name;
    const steps = (gm.heroDraft && gm.heroDraft.steps) || [];
    const dp = (gm.dota && gm.dota.players) || null;
    const score = gm.dota ? '<span class="sd-score"><b class="dl-rad">' + (gm.dota.radiantScore | 0) + '</b> : <b class="dl-dire">' + (gm.dota.direScore | 0) + '</b></span>' : '';
    const dur = gm.dota && gm.dota.clockTime ? '<span class="sd-dur">' + dlFmtClock(gm.dota.clockTime) + '</span>' : '';
    const teamBlock = (tk, name) => {
      const picks = steps.filter(st => st.team === tk && st.action === 'pick');
      const bans  = steps.filter(st => st.team === tk && st.action === 'ban');
      if (!picks.length && !bans.length) return '';
      return '<div class="sd-team"><div class="sd-team-name ' + (tk === 'team1' ? 'dl-rad' : 'dl-dire') + '">' + esc(name) + '</div>' +
        '<div class="sd-picks">' + picks.map(chip).join('') + '</div>' +
        (bans.length ? '<div class="sd-bans">' + bans.map(chip).join('') + '</div>' : '') +
      '</div>';
    };
    let statsHtml = '';
    if (dp && ((dp.team1 || []).length || (dp.team2 || []).length)) {
      statsHtml = '<details class="sd-stats"><summary>Player stats</summary><div class="sd-stats-cols">' +
        '<div>' + playerRows(dp.team1 || []) + '</div><div>' + playerRows(dp.team2 || []) + '</div>' +
      '</div></details>';
    }
    return '<div class="card sd-game">' +
      '<div class="sd-head"><span class="sd-gnum">GAME ' + gm.gameNum + '</span>' +
        '<span class="sd-win">' + esc(winName) + ' win' + (gm.isBye ? ' (BYE)' : '') + '</span>' + score + dur + '</div>' +
      (steps.some(st => st.hero) ? '<div class="sd-teams">' + teamBlock('team1', t1name) + teamBlock('team2', t2name) + '</div>' : '') +
      statsHtml +
    '</div>';
  }).join('');

  if (!seriesOver) html += '<div class="empty-state" style="padding:14px">Game ' + (m.currentGameNum || games.length + 1) + ' — up next</div>';
  html += renderDotaAggCaster();
  el.innerHTML = html;
}

// Tournament hero-stats aggregate (Dota) — per player, per hero, across recorded games.
function renderDotaAggCaster() {
  const lines = (_state && _state.tournament && _state.tournament.dotaStats) || [];
  if (!lines.length) return '';
  const byPlayer = {};
  lines.forEach(function (l) {
    const pid = l.steamid || l.name || '?';
    const pl = byPlayer[pid] || (byPlayer[pid] = { name: l.name || '—', games: 0, wins: 0, heroes: {} });
    pl.games++; if (l.win) pl.wins++;
    const hk = l.hero || '—';
    const h = pl.heroes[hk] || (pl.heroes[hk] = { hero: hk, games: 0, wins: 0, k: 0, d: 0, a: 0 });
    h.games++; if (l.win) h.wins++; h.k += (l.kills | 0); h.d += (l.deaths | 0); h.a += (l.assists | 0);
  });
  const agg = Object.keys(byPlayer).map(function (pid) {
    const pl = byPlayer[pid];
    pl.heroList = Object.keys(pl.heroes).map(function (hk) { return pl.heroes[hk]; }).sort(function (x, y) { return y.games - x.games; });
    return pl;
  }).sort(function (x, y) { return y.games - x.games; });

  const rows = agg.map(function (p) {
    const wr = p.games ? Math.round(p.wins / p.games * 100) : 0;
    return p.heroList.map(function (h, i) {
      const hwr = h.games ? Math.round(h.wins / h.games * 100) : 0;
      const kda = (h.k / h.games).toFixed(1) + ' / ' + (h.d / h.games).toFixed(1) + ' / ' + (h.a / h.games).toFixed(1);
      return '<tr>' + (i === 0 ? '<td rowspan="' + p.heroList.length + '" class="dagg-player"><div class="dagg-name">' + esc(p.name) + '</div><div class="dagg-sub">' + p.games + ' games · ' + wr + '%</div></td>' : '') +
        '<td>' + esc(h.hero) + '</td><td class="right">' + h.games + '</td><td class="right ' + wrClass(hwr) + '">' + hwr + '%</td><td class="right">' + kda + '</td></tr>';
    }).join('');
  }).join('');
  return '<div class="card" style="margin-top:16px"><div class="dagg-title">Tournament Hero Stats</div>' +
    '<table class="dagg-table"><thead><tr><th>Player</th><th>Hero</th><th class="right">Games</th><th class="right">Win%</th><th class="right">Avg K/D/A</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

// ── MAP VETO TAB (CS2) ───────────────────────────────────────────────────────────
function renderMapVeto() {
  const el = document.getElementById('mapveto-content'); if (!el) return;
  const s = _state, m = s.match || {}, mv = s.mapVeto || {};
  const teamName = tk => (m[tk] && (m[tk].name || m[tk].tag)) || (tk === 'team1' ? 'Team 1' : 'Team 2');
  const steps = (mv.steps || []).filter(st => st && st.map);
  const pool = (s.tournament && s.tournament.mapPool) || [];
  const poolNames = pool.map(x => (typeof x === 'string' ? x : (x && x.name)) || '').filter(Boolean);

  if (!steps.length && !poolNames.length) { el.innerHTML = '<div class="empty-state">No map veto data</div>'; return; }

  let html = '<div class="series-header"><span class="series-title">' + esc(mv.title || 'Map Veto') + '</span>' +
    '<span class="series-title" style="font-size:15px;color:var(--text-dim)">' + esc(m.format || '') + '</span></div>';

  if (steps.length) {
    html += '<div class="cs-veto-list">' + steps.map((st, i) => {
      const act = (st.action || '').toLowerCase();
      const actor = st.team ? teamName(st.team) : '';
      const cls = act === 'ban' ? 'cs-veto-ban' : act === 'decider' ? 'cs-veto-dec' : 'cs-veto-pick';
      let meta = '';
      if (act === 'pick') {
        const other = st.team === 'team1' ? 'team2' : 'team1';
        meta = st.side ? '<span class="cs-veto-side">' + esc(teamName(other)) + ' ' + esc(st.side) + ' start</span>' : '';
      } else if (act === 'decider') {
        // Data-driven: CS2 deciders record side:'knife'; VALORANT records a team + DEF/ATK side.
        meta = st.side === 'knife' ? '<span class="cs-veto-side">Knife round</span>'
             : (st.side && st.team) ? '<span class="cs-veto-side">' + esc(teamName(st.team)) + ' ' + esc(st.side) + ' start</span>'
             : '';
      }
      return '<div class="cs-veto-step ' + cls + '">' +
        '<span class="cs-veto-num">' + (i + 1) + '</span>' +
        '<span class="cs-veto-act">' + esc((act || '').toUpperCase()) + '</span>' +
        '<span class="cs-veto-map">' + esc(st.map) + '</span>' +
        (actor ? '<span class="cs-veto-actor">' + esc(actor) + '</span>' : '') +
        meta +
      '</div>';
    }).join('') + '</div>';
  }

  // Remaining pool (maps not in the veto)
  const usedMaps = new Set(steps.map(st => (st.map || '').toLowerCase()));
  const remaining = poolNames.filter(n => !usedMaps.has(n.toLowerCase()));
  if (remaining.length) {
    html += '<div class="cs-pool"><div class="cs-pool-label">Map pool</div><div class="cs-pool-maps">' +
      poolNames.map(n => '<span class="cs-pool-map' + (usedMaps.has(n.toLowerCase()) ? ' used' : '') + '">' + esc(n) + '</span>').join('') +
      '</div></div>';
  }
  el.innerHTML = html;
}

// ── LIVE TAB (CS2 scoreboard) ────────────────────────────────────────────────────
function csMoney(n) { return '$' + (n | 0).toLocaleString('en-US'); }
function csBuyLabel(avgEquip) { return avgEquip < 2000 ? 'Eco' : avgEquip < 3800 ? 'Force buy' : 'Full buy'; }
function renderLive() {
  const el = document.getElementById('live-content'); if (!el) return;
  if (casterIsDota()) return renderLiveDota(el);
  const s = _state, m = s.match || {}, live = s.live || {}, gsi = live.gsi || {}, players = live.players || {};
  const ids = Object.keys(players);
  const fresh = gsi.lastSeen && (Date.now() - gsi.lastSeen < 30000);

  if (!ids.length && !fresh) { el.innerHTML = '<div class="empty-state">Waiting for live data… (enable GSI / MatchZy on the Live Data tab)</div>'; return; }

  const t1name = (m.team1 && (m.team1.name || m.team1.tag)) || 'Team 1';
  const t2name = (m.team2 && (m.team2.name || m.team2.tag)) || 'Team 2';

  // Scoreline — GSI reports CT/T scores; show those plus the map/phase.
  let head = '<div class="cs-live-head">';
  head += '<span class="cs-live-map">' + esc(gsi.map || (live.matchzy && live.matchzy.map) || 'Live') + '</span>';
  if (gsi.map) head += '<span class="cs-live-score">CT <b>' + (gsi.ctScore|0) + '</b> : <b>' + (gsi.tScore|0) + '</b> T</span>';
  if (gsi.round) head += '<span class="cs-live-round">Round ' + (gsi.round|0) + (gsi.phase ? ' · ' + esc(gsi.phase) : '') + '</span>';
  head += '</div>';

  const col = tk => {
    const ps = ids.map(id => players[id]).filter(p => (p.team || 'team1') === tk).sort((a, b) => (b.kills|0) - (a.kills|0));
    const hasEco = ps.some(p => p.money != null || p.equip != null);
    let econ = '';
    if (hasEco) {
      const money = ps.reduce((n, p) => n + (p.money|0), 0), equip = ps.reduce((n, p) => n + (p.equip|0), 0);
      const avg = ps.length ? equip / ps.length : 0;
      econ = '<div class="cs-econ">' + csMoney(money) + ' · equip ' + csMoney(equip) + ' <span class="cs-buy">' + csBuyLabel(avg) + '</span></div>';
    }
    const rows = ps.map(p => {
      const mk = [];
      if (p.k5) mk.push('<span class="cs-mkb cs-mkb-ace">ACE</span>'); if (p.k4) mk.push('<span class="cs-mkb">4K</span>'); if (p.k3) mk.push('<span class="cs-mkb">3K</span>');
      return '<div class="cs-sb-row">' +
        '<span class="cs-sb-name">' + esc(p.name || '?') + (p.side ? ' <span class="cs-sb-side">' + esc(p.side) + '</span>' : '') + '</span>' +
        '<span class="cs-sb-kda"><b>' + (p.kills|0) + '</b> / ' + (p.deaths|0) + ' / ' + (p.assists|0) + '</span>' +
        (p.adr ? '<span class="cs-sb-adr">' + (p.adr|0) + ' adr</span>' : '<span class="cs-sb-adr"></span>') +
        (mk.length ? '<span class="cs-sb-mk">' + mk.join('') + '</span>' : '') +
      '</div>';
    }).join('') || '<div class="empty-state" style="padding:14px">No players</div>';
    return '<div class="card cs-sb-col"><div class="cs-sb-hdr">' + esc(tk === 'team1' ? t1name : t2name) + '</div>' + econ +
      '<div class="cs-sb-head-row"><span>Player</span><span>K / D / A</span><span>ADR</span><span></span></div>' + rows + '</div>';
  };

  el.innerHTML = head + '<div class="cs-sb-cols">' + col('team1') + col('team2') + '</div>';
}

// ── LIVE TAB (Dota — the match-summary information set, live for casters) ────────
// Comes off the observer/GOTV client, so it runs at the OBSERVER's delay — expected.
// DATA-ONLY reference surface: scoreboards + items, net-worth split, and the
// net-worth-over-time graph with ALL event markers (no broadcast toggles here).
function casterIsDota() { const a = _state && _state.adapter; return a ? a.pickEntity === 'hero' : false; }
function dlFmtNw(n) { n = n | 0; return Math.abs(n) >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }
function dlFmtClock(sec) {
  sec = sec | 0; const neg = sec < 0; sec = Math.abs(sec);
  return (neg ? '-' : '') + Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}
function dlRosterName(teamKey, p) {
  const roster = ((_state.players || {})[teamKey]) || [];
  const sid = String(p.steamid || '');
  if (sid) { const bySid = roster.filter(r => String(r.steamid || '') === sid)[0]; if (bySid && bySid.handle) return bySid.handle; }
  const gn = csNormName(p.gsiName);
  if (gn) { const byName = roster.filter(r => csNormName(r.handle) === gn || csNormName(r.name) === gn)[0]; if (byName && byName.handle) return byName.handle; }
  return '';   // roster name only — never the GSI in-game name
}
const DL_MARKS = {   // same dedicated per-type colours as the match-summary graphic
  roshan:    { glyph: 'R',  fill: '#f0cc44', label: 'ROSHAN' },
  tormentor: { glyph: 'T',  fill: '#3ec8e8', label: 'TORMENTOR' },
  tower:     { glyph: 'TW', fill: '#f08c3e', label: 'TOWER' },
  barracks:  { glyph: 'RX', fill: '#b07ce8', label: 'BARRACKS' },
  ancient:   { glyph: 'GG', fill: '#c9d4e0', label: 'ANCIENT' },
  multikill: { glyph: '',   fill: '#e86cb8', label: 'MULTIKILL' },
  teamfight: { glyph: 'TF', fill: '#7c9ce8', label: 'TEAMFIGHT' },
};
const DL_RAD = '#26aa5a', DL_DIRE = '#e14b3d';
let _dotaTl = { samples: [], events: [] }, _dotaTlAt = 0;
// Poll the match timeline while the Live tab is showing for a Dota game (5s, matches
// the broadcast graphic). fetch carries the caster token — the endpoint is requireAuth.
setInterval(function () {
  if (_activeTab !== 'live' || !_state || !casterIsDota() || document.hidden) return;
  fetch('/api/live/dota/timeline?token=' + encodeURIComponent(TOKEN))
    .then(r => r.ok ? r.json() : null)
    .then(j => { if (j && j.samples) { _dotaTl = j; _dotaTlAt = Date.now(); renderLive(); } })
    .catch(() => {});
}, 5000);
function dlGraphSvg() {
  const s = _dotaTl.samples || [];
  if (s.length < 2) return '<div class="empty-state" style="padding:20px">No timeline yet — the graph builds as the match runs.</div>';
  const W = 1200, H = 230, L = 52, R = 14, T = 50, B = 20;
  const iw = W - L - R, ih = H - T - B;
  const t0 = s[0].t, t1 = s[s.length - 1].t, span = Math.max(1, t1 - t0);
  let maxAbs = 0; s.forEach(p => { maxAbs = Math.max(maxAbs, Math.abs((p.rnw | 0) - (p.dnw | 0))); });
  let yMax = maxAbs * 1.1 || 1000;
  const pow = Math.pow(10, Math.floor(Math.log10(yMax))); const nn = yMax / pow;
  yMax = (nn <= 1 ? 1 : nn <= 2 ? 2 : nn <= 2.5 ? 2.5 : nn <= 5 ? 5 : 10) * pow;
  const X = t => L + (t - t0) / span * iw, Y = v => T + ih / 2 - (v / yMax) * (ih / 2), zero = Y(0);
  const pts = s.map(p => [X(p.t), Y((p.rnw | 0) - (p.dnw | 0))]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
  const area = line + 'L' + pts[pts.length - 1][0].toFixed(1) + ' ' + zero + 'L' + pts[0][0].toFixed(1) + ' ' + zero + 'Z';
  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="dl-graph-svg">';
  svg += '<defs><clipPath id="dl-up"><rect x="0" y="0" width="' + W + '" height="' + zero + '"/></clipPath>' +
    '<clipPath id="dl-dn"><rect x="0" y="' + zero + '" width="' + W + '" height="' + (H - zero) + '"/></clipPath>' +
    '<linearGradient id="dl-fu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + DL_RAD + '" stop-opacity="0.4"/><stop offset="1" stop-color="' + DL_RAD + '" stop-opacity="0.05"/></linearGradient>' +
    '<linearGradient id="dl-fd" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="' + DL_DIRE + '" stop-opacity="0.4"/><stop offset="1" stop-color="' + DL_DIRE + '" stop-opacity="0.05"/></linearGradient></defs>';
  [-1, -0.5, 0.5, 1].forEach(f => {
    const y = Y(yMax * f);
    svg += '<line x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '" stroke="rgba(255,255,255,0.08)"/>' +
      '<text class="dl-ax" x="' + (L - 6) + '" y="' + (y + 3.5) + '" text-anchor="end">' + (f > 0 ? '+' : '−') + dlFmtNw(yMax * Math.abs(f)) + '</text>';
  });
  svg += '<line x1="' + L + '" y1="' + zero + '" x2="' + (W - R) + '" y2="' + zero + '" stroke="rgba(255,255,255,0.3)" stroke-width="1.5"/>';
  const step = Math.max(300, Math.ceil(span / 6 / 300) * 300);
  for (let tt = Math.ceil(t0 / step) * step; tt <= t1; tt += step) {
    svg += '<text class="dl-ax" x="' + X(tt) + '" y="' + (H - 5) + '" text-anchor="middle">' + dlFmtClock(tt) + '</text>';
  }
  svg += '<path d="' + area + '" fill="url(#dl-fu)" clip-path="url(#dl-up)"/>' +
    '<path d="' + area + '" fill="url(#dl-fd)" clip-path="url(#dl-dn)"/>' +
    '<path d="' + line + '" fill="none" stroke="#e8f4ff" stroke-width="2" stroke-linejoin="round"/>';
  svg += '<text class="dl-side" x="' + L + '" y="' + (T - 28) + '" fill="' + DL_RAD + '">▲ RADIANT LEAD</text>' +
    '<text class="dl-side" x="' + L + '" y="' + (H - B - 6) + '" fill="' + DL_DIRE + '">▼ DIRE LEAD</text>';
  // All event types, two chip lanes (tool page — casters get everything, no toggles).
  const evs = (_dotaTl.events || []).filter(e => DL_MARKS[e.type]).sort((a, b) => a.t - b.t);
  let lastX = -1e9, lane = 0;
  evs.forEach(e => {
    const x = X(Math.min(t1, Math.max(t0, e.clock != null ? e.clock : e.t)));
    lane = (x - lastX < 26) ? 1 - lane : 0; lastX = x;
    const cy = 12 + lane * 22, m = DL_MARKS[e.type];
    const stem = (e.type === 'tower' || e.type === 'barracks' || e.type === 'ancient') ? (e.side === 'team1' ? DL_DIRE : e.side === 'team2' ? DL_RAD : m.fill)
      : e.type === 'multikill' ? (e.team === 'team2' ? DL_DIRE : DL_RAD) : m.fill;
    const glyph = e.type === 'multikill' ? (Math.min(5, Math.max(3, e.count | 0)) + 'K') : m.glyph;
    svg += '<line x1="' + x + '" y1="' + (cy + 9) + '" x2="' + x + '" y2="' + (H - B) + '" stroke="' + stem + '" stroke-opacity="0.45" stroke-width="1.2" stroke-dasharray="2 3"/>' +
      '<circle cx="' + x + '" cy="' + cy + '" r="9" fill="' + m.fill + '" stroke="#10161d" stroke-width="2"/>' +
      '<text x="' + x + '" y="' + (cy + 3) + '" text-anchor="middle" class="dl-chip-txt">' + glyph + '</text>';
  });
  svg += '</svg>';
  const seen = {}; let legend = '';
  evs.forEach(e => { if (seen[e.type]) return; seen[e.type] = 1; const m = DL_MARKS[e.type];
    legend += '<span class="dl-lg"><span class="dl-lg-chip" style="background:' + m.fill + '"></span>' + m.label + '</span>'; });
  return svg + (legend ? '<div class="dl-legend">' + legend + '</div>' : '');
}
function renderLiveDota(el) {
  const s = _state, m = s.match || {}, d = (s.live && s.live.dota) || {};
  const mp = d.matchPlayers || { team1: [], team2: [] };
  const fresh = d.lastSeen && (Date.now() - d.lastSeen < 30000);
  if (!(mp.team1 || []).length && !(mp.team2 || []).length && !fresh) {
    el.innerHTML = '<div class="empty-state">Waiting for live data… (enable GSI on the observer client — see the control panel\'s Live Data tab)</div>';
    return;
  }
  const t1n = (m.team1 && (m.team1.name || m.team1.tag)) || 'Radiant';
  const t2n = (m.team2 && (m.team2.name || m.team2.tag)) || 'Dire';
  const sum = arr => (arr || []).reduce((n, p) => n + (p.netWorth | 0), 0);
  const nw1 = sum(mp.team1), nw2 = sum(mp.team2), tot = nw1 + nw2, lead = nw1 - nw2;
  let head = '<div class="cs-live-head">' +
    '<span class="cs-live-map">' + dlFmtClock(d.clockTime) + (d.paused ? ' · PAUSED' : '') + '</span>' +
    '<span class="cs-live-score"><b class="dl-rad">' + (d.radiantScore | 0) + '</b> : <b class="dl-dire">' + (d.direScore | 0) + '</b></span>' +
    (d.gameState ? '<span class="cs-live-round">' + esc(d.gameState.replace(/_/g, ' ').toLowerCase()) + (d.winTeam ? ' · ' + esc(d.winTeam === 'team1' ? t1n : t2n) + ' win' : '') + '</span>' : '') +
  '</div>';
  if (tot) {
    head += '<div class="dl-nwbar-wrap"><div class="dl-nwbar-labels">' +
      '<span class="dl-rad">' + esc(t1n) + ' ' + dlFmtNw(nw1) + '</span>' +
      '<span class="dl-nw-lead">' + (lead === 0 ? 'EVEN' : (lead > 0 ? esc(t1n) : esc(t2n)) + ' +' + dlFmtNw(Math.abs(lead))) + '</span>' +
      '<span class="dl-dire">' + dlFmtNw(nw2) + ' ' + esc(t2n) + '</span></div>' +
      '<div class="dl-nwbar"><span class="dl-nw-t1" style="width:' + (nw1 / tot * 100) + '%"></span><span class="dl-nw-gap"></span><span class="dl-nw-t2"></span></div></div>';
  }
  const col = (tk, name) => {
    const rows = (mp[tk] || []).map(p => {
      const items = (p.items || []).map(it =>
        '<span class="dl-item' + (it.neutral ? ' dl-item-neutral' : '') + '" title="' + esc(it.name) + '"' + (it.img ? ' style="background-image:url(' + esc(it.img) + ')"' : '') + '></span>').join('');
      return '<div class="dl-row">' +
        '<span class="dl-hero"' + (p.heroImg ? ' style="background-image:url(' + esc(p.heroImg) + ')"' : '') + '><span class="dl-lvl">' + (p.level | 0) + '</span></span>' +
        '<span class="dl-name">' + esc(dlRosterName(tk, p) || p.hero || '?') + '<span class="dl-hero-sub">' + esc(p.hero || '') + '</span></span>' +
        '<span class="dl-kda"><b>' + (p.kills | 0) + '</b> / ' + (p.deaths | 0) + ' / ' + (p.assists | 0) + '</span>' +
        '<span class="dl-nw">' + dlFmtNw(p.netWorth) + '</span>' +
        '<span class="dl-gpm">' + (p.gpm | 0) + '</span>' +
        '<span class="dl-items">' + items + '</span>' +
      '</div>';
    }).join('') || '<div class="empty-state" style="padding:14px">No players</div>';
    return '<div class="card cs-sb-col dl-col dl-col-' + tk + '"><div class="cs-sb-hdr">' + esc(name) +
      '<span class="dl-side-tag">' + (tk === 'team1' ? 'RADIANT' : 'DIRE') + '</span></div>' +
      '<div class="dl-head-row"><span></span><span>Player</span><span>K / D / A</span><span>NET</span><span>GPM</span><span class="dl-items-h">Items</span></div>' + rows + '</div>';
  };
  const graph = '<div class="card dl-graph-card"><div class="dl-graph-title">NET WORTH OVER TIME</div>' + dlGraphSvg() + '</div>';
  el.innerHTML = head + '<div class="cs-sb-cols">' + col('team1', t1n) + col('team2', t2n) + '</div>' + graph;
}

// ── HERO DRAFT TAB (Dota Captains Mode — caster reference) ───────────────────────
// Mirrors state.heroDraft (operator board / GSI auto-fill): picks + bans per team in CM
// order, the on-clock slot, the two-tier timer (free time + each team's reserve pool),
// and the step sequence so casters can say "two bans, then it's a pick".
function hdCastClockTxt() {
  const hd = (_state && _state.heroDraft) || {};
  if (!hd.started) return '';
  const step = (hd.steps || [])[hd.currentStep | 0];
  const acting = step ? step.team : null;
  const reserve = (hd.reserve && acting) ? (hd.reserve[acting] | 0) : 0;
  let remain = null;
  if (hd.timerPaused && hd.turnPausedMs != null) remain = hd.turnPausedMs / 1000;
  else if (hd.turnEndsAt) remain = (hd.turnEndsAt - Date.now()) / 1000;
  if (remain == null) return '';
  remain = Math.max(0, Math.ceil(remain));
  const free = Math.max(0, remain - reserve);
  const mmss = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  const txt = free > 0 ? mmss(free) + ' free' : '<span class="hdc-reserve-live">' + mmss(remain) + ' reserve</span>';
  return txt + (hd.timerPaused ? ' <span class="hdc-paused">· paused</span>' : '');
}
setInterval(function () {
  const el = document.getElementById('hdc-clock');
  if (el) el.innerHTML = hdCastClockTxt();
}, 500);
function renderHeroDraft() {
  const el = document.getElementById('hdraft-content'); if (!el) return;
  if (!casterIsDota()) return;
  const s = _state, hd = s.heroDraft || {}, m = s.match || {};
  const steps = hd.steps || [];
  if (!steps.length) { el.innerHTML = '<div class="empty-state">No draft configured — the board fills once the draft starts (or via GSI auto-fill).</div>'; return; }
  const t1n = (m.team1 && (m.team1.name || m.team1.tag)) || 'Radiant';
  const t2n = (m.team2 && (m.team2.name || m.team2.tag)) || 'Dire';
  const cur = hd.currentStep | 0;
  const complete = steps.every(st => !!st.hero);
  const curStep = !complete ? steps[cur] : null;

  // Header: who's on the clock + the live two-tier timer.
  let head = '<div class="hdc-head">';
  if (complete) head += '<span class="hdc-onclock hdc-done">DRAFT COMPLETE</span>';
  else if (hd.started && curStep) {
    head += '<span class="hdc-onclock ' + (curStep.team === 'team1' ? 'hdc-t1' : 'hdc-t2') + '">' +
      esc(curStep.team === 'team1' ? t1n : t2n) + ' · ' + (curStep.action === 'pick' ? 'PICK' : 'BAN') + '</span>' +
      '<span class="hdc-clock" id="hdc-clock">' + hdCastClockTxt() + '</span>';
  } else head += '<span class="hdc-onclock hdc-idle">Draft not started</span>';
  head += '</div>';

  // Step sequence strip — every CM step in order, done/current/pending.
  const strip = '<div class="hdc-seq">' + steps.map((st, i) => {
    const cls = 'hdc-sq ' + (st.team === 'team1' ? 't1' : 't2') + (st.hero ? ' done' : '') + (!complete && i === cur ? ' cur' : '');
    return '<span class="' + cls + '" title="' + esc((st.team === 'team1' ? t1n : t2n) + ' ' + st.action) + '">' + (st.action === 'pick' ? 'P' : 'B') + '</span>';
  }).join('') + '</div>';

  const posLookup = tk => {
    const arr = (tk === 'team1' ? hd.team1Positions : hd.team2Positions) || [];
    const map = {}; arr.forEach((h, i) => { if (h) map[h] = i + 1; });
    return map;
  };
  const col = (tk, name) => {
    const picks = [], bans = [];
    steps.forEach((st, i) => { if (st.team === tk) (st.action === 'pick' ? picks : bans).push({ st, i }); });
    const pos = posLookup(tk);
    const reserve = (hd.reserve || {})[tk] | 0;
    const pickRows = picks.map((p, n) => {
      const active = !complete && p.i === cur;
      return '<div class="hdc-pick' + (active ? ' hdc-active' : '') + '">' +
        '<span class="hdc-pick-n">' + (n + 1) + '</span>' +
        '<span class="hdc-pick-img"' + (p.st.img ? ' style="background-image:url(' + esc(p.st.img) + ')"' : '') + '></span>' +
        '<span class="hdc-pick-name">' + (p.st.hero ? esc(p.st.hero) : (active ? 'On the clock…' : '—')) + '</span>' +
        (p.st.hero && pos[p.st.hero] ? '<span class="hdc-pos">P' + pos[p.st.hero] + '</span>' : '') +
      '</div>';
    }).join('');
    const banChips = bans.map(b => {
      const active = !complete && b.i === cur;
      return '<span class="hdc-ban' + (b.st.hero ? '' : ' empty') + (active ? ' hdc-active' : '') + '">' +
        '<span class="hdc-ban-img"' + (b.st.img ? ' style="background-image:url(' + esc(b.st.img) + ')"' : '') + '></span>' +
        (b.st.hero ? esc(b.st.hero) : (active ? '…' : '—')) + '</span>';
    }).join('');
    return '<div class="card hdc-col ' + (tk === 'team1' ? 'hdc-col-t1' : 'hdc-col-t2') + '">' +
      '<div class="cs-sb-hdr">' + esc(name) + '<span class="dl-side-tag">' + (tk === 'team1' ? 'RADIANT' : 'DIRE') + '</span>' +
      '<span class="hdc-reserve" title="Reserve time pool">RESERVE ' + Math.floor(reserve / 60) + ':' + String(reserve % 60).padStart(2, '0') + '</span></div>' +
      '<div class="hdc-picks">' + pickRows + '</div>' +
      '<div class="hdc-bans-label">Bans</div><div class="hdc-bans">' + banChips + '</div>' +
    '</div>';
  };
  el.innerHTML = head + strip + '<div class="cs-sb-cols">' + col('team1', t1n) + col('team2', t2n) + '</div>';
}

const DRAFT_ROLE_NAMES = ['Top', 'Jungle', 'Mid', 'Bot', 'Support'];

// ── DRAFT TAB ─────────────────────────────────────────────────────────────────
function renderDraft() {
  const s     = _state;
  const draft = s.draft || {};
  const m     = s.match || {};
  const el    = document.getElementById('draft-content');
  const phase = draft.phase || 'notstarted';

  if (phase === 'notstarted') {
    _draftTimerEnd = null;
    const t1n = (m.team1 && m.team1.name) || 'Team 1';
    const t2n = (m.team2 && m.team2.name) || 'Team 2';
    el.innerHTML = '<div class="empty-state" style="margin-bottom:16px">Draft not started</div>' +
      buildSeriesHistory(m, t1n, t2n);
    return;
  }

  const picks       = draft.picks || Array(20).fill('');
  const blueSlot    = draft.blueSideTeam || 'team1';
  const redSlot     = blueSlot === 'team1' ? 'team2' : 'team1';
  const blueTeam    = m[blueSlot] || {};
  const redTeam     = m[redSlot]  || {};
  const banFirst    = draft.banFirstTeam || 'blue';

  const bluePickIdx = banFirst === 'blue' ? BLUE_PICK_IDX : RED_PICK_IDX;
  const redPickIdx  = banFirst === 'blue' ? RED_PICK_IDX  : BLUE_PICK_IDX;
  const blueBanIdx  = banFirst === 'blue' ? BLUE_BAN_IDX  : RED_BAN_IDX;
  const redBanIdx   = banFirst === 'blue' ? RED_BAN_IDX   : BLUE_BAN_IDX;

  const draftActive  = phase !== 'complete';
  const stepIdx      = (draft.currentStep || 0) - 1;
  const activeIdx    = (draftActive && stepIdx >= 0 && stepIdx < 20) ? stepIdx : -1;
  const seq          = (activeIdx >= 0) ? DRAFT_SEQUENCE[activeIdx] : null;
  const onClockSide  = seq ? (seq.team === banFirst ? 'blue' : 'red') : null;

  _draftTimerEnd = (draft.timerVisible && draft.timerEnd) ? draft.timerEnd : null;

  // Player lookup — match by role field for robustness
  const allPlayers = s.players || {};
  const t1RolePicks = draft.team1RolePicks || [];
  const t2RolePicks = draft.team2RolePicks || [];
  const t1Players   = allPlayers.team1 || [];
  const t2Players   = allPlayers.team2 || [];
  const blueRolePicks = blueSlot === 'team1' ? t1RolePicks : t2RolePicks;
  const redRolePicks  = blueSlot === 'team1' ? t2RolePicks : t1RolePicks;
  const bluePlayers   = blueSlot === 'team1' ? t1Players   : t2Players;
  const redPlayers    = blueSlot === 'team1' ? t2Players   : t1Players;

  function playerForPick(url, rolePicks, players) {
    if (!url) return null;
    const roleIdx = rolePicks.findIndex(u => u === url);
    if (roleIdx < 0) return null;
    const roleName = DRAFT_ROLE_NAMES[roleIdx];
    return players.find(p => p.role === roleName) || players[roleIdx] || null;
  }

  function renderBanSlots(idxArr) {
    return idxArr.map(idx => {
      const url  = picks[idx] || '';
      const isActive = idx === activeIdx;
      const cls  = 'draft-ban-slot' + (url ? ' filled' : '') + (isActive ? ' active' : '');
      const img  = url ? 'background-image:url(' + esc(url) + ')' : '';
      return '<div class="' + cls + '"><div class="draft-ban-img" style="' + img + '"></div></div>';
    }).join('');
  }

  function renderPickSlots(idxArr, rolePicks, players) {
    const useRoleOrder = rolePicks.some(Boolean);
    const slots = useRoleOrder
      ? rolePicks.map((url, ri) => ({ url: url || '', isActive: false, player: players[ri] || null }))
      : idxArr.map(idx => ({ url: picks[idx] || '', isActive: idx === activeIdx, player: playerForPick(picks[idx] || '', rolePicks, players) }));

    return slots.map(({ url, isActive, player }) => {
      const name     = champNameFromUrl(url);
      const handle   = player ? (player.handle || '') : '';
      const dcs      = player ? (player.draftChampStats || null) : null;
      const trnEntry = (handle && name && _tournamentStats[handle]) ? (_tournamentStats[handle][name] || null) : null;
      const hasExpand = dcs || trnEntry;

      let opggPart = '';
      if (dcs) {
        const kdaRatio = dcs.kda && parseFloat(dcs.kda.d) > 0
          ? ((parseFloat(dcs.kda.k) + parseFloat(dcs.kda.a)) / parseFloat(dcs.kda.d)).toFixed(2)
          : 'Perfect';
        const kdaStr = dcs.kda ? (dcs.kda.k + ' / ' + dcs.kda.d + ' / ' + dcs.kda.a) : '—';
        const stats = [
          { val: dcs.winRate != null ? dcs.winRate + '%' : '—', key: 'Win Rate',   cls: wrClass(dcs.winRate) },
          { val: kdaStr,   key: 'Avg K/D/A',  cls: '' },
          { val: kdaRatio, key: 'KDA Ratio',  cls: '' },
          { val: dcs.cs   != null ? dcs.cs   : '—', key: 'CS/g',       cls: '' },
          { val: dcs.kp   != null ? dcs.kp + '%' : '—', key: 'Kill Part.', cls: '' },
          { val: dcs.games != null ? dcs.games : '—', key: 'Matches',   cls: '' },
        ];
        opggPart = '<div class="dps-grid">' +
          stats.map(s =>
            '<div class="dps-cell">' +
              '<div class="dps-val ' + s.cls + '">' + esc(String(s.val)) + '</div>' +
              '<div class="dps-key">' + s.key + '</div>' +
            '</div>'
          ).join('') +
        '</div>';
      }

      let trnPart = '';
      if (trnEntry) {
        const refsHtml = (trnEntry.matchRefs || []).map(ref =>
          '<div class="trn-ref-row ' + (ref.won ? 'trn-ref-win' : 'trn-ref-loss') + '">' +
            '<span class="trn-ref-result">' + (ref.won ? 'WIN' : 'LOSS') + '</span>' +
            '<span class="trn-ref-opp">vs ' + esc(ref.opponentName) + '</span>' +
            '<span class="trn-ref-meta">Game ' + esc(String(ref.gameNum)) + ' · ' + esc((ref.side || '').toUpperCase()) + '</span>' +
          '</div>'
        ).join('');
        trnPart = '<div class="draft-pick-trn">' +
          '<div class="draft-pick-trn-hdr">' +
            '<span class="trn-badge">TOURNAMENT</span>' +
            '<span class="trn-summary">' + trnEntry.games + (trnEntry.games === 1 ? ' Game' : ' Games') + ' · <span class="' + wrClass(trnEntry.winRate) + '">' + trnEntry.winRate + '% WR</span></span>' +
          '</div>' +
          '<div class="trn-refs">' + refsHtml + '</div>' +
        '</div>';
      }

      const statsPanel = hasExpand ? '<div class="draft-pick-stats-panel">' + opggPart + trnPart + '</div>' : '';

      const cls = 'draft-pick-slot' + (url ? ' filled' : '') + (isActive ? ' active' : '') + (hasExpand ? ' has-stats' : '');
      const img = url ? 'background-image:url(' + esc(url) + ')' : '';
      return '<div class="' + cls + '">' +
        '<div class="draft-pick-main">' +
          '<div class="draft-pick-img" style="' + img + '"></div>' +
          '<div class="draft-pick-info">' +
            '<div class="draft-pick-name">' + esc(name || '—') + '</div>' +
            (handle ? '<div class="draft-pick-handle">' + esc(handle) + '</div>' : '') +
            (trnEntry ? '<div class="trn-pick-badge">' + trnEntry.games + (trnEntry.games === 1 ? ' Game' : ' Games') + ' · <span class="' + wrClass(trnEntry.winRate) + '">' + trnEntry.winRate + '%</span></div>' : '') +
          '</div>' +
          (hasExpand ? '<button class="draft-pick-expand-btn" onclick="this.closest(\'.draft-pick-slot\').classList.toggle(\'expanded\')">▼</button>' : '') +
        '</div>' +
        statsPanel +
      '</div>';
    }).join('');
  }

  function sideCard(team, side, banIdx, pickIdx, rolePicks, players) {
    const logo    = team.logo ? 'background-image:url(' + esc(team.logo) + ')' : '';
    const isOnClock = onClockSide === side;
    return '<div class="draft-side draft-side-' + side + (isOnClock ? ' on-clock' : '') + '">' +
      '<div class="draft-side-hdr">' +
        (logo ? '<div class="draft-team-logo" style="' + logo + '"></div>' : '') +
        '<div class="draft-team-name">' + esc(team.name || team.tag || (side === 'blue' ? 'Blue Side' : 'Red Side')) + '</div>' +
        '<span class="draft-side-badge badge-' + side + '">' + side.toUpperCase() + '</span>' +
      '</div>' +
      '<div class="draft-section-lbl">Bans</div>' +
      '<div class="draft-bans-row">' + renderBanSlots(banIdx) + '</div>' +
      '<div class="draft-section-lbl">Picks</div>' +
      '<div class="draft-picks-col">' + renderPickSlots(pickIdx, rolePicks, players) + '</div>' +
    '</div>';
  }

  // On-clock banner
  let clockHtml = '';
  if (onClockSide && seq) {
    const team = onClockSide === 'blue' ? blueTeam : redTeam;
    const name = team.name || team.tag || (onClockSide === 'blue' ? 'Blue' : 'Red');
    const action = seq.type === 'ban' ? 'BANNING' : 'PICKING';
    clockHtml = '<div class="draft-on-clock draft-on-clock-' + onClockSide + '">' +
      '<span class="draft-clock-name">' + esc(name) + '</span>' +
      '<span class="draft-clock-sep">·</span>' +
      '<span class="draft-clock-action">' + action + '</span>' +
      (_draftTimerEnd ? '<span class="draft-timer-val" id="draft-timer-val">—</span>' : '') +
    '</div>';
  } else if (phase === 'complete') {
    clockHtml = '<div class="draft-on-clock draft-on-clock-done"><span class="draft-clock-action">DRAFT COMPLETE</span></div>';
  }

  // Side choice label
  let choiceHtml = '';
  if (draft.sideChooser) {
    const ct = m[draft.sideChooser] || {};
    const ctName = ct.tag || ct.name || draft.sideChooser;
    const chosenSide = draft.sideChooser === blueSlot ? 'BLUE' : 'RED';
    choiceHtml = '<div class="draft-side-choice">' + esc(ctName) + ' chose ' + chosenSide + '</div>';
  }

  // Phase + game meta
  const phaseLabel = DRAFT_PHASE_LABELS[phase] || phase;
  const gameNum    = m.currentGameNum || 1;
  const format     = m.format || '';
  const fearless   = m.fearlessDraft ? '<span class="pill pill-fearless">Fearless</span>' : '';
  const metaHtml   = '<div class="draft-meta-bar">' +
    '<span class="draft-phase-label">' + esc(phaseLabel) + '</span>' +
    '<span class="draft-game-info">Game ' + esc(gameNum) + (format ? ' · ' + esc(format) : '') + '</span>' +
    fearless +
  '</div>';

  const t1name = (m.team1 && m.team1.name) || 'Team 1';
  const t2name = (m.team2 && m.team2.name) || 'Team 2';

  el.innerHTML = '<div class="draft-board">' +
    metaHtml + choiceHtml + clockHtml +
    '<div class="draft-sides">' +
      sideCard(blueTeam, 'blue', blueBanIdx, bluePickIdx, blueRolePicks, bluePlayers) +
      sideCard(redTeam,  'red',  redBanIdx,  redPickIdx,  redRolePicks,  redPlayers) +
    '</div>' +
  '</div>' +
  buildSeriesHistory(m, t1name, t2name);
}

// ── STANDINGS TAB ─────────────────────────────────────────────────────────────
function renderStandings() {
  const s = _state;
  const tourn = s.tournament || {};
  const groups = tourn.groups || [];
  const el = document.getElementById('standings-content');

  if (groups.length === 0) {
    el.innerHTML = '<div class="empty-state">No group stage configured</div>';
    return;
  }

  const standings = calculateGroupStandings(s, _teams);
  const qualN = tourn.qualifiersPerGroup || 2;

  const html = '<div class="standings-grid">' +
    groups.map(grp => {
      const rows = standings[grp.id] || [];
      const rowsHtml = rows.map((r, i) => {
        const isQual = i < qualN;
        const logoStyle = r.logo ? 'background-image:url(' + esc(r.logo) + ')' : '';
        const row =
          '<div class="standings-row' + (isQual ? ' standings-row-qual' : '') + '">' +
            '<div class="standings-badge' + (isQual ? ' qual' : '') + '">' + (i + 1) + '</div>' +
            '<div class="standings-logo" style="' + logoStyle + '"></div>' +
            '<span class="standings-name">' + esc(r.name) + '</span>' +
            '<span class="standings-record">' +
              '<b class="standings-w">' + r.sw + '</b>' +
              '<span class="standings-rec-sep">–</span>' +
              '<span class="standings-l">' + r.sl + '</span>' +
            '</span>' +
          '</div>';
        // Qualification cutoff line after the last advancing position
        const cutoff = (i === qualN - 1 && i < rows.length - 1)
          ? '<div class="standings-cutoff"><span>Qualification</span></div>' : '';
        return row + cutoff;
      }).join('');

      return '<div class="card standings-card">' +
        '<div class="card-header standings-card-hdr">' +
          '<span class="card-title">' + esc(grp.name || 'Group') + '</span>' +
          '<span class="standings-qual-note">Top ' + qualN + ' advance</span>' +
        '</div>' +
        '<div class="standings-rows">' + rowsHtml + '</div>' +
      '</div>';
    }).join('') +
  '</div>';

  el.innerHTML = html;
}

// ── BRACKET TAB ───────────────────────────────────────────────────────────────
// Field shapes mirror the bracket overlay (public/graphics/bracket): each match is
// { team1:{name,score}, team2:{name,score}, complete }; the winner is derived from
// scores; team logos are resolved from the teams DB by name/tag.
function bktInferTrack(label) {
  const l = (label || '').toUpperCase().trim();
  if (l.indexOf('UB ') === 0 || l.indexOf('UPPER') === 0) return 'upper';
  if (l.indexOf('LB ') === 0 || l.indexOf('LOWER') === 0) return 'lower';
  if (l.indexOf('GRAND') !== -1 || l === 'FINAL' || l === 'FINALS') return 'final';
  return null;
}
function bktIsPendingRef(name) {
  if (!name) return false;
  const n = name.trim();
  return n.indexOf('Winner of ') === 0 || n.indexOf('Loser of ') === 0;
}
function bktResolveTeam(name) {
  if (!name || name === 'TBD' || name === 'BYE') return null;
  const n = name.toLowerCase();
  return _teams.find(t => (t.name && t.name.toLowerCase() === n) || (t.tag && t.tag.toLowerCase() === n)) || null;
}

function bktTeamRowHtml(team, done, isWin, isLose) {
  team = team || {};
  const name = team.name || '';
  const td = bktResolveTeam(name);
  const isTbd = !name || name === 'TBD' || name === 'BYE';
  const isPending = !isTbd && bktIsPendingRef(name);
  const cls = 'bkt-team' + (isTbd ? ' bkt-tbd' : '') + (isPending ? ' bkt-pending' : '') +
              (isWin ? ' bkt-winner' : '') + (done && isLose ? ' bkt-loser' : '');
  const logo = (td && td.logo)
    ? '<div class="bkt-team-logo" style="background-image:url(' + esc(td.logo) + ')"></div>'
    : '<div class="bkt-team-logo bkt-team-logo-ph"></div>';
  const display = isTbd ? (name === 'BYE' ? 'BYE' : 'TBD') : name;
  return '<div class="' + cls + '">' +
    logo +
    '<span class="bkt-team-name">' + esc(display) + '</span>' +
    (done ? '<span class="bkt-team-score">' + (parseInt(team.score) || 0) + '</span>' : '') +
  '</div>';
}

function bktMatchCard(match, matchCount, mi) {
  match = match || {};
  const t1 = match.team1 || {}, t2 = match.team2 || {};
  const done = !!match.complete;
  const t1win = done && (t1.score || 0) > (t2.score || 0);
  const t2win = done && (t2.score || 0) > (t1.score || 0);
  const badge = (matchCount > 1 && bktIsPendingRef(t1.name) && bktIsPendingRef(t2.name))
    ? '<div class="bkt-match-badge">Match ' + (mi + 1) + '</div>' : '';
  return '<div class="bkt-match">' + badge +
    bktTeamRowHtml(t1, done, t1win, t2win) +
    bktTeamRowHtml(t2, done, t2win, t1win) +
  '</div>';
}

function bktRoundColumn(round) {
  const matches = round.matches || [];
  return '<div class="bkt-round">' +
    '<div class="bkt-round-label">' + esc(round.label || 'Round') + '</div>' +
    '<div class="bkt-round-matches">' +
      matches.map((m, mi) => bktMatchCard(m, matches.length, mi)).join('') +
    '</div>' +
  '</div>';
}

function renderBracket() {
  const s = _state;
  const bracket = s.bracket || {};
  const tourn = s.tournament || {};
  const rounds = bracket.rounds || [];
  const el = document.getElementById('bracket-content');

  if (rounds.length === 0) {
    el.innerHTML = '<div class="empty-state">No bracket data</div>';
    return;
  }

  const isDouble = tourn.playoffFormat === 'doubleElim' || bracket.type === 'double';

  if (isDouble) {
    const upper = rounds.filter(r => bktInferTrack(r.label) === 'upper');
    const lower = rounds.filter(r => bktInferTrack(r.label) === 'lower');
    const finals = rounds.filter(r => bktInferTrack(r.label) === 'final');
    const other = rounds.filter(r => bktInferTrack(r.label) === null);

    const section = (cls, label, rs) =>
      '<div class="bkt-section ' + cls + '">' +
        (label ? '<div class="bkt-section-label ' + cls + '-label">' + label + '</div>' : '') +
        '<div class="bkt-rounds">' + rs.map(bktRoundColumn).join('') + '</div>' +
      '</div>';

    let out = '';
    if (upper.length)  out += section('bkt-upper', 'Upper Bracket', upper);
    if (lower.length)  out += section('bkt-lower', 'Lower Bracket', lower);
    if (other.length)  out += section('bkt-other', '', other);
    if (finals.length) out += section('bkt-final', 'Grand Final', finals);
    el.innerHTML = '<div class="bkt-double">' + out + '</div>';
  } else {
    el.innerHTML = '<div class="bkt-rounds">' + rounds.map(bktRoundColumn).join('') + '</div>';
  }
}

// ── SCHEDULE TAB ──────────────────────────────────────────────────────────────
function renderSchedule() {
  const s = _state;
  const schedule = (s.tournament && s.tournament.schedule) || [];
  const el = document.getElementById('schedule-content');

  if (schedule.length === 0) {
    el.innerHTML = '<div class="empty-state">No schedule configured</div>';
    return;
  }

  const html = schedule.map(day => {
    const games = day.games || [];
    const gamesHtml = games.map(g => {
      const t1name = resolveTeamName(g.team1Id, g.team1Override);
      const t2name = resolveTeamName(g.team2Id, g.team2Override);
      const result = g.result && g.result.completed;
      const hasGames = result && !g.isBye && g.result.games && g.result.games.length > 0;

      let resultText = '—';
      if (g.isBye) {
        resultText = 'BYE';
      } else if (result) {
        resultText = g.result.winner === 'team1' ? t1name : t2name;
      }

      const summaryHtml =
        '<div class="sched-game-summary"' + (hasGames ? ' onclick="this.parentElement.classList.toggle(\'open\')"' : '') + '>' +
          '<div class="sched-stage">' + esc(stageLabel(g.stage)) + '</div>' +
          '<div class="sched-teams">' +
            esc(t1name) + '<span class="sched-vs">VS</span>' + esc(t2name) +
          '</div>' +
          '<div class="sched-format">' + esc(g.format || '') + '</div>' +
          (g.fearlessDraft ? '<div class="sched-fearless">FEARLESS</div>' : '') +
          '<div class="sched-result' + (result ? ' completed' : '') + '">' + esc(resultText) + '</div>' +
          (hasGames ? '<div class="sched-expand-arrow">▼</div>' : '') +
        '</div>';

      let detailHtml = '';
      if (hasGames) {
        const teamWins = { team1: 0, team2: 0 };
        const blocksHtml = g.result.games.map(game => {
          teamWins[game.winner]++;
          const winnerName = game.winner === 'team1' ? t1name : t2name;
          const redTeam = game.blueSideTeam === 'team1' ? 'team2' : 'team1';
          const scoreText = teamWins[game.blueSideTeam] + ' &mdash; ' + teamWins[redTeam];

          const blue = game.blueSideTeam === 'team1'
            ? { picks: game.t1RolePicks || [], players: (game.players && game.players.team1) || [], name: t1name }
            : { picks: game.t2RolePicks || [], players: (game.players && game.players.team2) || [], name: t2name };
          const red = game.blueSideTeam === 'team1'
            ? { picks: game.t2RolePicks || [], players: (game.players && game.players.team2) || [], name: t2name }
            : { picks: game.t1RolePicks || [], players: (game.players && game.players.team1) || [], name: t1name };

          const renderSide = (side, color) => {
            const picksHtml = side.picks.map((url, i) => {
              const champName = url ? url.split('/').pop().split('_')[0] : '';
              const handle = (side.players[i] && side.players[i].handle) || '';
              return '<div class="sched-pick">' +
                (url ? '<img src="' + url + '" class="sched-pick-icon">' : '<div class="sched-pick-icon sched-pick-empty"></div>') +
                '<div class="sched-pick-info">' +
                  '<div class="sched-pick-champ">' + esc(champName) + '</div>' +
                  '<div class="sched-pick-handle">' + esc(handle) + '</div>' +
                '</div>' +
              '</div>';
            }).join('');
            return '<div class="sched-side">' +
              '<div class="sched-side-header">' +
                '<span class="sched-side-badge ' + color + '">' + color.toUpperCase() + '</span>' +
                '<span class="sched-side-name">' + esc(side.name) + '</span>' +
              '</div>' +
              '<div class="sched-picks">' + picksHtml + '</div>' +
            '</div>';
          };

          return '<div class="sched-game-block">' +
            '<div class="sched-game-block-header">' +
              'Game ' + game.gameNum + ' &middot; ' + esc(winnerName) + ' WIN' +
              (game.isBye ? ' &middot; <span class="sched-bye-label">BYE</span>' : ' &middot; ' + scoreText) +
            '</div>' +
            (game.isBye
              ? '<div class="sched-bye-body">No game played &mdash; result awarded as BYE</div>'
              : '<div class="sched-game-sides">' + renderSide(blue, 'blue') + renderSide(red, 'red') + '</div>') +
          '</div>';
        }).join('');

        detailHtml = '<div class="sched-game-detail">' + blocksHtml + '</div>';
      }

      return '<div class="schedule-game' + (hasGames ? ' expandable' : '') + '">' +
        summaryHtml +
        detailHtml +
      '</div>';
    }).join('');

    return '<div class="schedule-day">' +
      '<div class="schedule-day-header" onclick="this.classList.toggle(\'collapsed\')">' +
        '<div class="schedule-day-label">' + esc(day.label || 'Day') + '</div>' +
        (day.date ? '<div class="schedule-day-date">' + esc(day.date) + '</div>' : '') +
        '<div class="schedule-day-toggle">▼</div>' +
      '</div>' +
      '<div class="schedule-games">' + gamesHtml + '</div>' +
    '</div>';
  }).join('');

  el.innerHTML = html;
}
