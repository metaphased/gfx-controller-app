// Bracket Overlay
const _gfxToken = new URLSearchParams(window.location.search).get('token') || '';
const socket = io({ auth: { token: _gfxToken }, query: { token: _gfxToken } });

let _visible     = false;
let _bracketType = 'single';
let _outTimer    = null;
let _inTimer     = null;
let _connTimers  = [];   // connector reveal timeouts
let _teams       = [];   // local teams cache — loaded from API + kept fresh via state events

fetch('/api/teams')
  .then(function(r) { return r.json(); })
  .then(function(d) { if (d.teams && d.teams.length) _teams = d.teams; })
  .catch(function() {});

function $(id) { return document.getElementById(id); }
function _eH(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// ── Round classification helpers ───────────────────────────────────────────────
function isThirdPlaceRound(round) {
  var l = (round.label || '').toUpperCase();
  return l.indexOf('BRONZE') !== -1 ||
         (l.indexOf('3RD')   !== -1 && l.indexOf('PLACE') !== -1) ||
         (l.indexOf('THIRD') !== -1 && l.indexOf('PLACE') !== -1);
}

// ── Pending reference helpers ──────────────────────────────────────────────────
function isPendingRef(name) {
  if (!name) return false;
  var n = name.trim();
  return n.indexOf('Winner of ') === 0 || n.indexOf('Loser of ') === 0;
}

// Returns badge text for a match card — just "Match N" for multi-match rounds, empty for single-match rounds
function getMatchBadge(roundLabel, matchCount, mi) {
  return matchCount > 1 ? 'Match ' + (mi + 1) : '';
}

// ── Track inference ────────────────────────────────────────────────────────────
function inferTrack(label) {
  var l = (label || '').toUpperCase().trim();
  if (l.indexOf('UB ') === 0 || l.indexOf('UPPER') === 0) return 'upper';
  if (l.indexOf('LB ') === 0 || l.indexOf('LOWER') === 0) return 'lower';
  if (l.indexOf('GRAND') !== -1 || l === 'FINAL' || l === 'FINALS') return 'final';
  return null;
}

// ── Team resolution ────────────────────────────────────────────────────────────
function resolveTeam(name, teams) {
  if (!name || name === 'TBD' || name === 'BYE') return null;
  var n = name.toLowerCase();
  return teams.find(function(t) {
    return (t.name && t.name.toLowerCase() === n) ||
           (t.tag  && t.tag.toLowerCase()  === n);
  }) || null;
}

// ── SVG connector drawing ──────────────────────────────────────────────────────
function makePath(svg, d) {
  var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  p.setAttribute('stroke', 'rgba(255,255,255,0.22)');
  p.setAttribute('stroke-width', '1.5');
  p.setAttribute('stroke-linecap', 'square');
  p.setAttribute('fill', 'none');
  svg.appendChild(p);
  // Use stroke-dashoffset to draw the line from its start point to end point
  var len = p.getTotalLength();
  if (len > 0) {
    p.style.strokeDasharray  = len + 'px';
    p.style.strokeDashoffset = len + 'px';
  }
  return p;
}

// Returns a connector as three sequential phase arrays (water-through-pipes flow):
//   Phase 1 — both horizontal stubs shoot right from source matches to xMid
//   Phase 2 — vertical bar closes from top AND bottom toward the centre simultaneously
//   Phase 3 — merged flow shoots right to the destination match
function drawConnector(svg, svgR, rA, rB, rW) {
  var xA     = rA.right - svgR.left;
  var xB     = rB.right - svgR.left;
  var yA     = rA.top + rA.height * 0.5 - svgR.top;
  var yB     = rB.top + rB.height * 0.5 - svgR.top;
  var x2     = rW.left  - svgR.left;
  var yW     = rW.top   + rW.height * 0.5 - svgR.top;
  var xRight = Math.max(xA, xB);
  var xMid   = xRight + (x2 - xRight) * 0.4;
  var yMid   = (yA + yB) * 0.5;

  return [
    // Phase 1: horizontal stubs from each source rightward to xMid
    [makePath(svg, 'M ' + xA   + ' ' + yA   + ' H ' + xMid),
     makePath(svg, 'M ' + xB   + ' ' + yB   + ' H ' + xMid)],
    // Phase 2: top half draws downward to yMid; bottom half draws upward to yMid
    [makePath(svg, 'M ' + xMid + ' ' + yA   + ' V ' + yMid),
     makePath(svg, 'M ' + xMid + ' ' + yB   + ' V ' + yMid)],
    // Phase 3: output line shoots right from xMid to the destination
    [makePath(svg, 'M ' + xMid + ' ' + yW   + ' H ' + x2)]
  ];
}

// Simple left-to-right run (1:1 match ratio). Returns one phase.
function drawSimpleLine(svg, svgR, rFrom, rTo) {
  var x1   = rFrom.right - svgR.left;
  var y1   = rFrom.top   + rFrom.height * 0.5 - svgR.top;
  var x2   = rTo.left    - svgR.left;
  var y2   = rTo.top     + rTo.height   * 0.5 - svgR.top;
  var xMid = x1 + (x2 - x1) * 0.4;
  var d    = Math.abs(y1 - y2) < 2
    ? 'M ' + x1 + ' ' + y1 + ' H ' + x2
    : 'M ' + x1 + ' ' + y1 + ' H ' + xMid + ' V ' + y2 + ' H ' + x2;
  return [[makePath(svg, d)]];
}

// Merges per-connector phase arrays into combined phase buckets for a full round-pair.
function buildRoundConnectors(svg, svgR, cur, next) {
  var curM   = cur.querySelectorAll('.bkt-match');
  var nextM  = next.querySelectorAll('.bkt-match');
  var merged = [];
  if (!curM.length || !nextM.length) return merged;

  var addPhases = function(phases) {
    phases.forEach(function(phase, pi) {
      if (!merged[pi]) merged[pi] = [];
      merged[pi] = merged[pi].concat(phase);
    });
  };

  if (curM.length === nextM.length * 2) {
    for (var i = 0; i < nextM.length; i++) {
      addPhases(drawConnector(svg, svgR,
        curM[i * 2].getBoundingClientRect(),
        curM[i * 2 + 1].getBoundingClientRect(),
        nextM[i].getBoundingClientRect()));
    }
  } else if (curM.length === nextM.length) {
    for (var i = 0; i < nextM.length; i++) {
      addPhases(drawSimpleLine(svg, svgR,
        curM[i].getBoundingClientRect(),
        nextM[i].getBoundingClientRect()));
    }
  }
  return merged.filter(function(p) { return p && p.length; });
}

// Reveal one group of paths by drawing them (stroke-dashoffset → 0).
function revealPaths(paths, delayMs, durationMs) {
  var dur = (durationMs || 220) + 'ms';
  var t = setTimeout(function() {
    paths.forEach(function(p) {
      p.style.transition = 'stroke-dashoffset ' + dur + ' ease-out';
      p.style.strokeDashoffset = '0';
    });
  }, Math.max(0, delayMs));
  _connTimers.push(t);
}

// Play connector phases sequentially: stubs → vertical close → output run.
var PHASE_DUR = [200, 220, 200]; // ms per phase
function schedulePhases(phases, startDelayMs) {
  var t = startDelayMs;
  phases.forEach(function(phase, i) {
    if (phase && phase.length) {
      revealPaths(phase, t, PHASE_DUR[i] || 200);
      t += PHASE_DUR[i] || 200;
    }
  });
}

function clearConnTimers() {
  _connTimers.forEach(function(t) { clearTimeout(t); });
  _connTimers = [];
}

// Build all connectors and schedule their reveals based on round delays.
// roundDelays: { upper: [d0,d1,...], lower: [d0,d1,...], final: d, single: [d0,...] }
// animDur: animation duration in seconds
function buildAndScheduleConnectors(roundDelays, animDur) {
  var svg = $('bracket-svg');
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  var svgR = svg.getBoundingClientRect();
  // Each connector starts drawing 100ms before its destination column appears —
  // the line is mid-draw when the next column slides in, creating constant visual flow.
  var LEAD = 100; // ms before destination column starts

  if (_bracketType === 'double') {
    var upperRounds = Array.from(document.querySelectorAll('.bkt-section.bkt-upper .bkt-round'));
    var lowerRounds = Array.from(document.querySelectorAll('.bkt-section.bkt-lower .bkt-round'));
    var gfMatch     = document.querySelector('.bkt-final-section .bkt-match');

    for (var ui = 0; ui < upperRounds.length - 1; ui++) {
      var phases = buildRoundConnectors(svg, svgR, upperRounds[ui], upperRounds[ui + 1]);
      if (phases.length) schedulePhases(phases, roundDelays.upper[ui + 1] * 1000 - LEAD);
    }

    for (var li = 0; li < lowerRounds.length - 1; li++) {
      var phases = buildRoundConnectors(svg, svgR, lowerRounds[li], lowerRounds[li + 1]);
      if (phases.length) schedulePhases(phases, roundDelays.lower[li + 1] * 1000 - LEAD);
    }

    // GF connector starts drawing 100ms before GF card slides in;
    // both UBF→GF and LBF→GF draw simultaneously as the GF card arrives
    if (gfMatch) {
      var ubFinal = upperRounds.length ? upperRounds[upperRounds.length - 1] : null;
      var lbFinal = lowerRounds.length ? lowerRounds[lowerRounds.length - 1] : null;
      var gfPhases = [];

      if (ubFinal && lbFinal) {
        var ubM = ubFinal.querySelectorAll('.bkt-match');
        var lbM = lbFinal.querySelectorAll('.bkt-match');
        var gfR = gfMatch.getBoundingClientRect();
        var rA  = ubM.length ? ubM[ubM.length - 1].getBoundingClientRect() : null;
        var rB  = lbM.length ? lbM[lbM.length - 1].getBoundingClientRect() : null;
        if (rA && rB) gfPhases = drawConnector(svg, svgR, rA, rB, gfR);
        else if (rA)  gfPhases = drawSimpleLine(svg, svgR, rA, gfR);
      }

      if (gfPhases.length) {
        schedulePhases(gfPhases, (roundDelays.final || 0) * 1000 - LEAD);
      }
    }
  } else {
    var rounds = Array.from(document.querySelectorAll('#bracket-rounds-gfx .bkt-round'));
    for (var ri = 0; ri < rounds.length - 1; ri++) {
      var phases = buildRoundConnectors(svg, svgR, rounds[ri], rounds[ri + 1]);
      if (phases.length) schedulePhases(phases, roundDelays.single[ri + 1] * 1000 - LEAD);
    }

    // 3P connector: SF matches (penultimate round) → 3P match, same timing as the Final column.
    // The stubs and vertical will overlap with the SF→GF connector, creating a Y-split where
    // one output shoots to GF and the other to 3P from the same convergence point.
    var tp3Section = document.querySelector('#bracket-rounds-gfx .bkt-3p-section');
    if (tp3Section && rounds.length >= 2) {
      var tp3Match  = tp3Section.querySelector('.bkt-match');
      var sfRound   = rounds[rounds.length - 2];
      var sfMatches = sfRound ? sfRound.querySelectorAll('.bkt-match') : [];
      if (tp3Match && sfMatches.length === 2) {
        var tp3Phases = drawConnector(svg, svgR,
          sfMatches[0].getBoundingClientRect(),
          sfMatches[1].getBoundingClientRect(),
          tp3Match.getBoundingClientRect());
        if (tp3Phases.length) {
          schedulePhases(tp3Phases, roundDelays.single[rounds.length - 1] * 1000 - LEAD);
        }
      }
    }
  }
}

// ── Render ─────────────────────────────────────────────────────────────────────
function renderBracket(state) {
  var bkt    = state.bracket    || {};
  var tourn  = state.tournament || {};
  var rounds = bkt.rounds       || [];

  // Keep local cache fresh from socket broadcasts, fall back to API-fetched cache
  if (state.teams && state.teams.length) _teams = state.teams;
  var teams = _teams;

  _bracketType = (tourn.playoffFormat === 'doubleElim' || bkt.type === 'double') ? 'double' : 'single';

  var root = $('bracket-root');

  // Logo — only shown when explicitly enabled (default off so VMix can own the logo layer)
  var logoImg = document.getElementById('bracket-logo');
  var logoUrl = bkt.logoUrl || tourn.logo || '';
  if (logoImg) {
    if (bkt.showLogo && logoUrl) { logoImg.src = logoUrl; logoImg.style.display = ''; }
    else                          { logoImg.style.display = 'none'; }
  }

  var scale = bkt.logoScale != null ? bkt.logoScale : 7;
  if (root) {
    root.style.setProperty('--bracket-logo-h', scale + 'vh');
    root.classList.toggle('logo-center', bkt.logoPosition === 'center');
  }

  var container = $('bracket-rounds-gfx');
  if (!container) return;

  if (!rounds.length) {
    container.className = '';
    container.innerHTML = '<div class="bkt-empty">No bracket data</div>';
    return;
  }

  if (_bracketType === 'double') {
    renderDouble(container, rounds, teams);
  } else {
    renderSingle(container, rounds, teams);
  }
}

function renderSingle(container, rounds, teams) {
  container.className = 'layout-single';

  // Separate 3rd place from the main progression rounds
  var thirdPlaceRound = null;
  var mainRounds = rounds.filter(function(r) {
    if (isThirdPlaceRound(r)) { thirdPlaceRound = r; return false; }
    return true;
  });

  var lastIdx = mainRounds.length - 1;

  if (thirdPlaceRound) {
    // Regular rounds (everything before the final)
    var regularHtml = mainRounds.slice(0, lastIdx).map(function(r, i) {
      return roundHtml(r, i, teams, false);
    }).join('');

    // Final round (grand final treatment)
    var lastRound = mainRounds[lastIdx];
    var isFinal   = lastRound && (lastRound.matches || []).length === 1;
    var finalHtml = lastRound ? roundHtml(lastRound, lastIdx, teams, isFinal) : '';

    // 3rd place section (sibling to the final round inside the wrapper)
    var tp3Match = (thirdPlaceRound.matches || [])[0] || {};
    var tp3Html  =
      '<div class="bkt-3p-section">' +
        '<div class="bkt-3p-label">' + _eH(thirdPlaceRound.label || '3rd Place') + '</div>' +
        '<div class="bkt-matches">' + matchHtml(tp3Match, teams, thirdPlaceRound.label, 1, 0) + '</div>' +
      '</div>';

    container.innerHTML = regularHtml +
      '<div class="bkt-final-area">' + finalHtml + tp3Html + '</div>';
  } else {
    container.innerHTML = mainRounds.map(function(r, i) {
      var isFinal = i === lastIdx && (r.matches || []).length === 1;
      return roundHtml(r, i, teams, isFinal);
    }).join('');
  }
}

function renderDouble(container, rounds, teams) {
  var trackOf = function(r) { return r.track || inferTrack(r.label) || ''; };
  var upper   = rounds.filter(function(r) { return trackOf(r) === 'upper'; });
  var lower   = rounds.filter(function(r) { return trackOf(r) === 'lower'; });
  var final   = rounds.find(function(r)   { return trackOf(r) === 'final'; }) || null;

  if (!upper.length && !lower.length && !final) {
    renderSingle(container, rounds, teams); return;
  }

  // Auto-normalise the penultimate LB round to "LB Semifinals" if not already named
  lower = lower.map(function(r, li) {
    if (li === lower.length - 2 && (r.label || '').toLowerCase().indexOf('semi') === -1) {
      return Object.assign({}, r, { label: 'LB Semifinals' });
    }
    return r;
  });

  container.className = 'layout-double';

  // Interleave header + round pairs so CSS grid auto-flow places each header
  // directly above its round column — guaranteed pixel-perfect alignment.
  var upperHtml = upper.map(function(r, i) {
    return '<div class="bkt-round-header">' + _eH(r.label || 'Round') + '</div>' +
           roundHtml(r, i, teams, false, false);
  }).join('');
  var lowerHtml = lower.map(function(r, i) {
    return '<div class="bkt-round-header">' + _eH(r.label || 'Round') + '</div>' +
           roundHtml(r, i, teams, false, false);
  }).join('');

  var finalHtml = '';
  if (final) {
    var fm = (final.matches || [])[0] || {};
    var lparts = (final.label || 'Grand Final').split(' ');
    var labelHtml = lparts.length > 1
      ? _eH(lparts[0]) + '<br>' + _eH(lparts.slice(1).join(' '))
      : _eH(final.label || 'Grand Final');
    finalHtml =
      '<div class="bkt-final-section">' +
        '<div class="bkt-final-label">' + labelHtml + '</div>' +
        '<div class="bkt-matches">' + matchHtml(fm, teams, final.label, 1, 0) + '</div>' +
      '</div>';
  }

  container.innerHTML =
    '<div class="bkt-section bkt-upper">' +
      '<div class="bkt-section-label">UPPER BRACKET</div>' +
      '<div class="bkt-section-rounds">' + upperHtml + '</div>' +
    '</div>' +
    '<div class="bkt-section bkt-lower">' +
      '<div class="bkt-section-label">LOWER BRACKET</div>' +
      '<div class="bkt-section-rounds">' + lowerHtml + '</div>' +
    '</div>' +
    finalHtml;
}

function roundHtml(round, ri, teams, isFinal, showLabel) {
  if (showLabel === undefined) showLabel = true;
  var cls = 'bkt-round' + (isFinal ? ' bkt-final-round' : '');
  var rawLabel = round.label || (isFinal ? 'Grand Final' : ('Round ' + (ri + 1)));
  var lparts = isFinal ? rawLabel.split(' ') : null;
  var labelHtml = (isFinal && lparts && lparts.length > 1)
    ? _eH(lparts[0]) + '<br>' + _eH(lparts.slice(1).join(' '))
    : _eH(rawLabel);
  var labelEl = showLabel ? '<div class="bkt-round-label">' + labelHtml + '</div>' : '';
  return '<div class="' + cls + '">' +
    labelEl +
    '<div class="bkt-matches">' +
    (round.matches || []).map(function(m, mi) { return matchHtml(m, teams, round.label, (round.matches || []).length, mi); }).join('') +
    '</div></div>';
}

function matchHtml(match, teams, roundLabel, matchCount, mi) {
  var t1 = match.team1 || {}, t2 = match.team2 || {};
  var done = !!match.complete;
  var t1win = done && t1.score > t2.score, t2win = done && t2.score > t1.score;
  var t1Pending = isPendingRef(t1.name);
  var t2Pending = isPendingRef(t2.name);
  var badgeText = (roundLabel != null && t1Pending && t2Pending)
    ? getMatchBadge(roundLabel, matchCount || 1, mi || 0) : '';
  var badge = badgeText ? '<div class="bkt-match-badge">' + _eH(badgeText) + '</div>' : '';
  return '<div class="bkt-match">' +
    badge +
    teamRowHtml(t1.name, t1.score, teams, done, t1win, t2win) +
    '<div class="bkt-divider"></div>' +
    teamRowHtml(t2.name, t2.score, teams, done, t2win, t1win) +
    '</div>';
}

function teamRowHtml(name, score, teams, done, isWinner, isLoser) {
  var td      = resolveTeam(name, teams);
  var color   = td ? (td.color || '') : '';
  var logoUrl = td ? (td.logo  || '') : '';
  var isTbd   = !name || name === 'TBD' || name === 'BYE';
  var isPending = !isTbd && isPendingRef(name);
  var cls = 'bkt-team' + (isTbd ? ' bkt-tbd' : '') + (isPending ? ' bkt-pending-ref' : '') + (isWinner ? ' bkt-winner' : '') + (isLoser ? ' bkt-loser' : '');
  var sty = isWinner && color ? ' style="--bkt-accent:' + _eH(color) + '"' : '';
  var logo = logoUrl
    ? '<img class="bkt-team-logo" src="' + _eH(logoUrl) + '" alt="">'
    : '<div class="bkt-team-logo-ph"></div>';
  return '<div class="' + cls + '"' + sty + '>' +
    logo +
    '<span class="bkt-team-name">' + _eH(isTbd ? (name === 'BYE' ? 'BYE' : 'TBD') : name) + '</span>' +
    (done ? '<span class="bkt-team-score">' + (parseInt(score) || 0) + '</span>' : '') +
    '</div>';
}

// ── Animation ──────────────────────────────────────────────────────────────────
function animateIn() {
  var root = $('bracket-root');
  if (!root) return;

  clearConnTimers();
  if (_outTimer) { clearTimeout(_outTimer); root.classList.remove('bracket-exiting'); _outTimer = null; }

  root.style.display = '';
  void root.offsetWidth; // reflow — rounds are at natural positions, no animation transform yet

  var animDur  = 0.4;   // card slide-in duration (must match CSS)
  var stagger  = 0.42;  // just above animDur — ~20ms natural gap, no perceptible pause
  var start    = 0.2;
  var roundDelays = { upper: [], lower: [], final: null, single: [] };
  var allEls    = [];
  var lastDelay = start;

  if (_bracketType === 'double') {
    var upperRounds = Array.from(document.querySelectorAll('.bkt-section.bkt-upper .bkt-round'));
    var lowerRounds = Array.from(document.querySelectorAll('.bkt-section.bkt-lower .bkt-round'));
    var finalSec    = document.querySelector('.bkt-final-section');
    var maxCols     = Math.max(upperRounds.length, lowerRounds.length);

    // Iterate by visual column left→right: UB and LB at the same column share the same delay
    for (var col = 0; col < maxCols; col++) {
      var d = start + col * stagger;
      lastDelay = d;

      if (col < upperRounds.length) {
        upperRounds[col].style.animationDelay = d + 's';
        roundDelays.upper.push(d);
        allEls.push(upperRounds[col]);
      }
      if (col < lowerRounds.length) {
        lowerRounds[col].style.animationDelay = d + 's';
        roundDelays.lower.push(d);
        allEls.push(lowerRounds[col]);
      }
    }

    // Section labels slide in with the first column
    var upperLabel = document.querySelector('.bkt-section.bkt-upper .bkt-section-label');
    var lowerLabel = document.querySelector('.bkt-section.bkt-lower .bkt-section-label');
    if (upperLabel) { upperLabel.style.animationDelay = start + 's'; allEls.push(upperLabel); }
    if (lowerLabel) { lowerLabel.style.animationDelay = start + 's'; allEls.push(lowerLabel); }

    // Each round-header animates with its corresponding column (same stagger delay as its round)
    Array.from(document.querySelectorAll('.bkt-section.bkt-upper .bkt-round-header')).forEach(function(el, i) {
      el.style.animationDelay = (start + i * stagger) + 's'; allEls.push(el);
    });
    Array.from(document.querySelectorAll('.bkt-section.bkt-lower .bkt-round-header')).forEach(function(el, i) {
      el.style.animationDelay = (start + i * stagger) + 's'; allEls.push(el);
    });

    if (finalSec) {
      var d = start + maxCols * stagger;
      lastDelay = d;
      finalSec.style.animationDelay = d + 's';
      roundDelays.final = d;
      allEls.push(finalSec);
    }
  } else {
    var rounds = Array.from(document.querySelectorAll('#bracket-rounds-gfx .bkt-round'));
    rounds.forEach(function(el, i) {
      var d = start + i * stagger;
      lastDelay = d;
      el.style.animationDelay = d + 's';
      roundDelays.single.push(d);
      allEls.push(el);
    });
    // 3P section (if present) slides in with the same delay as the final round
    var tp3El = document.querySelector('#bracket-rounds-gfx .bkt-3p-section');
    if (tp3El && rounds.length) {
      var tp3Delay = start + (rounds.length - 1) * stagger;
      tp3El.style.animationDelay = tp3Delay + 's';
      allEls.push(tp3El);
    }
  }

  // Measure connector positions NOW — elements are at their final layout positions
  // (before bracket-entering is added, so no translateX transform is applied yet).
  // All of this runs in the same JS frame so the browser never paints the intermediate state.
  buildAndScheduleConnectors(roundDelays, animDur);

  // Start the enter animation — rounds jump to `from` (opacity 0, translateX) then play in
  root.classList.add('bracket-entering');

  if (_inTimer) clearTimeout(_inTimer);
  var totalMs = (lastDelay + animDur + 0.3) * 1000;
  _inTimer = setTimeout(function() {
    root.classList.remove('bracket-entering');
    allEls.forEach(function(el) { el.style.animationDelay = ''; });
    _inTimer = null;
  }, totalMs);
}

function animateOut() {
  var root = $('bracket-root');
  if (!root) return;

  clearConnTimers();

  if (_inTimer) {
    clearTimeout(_inTimer);
    root.classList.remove('bracket-entering');
    document.querySelectorAll('.bkt-round, .bkt-final-section, .bkt-3p-section, .bkt-section-label, .bkt-round-header').forEach(function(el) {
      el.style.animationDelay = '';
    });
    _inTimer = null;
  }

  root.classList.add('bracket-exiting');
  if (_outTimer) clearTimeout(_outTimer);
  _outTimer = setTimeout(function() {
    root.classList.remove('bracket-exiting');
    root.style.display = 'none';
    _outTimer = null;
  }, 650);
}

// ── Socket ─────────────────────────────────────────────────────────────────────
socket.on('connect', function() { _visible = false; });

socket.on('state', function(state) {
  GfxSettings.applyTheme(document.documentElement, state);
  GfxSettings.applyBackground(document.body, state);

  var bkt     = state.bracket || {};
  var visible = !!bkt.visible;

  renderBracket(state);

  if (visible && !_visible) {
    _visible = true;
    animateIn();
  } else if (!visible && _visible) {
    _visible = false;
    animateOut();
  } else if (visible && _visible) {
    requestAnimationFrame(function() { requestAnimationFrame(redrawConnectors); });
  }
});

// Immediately draw all connectors at full opacity (used when already visible).
function redrawConnectors() {
  var svg = $('bracket-svg');
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  var svgR = svg.getBoundingClientRect();

  var drawImmediate = function(phases) {
    phases.forEach(function(phase) {
      phase.forEach(function(p) {
        p.style.strokeDashoffset = '0';
      });
    });
  };

  if (_bracketType === 'double') {
    var upperRounds = Array.from(document.querySelectorAll('.bkt-section.bkt-upper .bkt-round'));
    var lowerRounds = Array.from(document.querySelectorAll('.bkt-section.bkt-lower .bkt-round'));
    var gfMatch     = document.querySelector('.bkt-final-section .bkt-match');
    for (var ui = 0; ui < upperRounds.length - 1; ui++)
      drawImmediate(buildRoundConnectors(svg, svgR, upperRounds[ui], upperRounds[ui + 1]));
    for (var li = 0; li < lowerRounds.length - 1; li++)
      drawImmediate(buildRoundConnectors(svg, svgR, lowerRounds[li], lowerRounds[li + 1]));
    if (gfMatch) {
      var ubF = upperRounds.length ? upperRounds[upperRounds.length - 1] : null;
      var lbF = lowerRounds.length ? lowerRounds[lowerRounds.length - 1] : null;
      if (ubF && lbF) {
        var ubM = ubF.querySelectorAll('.bkt-match'), lbM = lbF.querySelectorAll('.bkt-match');
        var rA = ubM.length ? ubM[ubM.length - 1].getBoundingClientRect() : null;
        var rB = lbM.length ? lbM[lbM.length - 1].getBoundingClientRect() : null;
        var rW = gfMatch.getBoundingClientRect();
        if (rA && rB) drawImmediate(drawConnector(svg, svgR, rA, rB, rW));
        else if (rA)  drawImmediate(drawSimpleLine(svg, svgR, rA, rW));
      }
    }
  } else {
    var rounds = Array.from(document.querySelectorAll('#bracket-rounds-gfx .bkt-round'));
    for (var ri = 0; ri < rounds.length - 1; ri++)
      drawImmediate(buildRoundConnectors(svg, svgR, rounds[ri], rounds[ri + 1]));

    var tp3Section = document.querySelector('#bracket-rounds-gfx .bkt-3p-section');
    if (tp3Section && rounds.length >= 2) {
      var tp3Match  = tp3Section.querySelector('.bkt-match');
      var sfRound   = rounds[rounds.length - 2];
      var sfMatches = sfRound ? sfRound.querySelectorAll('.bkt-match') : [];
      if (tp3Match && sfMatches.length === 2) {
        drawImmediate(drawConnector(svg, svgR,
          sfMatches[0].getBoundingClientRect(),
          sfMatches[1].getBoundingClientRect(),
          tp3Match.getBoundingClientRect()));
      }
    }
  }
}

window.addEventListener('resize', function() {
  if (_visible) requestAnimationFrame(redrawConnectors);
});
