// Break Screen — break.js
const _gfxToken = new URLSearchParams(window.location.search).get('token') || '';
const socket = io({ auth: { token: _gfxToken }, query: { token: _gfxToken } });

let _timerInterval = null;
let _lastVisible   = null; // null = first render; prevents spurious animateOut on load
let _tickerVisible = null; // null = force re-evaluate on next render

// ── Helpers ───────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function setText(id, val) { const el = $(id); if (el) el.textContent = val != null ? String(val) : ''; }
function setBg(id, url)   { const el = $(id); if (el) el.style.backgroundImage = url ? 'url(' + url + ')' : ''; }

// ── Show / hide ───────────────────────────────────────────────────────────────
function animateIn() {
  const root = $('break-root');
  if (!root) return;
  root.style.display = '';
  void root.offsetWidth; // force reflow before adding class
  root.classList.add('visible');
  _tickerVisible = null; // force ticker to re-evaluate and animate in on next render
}

function animateOut() {
  const root = $('break-root');
  if (!root) return;
  root.classList.remove('visible');
  setTimeout(function() { root.style.display = 'none'; }, 650);
}

// ── Countdown timer ───────────────────────────────────────────────────────────
function runTimer(timerEnd) {
  clearInterval(_timerInterval);
  const wrap   = $('break-timer');
  const val    = $('break-timer-value');
  const pipVal = $('break-pip-timer-value');
  if (!timerEnd) {
    if (wrap) wrap.style.display = 'none';
    if (pipVal) pipVal.textContent = '--:--';
    return;
  }
  if (timerEnd <= Date.now()) {
    if (wrap) wrap.style.display = '';
    if (val)    val.textContent    = '00:00';
    if (pipVal) pipVal.textContent = '00:00';
    return;
  }
  if (wrap) wrap.style.display = '';
  function tick() {
    const rem = Math.max(0, timerEnd - Date.now()) / 1000;
    const m = Math.floor(rem / 60);
    const s = Math.floor(rem % 60);
    const str = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    if (val)    val.textContent    = str;
    if (pipVal) pipVal.textContent = str;
    if (rem <= 0) clearInterval(_timerInterval);
  }
  tick();
  _timerInterval = setInterval(tick, 500);
}

// ── Ticker label (text / logo / none) ─────────────────────────────────────────
function renderTickerLabel(ticker) {
  TickerEngine.renderLabel(
    { wrap: 'break-ticker-label', text: 'break-ticker-label-text', img: 'break-ticker-label-img' },
    ticker
  );
}

