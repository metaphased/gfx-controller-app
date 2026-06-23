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
  renderAll();
});

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
  renderSeries();
  renderDraft();
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

  // Series score from seriesGames
  const games = m.seriesGames || [];
  let t1wins = 0, t2wins = 0;
  games.forEach(g => { if (g.winner === 'team1') t1wins++; else if (g.winner === 'team2') t2wins++; });
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
  const rk = p.rank;
  const badge = rk ? '<span class="rank-badge" style="--team-color:' + esc(color) + '">' + esc(rankShort(rk)) + '</span>' : '';
  const pool = p.champPool || [];
  const ogUrl = opggUrl(p.opggRegion, p.riotId);

  let champRows = '';
  if (pool.length > 0) {
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
      '<div class="player-role-icon" style="background-image:url(' + esc(roleIconUrl(p.role)) + ')"></div>' +
      '<div class="player-handle">' + esc(p.handle || p.name || '—') + '</div>' +
      badge +
      (ogUrl ? '<a class="opgg-btn" href="' + esc(ogUrl) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">op.gg ↗</a>' : '') +
      '<div class="expand-arrow">▼</div>' +
    '</div>' +
    '<div class="player-detail">' +
      (p.riotId ? '<div class="detail-riot-id">' + esc(p.riotId) + (p.opggRegion ? ' <span class="detail-region">' + esc(p.opggRegion.toUpperCase()) + '</span>' : '') + '</div>' : '') +
      rankFull +
      draftStatsHtml +
      trnHistoryHtml +
      champRows +
    '</div>' +
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
      return '<div class="card">' +
        '<div class="card-header"><span class="card-title">' + esc(grp.name || 'Group') + '</span></div>' +
        '<table class="standings-table">' +
          '<thead><tr><th></th><th>Team</th><th class="right">W</th><th class="right">L</th></tr></thead>' +
          '<tbody>' +
          rows.map((r, i) => {
            const isQual = (i < qualN) && (r.sw > 0 || r.sl > 0);
            const logoStyle = r.logo ? 'background-image:url(' + esc(r.logo) + ')' : '';
            return '<tr>' +
              '<td class="standings-pos ' + (isQual ? 'standings-qual' : '') + '">' + (i+1) + '</td>' +
              '<td><div class="team-cell"><div class="standings-logo" style="' + logoStyle + '"></div><span class="standings-name">' + esc(r.name) + '</span></div></td>' +
              '<td class="right standings-w">' + r.sw + '</td>' +
              '<td class="right standings-l">' + r.sl + '</td>' +
            '</tr>';
          }).join('') +
          '</tbody>' +
        '</table>' +
      '</div>';
    }).join('') +
  '</div>';

  el.innerHTML = html;
}

// ── BRACKET TAB ───────────────────────────────────────────────────────────────
function renderBracket() {
  const s = _state;
  const bracket = s.bracket || {};
  const rounds = bracket.rounds || [];
  const el = document.getElementById('bracket-content');

  if (rounds.length === 0) {
    el.innerHTML = '<div class="empty-state">No bracket data</div>';
    return;
  }

  const roundsHtml = rounds.map(round => {
    const matches = round.matches || [];
    if (matches.length === 0) return '';

    return '<div class="bracket-round">' +
      '<div class="bracket-round-label">' + esc(round.label || 'Round') + '</div>' +
      matches.map(match => {
        const t1 = match.team1 || {};
        const t2 = match.team2 || {};
        const w  = match.winner;
        const s1 = match.score ? match.score.t1 : null;
        const s2 = match.score ? match.score.t2 : null;

        function teamRow(team, slot, score) {
          const isTbd = !team.name && !team.tag;
          const isWin = w === slot;
          const cls   = isTbd ? 'tbd' : isWin ? 'winner' : (w && !isWin ? 'loser' : '');
          const logo  = team.logo ? 'background-image:url(' + esc(team.logo) + ')' : '';
          const name  = isTbd ? 'TBD' : (team.name || team.tag || '?');
          const sc    = score != null ? String(score) : '';
          return '<div class="bracket-team ' + cls + '">' +
            '<div class="bracket-team-logo" style="' + logo + '"></div>' +
            '<div class="bracket-team-name">' + esc(name) + '</div>' +
            (sc ? '<div class="bracket-team-score">' + esc(sc) + '</div>' : '') +
          '</div>';
        }

        return '<div class="bracket-match">' +
          teamRow(t1, 'team1', s1) +
          teamRow(t2, 'team2', s2) +
        '</div>';
      }).join('') +
    '</div>';
  }).join('');

  el.innerHTML = '<div class="bracket-rounds">' + roundsHtml + '</div>';
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
