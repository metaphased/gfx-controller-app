// Draft Overlay — draft.js
// Connect with graphics token from URL so OBS/vMix browser sources work without login
const _gfxToken = new URLSearchParams(window.location.search).get('token') || '';
const socket = io({ auth: { token: _gfxToken }, query: { token: _gfxToken } });

// ── Index maps (must match control.js exactly) ────────────────────────────────
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

const PHASE_LABELS = {
  notstarted:'—', bans1:'Phase 1 Bans', picks1:'Phase 1 Picks',
  bans2:'Phase 2 Bans', picks2:'Phase 2 Picks', complete:'Complete',
};

const ROLE_ICONS = {
  top:     '/graphics/draft/roles/top.png',
  jungle:  '/graphics/draft/roles/jungle.png',
  mid:     '/graphics/draft/roles/mid.png',
  adc:     '/graphics/draft/roles/bot.png',
  bot:     '/graphics/draft/roles/bot.png',
  support: '/graphics/draft/roles/support.png',
  sup:     '/graphics/draft/roles/support.png',
};

const TIMER_CIRC = 2 * Math.PI * 44;

let _timerInterval     = null;
let _lastTimerEnd      = null;
let _lastDuration      = 30;
let _logoExpandTimeout = null;
let _logoIsExpanded    = false;
let _lastLayout        = '';
let _introPlayed       = false;
let _lastVisible       = false;
let _lastIntroTrigger  = 0;
let _draftWasActive    = false;
let _renderHash        = '';
let _fearlessHash      = '';

// ── Socket ────────────────────────────────────────────────────────────────────
socket.on('connect', () => { _introPlayed = false; _draftWasActive = false; _renderHash = ''; _fearlessHash = ''; });

socket.on('state', (state) => {
  const settings = state.settings || {};
  // Normalise legacy 'arena' value → 'standard'
  const rawLayout = settings.draftLayout || 'standard';
  const layout    = rawLayout === 'arena' ? 'standard' : rawLayout;

  if (layout !== _lastLayout) {
    document.body.className = 'layout-' + layout;
    _lastLayout = layout;
  }

  GfxSettings.applyTheme(document.documentElement, state);
  GfxSettings.applyAnimation(document.documentElement, state, 'draft');
  GfxSettings.applyBackground(document.getElementById('draft-root'), state);

  const root    = document.getElementById('draft-root');
  const visible = !!(state.draft && state.draft.visible);

  if (!visible) {
    root.style.visibility = 'hidden';
    _lastVisible = false;
    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
    if (_logoExpandTimeout) { clearTimeout(_logoExpandTimeout); _logoExpandTimeout = null; }
    return;
  }

  // Visibility just turned on — reset intro and stale timer so both replay cleanly
  if (!_lastVisible) { _introPlayed = false; _lastTimerEnd = null; _draftWasActive = false; _renderHash = ''; _fearlessHash = ''; }
  _lastVisible = true;

  // introTrigger counter incremented by Reset Draft or Replay Intro button
  const trigger = (state.draft && state.draft.introTrigger) || 0;
  if (trigger !== _lastIntroTrigger) {
    _lastIntroTrigger = trigger;
    _introPlayed    = false;
    _lastTimerEnd   = null;
    _draftWasActive = false;
    _renderHash     = '';
    _fearlessHash   = '';
  }
  root.style.visibility = '';

  renderAll(state);
});

// ── Data fingerprints ─────────────────────────────────────────────────────────
// Covers all non-timer fields that affect the DOM. Timer ticks from the server
// update draft.timerEnd but nothing else — fingerprinting skips those renders.
function buildRenderHash(state) {
  const d = state.draft    || {};
  const m = state.match    || {};
  const p = state.players  || {};
  const s = state.settings || {};
  return JSON.stringify({
    picks:        d.picks,
    phase:        d.phase,
    step:         d.currentStep,
    blueSide:     d.blueSideTeam,
    banFirst:     d.banFirstTeam,
    sideChooser:  d.sideChooser,
    timerVisible: d.timerVisible,
    centerLogo:   s.draftCenterLogoUrl || d.centerLogoUrl,
    logoSet:      s.logoSet && s.logoSet.logos && s.logoSet.logos.map(function(l) { return l.url; }),
    phaseContrast:s.draftPhaseContrast,
    team1:        { name: m.team1 && m.team1.name, tag: m.team1 && m.team1.tag, logo: m.team1 && m.team1.logo, score: m.team1 && m.team1.score },
    team2:        { name: m.team2 && m.team2.name, tag: m.team2 && m.team2.tag, logo: m.team2 && m.team2.logo, score: m.team2 && m.team2.score },
    format:       m.format,
    gameNum:      m.currentGameNum,
    fearless:     m.fearlessDraft,
    t1RolePicks:  d.team1RolePicks,
    t2RolePicks:  d.team2RolePicks,
    players:      p,
    seriesGames:  m.seriesGames,
    tournLogo:    m.tournamentLogo,
  });
}

