// Hero Draft overlay (Dota 2 Captains Mode) — hero-draft.js
var _token = new URLSearchParams(location.search).get('token') || '';
var socket = io({ auth: { token: _token }, query: { token: _token } });

var _visible = null, _hideTimer = null, _enterTimer = null;
function $(id){ return document.getElementById(id); }
function norm(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,''); }

// ── Hero art: name → portrait, from the /api/heroes manifest (token-gated) ───────
var _heroImg = {};
(function loadHeroes(){
  fetch('/api/heroes' + (_token ? ('?token=' + encodeURIComponent(_token)) : ''))
    .then(function(r){ return r.json(); })
    .then(function(d){ (d.heroes || []).forEach(function(h){ _heroImg[norm(h.name)] = h.img; }); if (_lastState) render(_lastState); })
    .catch(function(){});
})();
function heroArt(name){ return name ? (_heroImg[norm(name)] || '') : ''; }

// ── Data ─────────────────────────────────────────────────────────────────────
function teamMeta(m, key){ var t=(m&&m[key])||{}; return { name: t.name || (key==='team1'?'RADIANT':'DIRE'), tag: t.tag||'', logo: t.logo||'', score: t.score|0 }; }
// Steps for one team + action, carrying the global step index (for the on-clock highlight).
function slotsFor(steps, team, action){
  var out=[]; (steps||[]).forEach(function(s,i){ if(s && s.team===team && s.action===action) out.push({ idx:i, hero:s.hero||'', img:s.img||'' }); }); return out;
}
function slotArt(e){ return e.img || heroArt(e.hero); }

// ── Slot rendering (build once per count, then update src + active) ──────────────
function renderBans(container, entries, cur){
  if (container._n !== entries.length) {
    container._n = entries.length;
    container.innerHTML = entries.map(function(){ return '<div class="ban-slot empty"><img alt=""><div class="ban-x" style="display:none"></div></div>'; }).join('');
  }
  var slots = container.children;
  entries.forEach(function(e,i){
    var slot=slots[i]; if(!slot) return;
    var img=slot.querySelector('img'), x=slot.querySelector('.ban-x'), art=slotArt(e);
    if (slot._art !== art){ slot._art=art;
      if(art){ slot.classList.remove('empty'); img.classList.remove('loaded'); img.onload=function(){img.classList.add('loaded');}; img.src=art; x.style.display=''; }
      else { slot.classList.add('empty'); img.classList.remove('loaded'); img.removeAttribute('src'); x.style.display='none'; }
    }
    slot.classList.toggle('active', e.idx===cur);
  });
}
function renderPicks(container, entries, cur, side){
  if (container._n !== entries.length) {
    container._n = entries.length;
    container.innerHTML = entries.map(function(){ return '<div class="pick-card side-'+side+'"><div class="pick-img"><div class="pick-empty"></div><div class="pick-bg"></div><div class="pick-scrim"></div></div><div class="pick-info"><span class="pick-name"></span></div></div>'; }).join('');
  }
  var cards = container.children;
  entries.forEach(function(e,i){
    var card=cards[i]; if(!card) return;
    var bg=card.querySelector('.pick-bg'), empty=card.querySelector('.pick-empty'), nm=card.querySelector('.pick-name'), art=slotArt(e);
    if (card._art !== art){ card._art=art;
      if(art){ empty.style.display='none'; bg.classList.remove('loaded'); var im=new Image(); im.onload=function(){ bg.style.backgroundImage="url('"+art+"')"; bg.classList.add('loaded'); }; im.src=art; }
      else { empty.style.display=''; bg.classList.remove('loaded'); bg.style.backgroundImage=''; }
    }
    if (nm.textContent !== (e.hero||'')) nm.textContent = e.hero || '';
    nm.classList.toggle('has-name', !!e.hero);
    card.classList.toggle('has-art', !!art);
    card.classList.toggle('active', e.idx===cur);
  });
}

