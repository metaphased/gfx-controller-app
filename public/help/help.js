/* ============================================================================
   MetaGFX — in-app Help
   Renders the same docs/*.md the GitHub wiki uses (served under /help/_src), so
   the help is always version-matched. Login OR ?token= gated by the server.

   - Left nav is built from /api/help/manifest (parsed from docs/README.md).
   - Routing is hash-based: #<topic> or #<topic>/<heading-anchor>.
   - Internal .md links and same-page #anchors are rewritten to that hash scheme;
     external links open in a new tab.
   ============================================================================ */
(function () {
  'use strict';

  var TOKEN = new URLSearchParams(location.search).get('token') || '';
  var HOME = 'README';                       // docs/README.md = documentation home
  var navEl = document.getElementById('help-nav');
  var docEl = document.getElementById('help-doc');
  var tocEl = document.getElementById('help-toc');
  var searchEl = document.getElementById('help-search');
  var manifest = { groups: [] };
  var titleByFile = {};                       // file -> nav title (for doc <h1> fallback / back state)
  var _spy = null;

  function withTok(url) { return TOKEN ? url + (url.indexOf('?') === -1 ? '?' : '&') + 'token=' + encodeURIComponent(TOKEN) : url; }
  function hashLink(file, anchor) { return '#' + file + (anchor ? '/' + anchor : ''); }

  // GitHub-compatible heading slug (matches the anchors hard-coded in the docs).
  // Deliberately does NOT collapse consecutive hyphens — neither does GitHub.
  function slugify(text) {
    return String(text).toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s/g, '-');
  }

  // ── Nav ────────────────────────────────────────────────────────────────────
  function buildNav() {
    var html = '<a class="help-nav-home" data-file="' + HOME + '" href="#">Documentation home</a>';
    manifest.groups.forEach(function (g) {
      html += '<div class="help-nav-group"><div class="help-nav-group-title">' + esc(g.title) + '</div>';
      g.items.forEach(function (it) {
        titleByFile[it.file] = titleByFile[it.file] || it.title;
        html += '<a class="help-nav-item" data-file="' + esc(it.file) + '" data-anchor="' + esc(it.anchor || '') + '"' +
                ' href="' + hashLink(it.file, it.anchor) + '" title="' + esc(it.desc || '') + '">' + esc(it.title) + '</a>';
      });
      html += '</div>';
    });
    navEl.innerHTML = html;
  }

  function setActiveNav(file) {
    Array.prototype.forEach.call(navEl.querySelectorAll('a'), function (a) {
      a.classList.toggle('active', a.getAttribute('data-file') === file);
    });
  }

  // ── Doc rendering ────────────────────────────────────────────────────────────
  function loadDoc(file, anchor) {
    if (!/^[a-z0-9-]+$/i.test(file)) file = HOME;
    docEl.innerHTML = '<div class="help-loading">Loading…</div>';
    fetch(withTok('/help/_src/' + file + '.md'), { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (md) {
        var holder = document.createElement('div');
        holder.innerHTML = marked.parse(md);
        rewrite(holder, file);
        docEl.innerHTML = '';
        while (holder.firstChild) docEl.appendChild(holder.firstChild);
        setActiveNav(file);
        buildToc(file);
        // Scroll to the requested heading, else back to the top of the article.
        if (anchor) { var t = document.getElementById(anchor); if (t) { t.scrollIntoView(); flash(t); } }
        else { docEl.parentNode.scrollTop = 0; }
        document.title = 'MetaGFX Help — ' + (titleByFile[file] || file);
      })
      .catch(function () {
        docEl.innerHTML = '<div class="help-error"><h2>Topic not found</h2><p>The page <code>' + esc(file) +
          '</code> could not be loaded. <a href="#">Return to the documentation home</a>.</p></div>';
      });
  }

  // Rewrite rendered HTML for in-app navigation: image sources, internal links,
  // external links, and stable heading IDs for anchor deep-linking.
  function rewrite(root, file) {
    var seen = {};
    Array.prototype.forEach.call(root.querySelectorAll('h1, h2, h3, h4, h5, h6'), function (h) {
      var base = slugify(h.textContent), id = base, n = 0;
      while (seen[id]) { n++; id = base + '-' + n; }
      seen[id] = true; h.id = id;
    });
    Array.prototype.forEach.call(root.querySelectorAll('img'), function (img) {
      var src = img.getAttribute('src') || '';
      if (/^(https?:)?\/\//.test(src) || src.charAt(0) === '/') return;
      img.setAttribute('src', withTok('/help/_src/' + src.replace(/^\.\//, '')));
      img.setAttribute('loading', 'lazy');
      img.classList.add('help-img');                 // click-to-enlarge (see lightbox)
    });
    // Figure captions: an <em> whose text is the WHOLE paragraph (a standalone
    // *caption* line, or one right after an image) reads as a caption and gets
    // block styling. Detected here rather than via CSS :only-child, which ignores
    // text nodes and would mis-flag inline emphasis surrounded by prose.
    Array.prototype.forEach.call(root.querySelectorAll('p > em'), function (em) {
      if (em.textContent.trim() === em.parentNode.textContent.trim()) em.classList.add('help-caption');
    });
    Array.prototype.forEach.call(root.querySelectorAll('a[href]'), function (a) {
      var href = a.getAttribute('href');
      var m;
      if ((m = href.match(/^([a-z0-9-]+)\.md(?:#([\w-]+))?$/i))) {            // internal doc link
        a.setAttribute('href', hashLink(m[1], m[2]));
      } else if (/^\.\.\/README\.md/i.test(href)) {                          // project landing → help home
        a.setAttribute('href', '#');
      } else if (href.charAt(0) === '#') {                                   // same-doc anchor
        a.setAttribute('href', hashLink(file, href.slice(1)));
      } else if (/^https?:\/\//.test(href)) {                               // external
        a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }

  function flash(el) { el.classList.add('help-flash'); setTimeout(function () { el.classList.remove('help-flash'); }, 1400); }

  // ── In-page table of contents (H2/H3) with scroll-spy ───────────────────────
  function buildToc(file) {
    if (_spy) { _spy.disconnect(); _spy = null; }
    var heads = docEl.querySelectorAll('h2, h3');
    if (heads.length < 2) { tocEl.innerHTML = ''; tocEl.classList.remove('has-toc'); return; }
    var html = '<div class="help-toc-title">On this page</div>';
    Array.prototype.forEach.call(heads, function (h) {
      html += '<a class="help-toc-' + h.tagName.toLowerCase() + '" href="' + hashLink(file, h.id) + '">' + esc(h.textContent) + '</a>';
    });
    tocEl.innerHTML = html; tocEl.classList.add('has-toc');

    var links = {};
    Array.prototype.forEach.call(tocEl.querySelectorAll('a'), function (a) { links[a.getAttribute('href').split('/').pop()] = a; });
    _spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && links[e.target.id]) {
          Array.prototype.forEach.call(tocEl.querySelectorAll('a'), function (a) { a.classList.remove('active'); });
          links[e.target.id].classList.add('active');
        }
      });
    }, { root: docEl.parentNode, rootMargin: '0px 0px -75% 0px', threshold: 0 });
    Array.prototype.forEach.call(heads, function (h) { _spy.observe(h); });
  }

  // ── Search (filters the nav by title + description) ──────────────────────────
  function filterNav(q) {
    q = q.trim().toLowerCase();
    Array.prototype.forEach.call(navEl.querySelectorAll('.help-nav-item'), function (a) {
      var hit = !q || a.textContent.toLowerCase().indexOf(q) !== -1 || (a.getAttribute('title') || '').toLowerCase().indexOf(q) !== -1;
      a.style.display = hit ? '' : 'none';
    });
    Array.prototype.forEach.call(navEl.querySelectorAll('.help-nav-group'), function (g) {
      var any = Array.prototype.some.call(g.querySelectorAll('.help-nav-item'), function (a) { return a.style.display !== 'none'; });
      g.style.display = any ? '' : 'none';
    });
  }

  // ── Routing ──────────────────────────────────────────────────────────────────
  function route() {
    var hash = location.hash.replace(/^#/, '');
    if (!hash) { loadDoc(HOME, null); setActiveNav(HOME); return; }
    var slash = hash.indexOf('/');
    var file = slash === -1 ? hash : hash.slice(0, slash);
    var anchor = slash === -1 ? null : hash.slice(slash + 1);
    loadDoc(file, anchor);
  }

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // ── Lightbox (click-to-enlarge screenshots) ──────────────────────────────────
  // Many docs screenshots are dense; clicking one opens it full-size in an overlay.
  // Click the backdrop / image or press Esc to close.
  function setupLightbox() {
    var box = document.createElement('div');
    box.className = 'help-lightbox';
    box.innerHTML = '<img alt="">';
    box.setAttribute('aria-hidden', 'true');
    document.body.appendChild(box);
    var boxImg = box.firstChild;
    function close() { box.classList.remove('open'); box.setAttribute('aria-hidden', 'true'); boxImg.removeAttribute('src'); }
    function open(src, alt) { boxImg.setAttribute('src', src); boxImg.setAttribute('alt', alt || ''); box.classList.add('open'); box.setAttribute('aria-hidden', 'false'); }
    docEl.addEventListener('click', function (e) {
      var img = e.target.closest && e.target.closest('img.help-img');
      if (img && img.getAttribute('src')) { e.preventDefault(); open(img.getAttribute('src'), img.getAttribute('alt')); }
    });
    box.addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && box.classList.contains('open')) close(); });
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  // No "back" link: help opens in its own tab, so a return button just spawns
  // redundant tabs — users close this tab to go back.
  setupLightbox();
  searchEl.addEventListener('input', function () { filterNav(searchEl.value); });
  window.addEventListener('hashchange', route);
  fetch(withTok('/api/help/manifest'), { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : { groups: [] }; })
    .then(function (m) { manifest = m && m.groups ? m : { groups: [] }; buildNav(); route(); })
    .catch(function () { buildNav(); route(); });
})();
