// shared-gfx.js — loaded by all graphic output pages
// Connects to the server via Socket.io and provides reactive state

(function() {
  const socket = io();
  window._gfxState = {};
  window._gfxCallbacks = [];

  socket.on('state', (state) => {
    window._gfxState = state;
    window._gfxCallbacks.forEach(cb => cb(state));
  });

  window.onState = function(cb) {
    window._gfxCallbacks.push(cb);
    if (Object.keys(window._gfxState).length) cb(window._gfxState);
  };

  // Animate in/out helper
  window.animateIn = function(el, cls = 'gfx-in') {
    el.classList.remove('gfx-out');
    el.classList.add(cls);
  };
  window.animateOut = function(el, cls = 'gfx-out') {
    el.classList.remove('gfx-in');
    el.classList.add(cls);
  };
})();