function buildFearlessHash(seriesGames, isFearless, blueSlot) {
  return JSON.stringify({ seriesGames: seriesGames, isFearless: isFearless, blueSlot: blueSlot });
}

// ── Main render ───────────────────────────────────────────────────────────────
function renderAll(state) {
  const draft    = state.draft    || {};
  const match    = state.match    || {};
  const players  = state.players  || {};
  const settings = state.settings || {};
  const picks    = draft.picks    || Array(20).fill('');

  // Skip full re-render when only timer fields changed (e.g. server tick updates timerEnd)
  const newHash = buildRenderHash(state);
  const introNeeded = !_introPlayed;
  const lifecycleNeeded = (draft.phase !== 'notstarted' && draft.phase !== 'complete') !== _draftWasActive
    || (draft.phase === 'complete' && _draftWasActive);
  if (newHash === _renderHash && !introNeeded && !lifecycleNeeded) return;
  _renderHash = newHash;

  const blueSlot     = draft.blueSideTeam || 'team1';
  const redSlot      = blueSlot === 'team1' ? 'team2' : 'team1';
  const blueTeam     = match[blueSlot] || {};
  const redTeam      = match[redSlot]  || {};
  const banFirstTeam = draft.banFirstTeam || 'blue';

  // When red bans first, the sequence roles ('blue'='first actor', 'red'='second actor')
  // are swapped relative to the physical sides — remap pick/ban index arrays accordingly.
  const bluePickIdx = banFirstTeam === 'blue' ? BLUE_PICK_IDX : RED_PICK_IDX;
  const redPickIdx  = banFirstTeam === 'blue' ? RED_PICK_IDX  : BLUE_PICK_IDX;
  const blueBanIdx  = banFirstTeam === 'blue' ? BLUE_BAN_IDX  : RED_BAN_IDX;
  const redBanIdx   = banFirstTeam === 'blue' ? RED_BAN_IDX   : BLUE_BAN_IDX;

  const phase   = draft.phase || 'notstarted';
  const rawStep = draft.currentStep || 0;
  const stepIdx = rawStep > 0 ? rawStep - 1 : 0;
  const draftActive = phase !== 'notstarted' && phase !== 'complete';
  const seq = (draftActive && stepIdx < 20) ? DRAFT_SEQUENCE[stepIdx] : null;
  // Map sequence role ('blue'=first actor / 'red'=second actor) to the physical side on screen.
  // Formula: seq.team === banFirstTeam → physical blue; otherwise physical red.
  const clockSide = seq ? (seq.team === banFirstTeam ? 'blue' : 'red') : null;

  // ── Team headers ─────────────────────────────────────────────────────────────
  setText('blue-name',  blueTeam.name || blueTeam.tag || 'BLUE');
  setText('red-name',   redTeam.name  || redTeam.tag  || 'RED');
  setText('blue-score', match[blueSlot] ? match[blueSlot].score : 0);
  setText('red-score',  match[redSlot]  ? match[redSlot].score  : 0);
  setBg('blue-logo', blueTeam.logo);
  setBg('red-logo',  redTeam.logo);

  // ── Bans in side panels ───────────────────────────────────────────────────────
  renderBanSlots('blue-bans', blueBanIdx, picks, 'blue');
  renderBanSlots('red-bans',  redBanIdx,  picks, 'red');

  // ── Series label ─────────────────────────────────────────────────────────────
  const formatNum = parseInt((match.format || 'Bo3').replace('Bo','')) || 3;
  setText('series-game',  'GAME ' + (match.currentGameNum || 1) + ' / ' + formatNum);
  setText('series-phase', PHASE_LABELS[phase] || '—');
  const seriesPhaseEl = document.getElementById('series-phase');
  const isBold = (settings.draftPhaseContrast || 'subtle') === 'bold';
  document.body.classList.toggle('phase-bold', isBold);

  // ── Side-choice + pick-order labels ──────────────────────────────────────────
  const sideChoiceEl = document.getElementById('side-choice-tag');
  const pickOrderEl  = document.getElementById('pick-order-tag');
  if (sideChoiceEl && pickOrderEl) {
    const sideChooser = draft.sideChooser || '';
    if (sideChooser) {
      const chooserTeam  = match[sideChooser] || {};
      const chooserTag   = chooserTeam.tag || chooserTeam.name || sideChooser.replace('team','T');
      const chosenSide   = sideChooser === blueSlot ? 'BLUE' : 'RED';
      const sideClass    = sideChooser === blueSlot ? 'series-choice-blue' : 'series-choice-red';
      const otherSlot    = sideChooser === 'team1' ? 'team2' : 'team1';
      const otherTeam    = match[otherSlot] || {};
      const otherTag     = otherTeam.tag || otherTeam.name || otherSlot.replace('team','T');
      const pickLabel    = (otherSlot === blueSlot ? 'blue' : 'red') === banFirstTeam ? '1ST PICK' : '2ND PICK';

      sideChoiceEl.textContent = chooserTag + ' CHOSE ' + chosenSide;
      sideChoiceEl.className   = 'series-choice-tag ' + sideClass;
      sideChoiceEl.style.display = '';
      pickOrderEl.textContent = otherTag + ' · ' + pickLabel;
      pickOrderEl.className   = 'series-choice-tag series-pick-tag series-choice-pick';
      pickOrderEl.style.display = '';

      // Trigger anim-fade-in on first reveal post-intro (intro handles it for pre-draft loads)
      if (_introPlayed && !sideChoiceEl.dataset.animShown) {
        sideChoiceEl.dataset.animShown = '1';
        pickOrderEl.dataset.animShown  = '1';
        _anim(sideChoiceEl, 'anim-fade-in', 825, 0);
        _anim(pickOrderEl,  'anim-fade-in', 825, 75);
      }
    } else {
      sideChoiceEl.style.display = 'none';
      pickOrderEl.style.display  = 'none';
      delete sideChoiceEl.dataset.animShown;
      delete pickOrderEl.dataset.animShown;
    }
  }

  // ── On-clock indicator (logo + team name in player bar centre) ───────────────
  updateClock(clockSide, seq, blueTeam, redTeam);

  // ── Timer ─────────────────────────────────────────────────────────────────────
  const timerRing = document.getElementById('timer-ring');
  const timerVal  = document.getElementById('timer-val');
  const showTimer = !!draft.timerVisible;
  // Ring is only shown by animateDraftStart (with draw animation) — never shown here.
  // Hide it when draft is not active or timer is disabled.
  if (timerRing && (!draftActive || !showTimer)) timerRing.style.display = 'none';
  // timer-val stays in layout flow at all times (display never toggled) to avoid
  // the flex recentre that shifts the logo row up when it appears.
  // Opacity is managed by runIntroAnimation (→0) and animateDraftStart (anim-slide-up-sm).
  if (!draft.timerEnd && _lastTimerEnd) {
    _lastTimerEnd = null;
    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
  }
  if (showTimer && draftActive && draft.timerEnd && draft.timerEnd !== _lastTimerEnd) {
    _lastTimerEnd = draft.timerEnd;
    _lastDuration = draft.timerDuration || 60;
    runTimer();
  }

  // ── Fearless bans ─────────────────────────────────────────────────────────────
  renderFearless(match.seriesGames || [], !!match.fearlessDraft, match, blueSlot);

  // ── Tournament logo ───────────────────────────────────────────────────────────
  // Priority: draft-specific override → first logo in library → match tournament logo
  const logoLibrary = (state.settings && state.settings.logoSet && state.settings.logoSet.logos) || [];
  const logoUrl = (settings && settings.draftCenterLogoUrl)
    || draft.centerLogoUrl  // backward compat with older saved state
    || (logoLibrary.length > 0 ? logoLibrary[0].url : '')
    || match.tournamentLogo || '';
  const logoEl = document.getElementById('tourn-logo');
  if (logoEl) logoEl.style.backgroundImage = logoUrl ? 'url(' + logoUrl + ')' : '';

  // ── Player bar ────────────────────────────────────────────────────────────────
  const bluePlayers = players[blueSlot]  || [];
  const redPlayers  = players[redSlot]   || [];
  // Prefer role-ordered picks after draft completes, fall back to draft order
  const blueRolePicks = (blueSlot === 'team1' ? draft.team1RolePicks : draft.team2RolePicks) || [];
  const redRolePicks  = (redSlot  === 'team1' ? draft.team1RolePicks : draft.team2RolePicks) || [];
  const bluePicks5 = bluePickIdx.map(i => picks[i] || '');
  const redPicks5  = redPickIdx.map( i => picks[i] || '');

  renderPlayerBar('players-blue', bluePlayers,
    blueRolePicks.length ? blueRolePicks : bluePicks5, 'blue');
  renderPlayerBar('players-red',  redPlayers,
    redRolePicks.length  ? redRolePicks  : redPicks5,  'red');

  // Intro animation fires once on first state; live reveals fire on subsequent updates
  if (!_introPlayed) runIntroAnimation(state);

  // Draft lifecycle animations
  if (draftActive && !_draftWasActive) animateDraftStart();
  if (!draftActive && _draftWasActive && phase === 'complete') animateDraftComplete();
  _draftWasActive = draftActive;
}