// ── Ticker scroll ─────────────────────────────────────────────────────────────
function renderTicker(ticker) {
  const wrap  = $('break-ticker');
  const inner = $('break-ticker-inner');
  if (!wrap || !inner) return;

  // Auto mode uses server-computed items; manual uses operator-entered items
  const items = (ticker && ticker.autoMode) ? (ticker.autoItems || []) : (ticker && ticker.items) || [];
  const show  = !!(ticker && ticker.visible && items.length);

  // ── Visibility transitions ────────────────────────────────────────────────
  if (show !== _tickerVisible) {
    var _tickerFirstRender = (_tickerVisible === null);
    _tickerVisible = show;
    var _tickerRoot = $('break-root');
    if (show) {
      // Add ticker-entering to break-root — drives the clip-path hide animation on
      // ::after using the same easing as the ticker's own slide-in, so the border
      // disappears from the bottom up, perfectly tracking the ticker's rising edge.
      if (_tickerRoot) {
        _tickerRoot.classList.remove('ticker-off', 'ticker-leaving');
        _tickerRoot.classList.add('ticker-entering');
        var _trEnterRef = _tickerRoot;
        setTimeout(function() { _trEnterRef.classList.remove('ticker-entering'); }, 1500);
      }
      wrap.style.display = '';
      wrap.classList.remove('ticker-entering', 'ticker-leaving');
      void wrap.offsetWidth;
      wrap.classList.add('ticker-entering');
    } else {
      wrap.classList.remove('ticker-entering', 'ticker-leaving');
      wrap.classList.add('ticker-leaving');
      if (_tickerRoot) {
        if (_tickerFirstRender) {
          // Initial state — ticker never visible, set directly with no animation
          _tickerRoot.classList.remove('ticker-entering', 'ticker-leaving');
          _tickerRoot.classList.add('ticker-off');
        } else {
          // Real exit: add ticker-leaving to break-root so CSS can drive the
          // clip-path reveal animation in sync with the ticker's slide-out easing
          _tickerRoot.classList.remove('ticker-off', 'ticker-entering');
          _tickerRoot.classList.add('ticker-leaving');
        }
      }
      var hideRef = wrap;
      var _trootRef = _tickerRoot;
      setTimeout(function() {
        if (!_tickerVisible) {
          hideRef.style.display = 'none';
          hideRef.classList.remove('ticker-leaving');
          inner.style.animation = 'none';
          inner.innerHTML = '';
          delete inner._tickerText;
          // Switch from leaving → off atomically (no gap between rules)
          if (_trootRef) {
            _trootRef.classList.remove('ticker-leaving');
            _trootRef.classList.add('ticker-off');
          }
        }
      }, 1500);
      return;
    }
  }

  if (!show) return;

  // ── Content ─────────────────────────────────────────────────────────────────
  TickerEngine.renderScroll(inner, items, {
    winClass:       'ticker-result-win',
    lossClass:      'ticker-result-loss',
    scoreClass:     'ticker-result-score',
    liveLabelClass: 'break-ticker-live-label',
    liveDotClass:   'break-ticker-live-dot',
    itemClass:      'break-ticker-item',
    animName:       'break-ticker-scroll'
  });
}

// ── Per-map round scores (CS2 / map-veto games) ────────────────────────────────
// Renders one chip per played map: name + "13–6" round score (winner's number in
// accent), the live map flagged LIVE, the next unplayed map flagged NEXT. Hidden for
// non-map-veto games and when there are no map results.
function _mapScoreChips(state) {
  const adapter = state.adapter || {};
  if (adapter.pregameKind !== 'map-veto') return null;
  // Only rows with a chosen map are real played maps (the model carries best-of rows,
  // some of which may be unset/unplayed).
  const results = ((state.match && state.match.mapResults) || []).filter(function(r){ return r && r.map; });
  if (!results.length) return null;
  // First not-yet-final map = "next" marker (only if it isn't already live).
  let nextIdx = -1;
  for (let i = 0; i < results.length; i++) {
    if (results[i].status !== 'final') { nextIdx = i; break; }
  }
  return results.map(function(r, i) {
    const live  = r.status === 'live';
    const isNext = !live && i === nextIdx;
    let scoreHtml;
    if (isNext) {
      scoreHtml = '<span class="break-map-next">NEXT</span>';
    } else {
      const t1cls = r.winner === 'team1' ? ' win' : '';
      const t2cls = r.winner === 'team2' ? ' win' : '';
      scoreHtml = '<span class="break-map-score">' +
        '<span class="break-map-r' + t1cls + '">' + (r.t1Rounds || 0) + '</span>' +
        '<span class="break-map-dash">–</span>' +
        '<span class="break-map-r' + t2cls + '">' + (r.t2Rounds || 0) + '</span></span>';
    }
    return '<div class="break-map' + (live ? ' live' : '') + '">' +
      '<div class="break-map-name">' + esc(r.map || ('MAP ' + (i + 1))) + '</div>' +
      scoreHtml +
      (live ? '<span class="break-map-live">LIVE</span>' : '') +
      '</div>';
  }).join('<span class="break-map-sep">·</span>');
}
function renderMapScores(state) {
  const el = $('break-maps');
  if (!el) return;
  const chips = _mapScoreChips(state);
  if (!chips) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = '';
  el.innerHTML = chips;
}

// True for map-veto games (CS2 etc.) — the LoL "GAME x OF y" centre counter never
// applies (no per-game numbering; the map chips / side scores convey progress). Checked
// independently of _cs2BreakInfo, which is null until at least one map is logged.
function _isMapVetoGame(state) { return ((state && state.adapter) || {}).pregameKind === 'map-veto'; }

