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
    container.innerHTML = entries.map(function(){ return '<div class="pick-card side-'+side+'"><div class="pick-img"><div class="pick-empty"></div><div class="pick-bg"></div></div><div class="pick-info"><span class="pick-name"></span></div></div>'; }).join('');
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

  // Tournament logo (event logo from match)
  setBg('tourn-logo', m.tournamentLogo || '');

  updateTimer();
}

// Optional reserve-time countdown near the clock (showTimer). The acting team's remaining time
// counts down from turnEndsAt (a server timestamp); ticks on an interval so it's smooth.
function _fmt(ms){ ms=Math.max(0,ms|0); var s=Math.ceil(ms/1000); return Math.floor(s/60)+':'+('0'+(s%60)).slice(-2); }
function updateTimer(){
  var el=$('clock-timer'); if(!el) return;
  var st=_lastState||{}, hd=st.heroDraft||{};
  var steps=hd.steps||[], cur=hd.currentStep|0;
  var acting=(hd.started && cur<steps.length && steps[cur]) ? steps[cur].team : null;
  var show = hd.visible && hd.showTimer && hd.started && acting && hd.turnEndsAt && !hd.timerPaused;
  if(!show){ el.style.display='none'; return; }
  el.style.display='';
  el.textContent=_fmt(hd.turnEndsAt - Date.now());
  el.style.color = acting==='team1' ? 'var(--hd-rad)' : 'var(--hd-dire)';
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