// ── Ban slot renderer ─────────────────────────────────────────────────────────
function renderBanSlots(containerId, idxMap, picks, side) {
  const el = document.getElementById(containerId);
  if (!el) return;

  // Build slots on first run
  if (el.children.length !== 5) {
    el.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const d = document.createElement('div');
      d.className = 'ban-slot empty-ban empty-ban-' + side;
      el.appendChild(d);
    }
  }

  idxMap.forEach((pickIdx, slotPos) => {
    const slot     = el.children[slotPos];
    const url      = picks[pickIdx] || '';
    const wasEmpty = slot.classList.contains('empty-ban');

    if (url) {
      slot.className = 'ban-slot filled-ban';
      let img     = slot.querySelector('.ban-img');
      let overlay = slot.querySelector('.ban-overlay');
      if (!img) {
        img = document.createElement('img');
        img.className = 'ban-img';
        img.onload = () => img.classList.add('loaded');
        slot.appendChild(img);
      }
      if (img.src !== url && !img.src.endsWith(url)) {
        img.classList.remove('loaded');
        img.onload = () => img.classList.add('loaded');
        img.src = url;
      }
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'ban-overlay';
        slot.appendChild(overlay);
      }
      if (wasEmpty && _introPlayed) animateBanReveal(slot);
    } else {
      slot.className = 'ban-slot empty-ban empty-ban-' + side;
      const img = slot.querySelector('.ban-img');
      if (img) img.remove();
      const ov  = slot.querySelector('.ban-overlay');
      if (ov)  ov.remove();
    }
  });
}

