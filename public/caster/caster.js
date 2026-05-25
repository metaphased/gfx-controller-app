'use strict';

const TOKEN = new URLSearchParams(window.location.search).get('token') || '';

const socket = io({ auth: { token: TOKEN }, query: { token: TOKEN } });

let _state = null;
let _teams = [];
let _activeTab = 'roster';

// ── Connection status ──────────────────────────────────────────────────────────
socket.on('connect', () => {
  const dot = document.getElementById('conn-dot');
  const lbl = document.getElementById('conn-label');
  dot.className = 'conn-dot live';
  lbl.textContent = 'Connected';
});

socket.on('disconnect', () => {
  const dot = document.getElementById('conn-dot');
  const lbl = document.getElementById('conn-label');
  dot.className = 'conn-dot dead';
  lbl.textContent = 'Disconnected';
});

socket.on('state', (s) => {
  _state = s;
  _teams = s.teams || [];
  renderAll();
});

// ── Tab switching ──────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    _activeTab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + _activeTab));
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
  const key = (role || '').toLowerCase();
  return '/graphics/head2head/roles/' + key + '.png';
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
  renderRoster();
  renderSeries();
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

function renderPlayerRow(p, color) {
  const rk = p.rank;
  const badge = rk ? '<span class="rank-badge" style="--team-color:' + esc(color) + '">' + esc(rankShort(rk)) + '</span>' : '';
  const pool = p.champPool || [];

  let champRows = '';
  if (pool.length > 0) {
    champRows = '<table class="champ-table">' +
      '<thead><tr><th>Champion</th><th class="right">Games</th><th class="right">Win Rate</th></tr></thead>' +
      '<tbody>' +
      pool.map(c => {
        const icon = c.key ? '<div class="champ-icon-sm" style="background-image:url(' + esc(champIconUrl(c.key)) + ')"></div>' : '';
        const wr = c.winRate != null ? parseFloat(c.winRate).toFixed(0) + '%' : '—';
        return '<tr>' +
          '<td><div class="champ-icon-cell">' + icon + '<span class="champ-name">' + esc(c.name || c.key) + '</span></div></td>' +
          '<td class="right">' + esc(c.games != null ? c.games : '—') + '</td>' +
          '<td class="right ' + wrClass(c.winRate) + '">' + esc(wr) + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>';
  } else {
    champRows = '<div style="color:var(--text-faint);font-size:12px">No champion pool data</div>';
  }

  const rankFull = rk ? '<div class="detail-rank-full">' + esc(rankText(rk)) + '</div>' : '';

  return '<div class="player-row">' +
    '<div class="player-row-summary">' +
      '<div class="player-role-icon" style="background-image:url(' + esc(roleIconUrl(p.role)) + ')"></div>' +
      '<div class="player-handle">' + esc(p.handle || p.name || '—') + '</div>' +
      badge +
      '<div class="expand-arrow">▼</div>' +
    '</div>' +
    '<div class="player-detail">' +
      rankFull +
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
  // seriesGames entries use t1RolePicks/t2RolePicks (role-indexed champion name arrays)
  // and draftPicks (full ordered draft picks with slot info)
  const t1role = g.t1RolePicks || [];
  const t2role = g.t2RolePicks || [];

  // Extract bans from draftPicks (action type 'ban')
  const draftPicks = g.draftPicks || [];
  const t1bans = draftPicks.filter(p => p.action === 'ban' && p.team === 'team1').map(p => ({ name: p.champion || '', key: p.key || '' }));
  const t2bans = draftPicks.filter(p => p.action === 'ban' && p.team === 'team2').map(p => ({ name: p.champion || '', key: p.key || '' }));

  // Build pick list from role picks (role-indexed: top/jg/mid/adc/sup)
  const roles = ['Top', 'Jg', 'Mid', 'ADC', 'Sup'];
  const picks1 = t1role.map((champ, i) => ({ name: champ || '', role: roles[i] || '' })).filter(p => p.name);
  const picks2 = t2role.map((champ, i) => ({ name: champ || '', role: roles[i] || '' })).filter(p => p.name);

  // Side info
  const sideHtml = g.t1Side
    ? '<div style="font-size:11px;color:var(--text-faint);margin-bottom:10px">' +
        esc(t1name) + ' <strong style="color:var(--text-dim)">' + esc((g.t1Side||'').toUpperCase()) + '</strong>' +
        ' · ' +
        esc(t2name) + ' <strong style="color:var(--text-dim)">' + esc((g.t2Side||'').toUpperCase()) + '</strong>' +
      '</div>'
    : '';

  function champPills(champs, isBan) {
    if (!champs || champs.length === 0) return '<span style="color:var(--text-faint);font-size:11px">—</span>';
    return champs.map(c => {
      const name = c.name || c.champion || (typeof c === 'string' ? c : '');
      const key  = c.key  || '';
      const icon = key ? '<div class="champ-pill-icon" style="background-image:url(' + esc(champIconUrl(key)) + ')"></div>' : '';
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
      let resultText = '—';
      if (g.isBye) {
        resultText = 'BYE';
      } else if (result) {
        const wn = g.result.winner === 'team1' ? t1name : t2name;
        resultText = wn;
      }

      return '<div class="schedule-game">' +
        '<div class="sched-stage">' + esc(stageLabel(g.stage)) + '</div>' +
        '<div class="sched-teams">' +
          esc(t1name) + '<span class="sched-vs">VS</span>' + esc(t2name) +
        '</div>' +
        '<div class="sched-format">' + esc(g.format || '') + '</div>' +
        (g.fearlessDraft ? '<div class="sched-fearless">FEARLESS</div>' : '') +
        '<div class="sched-result' + (result ? ' completed' : '') + '">' + esc(resultText) + '</div>' +
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
