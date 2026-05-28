// Shared ticker helpers — included by break-screen and pre-show.
// Eliminates duplicate renderTickerLabel + scroll engine logic across both overlays.
window.TickerEngine = (function() {
  var SEP = '   ·   '; // nbsp*3 + middot + nbsp*3 — immune to CSS whitespace trimming

  function _eH(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Render the label zone (text / logo / hidden).
  // ids: { wrap, text, img }
  function renderLabel(ids, ticker) {
    var wrap   = document.getElementById(ids.wrap);
    var textEl = document.getElementById(ids.text);
    var imgEl  = document.getElementById(ids.img);
    if (!wrap) return;

    var mode = (ticker && ticker.labelMode) || 'text';
    if (mode === 'none') { wrap.style.display = 'none'; return; }
    wrap.style.display = '';

    if (mode === 'logo' && ticker.labelLogoUrl) {
      if (imgEl) { imgEl.src = ticker.labelLogoUrl; imgEl.style.display = ''; }
      if (textEl) textEl.style.display = 'none';
    } else {
      if (imgEl) imgEl.style.display = 'none';
      if (textEl) { textEl.style.display = ''; textEl.textContent = (ticker && ticker.labelText) || 'NEWS'; }
    }
  }

  // Build and scroll ticker content inside `inner`.
  // cfg: { winClass, lossClass, scoreClass, liveLabelClass, liveDotClass, itemClass, animName }
  // Returns without touching the DOM if content is unchanged.
  function renderScroll(inner, items, cfg) {
    var setHtml = items
      .filter(function(i) { return i && (i.text || i.completed); })
      .map(function(i) {
        if (i.completed) {
          var w1 = i.winner === 'team1', w2 = i.winner === 'team2';
          return '<span class="' + (w1 ? cfg.winClass : cfg.lossClass) + '">' + _eH(i.t1) + '</span>' +
                 '<span class="' + cfg.scoreClass + '">  ' + _eH(String(i.score1)) + '–' + _eH(String(i.score2)) + '  </span>' +
                 '<span class="' + (w2 ? cfg.winClass : cfg.lossClass) + '">' + _eH(i.t2) + '</span>';
        }
        if (i.live) {
          return '<span class="' + cfg.liveLabelClass + '">LIVE</span>' +
                 '<span class="' + cfg.liveDotClass + '"></span>' + _eH(i.text);
        }
        return _eH(i.text);
      })
      .join(SEP) + SEP;

    if (inner._tickerText === setHtml) return;
    inner._tickerText = setHtml;

    inner.style.animation = 'none';
    inner.innerHTML = '';
    void inner.offsetWidth;

    var probe = document.createElement('span');
    probe.className = cfg.itemClass;
    probe.innerHTML = setHtml;
    inner.appendChild(probe);
    void inner.offsetWidth;
    var singleWidth = Math.max(1, probe.offsetWidth);
    inner.removeChild(probe);

    var trackWidth = (inner.parentElement ? inner.parentElement.offsetWidth : 0) || window.innerWidth;
    var perHalf = Math.max(2, Math.ceil(trackWidth / singleWidth) + 1);

    for (var i = 0; i < perHalf * 2; i++) {
      var span = document.createElement('span');
      span.className = cfg.itemClass;
      span.innerHTML = setHtml;
      inner.appendChild(span);
    }
    void inner.offsetWidth;

    var duration = Math.max(8, (perHalf * singleWidth) / 90).toFixed(1);
    inner.style.animation = cfg.animName + ' ' + duration + 's linear infinite';
  }

  return { renderLabel: renderLabel, renderScroll: renderScroll };
})();