// Role order used for fearless columns — matches DRAFT_ROLES index in control.js
// (Top=0, Jungle=1, Mid=2, ADC/bot=3, Support=4)
const FEARLESS_ROLE_ORDER = ['top', 'jungle', 'mid', 'bot', 'support'];

// ── Fearless bans renderer ────────────────────────────────────────────────────
// CSS-grid layout: 5 role columns, one row per game.
// BYE games span all 5 columns so a single centred label appears across the full width.
function renderFearless(seriesGames, isFearless, match, currentBlueSlot) {
  const section = document.getElementById('fearless-section');
  const content = document.getElementById('fearless-content');
  if (!section || !content) return;

  const show = isFearless && seriesGames.length > 0;
  section.style.display = show ? 'block' : 'none';
  if (!show) return;

  const fHash = buildFearlessHash(seriesGames, isFearless, currentBlueSlot);
  if (fHash === _fearlessHash) return;
  _fearlessHash = fHash;

  content.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'fearless-grid';

  // Header row — one role icon per column
  FEARLESS_ROLE_ORDER.forEach(function(role) {
    const iconHdr = document.createElement('div');
    iconHdr.className = 'fearless-role-icon-hdr';
    const iconUrl = ROLE_ICONS[role] || '';
    if (iconUrl) iconHdr.style.backgroundImage = 'url(' + iconUrl + ')';
    grid.appendChild(iconHdr);
  });

  // One row per game — BYE spans full width, normal games add 5 cells
  seriesGames.forEach(function(game, gi) {
    if (game.isBye) {
      const winnerSlot   = game.winner || '';
      const winnerIsBlue = winnerSlot === (currentBlueSlot || 'team1');
      const side         = winnerIsBlue ? 'blue' : 'red';
      const winnerTeam  = match && winnerSlot ? (match[winnerSlot] || {}) : {};
      const tag         = winnerTeam.tag || winnerTeam.name || '';

      const byeEl = document.createElement('div');
      byeEl.className = 'fearless-bye-row';
      byeEl.dataset.gameIdx = String(gi);
      byeEl.dataset.side    = side;
      byeEl.textContent     = tag ? tag + ' BYE' : 'BYE';
      grid.appendChild(byeEl);
    } else {
      const hasRoles = (game.t1RolePicks || []).some(Boolean) || (game.t2RolePicks || []).some(Boolean);
      FEARLESS_ROLE_ORDER.forEach(function(role, ri) {
        const pair = document.createElement('div');
        pair.className = 'fearless-game-pair';
        pair.dataset.gameIdx = String(gi);
        const t1Url = hasRoles ? ((game.t1RolePicks || [])[ri] || '') : ((game.t1Picks || [])[ri] || '');
        const t2Url = hasRoles ? ((game.t2RolePicks || [])[ri] || '') : ((game.t2Picks || [])[ri] || '');
        [t1Url, t2Url].forEach(function(url) {
          const icon = document.createElement('div');
          icon.className = 'fearless-icon';
          if (url) icon.style.backgroundImage = 'url(' + url + ')';
          pair.appendChild(icon);
        });
        grid.appendChild(pair);
      });
    }
  });

  content.appendChild(grid);
}