// ── Render ───────────────────────────────────────────────────────────────────
function setBg(id,url){ var e=$(id); if(e) e.style.backgroundImage = url ? ("url('"+String(url).replace(/'/g,'%27')+"')") : ''; }
var _lastState = null;
function render(state){
  _lastState = state;
  var hd = state.heroDraft || {}, m = state.match || {};
  var steps = hd.steps || [], cur = (hd.currentStep|0);
  var rad = teamMeta(m,'team1'), dire = teamMeta(m,'team2');

  // Headers
  $('rad-name').textContent = rad.name; $('dire-name').textContent = dire.name;
  $('rad-score').textContent = rad.score; $('dire-score').textContent = dire.score;
  setBg('rad-logo', rad.logo); setBg('dire-logo', dire.logo);
  $('rad-logo').classList.toggle('no-logo', !rad.logo); $('dire-logo').classList.toggle('no-logo', !dire.logo);

  // Bans + picks per side (team1 = Radiant, team2 = Dire)
  renderBans($('rad-bans'),  slotsFor(steps,'team1','ban'),  cur);
  renderBans($('dire-bans'), slotsFor(steps,'team2','ban'),  cur);
  renderPicks($('picks-rad'),  slotsFor(steps,'team1','pick'), cur, 'rad');
  renderPicks($('picks-dire'), slotsFor(steps,'team2','pick'), cur, 'dire');

  // Series label + phase
  var fmt = m.format || 'Bo3';
  $('series-game').textContent = 'GAME ' + ((m.currentGameNum|0) || 1) + ' · ' + fmt;
  // On-clock only once the admin has started the draft (pre-start = teams shown, no clock).
  var started = !!hd.started;
  var done = cur >= steps.length;
  var actTeam = (started && !done) ? (steps[cur] && steps[cur].team) : null;
  var actAction = done ? null : (steps[cur] && steps[cur].action);
  $('series-phase').textContent = !started ? 'DRAFT' : (done ? 'DRAFT COMPLETE' : (actAction === 'pick' ? 'PICK PHASE' : 'BAN PHASE'));

  // On-clock: acting team's header pulse + logo glow + arrow
  $('rad-header').classList.toggle('on-clock', actTeam === 'team1');
  $('dire-header').classList.toggle('on-clock', actTeam === 'team2');
  var logo = $('tourn-logo');
  logo.classList.toggle('on-rad',  actTeam === 'team1');
  logo.classList.toggle('on-dire', actTeam === 'team2');
  $('clock-arrow-l').classList.toggle('show', actTeam === 'team1');
  $('clock-arrow-r').classList.toggle('show', actTeam === 'team2');

  // Centre logo — uniform chain: hero-draft pick → event logo → none
  setBg('tourn-logo', GfxSettings.logoUrl(state, hd.logoUrl));
  $('hd-root').classList.toggle('show-names', !!hd.showPickNames);
  $('hd-root').classList.toggle('show-gradient', hd.showPickGradient !== false);

  updateTimer();
}

// Two-tier draft clock (showTimer). Each turn grants a fresh block of FREE time (pickTime); once
// that's spent the team's EXTRA/reserve pool drains. The primary countdown shows the free time
// (then the extra time once free hits 0), with the extra pool shown below as "+M:SS". The ring /
// horizontal bar depletes over the free time in the team colour, then switches to the extra colour
// and depletes over the reserve. Ticks on an interval so it's smooth.
var _RING_C = 2 * Math.PI * 44; // circle circumference for r=44
var _HD_EXTRA = '#f5b23d';      // amber — the "extra / reserve time" colour (distinct from team colours)
function _fmt(ms){ ms=Math.max(0,ms|0); var s=Math.ceil(ms/1000); return Math.floor(s/60)+':'+('0'+(s%60)).slice(-2); }
// Resolve the acting team's free + reserve time remaining from the current draft state. Text uses
// whole seconds (freeRemain/reserveRemain); the ring/bar use the continuous `frac` (from raw ms) so
// they glide smoothly rather than stepping once a second — the CSS transition interpolates ticks.
function _hdClock(hd){
  var steps=hd.steps||[], cur=hd.currentStep|0;
  var acting=(hd.started && cur<steps.length && steps[cur]) ? steps[cur].team : null;
  if(!acting) return null;
  var live = hd.turnEndsAt && !hd.timerPaused;
  var totalMs = live ? Math.max(0, hd.turnEndsAt - Date.now())
                     : (hd.timerPaused && hd.turnPausedMs!=null ? hd.turnPausedMs
                        : ((Math.max(0, hd.pickTime|0) + ((hd.reserve && hd.reserve[acting]) || 0)) * 1000));
  var poolMs = ((hd.reserve && hd.reserve[acting]) || 0) * 1000; // reserve pool at the start of this turn
  var reserveMs = Math.min(poolMs, totalMs);                     // free time spent first, so reserve is the tail
  var freeMs = Math.max(0, totalMs - poolMs);
  var inFree = freeMs > 0;
  var frac = inFree ? (freeMs / Math.max(1, (hd.pickTime|0) * 1000))
                    : (reserveMs / Math.max(1, (hd.reserveTime|0) * 1000));
  return { acting:acting, inFree:inFree, frac: Math.max(0, Math.min(1, frac)),
           freeRemain: Math.ceil(freeMs/1000), reserveRemain: Math.ceil(reserveMs/1000) };
}
function updateTimer(){
  var el=$('series-timer'), extra=$('series-extra'), ring=$('timer-ring'), arc=$('timer-arc'), bar=$('timer-bar'), barFill=$('timer-bar-fill');
  if(!el||!ring) return;
  var st=_lastState||{}, hd=st.heroDraft||{};
  var c = (hd.visible && hd.showTimer && hd.started) ? _hdClock(hd) : null;
  if(!c){ el.style.display='none'; if(extra) extra.style.display='none'; ring.style.display='none'; if(bar) bar.style.display='none'; return; }
  var teamCol = c.acting==='team1' ? 'var(--hd-rad)' : 'var(--hd-dire)';
  var teamHex = c.acting==='team1' ? '#2fbf6b' : '#e14b3d';
  var activeCol = c.inFree ? teamCol : _HD_EXTRA;
  var activeHex = c.inFree ? teamHex : _HD_EXTRA;
  // Primary countdown = free time while it lasts, then the extra time.
  el.style.display=''; el.textContent=_fmt((c.inFree ? c.freeRemain : c.reserveRemain) * 1000); el.style.color=activeCol;
  // Extra-time readout below — shown while there's still free time (once free is gone it IS the primary).
  if(extra){
    if(c.inFree && c.reserveRemain>0){ extra.style.display=''; extra.textContent='+ '+_fmt(c.reserveRemain*1000); }
    else extra.style.display='none';
  }
  // Continuous fraction of the current phase remaining (free out of pickTime, then reserve out of reserveTime).
  var frac = c.frac;
  var barStyle = (hd.timerStyle === 'bar');
  // Ring (default) vs horizontal bar between the bans and the pick strip.
  if(barStyle){
    ring.style.display='none';
    if(bar){ bar.style.display=''; barFill.style.transform='scaleX('+frac+')'; barFill.style.background=activeHex; }
  } else {
    if(bar) bar.style.display='none';
    ring.style.display='';
    arc.style.strokeDasharray = _RING_C;
    arc.style.strokeDashoffset = _RING_C * (1 - frac);
    arc.style.stroke = activeHex;
  }
}
setInterval(updateTimer, 250);

// ── Show / hide ───────────────────────────────────────────────────────────────
function animateIn(){
  var root=$('hd-root'); if(!root) return;
  if(_hideTimer){ clearTimeout(_hideTimer); _hideTimer=null; }
  root.classList.remove('hd-hiding'); root.style.display='';
  void root.offsetWidth; root.classList.add('hd-entering');
  _enterTimer=setTimeout(function(){ root.classList.remove('hd-entering'); _enterTimer=null; }, 1400);
}
function animateOut(){
  var root=$('hd-root'); if(!root) return;
  if(_enterTimer){ clearTimeout(_enterTimer); root.classList.remove('hd-entering'); _enterTimer=null; }
  root.classList.add('hd-hiding');
  _hideTimer=setTimeout(function(){ root.classList.remove('hd-hiding'); root.style.display='none'; _hideTimer=null; }, 500);
}

socket.on('state', function(state){
  var hd = state.heroDraft || {};
  var vis = !!hd.visible;
  GfxSettings.applyTheme(document.documentElement, state);
  GfxSettings.applyAnimation(document.documentElement, state, 'heroDraft');
  if (vis !== _visible){
    if (vis){ render(state); animateIn(); }
    else if (_visible !== null) animateOut();
    _visible = vis; return;
  }
  if (!vis) return;
  render(state);
});
