// Canonical map of graphic ID → standalone output path
const GRAPHIC_PATHS = {
  scoreboard:          '/graphics/scoreboard/',
  lowerThird:          '/graphics/lower-third/',
  headToHead:          '/graphics/head2head/',
  playerIntro:         '/graphics/player-intro/',
  preShow:             '/graphics/pre-show/',
  draft:               '/graphics/draft/',
  bracket:             '/graphics/bracket/',
  groupStage:          '/graphics/group-stage/',
  tournamentStructure: '/graphics/tournament-structure/',
  breakScreen:         '/graphics/break-screen/',
  winScreen:           '/graphics/win-screen/',
  prizepool:           '/graphics/prizepool/',
  bgOutput:            '/graphics/bg-output/',
  champSelect:         '/graphics/champ-select/',
};

const busId  = location.pathname.split('/').filter(Boolean).pop();
const params = new URLSearchParams(location.search);
const token  = params.get('token') || '';

// Store token so same-origin iframes can read it
if (token) localStorage.setItem('gfx_token', token);

const root       = document.getElementById('bus-root');
const frames     = {};   // graphicId → <iframe>
const hideTimers = {};   // graphicId → setTimeout handle

// How long to keep an outgoing iframe visible so its own out-animation can complete
const OUT_DELAY = 800;

function ensureFrame(graphicId) {
  if (frames[graphicId]) return frames[graphicId];
  const url = GRAPHIC_PATHS[graphicId];
  if (!url) return null;
  const src = token ? url + '?token=' + encodeURIComponent(token) : url;
  const iframe = document.createElement('iframe');
  iframe.className = 'bus-frame';
  iframe.src = src;
  iframe.setAttribute('data-graphic', graphicId);
  root.appendChild(iframe);
  frames[graphicId] = iframe;
  return iframe;
}

function syncDisplay(s) {
  const buses = (s.settings && s.settings.buses) || [];
  const bus   = buses.find(b => b.id === busId);
  if (!bus) return;

  // Preload all assigned iframes so switching is instant
  (bus.assignments || []).forEach(g => ensureFrame(g));

  // Show the first assigned graphic that is currently visible in state
  const activeKey = (bus.assignments || []).find(k => s[k] && s[k].visible) || null;

  Object.entries(frames).forEach(([graphicId, frame]) => {
    if (graphicId === activeKey) {
      // Cancel any pending hide, bring to front, show immediately
      if (hideTimers[graphicId]) {
        clearTimeout(hideTimers[graphicId]);
        delete hideTimers[graphicId];
      }
      frame.style.zIndex = '2';
      frame.classList.add('active');
    } else if (frame.classList.contains('active') && !hideTimers[graphicId]) {
      // Send to back so incoming frame is never blocked, then hide after out-animation
      frame.style.zIndex = '1';
      hideTimers[graphicId] = setTimeout(() => {
        frame.classList.remove('active');
        frame.style.zIndex = '';
        delete hideTimers[graphicId];
      }, OUT_DELAY);
    }
  });
}

// Scale the 1920×1080 root to fill the current viewport (no-op at exactly 1920×1080)
function scaleToFit() {
  const root  = document.getElementById('bus-root');
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  const x     = (window.innerWidth  - 1920 * scale) / 2;
  const y     = (window.innerHeight - 1080 * scale) / 2;
  root.style.transform = 'scale(' + scale + ')';
  root.style.left      = x + 'px';
  root.style.top       = y + 'px';
}
window.addEventListener('resize', scaleToFit);
scaleToFit();

const socket = io({ query: { token } });

socket.on('state', s => {
  syncDisplay(s);
});