// ── On-clock indicator ────────────────────────────────────────────────────────
function updateClock(clockSide, seq, blueTeam, redTeam) {
  const centerEl = document.getElementById('clock-center');
  const logoEl   = document.getElementById('tourn-logo');
  const arrowL   = document.getElementById('clock-arrow-l');
  const arrowR   = document.getElementById('clock-arrow-r');
  const blueHdr  = document.getElementById('blue-header');
  const redHdr   = document.getElementById('red-header');

  if (blueHdr) blueHdr.classList.remove('on-clock');
  if (redHdr)  redHdr.classList.remove('on-clock');

  if (!clockSide || !seq) {
    if (centerEl) centerEl.className = 'clock-center';
    if (logoEl)   logoEl.className   = 'tourn-logo';
    if (arrowL) arrowL.classList.remove('show', 'hide');
    if (arrowR) arrowR.classList.remove('show', 'hide');
    document.documentElement.style.removeProperty('--clock-color');
    return;
  }

  const isBlue = clockSide === 'blue';
  const cssVar = isBlue ? '--gfx-blue' : '--gfx-red';
  const color  = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();

  document.documentElement.style.setProperty('--clock-color', color);

  if (centerEl) centerEl.className = 'clock-center active-' + clockSide;
  if (logoEl)   logoEl.className   = 'tourn-logo side-' + clockSide;

  // ◀ active (bright) when blue on clock, hidden when red; ▶ vice-versa
  if (arrowL) { arrowL.classList.toggle('show', isBlue);  arrowL.classList.toggle('hide', !isBlue);  }
  if (arrowR) { arrowR.classList.toggle('show', !isBlue); arrowR.classList.toggle('hide', isBlue);   }

  const activeHdr = isBlue ? blueHdr : redHdr;
  if (activeHdr) activeHdr.classList.add('on-clock');
}

// ── Player bar renderer ───────────────────────────────────────────────────────
function renderPlayerBar(containerId, players, picks5, side) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const slots = Array.from({length: 5}, (_, i) => players[i] || {handle:'', name:'', role:''});

  if (el.children.length !== 5) {
    el.innerHTML = '';
    slots.forEach((p, i) => el.appendChild(makePlayerCard(p, picks5[i] || '', side)));
    return;
  }

  // Update in place
  const swapQueue = []; // collects role-swap cards so we can sort and stagger after the loop
  slots.forEach((p, i) => {
    const card    = el.children[i];
    const bg      = card.querySelector('.player-bg');
    const nameEl  = card.querySelector('.player-name');
    const roleEl  = card.querySelector('.player-role-icon');
    const url     = picks5[i] || '';

    if (bg) {
      if (url) {
        const wasEmpty = bg.classList.contains('no-champ');
        const prevUrl  = bg.dataset.champUrl || '';
        const isSwap   = !wasEmpty && prevUrl && prevUrl !== url;
        bg.style.backgroundImage = 'url(' + url + ')';
        bg.dataset.champUrl = url;
        bg.classList.remove('no-champ');
        if (wasEmpty && _introPlayed) animatePickReveal(bg);
        else if (isSwap && _introPlayed) swapQueue.push({ bg, i, prevUrl });
      } else {
        bg.dataset.swapGen = (parseInt(bg.dataset.swapGen) || 0) + 1; // invalidate pending onSwapExit
        bg.style.animation = 'none';
        bg.style.backgroundImage = '';
        bg.dataset.champUrl = '';
        bg.classList.add('no-champ');
      }
    }
    if (nameEl) nameEl.textContent = p.handle || p.name || '';
    if (roleEl) {
      const icon = ROLE_ICONS[(p.role || '').toLowerCase()] || '';
      roleEl.style.backgroundImage = icon ? 'url(' + icon + ')' : '';
      roleEl.style.display = icon ? 'block' : 'none';
    }
  });

  // Animate swaps after collecting: sort outer-to-inner, assign consecutive delays
  if (swapQueue.length) {
    swapQueue.sort((a, b) => side === 'blue' ? a.i - b.i : b.i - a.i);
    swapQueue.forEach(({ bg, prevUrl }, order) => animateRoleSwap(bg, order * 120, prevUrl));
  }
}

function makePlayerCard(player, champUrl, side) {
  const card = document.createElement('div');
  card.className = 'player-card side-' + side;

  const bg = document.createElement('div');
  bg.className = 'player-bg' + (champUrl ? '' : ' no-champ');
  if (champUrl) { bg.style.backgroundImage = 'url(' + champUrl + ')'; bg.dataset.champUrl = champUrl; }
  card.appendChild(bg);

  const info = document.createElement('div');
  info.className = 'player-info';

  const icon = ROLE_ICONS[(player.role || '').toLowerCase()] || '';
  const roleEl = document.createElement('div');
  roleEl.className = 'player-role-icon';
  if (icon) { roleEl.style.backgroundImage = 'url(' + icon + ')'; }
  else { roleEl.style.display = 'none'; }
  info.appendChild(roleEl);

  const nameEl = document.createElement('span');
  nameEl.className = 'player-name';
  nameEl.textContent = player.handle || player.name || '';
  info.appendChild(nameEl);

  card.appendChild(info);
  return card;
}