// CS2 / map-veto series info derived from played maps (NOT currentGameNum). A map
// counts as played once marked final, so the next game = finals + 1 (2 finals in a
// Bo3 → game 3). Returns null for non-map-veto games or when no maps are set.
function _cs2BreakInfo(state) {
  const adapter = state.adapter || {};
  if (adapter.pregameKind !== 'map-veto') return null;
  const results = ((state.match && state.match.mapResults) || []).filter(function(r){ return r && r.map; });
  if (!results.length) return null;
  const total = results.length;
  let finalCount = 0, nextMap = '';
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'final') finalCount++;
    else if (!nextMap) nextMap = results[i].map;
  }
  return { total: total, finalCount: finalCount, nextMap: nextMap,
           gameNum: Math.min(finalCount + 1, total), seriesOver: finalCount >= total };
}

// ── Next Up — auto-derived from today's schedule, manual bs.nextMatch overrides ──
function renderNextUp(bs, todayGames) {
  const wrapEl = $('break-next');
  const textEl = $('break-next-text');

  // Manual override
  if (bs.nextMatch) {
    if (wrapEl) wrapEl.style.display = '';
    if (textEl) textEl.textContent = bs.nextMatch;
    return;
  }

  // Auto-derive: find next unplayed game after the current one
  var games    = todayGames || [];
  var currIdx  = -1;
  for (var j = 0; j < games.length; j++) { if (games[j].isCurrent) { currIdx = j; break; } }
  var nextGame = null;
  for (var i = (currIdx >= 0 ? currIdx + 1 : 0); i < games.length; i++) {
    if (!games[i].result || !games[i].result.completed) { nextGame = games[i]; break; }
  }

  if (!nextGame) { if (wrapEl) wrapEl.style.display = 'none'; return; }

  var t1  = nextGame.team1.name || nextGame.team1.tag || '?';
  var t2  = nextGame.team2.name || nextGame.team2.tag || '?';
  var fmt = nextGame.format || '';
  if (wrapEl) wrapEl.style.display = '';
  if (textEl) textEl.textContent = t1 + ' vs ' + t2 + (fmt ? '   —   ' + fmt : '');
}

// ── PIP FLIP helpers ───────────────────────────────────────────────────────────
// Animates elements from their current visual positions to wherever CSS places them
// after a class change — handles X, Y and font-size in one motion.
var _PIP_FLIP_IDS = ['break-tourn-logo', 'break-main-msg', 'break-subtext', 'break-sponsors'];
var _EASE = 'cubic-bezier(0.25, 1, 0.5, 1)'; // energetic start, smooth settle

function _flipSnapshot() {
  var s   = {};
  var pip = !!($('break-root') && $('break-root').classList.contains('pip-mode'));
  _PIP_FLIP_IDS.forEach(function(id) {
    var el = $(id);
    if (el) {
      var r = el.getBoundingClientRect();
      s[id] = { top: r.top, left: r.left };
      // Capture font-size in vh so CSS can interpolate cleanly
      if (id === 'break-main-msg') s[id].fontSize = pip ? '4.8vh' : '8.5vh';
    }
  });
  return s;
}

