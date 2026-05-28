// Tournament Structure Overlay
var _gfxToken = new URLSearchParams(window.location.search).get('token') || '';
var socket = io({ auth: { token: _gfxToken }, query: { token: _gfxToken } });

var _visible        = false;
var _outTimer       = null;
var _inTimer        = null;
var _structureHash  = '';

function $(id) { return document.getElementById(id); }
function _eH(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Helpers ───────────────────────────────────────────────────────────────────
function stageFormat(stg, key, fallback) {
  return ((stg || {})[key] || { format: fallback }).format || fallback;
}

function arrowHtml() {
  return (
    '<div class="ts-h-arrow">' +
      '<div class="ts-h-arrow-line"></div>' +
      '<div class="ts-h-arrow-head">&#9658;</div>' +
    '</div>'
  );
}

// Stage card: name at top, optional subtitle, detail rows below separator
function stageCardHtml(cfg) {
  var detailsHtml = '';
  (cfg.details || []).forEach(function(d) {
    var cls = 'ts-detail-row';
    if (d.wide) cls += ' ts-detail-wide';
    if (d.gf)   cls += ' ts-detail-gf';
    detailsHtml +=
      '<div class="' + cls + '">' +
        '<span class="ts-detail-lbl">' + _eH(d.label) + '</span>' +
        '<span class="ts-detail-val">' + _eH(d.value) + '</span>' +
      '</div>';
  });
  return (
    '<div class="ts-stage ts-type-' + _eH(cfg.type) + '">' +
      '<div class="ts-stage-body">' +
        '<div class="ts-stage-name">' + _eH(cfg.label) + '</div>' +
        (cfg.sub ? '<div class="ts-stage-sub">' + _eH(cfg.sub) + '</div>' : '') +
      '</div>' +
      (detailsHtml ? '<div class="ts-stage-details">' + detailsHtml + '</div>' : '') +
    '</div>'
  );
}

// ── Layout: Group Stage (optional) → Playoffs ─────────────────────────────────
// Grand Final format is a highlighted row inside the Playoffs card.
// sidePillsHtml: when set, pills are rendered as a vertical column beside the solo Playoffs card.
function buildLayout(t, sidePillsHtml) {
  var stg   = t.stages || {};
  var hasGrp = !!t.hasGroupStage;
  var isDE   = t.playoffFormat === 'doubleElim';
  var gfFmt  = stageFormat(stg, 'grandFinals', 'Bo5');

  var cards = '';

  // Group Stage card
  if (hasGrp) {
    var grpDetails = [];
    if (t.numGroups)          grpDetails.push({ label: 'Groups',  value: String(t.numGroups) });
    if (t.qualifiersPerGroup) grpDetails.push({ label: 'Advance', value: 'Top ' + t.qualifiersPerGroup });
    grpDetails.push({ label: 'Format', value: stageFormat(stg, 'groupStage', 'Bo3') });
    if (t.showTiebreaker && t.tiebreaker) grpDetails.push({ label: 'Tiebreaker', value: t.tiebreaker });
    cards += stageCardHtml({ type: 'group', label: 'Group Stage', sub: 'Round Robin', details: grpDetails });
    cards += arrowHtml();
  }

  // Playoffs card — contains all bracket stage formats, Grand Final highlighted at bottom
  var poDetails = [];
  if (isDE) {
    poDetails.push({ label: 'Upper Bracket', value: stageFormat(stg, 'upperBracket',      'Bo3') });
    poDetails.push({ label: 'Lower Bracket', value: stageFormat(stg, 'lowerBracket',      'Bo3') });
    poDetails.push({ label: 'Lower Bracket Final', value: stageFormat(stg, 'lowerBracketFinal', 'Bo5') });
  } else {
    poDetails.push({ label: 'Format', value: stageFormat(stg, 'quarterfinals', 'Bo3') });
    if (t.thirdPlaceMatch) poDetails.push({ label: '3rd Place', value: stageFormat(stg, 'thirdPlace', 'Bo3') });
  }
  // Grand Final always shown as the highlighted final row
  poDetails.push({ label: 'Grand Final', value: gfFmt, gf: true });

  cards += stageCardHtml({
    type:    'playoffs',
    label:   'Playoffs',
    sub:     isDE ? 'Double Elimination' : 'Single Elimination',
    details: poDetails
  });

  // Solo layout: pills alongside card, or centred card alone if no pills
  if (!hasGrp) {
    if (sidePillsHtml) {
      return (
        '<div class="ts-solo-wrap">' +
          '<div class="ts-stage-row">' + cards + '</div>' +
          '<div class="ts-solo-pills">' + sidePillsHtml + '</div>' +
        '</div>'
      );
    }
    return '<div class="ts-stage-row ts-stage-row-solo">' + cards + '</div>';
  }

  return '<div class="ts-stage-row">' + cards + '</div>';
}

// ── Date formatting ───────────────────────────────────────────────────────────
// Parses YYYY-MM-DD (from date picker) and formats according to preference.
// Falls back to returning the raw string so legacy text entries still display.
function formatDate(s, fmt, withYear) {
  if (!s) return '';
  var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  var mon  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var monF = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var yr = m[1];
  var mi = parseInt(m[2], 10) - 1;
  var d  = parseInt(m[3], 10);
  var base;
  if (fmt === 'dmon')     base = d + ' ' + mon[mi];
  else if (fmt === 'mondfull') base = monF[mi] + ' ' + d;
  else if (fmt === 'ddmm') base = m[3] + '/' + m[2];
  else base = mon[mi] + ' ' + d;  // 'mond': Jan 1
  return withYear ? base + ' ' + yr : base;
}

// ── Info pills ────────────────────────────────────────────────────────────────
function pillHtml(label, value, wide) {
  return (
    '<div class="ts-pill' + (wide ? ' ts-pill-wide' : '') + '">' +
      '<span class="ts-pill-lbl">' + _eH(label) + '</span>' +
      '<span class="ts-pill-val">' + _eH(String(value)) + '</span>' +
    '</div>'
  );
}

// Builds the pills HTML string — used by both the info bar and the solo side panel
function buildPillsHtml(t, ts, teams) {
  var pills = '';

  var teamCount = t.totalTeams || (teams && teams.length) || 0;
  var players   = t.playersPerTeam != null ? t.playersPerTeam : 5;
  var subs      = t.maxSubsPerTeam != null ? t.maxSubsPerTeam : 0;
  var rosterStr = players + ' Player' + (players !== 1 ? 's' : '');
  if (subs > 0) rosterStr += ' + ' + subs + ' Sub' + (subs !== 1 ? 's' : '');
  if (teamCount) {
    pills += pillHtml('Rosters', teamCount + ' Teams · ' + rosterStr);
  } else if (players !== 5 || subs > 0) {
    // Only show roster pill when something non-default has been set
    pills += pillHtml('Rosters', rosterStr);
  }

  if (t.showDates && (t.startDate || t.endDate)) {
    var dfmt = ts.dateFormat || 'mond';
    var yr1 = t.startDate && String(t.startDate).match(/^(\d{4})-/);
    var yr2 = t.endDate   && String(t.endDate).match(/^(\d{4})-/);
    var crossYear = !!(yr1 && yr2 && yr1[1] !== yr2[1]);
    var withYear  = !!(ts.showYear && crossYear);
    var d1 = formatDate(t.startDate, dfmt, withYear);
    var d2 = formatDate(t.endDate,   dfmt, withYear);
    var dateVal = (d1 && d2 && d1 !== d2) ? d1 + ' – ' + d2 : (d1 || d2);
    if (dateVal) pills += pillHtml('Dates', dateVal);
  }
  if (t.showRegion   && t.region)       pills += pillHtml('Region',   t.region);
  if (t.showPatch    && t.patchVersion) pills += pillHtml('Patch',    t.patchVersion);
  if (t.showLocation && t.location)     pills += pillHtml('Location', t.location);

  return pills;
}

// ── Full render ───────────────────────────────────────────────────────────────
function renderStructure(state) {
  var t    = state.tournament          || {};
  var ts   = state.tournamentStructure || {};
  var root = $('ts-root');
  if (!root) return;

  // Logo
  var logoImg   = $('ts-logo');
  var logoUrl   = t.logo || (state.match && state.match.tournamentLogo) || '';
  var logoShown = !!(ts.showLogo && logoUrl);
  if (logoImg) {
    if (logoShown) { logoImg.src = logoUrl; logoImg.style.display = ''; }
    else           { logoImg.style.display = 'none'; }
  }
  root.style.setProperty('--ts-logo-h', (ts.logoScale != null ? ts.logoScale : 7) + 'vh');
  root.classList.toggle('logo-center',  ts.logoPosition === 'center');
  root.classList.toggle('has-logo',     logoShown);
  var isSolo = !t.hasGroupStage;
  // info-center only applies when pills are in the horizontal bar (group stage layout)
  root.classList.toggle('info-center', !isSolo && ts.infoBarAlign === 'center');

  // Display title
  var titleEl = $('ts-title');
  if (titleEl) {
    var title = (ts.showTitle && ts.displayTitle) ? ts.displayTitle.trim() : '';
    titleEl.textContent = title.toUpperCase();
    titleEl.style.display = title ? '' : 'none';
  }

  // Pills — shown above cards with group stage; moved to side panel when solo
  var pillsHtml = buildPillsHtml(t, ts, state.teams);
  var infoBar = $('ts-info-bar');
  if (infoBar) {
    if (isSolo) {
      infoBar.innerHTML = '';
      infoBar.style.display = 'none';
    } else {
      infoBar.innerHTML     = pillsHtml;
      infoBar.style.display = pillsHtml ? '' : 'none';
    }
  }

  // Stage cards (solo layout passes pills to sit alongside the card)
  var stagesEl = $('ts-stages');
  if (!stagesEl) return;
  stagesEl.innerHTML = buildLayout(t, isSolo ? pillsHtml : null);
}

// ── Animation ─────────────────────────────────────────────────────────────────
function animateIn() {
  var root = $('ts-root');
  if (!root) return;
  if (_outTimer) { clearTimeout(_outTimer); root.classList.remove('ts-exiting'); _outTimer = null; }

  root.style.display = '';
  void root.offsetWidth;

  var animEls = Array.from(root.querySelectorAll('.ts-stage'));
  animEls.forEach(function(el, i) {
    el.style.animationDelay = (0.12 + i * 0.1) + 's';
  });

  root.classList.add('ts-entering');
  if (_inTimer) clearTimeout(_inTimer);
  _inTimer = setTimeout(function() {
    root.classList.remove('ts-entering');
    animEls.forEach(function(el) { el.style.animationDelay = ''; });
    _inTimer = null;
  }, (0.12 + animEls.length * 0.1 + 0.5) * 1000);
}

function animateOut() {
  var root = $('ts-root');
  if (!root) return;
  if (_inTimer) {
    clearTimeout(_inTimer);
    root.classList.remove('ts-entering');
    root.querySelectorAll('.ts-stage').forEach(function(el) { el.style.animationDelay = ''; });
    _inTimer = null;
  }
  root.classList.add('ts-exiting');
  if (_outTimer) clearTimeout(_outTimer);
  _outTimer = setTimeout(function() {
    root.classList.remove('ts-exiting');
    root.style.display = 'none';
    _outTimer = null;
  }, 500);
}

// ── Data fingerprint ──────────────────────────────────────────────────────────
function tournamentStructureHash(state) {
  var t  = state.tournament          || {};
  var ts = state.tournamentStructure || {};
  return JSON.stringify({
    hasGrp:  t.hasGroupStage,
    numGrps: t.numGroups,
    qualN:   t.qualifiersPerGroup,
    format:  t.playoffFormat,
    tp3:     t.thirdPlaceMatch,
    stages:  t.stages,
    teams:   t.totalTeams || (state.teams && state.teams.length),
    ppt:     t.playersPerTeam,
    subs:    t.maxSubsPerTeam,
    dates:   t.showDates, start: t.startDate, end: t.endDate,
    region:  t.showRegion && t.region,
    patch:   t.showPatch  && t.patchVersion,
    loc:     t.showLocation && t.location,
    tie:     t.showTiebreaker && t.tiebreaker,
    logo:    t.logo || (state.match && state.match.tournamentLogo),
    ts:      ts
  });
}

// ── Socket ────────────────────────────────────────────────────────────────────
socket.on('connect', function() { _visible = false; });

socket.on('state', function(state) {
  GfxSettings.applyTheme(document.documentElement, state);
  GfxSettings.applyBackground(document.body, state);

  var ts      = state.tournamentStructure || {};
  var visible = !!ts.visible;
  var hash    = tournamentStructureHash(state);

  if (visible && !_visible) {
    _visible = true;
    _structureHash = hash;
    renderStructure(state);
    animateIn();
  } else if (!visible && _visible) {
    _visible = false;
    animateOut();
  } else if (hash !== _structureHash) {
    _structureHash = hash;
    renderStructure(state);
  }
});