// ── Timer countdown ───────────────────────────────────────────────────────────
function runTimer() {
  if (_timerInterval) clearInterval(_timerInterval);
  _timerInterval = setInterval(() => {
    if (!_lastTimerEnd) { clearInterval(_timerInterval); return; }
    const rem      = Math.max(0, _lastTimerEnd - Date.now());
    const secs     = Math.ceil(rem / 1000);
    const fraction = rem / (_lastDuration * 1000);
    const valEl    = document.getElementById('timer-val');
    const arcEl    = document.getElementById('timer-arc');
    if (valEl) valEl.textContent = secs;
    if (arcEl) {
      arcEl.style.strokeDasharray  = TIMER_CIRC;
      arcEl.style.strokeDashoffset = TIMER_CIRC * (Math.max(0, Math.min(1, fraction)) - 1);
      const f = Math.max(0, Math.min(1, fraction));
      const r = f > 0.5 ? Math.round(255 * (2 - 2*f)) : 255;
      const g = f > 0.5 ? 155 : Math.round(155 * 2*f);
      arcEl.style.stroke = 'rgb(' + r + ',' + g + ',35)';
    }
    if (rem <= 0) clearInterval(_timerInterval);
  }, 100);
}

// ── Animation helpers ─────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

function _anim(el, keyframe, durationMs, delayMs, ease) {
  if (!el) return;
  el.style.animation = `${keyframe} ${durationMs}ms ${ease || 'cubic-bezier(0.25,0.46,0.45,0.94)'} ${delayMs}ms both`;
}

function animatePickReveal(bg) {
  bg.style.animation = 'none';
  void bg.offsetWidth;
  bg.style.animation = 'anim-slide-up 0.42s cubic-bezier(0.25,0.46,0.45,0.94) both';
}

function animateBanReveal(slot) {
  slot.style.animation = 'none';
  void slot.offsetWidth;
  slot.style.animation = 'anim-ban-reveal 0.32s ease both';
}

function animateRoleSwap(bg, delayMs, prevUrl) {
  delayMs = delayMs || 0;
  const gen    = ((parseInt(bg.dataset.swapGen) || 0) + 1);
  bg.dataset.swapGen = gen;

  const newUrl = bg.style.backgroundImage;
  const oldUrl = prevUrl ? 'url(' + prevUrl + ')' : '';

  bg.style.backgroundImage = oldUrl;
  bg.style.animation = 'none';
  void bg.offsetWidth;
  bg.style.animation = 'anim-role-exit 220ms cubic-bezier(0.5,0,1,0.85) ' + delayMs + 'ms both';

  function onSwapExit(e) {
    if (e.animationName !== 'anim-role-exit') return;
    bg.removeEventListener('animationend', onSwapExit);
    if (parseInt(bg.dataset.swapGen) !== gen) return; // reset arrived — discard
    bg.style.backgroundImage = newUrl;
    bg.style.animation = 'anim-role-enter 530ms cubic-bezier(0,0,0.08,1) both';
  }
  bg.addEventListener('animationend', onSwapExit);
}

function animateDraftComplete() {
  const E = 'cubic-bezier(0.25,0.46,0.45,0.94)';
  const phaseEl    = $('series-phase');
  const timerValEl = $('timer-val');
  const timerRing  = $('timer-ring');
  const logoEl     = $('tourn-logo');

  // Stop the countdown immediately
  if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }

  // Clear stale animations + single reflow before applying exit animations
  [phaseEl, timerValEl, timerRing, logoEl].filter(Boolean).forEach(el => { el.style.animation = 'none'; });
  void document.getElementById('draft-root').offsetWidth;

  if (phaseEl)    _anim(phaseEl,    'anim-fade-out',        400,  0,   E);
  if (timerValEl && timerValEl.style.display !== 'none') {
    _anim(timerValEl, 'anim-slide-down-sm', 400, 100, E);
  }
  if (timerRing && timerRing.style.display !== 'none') {
    _anim(timerRing, 'anim-fade-out', 500, 150);
  }
  // Logo grows slightly to mark completion — spring easing for a satisfying pop
  if (logoEl) {
    logoEl.className = 'tourn-logo'; // clear any side-specific pulse class
    _anim(logoEl, 'anim-logo-complete', 700, 350, 'cubic-bezier(0.34,1.56,0.64,1)');
  }
}

