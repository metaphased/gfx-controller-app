// Group Stage Overlay
var _gfxToken = new URLSearchParams(window.location.search).get('token') || '';
var socket = io({ auth: { token: _gfxToken }, query: { token: _gfxToken } });

var _visible     = false;
var _currentMode = null;
var _structHash  = '';   // fingerprint: groups/teams/qualN/logo
var _scoresHash  = '';   // fingerprint: completed game results only
var _teams       = [];
var _outTimer    = null;
var _inTimer     = null;


function $(id) { return document.getElementById(id); }
function _eH(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Standings ──────────────────────────────────────────────────────────────────
function calculateGroupStandings(state) {
  var t      = state.tournament || {};
  var standings = {};

  (t.groups || []).forEach(function(grp) {
    standings[grp.id] = (grp.teamIds || []).map(function(tid) {
      var tm = _teams.find(function(x) { return x.id === tid; });
      return { teamId: tid, name: tm ? (tm.name || tm.tag || tid) : tid, logo: tm ? (tm.logo || '') : '', sw: 0, sl: 0 };
    });
  });

  (t.schedule || []).forEach(function(day) {
    (day.games || []).forEach(function(game) {
      if (game.stage !== 'groupStage' || !game.result || !game.result.completed) return;
      var r = game.result;
      Object.keys(standings).forEach(function(grpId) {
        var rows = standings[grpId];
        var e1 = rows.find(function(e) { return e.teamId === game.team1Id; });
        var e2 = rows.find(function(e) { return e.teamId === game.team2Id; });
        if (!e1 || !e2) return;
        if (r.winner === 'team1') { e1.sw++; e2.sl++; } else { e2.sw++; e1.sl++; }
      });
    });
  });

  Object.keys(standings).forEach(function(grpId) {
    standings[grpId].sort(function(a, b) { return b.sw !== a.sw ? b.sw - a.sw : a.sl - b.sl; });
  });

  return standings;
}

// ── Data fingerprints ─────────────────────────────────────────────────────────
function structHash(state) {
  var t = state.tournament || {};
  var gs = state.groupStage || {};
  return JSON.stringify({
    groups: (t.groups || []).map(function(g) { return { id: g.id, name: g.name, teamIds: g.teamIds }; }),
    qualN:  t.qualifiersPerGroup,
    teams:  _teams.map(function(t) { return { id: t.id, name: t.name, logo: t.logo }; }),
    logo:   gs.logoUrl, scale: gs.logoScale, pos: gs.logoPosition, show: gs.showLogo
  });
}

function scoresHash(state) {
  var t = state.tournament || {};
  return JSON.stringify(
    (t.schedule || []).map(function(d) {
      return (d.games || [])
        .filter(function(g) { return g.stage === 'groupStage' && g.result && g.result.completed; })
        .map(function(g) { return { t1: g.team1Id, t2: g.team2Id, w: g.result.winner }; });
    })
  );
}

// ── Apply logo + mode class (no DOM rebuild) ───────────────────────────────────
function applyLogoAndMode(state) {
  var gs    = state.groupStage || {};
  var tourn = state.tournament  || {};
  var root  = $('groups-root');
  if (!root) return;

  // Logo — only shown when explicitly enabled (default off so VMix can own the logo layer)
  var logoImg = document.getElementById('groups-logo');
  var logoUrl = gs.logoUrl || tourn.logo || '';
  if (logoImg) {
    if (gs.showLogo && logoUrl) { logoImg.src = logoUrl; logoImg.style.display = ''; }
    else                         { logoImg.style.display = 'none'; }
  }

  var scale = gs.logoScale != null ? gs.logoScale : 7;
  root.style.setProperty('--groups-logo-h', scale + 'vh');
  root.classList.toggle('logo-center', gs.logoPosition === 'center');

  var mode = gs.mode || 'live';
  root.classList.toggle('mode-live',  mode !== 'final');
  root.classList.toggle('mode-final', mode === 'final');
}

// ── Full group card rebuild ────────────────────────────────────────────────────
function renderGroups(state) {
  var t         = state.tournament || {};
  var groups    = t.groups || [];
  var qualN     = t.qualifiersPerGroup || 2;
  var standings = calculateGroupStandings(state);
  var container = $('groups-container');
  if (!container) return;

  if (!groups.length) {
    container.innerHTML = '<div class="gs-empty">No group data</div>';
    applyLogoAndMode(state);
    return;
  }

  var perRow   = Math.min(groups.length, 4);
  container.style.setProperty('--gs-card-w', (((90 - (perRow - 1) * 2) / perRow)).toFixed(1) + 'vw');

  var anyScores = false;
  Object.keys(standings).forEach(function(id) {
    standings[id].forEach(function(r) { if (r.sw > 0 || r.sl > 0) anyScores = true; });
  });

  container.innerHTML = groups.map(function(grp) {
    var rows = standings[grp.id] || [];
    var cutoffDone = false;

    var teamsHtml = rows.map(function(entry, idx) {
      var isQ  = idx < qualN;
      var html = '';
      if (!isQ && !cutoffDone && qualN < rows.length) {
        cutoffDone = true;
        html += '<div class="gs-cutoff"><span class="gs-cutoff-label">Advances to Playoffs</span></div>';
      }
      var logo = entry.logo
        ? '<img class="gs-team-logo" src="' + _eH(entry.logo) + '" alt="">'
        : '<div class="gs-team-logo-ph"></div>';
      var record = anyScores
        ? '<span class="gs-record">' + entry.sw + ' – ' + entry.sl + '</span>'
        : '<span class="gs-record" style="opacity:0.2">0 – 0</span>';
      html += '<div class="gs-team ' + (isQ ? 'qualifying' : 'eliminated') + '" data-team-id="' + _eH(entry.teamId) + '">' +
        logo + '<span class="gs-team-name">' + _eH(entry.name) + '</span>' + record + '</div>';
      return html;
    }).join('');

    if (!rows.length) {
      teamsHtml = '<div class="gs-team eliminated"><div class="gs-team-logo-ph"></div>' +
        '<span class="gs-team-name" style="font-style:italic;color:rgba(255,255,255,0.2)">No teams assigned</span></div>';
    }

    return '<div class="gs-group" data-group-id="' + _eH(grp.id) + '"><div class="gs-group-header">' + _eH(grp.name) + '</div>' + teamsHtml + '</div>';
  }).join('');

  applyLogoAndMode(state);
}

// ── Targeted score + rank update (no card rebuild) ────────────────────────────
function updateScores(state) {
  var t = state.tournament || {};
  var groups = t.groups || [];
  var qualN = t.qualifiersPerGroup || 2;
  var standings = calculateGroupStandings(state);

  var anyScores = false;
  Object.keys(standings).forEach(function(id) {
    standings[id].forEach(function(r) { if (r.sw > 0 || r.sl > 0) anyScores = true; });
  });

  groups.forEach(function(grp) {
    var card = document.querySelector('.gs-group[data-group-id="' + CSS.escape(grp.id) + '"]');
    if (!card) return;
    var rows = standings[grp.id] || [];
    var cutoffInserted = false;

    card.querySelectorAll('.gs-cutoff').forEach(function(el) { el.remove(); });

    rows.forEach(function(entry, idx) {
      var isQ = idx < qualN;
      var row = card.querySelector('.gs-team[data-team-id="' + CSS.escape(entry.teamId) + '"]');
      if (!row) return;

      row.classList.toggle('qualifying', isQ);
      row.classList.toggle('eliminated', !isQ);

      var rec = row.querySelector('.gs-record');
      if (rec) {
        rec.textContent = anyScores ? (entry.sw + ' – ' + entry.sl) : '0 – 0';
        rec.style.opacity = anyScores ? '' : '0.2';
      }

      if (!isQ && !cutoffInserted && qualN < rows.length) {
        cutoffInserted = true;
        var cutoff = document.createElement('div');
        cutoff.className = 'gs-cutoff';
        cutoff.innerHTML = '<span class="gs-cutoff-label">Advances to Playoffs</span>';
        card.appendChild(cutoff);
      }

      card.appendChild(row);
    });
  });
}

// ── Animation ──────────────────────────────────────────────────────────────────
function animateIn() {
  var root = $('groups-root');
  if (!root) return;
  if (_outTimer) { clearTimeout(_outTimer); root.classList.remove('groups-exiting'); _outTimer = null; }

  root.style.display = '';
  void root.offsetWidth;

  var cards = Array.from(document.querySelectorAll('.gs-group'));
  cards.forEach(function(card, i) { card.style.animationDelay = (0.1 + i * 0.11) + 's'; });

  root.classList.add('groups-entering');
  if (_inTimer) clearTimeout(_inTimer);
  var totalMs = (0.1 + cards.length * 0.11 + 0.5) * 1000;
  _inTimer = setTimeout(function() {
    root.classList.remove('groups-entering');
    cards.forEach(function(card) { card.style.animationDelay = ''; });
    _inTimer = null;
  }, totalMs);
}

function animateOut() {
  var root = $('groups-root');
  if (!root) return;
  if (_inTimer) {
    clearTimeout(_inTimer);
    root.classList.remove('groups-entering');
    document.querySelectorAll('.gs-group').forEach(function(el) { el.style.animationDelay = ''; });
    _inTimer = null;
  }
  root.classList.add('groups-exiting');
  if (_outTimer) clearTimeout(_outTimer);
  _outTimer = setTimeout(function() {
    root.classList.remove('groups-exiting');
    root.style.display = 'none';
    _outTimer = null;
  }, 550);
}

// ── Socket ─────────────────────────────────────────────────────────────────────
socket.on('connect', function() { _visible = false; });

socket.on('state', function(state) {
  GfxSettings.applyTheme(document.documentElement, state);
  GfxSettings.applyBackground(document.body, state);

  if (state.teams && state.teams.length) _teams = state.teams;

  var gs      = state.groupStage || {};
  var visible = !!gs.visible;
  var mode    = gs.mode || 'live';
  var sHash   = structHash(state);
  var cHash   = scoresHash(state);

  if (visible && !_visible) {
    // Showing: always do a full render then animate in
    _visible = true;
    _currentMode = mode;
    _structHash = sHash;
    _scoresHash = cHash;
    renderGroups(state);
    animateIn();
  } else if (!visible && _visible) {
    _visible = false;
    _currentMode = null;
    animateOut();
  } else if (visible) {
    var structChanged = sHash !== _structHash;
    var scoreChanged  = cHash !== _scoresHash;
    var modeChanged   = mode !== _currentMode;

    if (structChanged) {
      // Groups/teams/qualN changed — full card rebuild
      _structHash = sHash;
      _scoresHash = cHash;
      _currentMode = mode;
      renderGroups(state);
    } else if (scoreChanged) {
      // Scores only — update W/L text and row order in place
      _scoresHash = cHash;
      updateScores(state);
    } else if (modeChanged) {
      // Mode-only change — just toggle the root class
      _currentMode = mode;
      applyLogoAndMode(state);
    } else {
      // Logo/scale/position change only
      applyLogoAndMode(state);
    }
  } else {
    // Hidden — pre-render so it's ready when shown
    _structHash = sHash;
    _scoresHash = cHash;
    _currentMode = mode;
    renderGroups(state);
  }
});