function _flipAnimate(before, duration) {
  var d = duration + 's ' + _EASE;

  // 1. READ all final positions in one pass — no style changes during reads
  var finals = {};
  _PIP_FLIP_IDS.forEach(function(id) {
    var el = $(id);
    if (el) finals[id] = el.getBoundingClientRect();
  });

  // 2. WRITE all inverse transforms in one pass — no reads during writes
  _PIP_FLIP_IDS.forEach(function(id) {
    var el = $(id);
    if (!el || !before[id] || !finals[id]) return;
    var dx = before[id].left - finals[id].left;
    var dy = before[id].top  - finals[id].top;
    el.style.transition = 'none';
    el.style.transform  = 'translateX(' + dx + 'px) translateY(' + dy + 'px)';
    if (id === 'break-main-msg' && before[id].fontSize) el.style.fontSize = before[id].fontSize;
  });

  // 3. One forced reflow to commit all inverse positions before animating
  $('break-root').getBoundingClientRect();

  // 4. Play: set transitions and release transforms so elements animate to final positions
  _PIP_FLIP_IDS.forEach(function(id) {
    var el = $(id);
    if (!el) return;
    var t = 'transform ' + d;
    if (id === 'break-main-msg') t += ', font-size ' + d;
    el.style.transition = t;
    el.style.transform  = '';
    if (id === 'break-main-msg') el.style.fontSize = '';
  });

  // 5. Clean up inline styles after animation completes
  setTimeout(function() {
    _PIP_FLIP_IDS.forEach(function(id) {
      var el = $(id);
      if (el) { el.style.transition = ''; el.style.transform = ''; el.style.fontSize = ''; }
    });
  }, duration * 1000 + 50);
}

// ── PIP bottom bar ────────────────────────────────────────────────────────────
function renderPipBottom(state) {
  const bs    = state.breakScreen || {};
  const match = state.match || {};
  const t1 = match.team1 || {};
  const t2 = match.team2 || {};

  setBg('break-pip-t1-logo', t1.logo);
  setBg('break-pip-t2-logo', t2.logo);
  setText('break-pip-t1-name', t1.name || t1.tag || '');
  setText('break-pip-t2-name', t2.name || t2.tag || '');

  const fmt     = match.format || 'Bo3';
  const fmtNum  = parseInt(fmt.replace(/[Bb]o/, '')) || 3;
  const gameNum = match.currentGameNum || 1;
  const winsNeed   = Math.ceil(fmtNum / 2);
  const t1wins     = t1.score || 0;
  const t2wins     = t2.score || 0;
  const seriesOver = t1wins >= winsNeed || t2wins >= winsNeed;
  const isBo1      = fmtNum === 1;

  var t1ScoreEl = $('break-pip-t1-score');
  var t2ScoreEl = $('break-pip-t2-score');
  if (t1ScoreEl) {
    t1ScoreEl.style.display = isBo1 ? 'none' : '';
    t1ScoreEl.textContent   = t1.score != null ? String(t1.score) : '0';
    t1ScoreEl.style.color   = (!isBo1 && seriesOver && t1wins > t2wins) ? 'var(--gfx-c1)' : '';
  }
  if (t2ScoreEl) {
    t2ScoreEl.style.display = isBo1 ? 'none' : '';
    t2ScoreEl.textContent   = t2.score != null ? String(t2.score) : '0';
    t2ScoreEl.style.color   = (!isBo1 && seriesOver && t2wins > t1wins) ? 'var(--gfx-c1)' : '';
  }

  var pipFmtEl  = $('break-pip-format');
  var pipGameEl = $('break-pip-game');
  // CS2: PIP has no map-chip row, so surface the NEXT MAP by the score instead of a
  // game counter ("NEXT" label + map name; or SERIES COMPLETE). Gated on the adapter so
  // a CS2 break BEFORE any map is logged still suppresses the LoL "GAME x OF y" counter.
  var cs2 = _cs2BreakInfo(state);
  if (_isMapVetoGame(state)) {
    var pipLabel = cs2 ? (cs2.seriesOver ? 'SERIES COMPLETE' : (cs2.nextMap || '')) : '';
    if (pipFmtEl) {
      pipFmtEl.style.display = (cs2 && !cs2.seriesOver && cs2.nextMap) ? '' : 'none';
      pipFmtEl.textContent   = 'NEXT';
    }
    if (pipGameEl) {
      pipGameEl.style.display = pipLabel ? '' : 'none';
      pipGameEl.textContent   = pipLabel;
    }
  } else {
    if (pipFmtEl) {
      pipFmtEl.style.display = isBo1 ? '' : 'none';
      pipFmtEl.textContent   = fmt;
    }
    if (pipGameEl) {
      pipGameEl.style.display = isBo1 ? 'none' : '';
      pipGameEl.textContent   = seriesOver ? 'SERIES COMPLETE' : 'GAME ' + gameNum + ' OF ' + fmtNum;
    }
  }

  // Upcoming in the bottom bar — manual override takes priority, same as renderNextUp
  var pipUpEl   = $('break-pip-upcoming');
  var pipUpText = $('break-pip-upcoming-text');
  if (bs.nextMatch) {
    if (pipUpEl) pipUpEl.style.display = '';
    if (pipUpText) pipUpText.textContent = bs.nextMatch;
  } else {
    var games    = state.todayGames || [];
    var currIdx  = -1;
    for (var j = 0; j < games.length; j++) { if (games[j].isCurrent) { currIdx = j; break; } }
    var nextGame = null;
    for (var i = (currIdx >= 0 ? currIdx + 1 : 0); i < games.length; i++) {
      if (!games[i].result || !games[i].result.completed) { nextGame = games[i]; break; }
    }
    if (nextGame && pipUpEl && pipUpText) {
      var nt1 = nextGame.team1.name || nextGame.team1.tag || '?';
      var nt2 = nextGame.team2.name || nextGame.team2.tag || '?';
      var nfmt = nextGame.format || '';
      pipUpEl.style.display = '';
      pipUpText.textContent = nt1 + ' vs ' + nt2 + (nfmt ? '   —   ' + nfmt : '');
    } else if (pipUpEl) {
      pipUpEl.style.display = 'none';
    }
  }
}