// ── Intro animation ───────────────────────────────────────────────────────────
// All delays set upfront; fill-mode:backwards (in 'both') keeps elements in their
// from-state until each delay fires — no visible flash on load.
// Arrows, phase text, timer value and timer arc are intentionally excluded:
// they appear only when the draft actually starts via animateDraftStart().
function runIntroAnimation(state) {
  _introPlayed = true;
  const E  = 'cubic-bezier(0.25,0.46,0.45,0.94)';
  const Eh = 'cubic-bezier(0.16,1,0.3,1)';     // expo-out for panel slides
  const Es = 'cubic-bezier(0.34,1.56,0.64,1)'; // spring for logo

  // Clear all previously-animated elements so the intro can restart cleanly.
  // Setting animation:'none' then forcing one reflow lets new animations restart from scratch.
  // Cancel any pending logo-expand timeout from a previous intro
  if (_logoExpandTimeout) { clearTimeout(_logoExpandTimeout); _logoExpandTimeout = null; }
  _logoIsExpanded = false;

  // Reset animShown flags so choice tags re-animate if intro replays
  [$('side-choice-tag'), $('pick-order-tag')].forEach(function(el) {
    if (el) delete el.dataset.animShown;
  });

  const toReset = [
    $('blue-header'), $('blue-bans'), $('red-header'), $('red-bans'),
    $('tourn-logo'), $('timer-ring'), $('timer-track'), $('series-game'),
    $('series-phase'), $('timer-val'), $('timer-arc'),
    $('side-choice-tag'), $('pick-order-tag'),
    ...document.querySelectorAll('.player-bg, .player-name, .player-role-icon, .fearless-game-pair, .fearless-bye-row, .fearless-role-icon-hdr, .team-logo, .team-name, .team-score'),
    document.querySelector('.fearless-label'),
  ].filter(Boolean);
  toReset.forEach(el => { el.style.animation = 'none'; el.style.transform = ''; });
  void document.getElementById('draft-root').offsetWidth; // single forced reflow

  // Hide draft-start elements until animateDraftStart() fires
  const phaseEl    = $('series-phase');
  const timerValEl = $('timer-val');
  const timerArcEl = $('timer-arc');
  if (phaseEl)    phaseEl.style.opacity    = '0';
  if (timerValEl) timerValEl.style.opacity = '0';
  if (timerArcEl) timerArcEl.style.opacity = '0';

  // ── Phase 1 (t=0): Side panels slide in, player card bgs slide up ─────────
  // Headers use expo-out easing for a confident deceleration
  _anim($('blue-header'), 'anim-slide-left',  1300, 0,   Eh);
  _anim($('blue-bans'),   'anim-slide-left',  1000, 200, E);
  _anim($('red-header'),  'anim-slide-right', 1300, 0,   Eh);
  _anim($('red-bans'),    'anim-slide-right', 1000, 200, E);

  // Team name text, logo and score fade in once the header panel is underway
  ['blue-header', 'red-header'].forEach(id => {
    const hdr = $(id);
    if (!hdr) return;
    ['.team-logo', '.team-name', '.team-score'].forEach(sel => {
      const el = hdr.querySelector(sel);
      if (el) _anim(el, 'anim-fade-in', 550, 420);
    });
  });

  // Both sides fan from outermost card inward.
  // Blue: outer = index 0 (left edge), stagger increases left→right.
  // Red:  outer = index 4 (right edge), stagger increases right→left.
  ['players-blue', 'players-red'].forEach((id, sideIdx) => {
    const side = $(id);
    if (!side) return;
    const cards = Array.from(side.children);
    cards.forEach((card, i) => {
      const stagger = sideIdx === 0 ? i : (cards.length - 1 - i);
      const bg = card.querySelector('.player-bg');
      if (bg) _anim(bg, 'anim-slide-up', 1100, stagger * 180, E);
    });
  });

  // ── Phase 2 (t=975): Player names ─────────────────────────────────────────
  document.querySelectorAll('.player-name').forEach(el => _anim(el, 'anim-fade-in', 750, 975));

  // ── Phase 3 (t=1350): Role icons ──────────────────────────────────────────
  document.querySelectorAll('.player-role-icon').forEach(el => {
    if (el.style.display !== 'none') _anim(el, 'anim-fade-in', 675, 1350);
  });

  // ── Phase 4 (t=1650): Logo scale-in — ring stays hidden until draft starts ──
  _anim($('tourn-logo'), 'anim-scale-in', 900, 1650, Es);
  // After scale-in ends, expand logo to pre-draft large state (if draft hasn't started)
  _logoExpandTimeout = setTimeout(function() {
    _logoExpandTimeout = null;
    const logoEl = $('tourn-logo');
    if (logoEl && !_draftWasActive) {
      // Release anim-scale-in fill-mode, then play explicit expand keyframe
      logoEl.style.animation = 'none';
      void logoEl.offsetWidth; // commit scale(1) so anim-logo-expand's from: matches
      _anim(logoEl, 'anim-logo-expand', 700, 0, 'cubic-bezier(0.2, 0, 0.2, 1)');
      _logoIsExpanded = true;
    }
  }, 2600); // 1650ms delay + 900ms duration + 50ms buffer

  // ── Phase 5 (t=2175): Game number + side-choice tags (staggered) ────────────
  _anim($('series-game'),    'anim-fade-in', 825, 2175);
  // Choice tags fade in just after series-game, same animation
  if (state.draft && state.draft.sideChooser) {
    const sc = $('side-choice-tag'), po = $('pick-order-tag');
    _anim(sc, 'anim-fade-in', 825, 2275); // 100ms after series-game
    _anim(po, 'anim-fade-in', 825, 2350); // 75ms after side-choice
    if (sc) sc.dataset.animShown = '1';
    if (po) po.dataset.animShown = '1';
  }

  // ── Phase 6 (t=2625): Fearless rows — bottom row first, 240ms between rows ─
  const fearlessSection = $('fearless-section');
  if (fearlessSection && fearlessSection.style.display !== 'none') {
    const label = fearlessSection.querySelector('.fearless-label');
    if (label) _anim(label, 'anim-fade-in', 750, 2625);

    // Role icons fade in with the label.
    // After the animation ends we clear the fill-mode lock so CSS (body.phase-bold)
    // can control opacity freely without the animation value overriding it.
    fearlessSection.querySelectorAll('.fearless-role-icon-hdr').forEach(function(el) {
      _anim(el, 'anim-fade-in', 600, 2700);
      el.addEventListener('animationend', function onIconReveal(e) {
        if (e.animationName !== 'anim-fade-in') return;
        el.removeEventListener('animationend', onIconReveal);
        el.style.animation = ''; // release fill-mode; CSS opacity rule takes over
      });
    });

    // Game pairs staggered bottom-to-top: collect unique game indices then animate
    const allPairs = Array.from(fearlessSection.querySelectorAll('.fearless-game-pair, .fearless-bye-row'));
    const gameIndices = [...new Set(allPairs.map(p => parseInt(p.dataset.gameIdx || '0')))].sort((a, b) => a - b);
    gameIndices.forEach(gi => {
      const revealOrder = gameIndices.length - 1 - gi; // newest game (highest gi) = 0 (first)
      const pairDelay   = 2800 + revealOrder * 200;
      fearlessSection.querySelectorAll(`.fearless-game-pair[data-game-idx="${gi}"], .fearless-bye-row[data-game-idx="${gi}"]`).forEach(pair => {
        _anim(pair, 'anim-fade-in', 550, pairDelay, E);
      });
    });
  }
}

// ── Draft-start animation — fires when phase transitions from notstarted → active ──
function animateDraftStart() {
  const E = 'cubic-bezier(0.25,0.46,0.45,0.94)';
  const phaseEl    = $('series-phase');
  const timerArcEl = $('timer-arc');
  const timerValEl = $('timer-val');
  const timerRing  = $('timer-ring');
  const timerTrack = $('timer-track');
  const logoEl     = $('tourn-logo');

  // Cancel any pending logo-expand (draft started before intro fully played)
  if (_logoExpandTimeout) { clearTimeout(_logoExpandTimeout); _logoExpandTimeout = null; }

  // Clear stale animations + single reflow
  [phaseEl, timerArcEl, timerValEl, timerTrack].filter(Boolean).forEach(el => { el.style.animation = 'none'; });
  void (phaseEl || timerArcEl || timerValEl || document.body).offsetWidth;

  // Show the ring SVG container now that the draft is starting
  if (timerRing) timerRing.style.display = '';

  // Track: clockwise draw from 12 o'clock
  if (timerTrack) _anim(timerTrack, 'ring-track-draw', 1800, 0, 'cubic-bezier(0.4, 0, 0.15, 1)');

  // Arc: CCW sweep reveal — draws counter-clockwise from 12 o'clock
  // Uses fill-mode:forwards so it holds opacity:1 / dashoffset:0 after completing.
  // animationend handler then releases the fill-mode lock so runTimer() can update dashoffset.
  if (timerArcEl) {
    timerArcEl.style.animation = 'arc-reveal-ccw 1000ms cubic-bezier(0.4, 0, 0.15, 1) 350ms forwards';
    timerArcEl.addEventListener('animationend', function onArcReveal(e) {
      if (e.animationName !== 'arc-reveal-ccw') return;
      timerArcEl.removeEventListener('animationend', onArcReveal);
      // Snapshot the current countdown position before clearing animation
      const f = (_lastTimerEnd && _lastDuration)
        ? Math.max(0, Math.min(1, (_lastTimerEnd - Date.now()) / (_lastDuration * 1000)))
        : 1;
      timerArcEl.style.strokeDasharray  = String(TIMER_CIRC);
      timerArcEl.style.strokeDashoffset = String(TIMER_CIRC * (f - 1));
      timerArcEl.style.opacity = '1';
      timerArcEl.style.animation = ''; // release fill-mode; runTimer() resumes control
    });
  }

  // Phase text: expand from center
  if (phaseEl) _anim(phaseEl, 'anim-reveal-center', 900, 0, E);

  // Timer value: slide up (always in DOM flow — opacity-only reveal)
  if (timerValEl) _anim(timerValEl, 'anim-slide-up-sm', 800, 300, E);

  // Logo: replace expand animation directly with contract — no 'animation:none' between them.
  // Clearing the animation first drops the fill-mode lock (scale 1.5 → scale 1 snap)
  // which then makes the contract jump up on its first frame. Replacing inline keeps
  // the scale(1.5) fill-state continuous into the contract's from{scale(1.5)}.
  if (logoEl && _logoIsExpanded) {
    _anim(logoEl, 'anim-logo-contract', 1400, 0, 'cubic-bezier(0.2, 0, 0.2, 1)');
    _logoIsExpanded = false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val != null ? String(val) : '';
}
function setBg(id, url) {
  const el = document.getElementById(id);
  if (el) el.style.backgroundImage = url ? 'url(' + url + ')' : '';
}