// ── Main render ───────────────────────────────────────────────────────────────
function renderAll(state) {
  const bs       = state.breakScreen || {};
  const match    = state.match       || {};
  const settings = state.settings    || {};
  const ticker   = state.ticker      || {};
  const t1 = match.team1 || {};
  const t2 = match.team2 || {};

  // ── PIP entry: snapshot ALL positions BEFORE any style changes ────────────
  // Every style change below (logo height, text, timer visibility) can shift the
  // flex layout, making clones appear at wrong positions if measured after them.
  // Capturing rects here guarantees clones land exactly where elements were painted.
  const rootEl = $('break-root');
  var wasPip = !!(rootEl && rootEl.classList.contains('pip-mode'));
  var logoScale = bs.centerLogoScale || 8; // defined early so rAF closure can read it
  var _pipEntry = null; // { rootRect, flipBefore, cloneData }

  if (bs.pipMode && !wasPip && rootEl) {
    var _peRootRect   = rootEl.getBoundingClientRect();
    var _peFlipBefore = _flipSnapshot();
    var _peCloneData  = [];
    ['break-series', 'break-maps', 'break-next', 'break-timer'].forEach(function(id) {
      var el = $(id);
      if (!el || el.style.display === 'none') return;
      var r = el.getBoundingClientRect();
      _peCloneData.push({ el: el, rect: r });
    });
    _pipEntry = { rootRect: _peRootRect, flipBefore: _peFlipBefore, cloneData: _peCloneData };
  }

  // Exit snapshot — same reasoning: logo height reverts to full scale in the logo section
  // below, which shifts every element in the narrow flex column. Snapshot here so 'before'
  // matches what's actually painted, not the post-height-change layout.
  var _pipExitBefore = (!bs.pipMode && wasPip && rootEl) ? _flipSnapshot() : null;

  // ── Tournament / centre logo ──────────────────────────────────────────────
  // Priority: break-specific override → first library logo → match tournament logo
  const logoLibrary = (settings.logoSet && settings.logoSet.logos) || [];
  const tournLogo = (settings.breakCenterLogoUrl)
    || (logoLibrary.length ? logoLibrary[0].url : '')
    || match.tournamentLogo || '';
  const logoImg = $('break-tourn-logo-img');
  if (logoImg) {
    if (!bs.pipMode) {
      // Normal mode: full scale
      logoImg.style.height = logoScale + 'vh';
    } else if (wasPip) {
      // Already in pip mode: apply cap immediately (no transition running)
      logoImg.style.height = Math.min(logoScale, 9) + 'vh';
    }
    // Entering pip mode (_pipEntry set): height set inside the transition rAF,
    // just before _flipAnimate reads finals, so FLIP captures the correct target.
    if (tournLogo) { logoImg.src = tournLogo; logoImg.style.display = ''; }
    else           { logoImg.style.display = 'none'; }
  }
  const tournNameEl = $('break-tourn-name');
  if (tournNameEl) {
    tournNameEl.style.display = bs.showTournName ? '' : 'none';
    tournNameEl.textContent   = match.tournament || '';
  }

  // ── Primary message + subtext ─────────────────────────────────────────────
  setText('break-main-msg', bs.message || 'BE RIGHT BACK');
  setText('break-subtext',  bs.subtext || '');

  // ── Series state ──────────────────────────────────────────────────────────
  setBg('break-t1-logo', t1.logo);
  setBg('break-t2-logo', t2.logo);
  setText('break-t1-name', t1.name || t1.tag || '');
  setText('break-t2-name', t2.name || t2.tag || '');

  const fmt        = match.format || 'Bo3';
  const fmtNum     = parseInt(fmt.replace(/[Bb]o/,'')) || 3;
  const gameNum    = match.currentGameNum || 1;
  const winsNeed   = Math.ceil(fmtNum / 2);
  const t1wins     = t1.score || 0;
  const t2wins     = t2.score || 0;
  const seriesOver = t1wins >= winsNeed || t2wins >= winsNeed;
  const isBo1      = fmtNum === 1;

  // Scores only appear for BO3+
  const t1ScoreEl = $('break-t1-score');
  const t2ScoreEl = $('break-t2-score');
  if (t1ScoreEl) {
    t1ScoreEl.style.display = isBo1 ? 'none' : '';
    t1ScoreEl.textContent   = t1.score != null ? String(t1.score) : '0';
    t1ScoreEl.style.color   = (!isBo1 && seriesOver && t1wins > t2wins) ? 'var(--gfx-c1)' : '';
  }
  if (t2ScoreEl) {
    t2ScoreEl.style.display = isBo1 ? 'none' : '';
    t2ScoreEl.textContent   = t2.score != null ? String(t2.score) : '0';
    t2ScoreEl.style.color   = (!isBo1 && seriesOver && t2wins > t1wins) ? 'var(--gfx-c1)' : '';
  }

  // Centre: BO1 shows format label; BO3+ shows game progress. For CS2 the map-score
  // chips below already convey which map is next, so drop the centre game counter —
  // the side scores ("1 — 1") read fine on their own.
  const mapVeto  = _isMapVetoGame(state);
  const formatEl = $('break-series-format');
  const gameEl   = $('break-series-game');
  if (formatEl) {
    formatEl.style.display = (!mapVeto && isBo1) ? '' : 'none';
    formatEl.textContent   = fmt;
  }
  if (gameEl) {
    gameEl.style.display = (!mapVeto && !isBo1) ? '' : 'none';
    gameEl.textContent   = seriesOver ? 'SERIES COMPLETE' : 'GAME ' + gameNum + ' OF ' + fmtNum;
  }

  // ── Per-map round scores (CS2) ────────────────────────────────────────────
  renderMapScores(state);

  // ── Timer ─────────────────────────────────────────────────────────────────
  runTimer(bs.timerEnd || null);

  // ── Next up ───────────────────────────────────────────────────────────────
  renderNextUp(bs, state.todayGames || []);

  // ── Sponsor logos ─────────────────────────────────────────────────────────
  const sponsorEl = $('break-sponsors');
  if (sponsorEl) {
    const logos = match.sponsorLogos || [];
    sponsorEl.innerHTML = logos.map(function(url) {
      return '<div class="break-sponsor" style="background-image:url(' + esc(url) + ')"></div>';
    }).join('');
  }

  // ── Ticker scroll ────────────────────────────────────────────────────────
  renderTicker(ticker);

  // ── PIP mode ──────────────────────────────────────────────────────────────
  if (rootEl) {
    // Steady-state pip: runTimer and renderNextUp don't know about pip mode and will
    // re-show break-timer / break-next on every data update. Keep them hidden here so
    // their content is only surfaced via the bottom bar (renderPipBottom handles that).
    if (bs.pipMode && wasPip) {
      ['break-series', 'break-maps', 'break-next', 'break-timer'].forEach(function(id) {
        var el = $(id); if (el) el.style.display = 'none';
      });
    }

    if (bs.pipMode && !wasPip && _pipEntry) {
      // Create clones from pre-measured positions (captured before any style changes)
      var _clones = [];
      _pipEntry.cloneData.forEach(function(item) {
        var clone = item.el.cloneNode(true);
        clone.removeAttribute('id');
        clone.style.position      = 'absolute';
        clone.style.top           = (item.rect.top  - _pipEntry.rootRect.top)  + 'px';
        clone.style.left          = (item.rect.left - _pipEntry.rootRect.left) + 'px';
        clone.style.width         = item.rect.width  + 'px';
        clone.style.height        = item.rect.height + 'px';
        clone.style.margin        = '0';
        clone.style.zIndex        = '8';
        clone.style.pointerEvents = 'none';
        rootEl.appendChild(clone);
        _clones.push(clone);
        item.el.style.display = 'none';
      });

      rootEl.getBoundingClientRect(); // commit clone positions

      requestAnimationFrame(function() {
        // Set logo height here — just before _flipAnimate reads finals — so FLIP
        // captures the correct target position (9vh cap) in pip-mode layout.
        if (logoImg) logoImg.style.height = Math.min(logoScale, 9) + 'vh';

        _clones.forEach(function(c) {
          c.style.transition = 'opacity 0.5s ease';
          c.style.opacity    = '0';
        });

        rootEl.classList.add('pip-mode');
        rootEl.classList.add('pip-spread');
        _flipAnimate(_pipEntry.flipBefore, 2);

        setTimeout(function() {
          _clones.forEach(function(c) {
            if (c.parentNode) c.parentNode.removeChild(c);
          });
        }, 600);
      });

    } else if (!bs.pipMode && wasPip && _pipExitBefore) {
      // 'before' was captured at the very top of renderAll, before the logo height
      // was restored to full scale — so it matches exactly what's on screen.
      var before = _pipExitBefore;

      // break-series is always visible in normal mode — restore it explicitly.
      // break-next and break-timer: renderNextUp / runTimer already ran and set their
      // correct display states. Just ensure they start invisible so they fade in.
      var seriesEl = $('break-series');
      if (seriesEl) seriesEl.style.display = '';

      var _exitIds = ['break-series', 'break-next', 'break-timer'];
      _exitIds.forEach(function(id) {
        var el = $(id);
        if (el && el.style.display !== 'none') el.style.opacity = '0';
      });

      rootEl.classList.remove('pip-spread');
      rootEl.classList.remove('pip-mode');
      _flipAnimate(before, 1.5);

      // Fade each visible element back in once the FLIP is well underway
      setTimeout(function() {
        _exitIds.forEach(function(id) {
          var el = $(id);
          if (!el || el.style.display === 'none') return;
          el.style.transition = 'opacity 0.5s ease';
          el.style.opacity    = '1';
          setTimeout(function() {
            var e = $(id);
            if (e) { e.style.transition = ''; e.style.opacity = ''; }
          }, 550);
        });
      }, 300);
    }
  }
  renderPipBottom(state);
}

// ── Socket ────────────────────────────────────────────────────────────────────
socket.on('state', function(state) {
  const root    = $('break-root');
  const visible = !!(state.breakScreen && state.breakScreen.visible);

  GfxSettings.applyTheme(document.documentElement, state);
  GfxSettings.applyAnimation(document.documentElement, state, 'breakScreen');
  GfxSettings.clearBackground(root);

  // Ticker label runs on every state push — independent of break screen visibility
  renderTickerLabel(state.ticker || {});

  // Visibility transitions
  if (visible !== _lastVisible) {
    if (visible) animateIn();
    else if (_lastVisible !== null) animateOut();
    _lastVisible = visible;
  }

  if (!visible) return;
  renderAll(state);
});
