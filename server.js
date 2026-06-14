require('dotenv').config();
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');
const fs       = require('fs');
const fetch    = require('node-fetch');
const multer   = require('multer');
const csv      = require('csv-parser');
const cors     = require('cors');
const session  = require('express-session');
const bcrypt   = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const switcher = require('./switcher');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3000;
const EXTERNAL_URL = process.env.EXTERNAL_URL || null;

// ── Data paths ─────────────────────────────────────────────────────────────────
const DATA_DIR    = path.join(__dirname, 'data');
const DATA_FILE   = path.join(DATA_DIR, 'state.json');
const TEAMS_FILE    = path.join(DATA_DIR, 'teams.json');
const USERS_FILE    = path.join(DATA_DIR, 'users.json');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const LOOKS_FILE    = path.join(DATA_DIR, 'looks.json');
const SECRET_FILE = path.join(DATA_DIR, 'session-secret.txt');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Persist session secret across restarts
function getSessionSecret() {
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  const s = 'gfx-' + require('crypto').randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, s);
  return s;
}

// ── Session ────────────────────────────────────────────────────────────────────
const sessionMiddleware = session({
  secret: getSessionSecret(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24 h
    httpOnly: true,              // not readable from JS — mitigates XSS cookie theft
    sameSite: 'lax',            // mitigates CSRF / cross-site socket hijack
  }
});
app.use(sessionMiddleware);
app.use(express.json());

// ── Socket.io (shares express session) ────────────────────────────────────────
const io = new Server(server, { cors: { origin: '*' } });
io.engine.use(sessionMiddleware);

// ── Users ──────────────────────────────────────────────────────────────────────
let _users = [];
function loadUsers() {
  try { if (fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch(e) { console.error('Users load:', e.message); }
  return [];
}
function saveUsers(u) { _users = u; fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2)); }

// Seed a default admin if no users exist; prime _users cache either way
(function ensureAdmin() {
  const users = loadUsers();
  if (users.length === 0) {
    users.push({ id: 'u1', username: 'admin', passwordHash: bcrypt.hashSync('admin', 10), role: 'superadmin' });
    saveUsers(users); // saveUsers sets _users
    console.log('\n  Default admin created — username: admin  password: admin\n  Change this password immediately in the Users tab.\n');
  } else {
    _users = users;
  }
})();

// ── Auth middleware ────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  // Also accept graphics token (for Companion / external integrations)
  const token = req.query.token || req.headers['x-graphics-token'];
  if (token && state.settings && state.settings.graphicsToken === token) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorised' });
  res.redirect('/login/');
}
function requireAdmin(req, res, next) {
  if (req.session && req.session.user && ['admin','superadmin'].includes(req.session.user.role)) return next();
  if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Admin only' });
  res.redirect('/operator/');
}

// ── Auth routes (public) ───────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts — try again in 15 minutes' }
});

app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = _users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.passwordHash))
    return res.status(401).json({ error: 'Invalid username or password' });
  req.session.user = { id: user.id, username: user.username, role: user.role };
  const redirect = ['admin','superadmin'].includes(user.role) ? '/control/' : '/operator/';
  res.json({ ok: true, role: user.role, redirect });
});

app.get('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login/'));
});

app.get('/api/auth/me', (req, res) => {
  if (req.session && req.session.user) {
    const full = _users.find(u => u.id === req.session.user.id);
    res.json({ user: {
      ...req.session.user,
      keybinds: (full && full.keybinds) || {},
      theme: (full && full.theme) || null,
      layout: (full && full.layout) || null,
    }, themeDefault: (state.settings && state.settings.uiTheme) || null });
  } else {
    res.status(401).json({ error: 'Not logged in' });
  }
});

// ── User keybinds ─────────────────────────────────────────────────────────────
app.post('/api/users/me/keybinds', requireAuth, (req, res) => {
  const { keybinds } = req.body || {};
  if (typeof keybinds !== 'object' || Array.isArray(keybinds)) return res.status(400).json({ error: 'keybinds must be an object' });
  if (!req.session || !req.session.user) return res.status(403).json({ error: 'Session required' });
  const user = _users.find(u => u.id === req.session.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.keybinds = keybinds;
  saveUsers(_users);
  res.json({ ok: true });
});

// ── Per-user UI theme (preset + accent/panel overrides) ────────────────────────
const THEME_PRESETS = ['graphite', 'steel', 'bronze'];
function sanitizeTheme(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
  const clampNum = (v, lo, hi) => (v === null || v === undefined || v === '' ? null
    : Math.min(hi, Math.max(lo, Number(v) || 0)));
  return {
    preset:     THEME_PRESETS.includes(t.preset) ? t.preset : 'graphite',
    accentHue:  clampNum(t.accentHue, 0, 360),
    accentSat:  clampNum(t.accentSat, 0, 60),
    panelLight: clampNum(t.panelLight, 6, 22),
  };
}
app.post('/api/users/me/theme', requireAuth, (req, res) => {
  if (!req.session || !req.session.user) return res.status(403).json({ error: 'Session required' });
  const theme = sanitizeTheme((req.body || {}).theme);
  if (!theme) return res.status(400).json({ error: 'theme object required' });
  const user = _users.find(u => u.id === req.session.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.theme = theme;
  saveUsers(_users);
  res.json({ ok: true, theme });
});

// ── Per-user operator panel layout (drag-reorder; { cols: [[ids],…] }) ──────────
function sanitizeLayout(l) {
  if (!l || typeof l !== 'object' || !Array.isArray(l.cols)) return null;
  const cols = l.cols.slice(0, 6).map(function (col) {
    if (!Array.isArray(col)) return [];
    return col.filter(function (id) { return typeof id === 'string' && id.length < 80; }).slice(0, 40);
  });
  return { cols };
}
app.post('/api/users/me/layout', requireAuth, (req, res) => {
  if (!req.session || !req.session.user) return res.status(403).json({ error: 'Session required' });
  const layout = sanitizeLayout((req.body || {}).layout);
  if (!layout) return res.status(400).json({ error: 'layout { cols:[[ids]] } required' });
  const user = _users.find(u => u.id === req.session.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.layout = layout;
  saveUsers(_users);
  res.json({ ok: true, layout });
});

// ── SSE endpoint — accepts session or graphics token ──────────────────────────
app.get('/api/events', (req, res) => {
  const hasSession = req.session && req.session.user;
  const hasToken = req.query.token && state.settings && state.settings.graphicsToken === req.query.token;
  if (!hasSession && !hasToken) return res.status(401).json({ error: 'Unauthorized' });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`data: ${buildSSEPayload()}\n\n`);
  _sseClients.add(res);
  req.on('close', () => _sseClients.delete(res));
});

// ── Static — public (no auth) ──────────────────────────────────────────────────
app.use('/login',    express.static(path.join(__dirname, 'public', 'login')));
// Graphics overlays: don't let browsers (esp. OBS/vMix CEF) serve stale HTML/CSS/JS —
// force revalidation so a source refresh always picks up the current build. Champion
// art and other assets keep normal caching.
app.use('/graphics', express.static(path.join(__dirname, 'public', 'graphics'), {
  setHeaders: (res, filePath) => {
    if (/\.(html|css|js)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  },
}));
app.use('/uploads',  express.static(path.join(__dirname, 'public', 'uploads')));
app.use('/champions',express.static(path.join(__dirname, 'public', 'champions')));
app.use('/fonts',    express.static(path.join(__dirname, 'public', 'fonts')));
app.use('/shared',   express.static(path.join(__dirname, 'public', 'shared')));  // design tokens — needed by login (pre-auth) too

// ── Caster view — token-gated HTML, assets served freely ───────────────────────
function requireToken(req, res, next) {
  const token = req.query.token;
  if (token && state.settings && state.settings.graphicsToken === token) return next();
  res.status(401).send('<!DOCTYPE html><html><head><title>Unauthorized</title><style>body{font-family:sans-serif;background:#07101a;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}</style></head><body><div style="text-align:center"><h2>Unauthorized</h2><p style="opacity:.6">Valid token required — check your caster URL</p></div></body></html>');
}
// Only the HTML entry point needs the token; CSS/JS assets are not sensitive
app.get(['/caster', '/caster/'], requireToken, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'caster', 'index.html'));
});
app.use('/caster', express.static(path.join(__dirname, 'public', 'caster')));

// Bus output pages — static assets served first, then catch-all for bus IDs.
// Same no-cache as /graphics so OBS/vMix CEF picks up updated bus HTML/CSS/JS on refresh.
app.use('/bus', express.static(path.join(__dirname, 'public', 'bus'), {
  setHeaders: (res, filePath) => {
    if (/\.(html|css|js)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  },
}));
app.get('/bus/:id', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'bus', 'index.html'));
});

// ── In-app help (renders docs/*.md) — session OR graphics-token gated ──────────
// The same docs/*.md that GitHub renders as the wiki are served here, so the
// in-app help never drifts from the running version. requireAuth accepts a logged
// -in session or ?token=<graphicsToken>.
const DOCS_DIR = path.join(__dirname, 'docs');

// Parse docs/README.md (the wiki index) into a grouped nav manifest so the index
// stays the single source of truth for topic titles/order/descriptions.
function parseHelpManifest(md) {
  const groups = [];
  let group = null, sawGroup = false;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '---') break;                       // stop at the footer rule
    const h = line.match(/^##\s+(.+)$/);
    if (h) { group = { title: h[1].trim(), items: [] }; groups.push(group); sawGroup = true; continue; }
    if (!sawGroup || !group) continue;
    // Table row: | [Title](file.md#anchor) | description |
    const row = line.match(/^\|\s*\[([^\]]+)\]\(([a-z0-9-]+)\.md(#[a-z0-9-]+)?\)\s*\|\s*(.*?)\s*\|\s*$/i);
    if (row) group.items.push({ title: row[1].trim(), file: row[2], anchor: (row[3] || '').replace(/^#/, ''), desc: row[4].trim() });
  }
  return { groups: groups.filter(g => g.items.length) };
}

// Markdown source + images for the renderer (e.g. /help/_src/bracket.md, /help/_src/img/x.jpg).
// Gated (session cookie, or the help page appends ?token= to these fetches).
app.use('/help/_src', requireAuth, express.static(DOCS_DIR, {
  setHeaders: (res, fp) => {
    if (/\.md$/i.test(fp)) res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  },
}));
app.get('/api/help/manifest', requireAuth, (req, res) => {
  try { res.json(parseHelpManifest(fs.readFileSync(path.join(DOCS_DIR, 'README.md'), 'utf8'))); }
  catch (e) { res.status(500).json({ error: 'Help manifest unavailable' }); }
});
// Like the caster view: only the HTML entry is auth-gated; the page's own CSS/JS
// assets are served freely so they load even under ?token= auth (the browser does
// not attach the token to sub-resource requests).
app.get(['/help', '/help/'], requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'help', 'index.html'));
});
app.use('/help', express.static(path.join(__dirname, 'public', 'help')));

// Root redirect
app.get('/', (req, res) => {
  if (!req.session || !req.session.user) return res.redirect('/login/');
  res.redirect(['admin','superadmin'].includes(req.session.user.role) ? '/control/' : '/operator/');
});

// ── Static — protected ─────────────────────────────────────────────────────────
app.use('/control',  requireAuth, requireAdmin, express.static(path.join(__dirname, 'public', 'control')));
app.use('/operator', requireAuth, express.static(path.join(__dirname, 'public', 'operator')));

// ── Shared static (champion picker JS etc.) ────────────────────────────────────
app.use(requireAuth, express.static(path.join(__dirname, 'public')));

// ── All API routes require auth ────────────────────────────────────────────────
app.use('/api', requireAuth);

// ── Uploads ───────────────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
// Strip any path components and unsafe chars from the client filename to prevent
// path traversal (e.g. originalname "../../evil.js") and odd characters on disk.
function safeFilename(original) {
  const base = path.basename(original || 'file');
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '') || 'file';
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => cb(null, Date.now() + '-' + safeFilename(file.originalname))
});
// Images only, 8 MB cap — uploads are served unauthenticated from /uploads, so an
// uploaded .html/.svg/.js would be a same-origin stored-XSS vector. SVG is excluded
// because it can carry scripts.
const ALLOWED_UPLOAD_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_UPLOAD_MIME.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only PNG, JPEG, GIF, or WebP images are allowed'));
  }
});
// Separate uploader for custom broadcast fonts — woff2/woff/ttf/otf only, 4 MB cap,
// stored under /uploads/fonts. Font files aren't script-executable, so serving them
// unauthenticated from /uploads is safe (unlike SVG/HTML).
const fontUploadDir = path.join(uploadDir, 'fonts');
if (!fs.existsSync(fontUploadDir)) fs.mkdirSync(fontUploadDir, { recursive: true });
const BUNDLED_FONT_NAMES = ['barlow condensed','barlow','sora','space grotesk','outfit','poppins','figtree','hubot sans','nacelle','darker grotesque','switzer','oxygen','inter'];
const uploadFont = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, fontUploadDir),
    filename:    (req, file, cb) => cb(null, Date.now() + '-' + safeFilename(file.originalname)),
  }),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.(woff2|woff|ttf|otf)$/i.test(file.originalname || '')) return cb(null, true);
    cb(new Error('Only .woff2, .woff, .ttf or .otf font files are allowed'));
  }
});
// Separate uploader for data imports (CSV / JSON) — filtered by extension, 5 MB cap.
const uploadData = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.(csv|json)$/i.test(file.originalname || '')) return cb(null, true);
    cb(new Error('Only .csv or .json files are allowed'));
  }
});
// Run a multer single-file middleware and convert size/type/parse errors into a
// clean 400 JSON response instead of bubbling up to a 500.
function singleUpload(mw) {
  return (req, res, next) => mw(req, res, err => {
    if (err) return res.status(400).json({ error: err.message || 'Upload rejected' });
    next();
  });
}

// ── State / defaults ───────────────────────────────────────────────────────────
const DEFAULT_ROLES = ['Top', 'Jungle', 'Mid', 'Bot', 'Support'];

function makeDefaultPlayers() {
  return DEFAULT_ROLES.map((role, i) => ({ name: '', handle: 'Player ' + (i+1), role, country: '', active: true }));
}
function makeDefaultSubs() {
  return [1,2,3].map(i => ({ name: '', handle: 'Sub ' + i, role: '', country: '', active: false }));
}
// ── TEAM IDENTITY NAMING (read before touching team-keyed data) ───────────────
// "Team 1 / Team 2" is keyed THREE ways depending on the object — mixing them up is a
// recurring bug source, so:
//   • Live / top-level state → FULL `team1`/`team2`:
//       match.team1, players.team1 / team1subs, draft.team1RolePicks,
//       draft.committedT1Picks (note the capital T), schedule game team1Id / team1Override.
//       Also as string VALUES: draft.blueSideTeam / sideChooser, winScreen.team,
//       playerSpotlight slot.team = 'team1' | 'team2'.
//   • Per-game SNAPSHOT objects (match.seriesGames[], schedule result.games[]) →
//       ABBREVIATED keys `t1*`/`t2*`: t1Side, t1Picks, t1Bans, t1RolePicks, t1Players.
//       BUT the same snapshot ALSO has `winner: 'team1'` and nested `players.team1` (full).
//   • POST /api/match/record-game body uses the t1*/t2* keys.
//   • Local variables in render code use t1/t2 freely — cosmetic, no cross-file contract.
// CONVENTION FOR NEW CODE: use full `team1`/`team2`. Do NOT rename the existing persisted
// t1* keys without a state.json + saved-profiles migration (they're stored on disk).
// ──────────────────────────────────────────────────────────────────────────────
const makeDefault = () => ({
  tournament: {
    hasGroupStage:      false,
    playoffFormat:      'singleElim', // 'singleElim' | 'doubleElim'
    thirdPlaceMatch:    false,        // single elim only
    totalTeams:         0,            // total teams across the whole tournament (0 = not set)
    numGroups:          0,            // number of groups (0 = not set)
    qualifiersPerGroup: 2,            // top N from each group advance to playoffs
    playoffSeeding:     'manual',     // 'manual' | 'seeded'
    stages: {
      groupStage:    { format: 'Bo1' },
      roundOf16:     { format: 'Bo3' },
      quarterfinals: { format: 'Bo3' },
      semifinals:    { format: 'Bo3' },
      finals:        { format: 'Bo5' },
      thirdPlace:    { format: 'Bo3' },
      upperBracket:  { format: 'Bo3' },
      lowerBracket:      { format: 'Bo3' },
      lowerBracketFinal: { format: 'Bo5' },
      grandFinals:       { format: 'Bo5' },
    },
    playersPerTeam:  5,
    maxSubsPerTeam:  0,
    startDate:       '',
    endDate:         '',
    region:          '',
    tiebreaker:      '',
    patchVersion:    '',
    showDates:       false,
    showRegion:      false,
    showTiebreaker:  false,
    showPatch:       false,
    hasPrizepool:    false,
    teamPool:        [],   // team IDs competing in THIS tournament (subset of global Teams DB)
    groups: [],
    schedule: []
  },
  tournamentStructure: { visible: false, showLogo: false, logoScale: 7, logoPosition: 'left', displayTitle: '', showTitle: false },
  match: {
    team1: { name: 'Team One', tag: 'T1', logo: '', score: 0 },
    team2: { name: 'Team Two', tag: 'T2', logo: '', score: 0 },
    game: 'lol', format: 'Bo3', tournament: '', tournamentLogo: '', sponsorLogos: [],
    fearlessDraft: false,
    currentGameNum: 1,
    seriesGames: [],
    scheduleDayId: null,
    scheduleGameId: null,
  },
  players: {
    team1: makeDefaultPlayers(), team2: makeDefaultPlayers(),
    team1subs: makeDefaultSubs(), team2subs: makeDefaultSubs()
  },
  lowerThird:  { visible: false, text: '', subtext: '', supertext: '', side: 'left' },
  headToHead:  { visible: false, mode: 'spotlight', spotlightRole: 0, animStyle: 'standard' },
  playerIntro: { visible: false, layout: 'panel', animVariant: 'rise', showLogo: true, showRank: false, showChamps: false, piBg: 'transparent', piLogoUrl: '' },
  preShow:     { visible: false, timerEnd: null, logoUrl: '', logoScale: 8, hideLogo: false, headerText: '', hideHeaderText: false, timerLabel: '', layout: 'center' },
  draft: {
    visible: false,
    phase: 'notstarted',
    blueSideTeam: 'team1',
    currentStep: 0,
    picks: ['','','','','','','','','','','','','','','','','','','',''],
    committedT1Picks: [],
    committedT2Picks: [],
    team1RolePicks: [],
    team2RolePicks: [],
    timerEnd:      null,
    timerDuration: 60,
    timerVisible:  false,
    introTrigger:  0,
    banFirstTeam:  'blue',   // 'blue' | 'red' — which side bans first
    sideChooser:   '',       // 'team1' | 'team2' — which team made the side selection
  },
  bracket:     { visible: false, title: 'TOURNAMENT BRACKET', type: 'single', logoUrl: '', logoScale: 7, logoPosition: 'left', showLogo: false, rounds: [] },
  groupStage:  { visible: false, mode: 'live', logoUrl: '', logoScale: 7, logoPosition: 'left', showLogo: false },
  breakScreen: { visible: false, message: 'BE RIGHT BACK', subtext: '', nextMatch: '', timerEnd: null, pipMode: false },
  winScreen:   { visible: false, team: 'team1', message: 'WINS THE SERIES', style: 'blade', seriesScore: '', accentSource: 'side', accentCustom: '#1ffaff', showPicks: false, picksPosition: 'below', compShape: 'rect', compBg: 'bespoke' },
  // Player Spotlight — 1-or-2 player highlight (manual A→C transition). format: full|l3,
  // design: angled|bleed|framed, mode: single|duo|compare. players[0]=A (team1 side),
  // players[1]=C (team2 side); champ='' = auto (most-played); statOverrides keyed by stat.
  playerSpotlight: {
    // stage: which player(s) are on the left/right stage — 'a' (left only),
    // 'b' (right only), 'both'. showVs toggles the centre VS badge in the Both view.
    visible: false, format: 'full', design: 'showcase', stage: 'a', showVs: true,
    statSource: 'both', accentSource: 'side', accentCustom: '#1ffaff',
    players: [
      { team: 'team1', handle: '', champ: '', caption: '', statTokens: [], statOverrides: {} },
      { team: 'team2', handle: '', champ: '', caption: '', statTokens: [], statOverrides: {} },
    ],
  },
  prizepool: { visible: false, showLogo: false, logoScale: 7, logoPosition: 'left', entries: [] },
  bgOutput: {
    bgType: 'animation', bgAnimation: 'particles',
    bgColor: '#070f12',  bgImage: '',
    bgFogLayer: false,   bgFogIntensity: 50,
    animation: { bgSpeed: 'medium' },
    palette: [],
  },
  ticker:      { visible: false, items: [] },
  meta:        { activeProfileId: null, activeProfileName: null },
  settings: {
    palette: [
      { name: 'Primary',   hex: '#1ffaff' },
      { name: 'Secondary', hex: '#a7a38e' },
      { name: 'Light',     hex: '#e8e6df' },
      { name: 'Dark',      hex: '#070f12' },
    ],
    blueAccent:  '#1e6fff',
    redAccent:   '#ff3b3b',
    bgType:      'transparent',
    bgColor:     '#070f12',
    bgImage:     '',
    bgAnimation: 'none',
    draftLayout: 'arena',      // 'arena' | 'classic'
    overlayFont: '',           // broadcast font for all overlays ('' = Barlow Condensed); a bundled family or a customFonts name
    customFonts: [],           // user-uploaded fonts: [{ id, name, url, format }]
    graphicsToken: require('crypto').randomBytes(16).toString('hex'),
    animation: {
      speed:           'medium',        // 'instant' | 'fast' | 'medium' | 'slow' (duration multiplier)
      enterEase:       'easeOutQuart',  // easing name from GfxSettings.EASINGS
      exitEase:        'easeInQuart',
      moveEase:        'easeInOutQuad',
      dataChangeStyle: 'fade',          // 'none' | 'fade' | 'slide' | 'scale'
      bgSpeed:         'medium',        // 'slow' | 'medium' | 'fast'
      overrides:       {},              // { [graphicKey]: { enterEase?, exitEase?, moveEase?, speed? } }
    },
    logoSet: { logos: [] },        // [{ name: string, url: string }]
    buses: [
      { id: 'busA', name: 'Bus A', assignments: [] },
      { id: 'busB', name: 'Bus B', assignments: [] },
    ],
    h2hChampStats: {
      enabled: false,
      Top:     ['winRate', 'games', 'kda', 'cs'],
      Jungle:  ['winRate', 'games', 'kda', 'kp'],
      Mid:     ['winRate', 'games', 'kda', 'cs'],
      Bot:     ['winRate', 'games', 'kda', 'cs'],
      Support: ['winRate', 'games', 'kda', 'kp', 'vision'],
    },
  },
});

const _PROTO_BLOCKLIST = ['__proto__', 'constructor', 'prototype'];
function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (_PROTO_BLOCKLIST.includes(key)) continue; // block prototype pollution
    const val = source[key];
    if (val !== null && val !== undefined && typeof val === 'object' && !Array.isArray(val)) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      deepMerge(target[key], val);
    } else { target[key] = val; }
  }
  return target;
}

// Migrate the legacy animation settings (transitionSpeed/motionEnergy) to the new
// easing model. Only fills new fields when absent so a user's explicit choices win.
function migrateAnimationSettings(st) {
  const a = st && st.settings && st.settings.animation;
  if (!a) return;
  const MOTION = {
    smooth: { enterEase: 'easeOutQuart', exitEase: 'easeInQuart', moveEase: 'easeInOutQuad' },
    linear: { enterEase: 'linear',       exitEase: 'linear',      moveEase: 'linear' },
    bouncy: { enterEase: 'easeOutBack',  exitEase: 'easeInBack',  moveEase: 'easeInOutBack' },
    snap:   { enterEase: 'easeOutExpo',  exitEase: 'easeInExpo',  moveEase: 'easeInOutExpo' },
  };
  if (a.speed === undefined && a.transitionSpeed !== undefined) a.speed = a.transitionSpeed;
  if (a.enterEase === undefined && a.motionEnergy !== undefined) {
    const m = MOTION[a.motionEnergy] || MOTION.smooth;
    a.enterEase = m.enterEase; a.exitEase = m.exitEase; a.moveEase = m.moveEase;
  }
  if (!a.overrides || typeof a.overrides !== 'object') a.overrides = {};
  delete a.transitionSpeed; delete a.motionEnergy;
}

function loadState() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const st = deepMerge(makeDefault(), JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
      migrateAnimationSettings(st);
      return st;
    }
  } catch(e) { console.error('State load:', e.message); }
  return makeDefault();
}
function saveState() { try { fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2)); } catch(e) { console.error(e); } }
let _teams = [];
function loadTeams() { try { if (fs.existsSync(TEAMS_FILE)) return JSON.parse(fs.readFileSync(TEAMS_FILE, 'utf8')); } catch(e) {} return []; }
function saveTeams(t) { _teams = t; try { fs.writeFileSync(TEAMS_FILE, JSON.stringify(t, null, 2)); } catch(e) { console.error(e); } }

// Team IDs referenced anywhere in the active tournament (schedule games + groups).
function _referencedTeamIds() {
  const ids = new Set();
  ((state.tournament && state.tournament.schedule) || []).forEach(d =>
    (d.games || []).forEach(g => { if (g.team1Id) ids.add(g.team1Id); if (g.team2Id) ids.add(g.team2Id); }));
  ((state.tournament && state.tournament.groups) || []).forEach(gr =>
    (gr.teamIds || []).forEach(id => ids.add(id)));
  return [...ids];
}
// Ensure the active tournament has a teamPool. Legacy tournaments (saved before
// this feature) have none — seed it from teams already referenced in the
// schedule/groups so nothing disappears from their dropdowns mid-event.
function _ensureTeamPool() {
  if (!state.tournament) return;
  if (!Array.isArray(state.tournament.teamPool)) state.tournament.teamPool = _referencedTeamIds();
}

function loadProfiles() { try { if (fs.existsSync(PROFILES_FILE)) return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8')); } catch(e) {} return []; }
function saveProfiles(p) { try { fs.writeFileSync(PROFILES_FILE, JSON.stringify(p, null, 2)); } catch(e) { console.error(e); } }

// ── Looks (reusable visual identities: palette + accents + background + animation) ──
// A Look is theme-only and additive; it can be applied over any tournament profile
// without touching teams/schedule. Logo library is intentionally excluded.
const LOOK_FIELDS = ['palette','blueAccent','redAccent','bgType','bgColor','bgImage','bgFogLayer','bgFogIntensity','animation','overlayFont'];
function loadLooks() { try { if (fs.existsSync(LOOKS_FILE)) return JSON.parse(fs.readFileSync(LOOKS_FILE, 'utf8')); } catch(e) {} return null; }
function saveLooks(l) { try { fs.writeFileSync(LOOKS_FILE, JSON.stringify(l, null, 2)); } catch(e) { console.error(e); } }
function _seedLooks() {
  const mkAnim = (speed, e, x, m) => ({ speed, enterEase: e, exitEase: x, moveEase: m, dataChangeStyle: 'fade', bgSpeed: 'medium', overrides: {} });
  const pal = (a, b, c, d) => [
    { name: 'Primary', hex: a }, { name: 'Secondary', hex: b }, { name: 'Light', hex: c }, { name: 'Dark', hex: d },
  ];
  const mk = (name, data) => ({ id: 'look_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), data });
  return [
    mk('Broadcast Clean', { palette: pal('#1ffaff', '#a7a38e', '#F7F5F0', '#0a1b20'), blueAccent: '#1e6fff', redAccent: '#ff3b3b', bgType: 'transparent', bgColor: '#070f12', animation: mkAnim('medium', 'easeOutQuart', 'easeInQuart', 'easeInOutQuad') }),
    mk('Neon Surge',      { palette: pal('#ff2bd1', '#19e3ff', '#fdf0ff', '#120018'), blueAccent: '#19e3ff', redAccent: '#ff2bd1', bgType: 'transparent', bgColor: '#0a0014', animation: mkAnim('fast', 'easeOutExpo', 'easeInExpo', 'easeInOutExpo') }),
    mk('Big Impact',      { palette: pal('#ffc83d', '#ff5a3c', '#fff6e6', '#1a1208'), blueAccent: '#3d7bff', redAccent: '#ff5a3c', bgType: 'transparent', bgColor: '#120c04', animation: mkAnim('slow', 'easeOutBack', 'easeInBack', 'easeInOutQuint') }),
  ];
}
function getLooks() {
  let looks = loadLooks();
  if (!Array.isArray(looks)) { looks = _seedLooks(); saveLooks(looks); }
  return looks;
}

function snapshotForProfile() {
  // Settings snapshot — exclude graphicsToken so each install keeps its own auth token,
  // and customFonts so the uploaded-font library stays global (profiles only carry the
  // overlayFont *selection*, not the font files).
  const settingsSnap = JSON.parse(JSON.stringify(state.settings || {}));
  delete settingsSnap.graphicsToken;
  delete settingsSnap.customFonts;
  const pp = state.prizepool || {};
  return {
    tournament: JSON.parse(JSON.stringify(state.tournament)),
    bracket: { title: state.bracket.title, rounds: JSON.parse(JSON.stringify(state.bracket.rounds)) },
    match: (({ team1, team2, game, format, tournament, tournamentLogo, sponsorLogos,
                fearlessDraft, currentGameNum, seriesGames, scheduleDayId, scheduleGameId }) =>
      ({ team1, team2, game, format, tournament, tournamentLogo, sponsorLogos,
         fearlessDraft, currentGameNum, seriesGames, scheduleDayId, scheduleGameId }))(state.match),
    players: JSON.parse(JSON.stringify(state.players)),
    prizepool: { showLogo: pp.showLogo, logoScale: pp.logoScale, logoPosition: pp.logoPosition, entries: JSON.parse(JSON.stringify(pp.entries || [])) },
    settings: settingsSnap,
  };
}

let state = loadState();
_teams = loadTeams(); // prime in-memory cache after state is ready
_ensureTeamPool();    // migrate legacy tournaments to an explicit competing-teams pool

// ── Bus state (in-memory, not persisted) ───────────────────────────────────────
let busState = {};
function initBusState() {
  const buses = (state.settings && state.settings.buses) || [];
  buses.forEach(b => { if (!busState[b.id]) busState[b.id] = { activeGraphic: null, visible: false }; });
}
initBusState();

// ── Live switcher (OBS / vMix) on-air detection ────────────────────────────────
// Maps a switcher source to one of our graphic keys: OBS by browser-source URL,
// vMix by input title (best-effort). Bus pages resolve to the bus's active graphic.
const GRAPHIC_PATHS = {
  lowerThird: 'graphics/lower-third', headToHead: 'graphics/head2head', playerIntro: 'graphics/player-intro',
  preShow: 'graphics/pre-show', draft: 'graphics/draft', bracket: 'graphics/bracket',
  groupStage: 'graphics/group-stage', tournamentStructure: 'graphics/tournament-structure',
  prizepool: 'graphics/prizepool', winScreen: 'graphics/win-screen', breakScreen: 'graphics/break-screen',
  playerSpotlight: 'graphics/player-spotlight',
  bgOutput: 'graphics/bg-output',
};
const GRAPHIC_LABELS = {
  lowerThird: 'lower third', headToHead: 'head to head', playerIntro: 'player intro',
  preShow: 'pre-show', draft: 'draft', bracket: 'bracket', groupStage: 'group stage',
  tournamentStructure: 'tournament structure', prizepool: 'prize', winScreen: 'win screen',
  breakScreen: 'break screen', bgOutput: 'background', ticker: 'ticker', playerSpotlight: 'player spotlight',
};
function _switcherByUrl(url) {
  if (!url) return null;
  let pathname; try { pathname = new URL(url).pathname; } catch (e) { pathname = String(url); }
  const busM = pathname.match(/\/bus\/([^/?#]+)/);
  if (busM) { const bs = busState[busM[1]]; return (bs && bs.visible) ? (bs.activeGraphic || null) : null; }
  for (const key in GRAPHIC_PATHS) { if (pathname.includes(GRAPHIC_PATHS[key])) return key; }
  return null;
}
function _switcherByTitle(title) {
  if (!title) return null;
  const t = String(title).toLowerCase();
  for (const key in GRAPHIC_LABELS) { if (t.includes(GRAPHIC_LABELS[key]) || t.includes(key.toLowerCase())) return key; }
  return null;
}
function sanitizeSwitcher(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const port = (v, d) => { const n = parseInt(v, 10); return (n >= 1 && n <= 65535) ? n : d; };
  const str = (v) => (typeof v === 'string' ? v.slice(0, 200) : '');
  return {
    type: ['obs', 'vmix'].includes(s.type) ? s.type : 'none',
    enabled: !!s.enabled,
    showPreview: !!s.showPreview,
    obs:  { host: str((s.obs || {}).host) || '127.0.0.1',  port: port((s.obs || {}).port, 4455),  password: str((s.obs || {}).password) },
    vmix: { host: str((s.vmix || {}).host) || '127.0.0.1', port: port((s.vmix || {}).port, 8088) },
  };
}
switcher.configure({
  settings: state.settings,
  matchers: { byUrl: _switcherByUrl, byTitle: _switcherByTitle },
  onChange: (snap) => io.emit('switcher:state', snap),
});

let _saveTimer = null;
function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(function() { _saveTimer = null; saveState(); }, 300);
}
// Flush any pending debounced save on clean exit
process.on('SIGINT',  function() { if (_saveTimer) { clearTimeout(_saveTimer); saveState(); } process.exit(0); });
process.on('SIGTERM', function() { if (_saveTimer) { clearTimeout(_saveTimer); saveState(); } process.exit(0); });

function broadcastSchedule() { io.emit('schedule', state.tournament.schedule || []); }
// Build the state payload sent over sockets / GET /api/state. The graphics token
// is only included for admins (the control panel needs it to render output URLs);
// operators and graphics-token connections get it stripped.
function buildStatePayload(includeToken) {
  const { schedule: _s, ...tournamentForBcast } = (state.tournament || {});
  const payload = Object.assign({}, state, { tournament: tournamentForBcast, teams: _teams, busState, switcher: switcher.getSnapshot() });
  if (!includeToken && payload.settings) {
    payload.settings = Object.assign({}, payload.settings); // clone so we don't mutate real state
    delete payload.settings.graphicsToken;
    if (payload.settings.switcher) {            // hide switcher creds/config from non-admins
      payload.settings = Object.assign({}, payload.settings);
      delete payload.settings.switcher;
    }
  }
  return payload;
}
function broadcast() {
  scheduleSave();
  io.to('gfxAdmins').emit('state', buildStatePayload(true));
  io.to('gfxBasic').emit('state', buildStatePayload(false));
  pushSSEState();
}

// ── SSE (Server-Sent Events) for Companion / external integrations ─────────────
const _sseClients = new Set();
const SSE_GRAPHIC_KEYS = ['lowerThird','headToHead','playerIntro','draft','bracket','groupStage','breakScreen','winScreen','playerSpotlight','prizepool','ticker'];
function buildSSEPayload() {
  const visibilities = {};
  SSE_GRAPHIC_KEYS.forEach(k => { if (state[k]) visibilities[k] = !!state[k].visible; });
  return JSON.stringify({
    type: 'state',
    visibilities,
    busState,
    scores: { team1: state.match?.team1?.score ?? 0, team2: state.match?.team2?.score ?? 0 },
    draftPhase: state.draft?.phase || 'notstarted',
    timerRunning: !!(state.draft?.timerEnd && state.draft.timerEnd > Date.now()),
    activeProfile: state.meta?.activeProfileName || null,
  });
}
function pushSSEState() {
  if (!_sseClients.size) return;
  const msg = `data: ${buildSSEPayload()}\n\n`;
  for (const client of _sseClients) {
    try { client.write(msg); } catch(e) { _sseClients.delete(client); }
  }
}

let tournamentStatsCache = null;
function invalidateStatsCache() { tournamentStatsCache = null; io.emit('stats:invalidated'); }

function buildTournamentStats() {
  const teams = _teams;
  const stats = {};

  const getTeamName = (id, override) => {
    if (override) return override;
    const t = teams.find(x => x.id === id);
    return t ? (t.name || t.tag || 'TBD') : 'TBD';
  };

  const parseChampion = url => {
    if (!url) return null;
    const file = url.split('/').pop();
    const name = file.split('_')[0];
    return name || null;
  };

  const processGames = (games, t1Name, t2Name) => {
    (games || []).forEach(game => {
      if (!game || game.isBye) return;
      [
        { picks: game.t1RolePicks, players: (game.players && game.players.team1) || [], won: game.winner === 'team1', opponentName: t2Name, mySide: game.t1Side },
        { picks: game.t2RolePicks, players: (game.players && game.players.team2) || [], won: game.winner === 'team2', opponentName: t1Name, mySide: game.t2Side },
      ].forEach(({ picks, players, won, opponentName, mySide }) => {
        players.forEach((p, i) => {
          const handle = p.handle;
          if (!handle) return;
          const champ = parseChampion((picks || [])[i]);
          if (!champ) return;
          if (!stats[handle]) stats[handle] = {};
          if (!stats[handle][champ]) stats[handle][champ] = { games: 0, wins: 0, losses: 0, imgUrl: (picks || [])[i], matchRefs: [] };
          const entry = stats[handle][champ];
          entry.games++;
          won ? entry.wins++ : entry.losses++;
          entry.matchRefs.push({ opponentName, gameNum: game.gameNum, side: mySide, won });
        });
      });
    });
  };

  // All completed schedule matches
  (state.tournament.schedule || []).forEach(day => {
    (day.games || []).forEach(sg => {
      if (!sg.result || !sg.result.completed) return;
      const t1Name = getTeamName(sg.team1Id, sg.team1Override);
      const t2Name = getTeamName(sg.team2Id, sg.team2Override);
      processGames(sg.result.games, t1Name, t2Name);
    });
  });

  // Active in-progress series (only if not already committed to a completed result)
  let activeAlreadyCommitted = false;
  if (state.match.scheduleDayId && state.match.scheduleGameId) {
    const _day = (state.tournament.schedule || []).find(d => d.id === state.match.scheduleDayId);
    const _sg  = _day && _day.games.find(g => g.id === state.match.scheduleGameId);
    if (_sg && _sg.result && _sg.result.completed) activeAlreadyCommitted = true;
  }
  if (!activeAlreadyCommitted) {
    processGames(state.match.seriesGames, state.match.team1.name || 'Team 1', state.match.team2.name || 'Team 2');
  }

  Object.values(stats).forEach(champMap => {
    Object.values(champMap).forEach(entry => {
      entry.winRate = entry.games > 0 ? Math.round((entry.wins / entry.games) * 100) : 0;
    });
  });

  return stats;
}

// Translates a raw stage key (e.g. 'bracket-round-0', 'groupStage') to a display label.
const _STAGE_LABEL_MAP = {
  groupStage:'Group Stage', roundOf16:'Round of 16', quarterfinals:'Quarterfinals',
  semifinals:'Semifinals', finals:'Finals', thirdPlace:'3rd Place',
  upperBracket:'Upper Bracket', lowerBracket:'Lower Bracket', lowerBracketFinal:'LB Final', grandFinals:'Grand Finals'
};
function resolveStageLabel(key) {
  if (!key) return '';
  if (_STAGE_LABEL_MAP[key]) return _STAGE_LABEL_MAP[key];
  if (key.startsWith('bracket-round-')) {
    const idx   = parseInt(key.replace('bracket-round-', ''));
    const round = (state.bracket && state.bracket.rounds || [])[idx];
    return round ? (round.label || ('Round ' + (idx + 1))) : key;
  }
  return key;
}

// Builds state.todayGames from the schedule day that is currently loaded.
// Called before every broadcast() that touches match / series state.
function deriveTodayGames() {
  const dayId  = state.match && state.match.scheduleDayId;
  const gameId = state.match && state.match.scheduleGameId;
  if (!dayId) { state.todayGames = []; return; }
  const day = (state.tournament.schedule || []).find(d => d.id === dayId);
  if (!day)  { state.todayGames = []; return; }
  const teams = _teams;
  // Resolve a single team — override text > bracket live > saved ID > TBD
  const resolveTeam = (id, override) => {
    if (override) return { name: override, tag: override, logo: '' };
    if (!id)      return { name: 'TBD',    tag: 'TBD',    logo: '' };
    const t = teams.find(x => x.id === id) || {};
    return { name: t.name||'', tag: t.tag||'', logo: t.logo||'' };
  };
  // Resolve team from a bracket match team entry (name-based lookup)
  const resolveFromBracket = bTeam => {
    const name = bTeam && bTeam.name;
    if (!name || name === 'TBD') return { name: 'TBD', tag: 'TBD', logo: '' };
    const t = teams.find(x =>
      (x.name && x.name.toLowerCase() === name.toLowerCase()) ||
      (x.tag  && x.tag.toLowerCase()  === name.toLowerCase())
    ) || {};
    return { name: t.name || name, tag: t.tag || name, logo: t.logo || '' };
  };

  state.todayGames = (day.games || []).map((sg, idx) => {
    let team1, team2;
    // Live bracket link: always reflect current bracket match state
    if (sg.bracketRoundIdx != null && sg.bracketMatchIdx != null) {
      const bRound = (state.bracket.rounds || [])[sg.bracketRoundIdx];
      const bMatch = bRound && (bRound.matches || [])[sg.bracketMatchIdx];
      if (bMatch) {
        team1 = resolveFromBracket(bMatch.team1);
        team2 = resolveFromBracket(bMatch.team2);
      }
    }
    if (!team1) team1 = resolveTeam(sg.team1Id, sg.team1Override);
    if (!team2) team2 = resolveTeam(sg.team2Id, sg.team2Override);
    return {
      id:             sg.id,
      gameIndex:      idx,
      team1, team2,
      format:         sg.format  || 'Bo3',
      stage:          resolveStageLabel(sg.stage || ''),
      result:         sg.result  || null,
      isCurrent:      sg.id === gameId,
      bracketLinked:  sg.bracketRoundIdx != null
    };
  });

  // Build auto ticker items from today's game list
  state.ticker = state.ticker || {};
  const autoItems = [];
  state.todayGames.forEach(g => {
    const t1 = g.team1.name || g.team1.tag || '?';
    const t2 = g.team2.name || g.team2.tag || '?';
    if (g.result && g.result.completed) {
      autoItems.push({
        completed: true,
        t1: t1, t2: t2,
        score1: g.result.team1SeriesScore,
        score2: g.result.team2SeriesScore,
        winner: g.result.winner,   // 'team1' | 'team2'
        text: t1 + '  ' + g.result.team1SeriesScore + '-' + g.result.team2SeriesScore + '  ' + t2
      });
    } else if (g.isCurrent) {
      const ls1 = (state.match.team1 && state.match.team1.score) || 0;
      const ls2 = (state.match.team2 && state.match.team2.score) || 0;
      const scoreStr = (ls1 > 0 || ls2 > 0) ? '  ' + ls1 + '-' + ls2 : '';
      autoItems.push({ text: t1 + ' vs ' + t2 + scoreStr + (g.format ? '  —  ' + g.format : ''), live: true });
    } else {
      autoItems.push({ text: t1 + ' vs ' + t2 + (g.format ? '  —  ' + g.format : '') });
    }
  });
  state.ticker.autoItems = autoItems;
}

// Bootstrap: compute derived fields immediately from whatever was last persisted
deriveTodayGames();

// ── Config API (public) ────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => res.json({ externalUrl: EXTERNAL_URL }));

// ── State API ──────────────────────────────────────────────────────────────────
app.get('/api/state', (req, res) => {
  const isAdmin = req.session && req.session.user && ['admin','superadmin'].includes(req.session.user.role);
  if (isAdmin) return res.json(state);
  const safe = Object.assign({}, state, { settings: Object.assign({}, state.settings) });
  delete safe.settings.graphicsToken;
  res.json(safe);
});
app.post('/api/state/reset', requireAdmin, (req, res) => { state = makeDefault(); deriveTodayGames(); broadcastSchedule(); broadcast(); res.json({ ok: true }); });
app.post('/api/match',  requireAdmin, (req, res) => { deepMerge(state.match, req.body); broadcast(); res.json({ ok: true }); });

app.post('/api/score', (req, res) => {
  const { team, delta } = req.body;
  if (state.match[team]) state.match[team].score = Math.max(0, (state.match[team].score||0) + Number(delta));
  broadcast(); res.json({ ok: true });
});

app.post('/api/players', requireAdmin, (req, res) => {
  const { team, index, data } = req.body;
  if (state.players[team] && state.players[team][index] !== undefined) Object.assign(state.players[team][index], data);
  broadcast(); res.json({ ok: true });
});
app.post('/api/subs', requireAdmin, (req, res) => {
  const { team, index, data } = req.body;
  const key = team + 'subs';
  if (state.players[key] && state.players[key][index] !== undefined) Object.assign(state.players[key][index], data);
  broadcast(); res.json({ ok: true });
});
app.post('/api/players/swap', requireAdmin, (req, res) => {
  const { team, playerIndex, subIndex } = req.body;
  const subsKey = team + 'subs';
  if (!state.players[team] || !state.players[subsKey]) return res.status(400).json({ error: 'Invalid team' });
  const player = { ...state.players[team][playerIndex] };
  const sub    = { ...state.players[subsKey][subIndex] };
  if (!player || !sub) return res.status(400).json({ error: 'Invalid index' });
  state.players[team][playerIndex] = { ...sub,    role: player.role, active: true };
  state.players[subsKey][subIndex] = { ...player, role: sub.role,    active: false };
  broadcast(); res.json({ ok: true });
});
app.post('/api/match/load-team', requireAdmin, (req, res) => {
  const { slot, teamId } = req.body;
  if (!slot || !teamId) return res.status(400).json({ error: 'slot and teamId required' });
  const team = _teams.find(t => t.id === teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const score = state.match[slot] ? state.match[slot].score : 0;
  state.match[slot] = { name: team.name||'', tag: team.tag||'', logo: team.logo||'', score, teamId: team.id };
  const tp = team.players || [];
  DEFAULT_ROLES.forEach((role, i) => {
    const p = tp[i] || {};
    state.players[slot][i] = { name: p.name||'', handle: p.handle||'', role, country: p.country||'', active: true, opggRegion: p.opggRegion||'', riotId: p.riotId||'' };
  });
  const subsKey = slot + 'subs';
  const ts = team.subs || [];
  state.players[subsKey] = [0,1,2].map(i => {
    const s = ts[i] || {};
    return { name: s.name||'', handle: s.handle||'', role: s.role||'', country: s.country||'', active: false, opggRegion: s.opggRegion||'', riotId: s.riotId||'' };
  });
  broadcast(); res.json({ ok: true });
});

// State key → ctrl-bar page key (for attribution + logging)
const GRAPHIC_PAGE_KEYS = {
  lowerThird: 'lower-thirds', headToHead: 'h2h', playerIntro: 'player-intro',
  draft: 'draft-gfx', bracket: 'bracket', breakScreen: 'break-screen',
  winScreen: 'win-screen', preShow: 'pre-show',
  tournamentStructure: 'tournament-structure', groupStage: 'standings',
  prizepool: 'prizepool', ticker: 'ticker', playerSpotlight: 'player-spotlight'
};

function findBusForGraphic(graphicName) {
  const buses = (state.settings && state.settings.buses) || [];
  return buses.find(b => (b.assignments || []).includes(graphicName)) || null;
}

// Graphic visibility (both roles)
app.post('/api/graphic/:name/show', (req, res) => {
  const name = req.params.name;
  if (state[name] !== undefined) state[name].visible = true;
  // Auto-route: if graphic is assigned to a bus, activate it there
  const bus = findBusForGraphic(name);
  if (bus) {
    if (!busState[bus.id]) busState[bus.id] = {};
    busState[bus.id].activeGraphic = name;
    busState[bus.id].visible = true;
    io.emit('bus:active', { busId: bus.id, graphic: name, visible: true });
    io.emit('busState', busState);
  }
  const pageKey = GRAPHIC_PAGE_KEYS[name] || name;
  const user = resolveUserFromReq(req); const role = resolveRoleFromReq(req);
  recordAction(pageKey, user, 'Show'); logAction(user, role, 'show', pageKey);
  broadcast(); res.json({ ok: true });
});
app.post('/api/graphic/:name/hide', (req, res) => {
  const name = req.params.name;
  if (state[name] !== undefined) state[name].visible = false;
  // Auto-deactivate: if this is the currently active graphic on its bus, hide the bus
  const bus = findBusForGraphic(name);
  if (bus && busState[bus.id] && busState[bus.id].activeGraphic === name) {
    busState[bus.id].visible = false;
    io.emit('bus:active', { busId: bus.id, graphic: name, visible: false });
    io.emit('busState', busState);
  }
  const pageKey = GRAPHIC_PAGE_KEYS[name] || name;
  const user = resolveUserFromReq(req); const role = resolveRoleFromReq(req);
  recordAction(pageKey, user, 'Hide'); logAction(user, role, 'hide', pageKey);
  broadcast(); res.json({ ok: true });
});

// ── Graphic toggle ─────────────────────────────────────────────────────────────
app.post('/api/graphic/:name/toggle', (req, res) => {
  const name = req.params.name;
  if (state[name] !== undefined) {
    const nowVisible = !state[name].visible;
    state[name].visible = nowVisible;
    const bus = findBusForGraphic(name);
    if (bus) {
      if (!busState[bus.id]) busState[bus.id] = {};
      if (nowVisible) {
        busState[bus.id].activeGraphic = name;
        busState[bus.id].visible = true;
      } else if (busState[bus.id].activeGraphic === name) {
        busState[bus.id].visible = false;
      }
      io.emit('bus:active', { busId: bus.id, graphic: name, visible: nowVisible });
      io.emit('busState', busState);
    }
    const pageKey = GRAPHIC_PAGE_KEYS[name] || name;
    const user = resolveUserFromReq(req); const role = resolveRoleFromReq(req);
    const action = nowVisible ? 'Show' : 'Hide';
    recordAction(pageKey, user, action); logAction(user, role, action.toLowerCase(), pageKey);
  }
  broadcast(); res.json({ ok: true });
});

// ── Score shortcuts ────────────────────────────────────────────────────────────
app.post('/api/match/score/team1/increment', requireAuth, (req, res) => { state.match.team1.score = Math.max(0, (state.match.team1.score||0) + 1); broadcast(); res.json({ ok: true }); });
app.post('/api/match/score/team1/decrement', requireAuth, (req, res) => { state.match.team1.score = Math.max(0, (state.match.team1.score||0) - 1); broadcast(); res.json({ ok: true }); });
app.post('/api/match/score/team2/increment', requireAuth, (req, res) => { state.match.team2.score = Math.max(0, (state.match.team2.score||0) + 1); broadcast(); res.json({ ok: true }); });
app.post('/api/match/score/team2/decrement', requireAuth, (req, res) => { state.match.team2.score = Math.max(0, (state.match.team2.score||0) - 1); broadcast(); res.json({ ok: true }); });

// ── Game navigation ────────────────────────────────────────────────────────────
app.post('/api/match/next-game', requireAdmin, (req, res) => {
  state.match.currentGameNum = (state.match.currentGameNum || 1) + 1;
  state.draft.picks = Array(20).fill('');
  state.draft.committedT1Picks = []; state.draft.committedT2Picks = [];
  state.draft.team1RolePicks = [];   state.draft.team2RolePicks = [];
  state.draft.phase = 'notstarted';  state.draft.currentStep = 0;
  broadcast(); res.json({ ok: true });
});
app.post('/api/match/prev-game', requireAdmin, (req, res) => {
  state.match.currentGameNum = Math.max(1, (state.match.currentGameNum || 1) - 1);
  broadcast(); res.json({ ok: true });
});

// ── Draft timer toggle ─────────────────────────────────────────────────────────
app.post('/api/draft/timer/toggle', requireAuth, (req, res) => {
  if (state.draft.timerEnd && state.draft.timerEnd > Date.now()) {
    state.draft.timerEnd = null;
  } else {
    state.draft.timerEnd = Date.now() + (state.draft.timerDuration || 60) * 1000;
  }
  broadcast(); res.json({ ok: true });
});

// ── Bus cycle ─────────────────────────────────────────────────────────────────
app.post('/api/bus/:id/next', requireAuth, (req, res) => {
  const busId = req.params.id;
  const bus = (state.settings.buses || []).find(b => b.id === busId);
  if (!bus || !(bus.assignments || []).length) return res.status(400).json({ error: 'Bus not found or no assignments' });
  const assignments = bus.assignments;
  const current = busState[busId] ? busState[busId].activeGraphic : null;
  const idx = current ? assignments.indexOf(current) : -1;
  const nextGraphic = assignments[(idx + 1) % assignments.length];
  if (!busState[busId]) busState[busId] = {};
  busState[busId].activeGraphic = nextGraphic;
  busState[busId].visible = true;
  if (state[nextGraphic] !== undefined) state[nextGraphic].visible = true;
  io.emit('bus:active', { busId, graphic: nextGraphic, visible: true });
  io.emit('busState', busState);
  broadcast(); res.json({ ok: true });
});

// ── Companion profile generator (Companion 4.x format) ────────────────────────
app.get('/api/companion/profile', (req, res) => {
  const hasSession = req.session && req.session.user;
  const hasToken = req.query.token && state.settings && state.settings.graphicsToken === req.query.token;
  if (!hasSession && !hasToken) return res.status(401).json({ error: 'Unauthorized' });

  function genId() { return require('crypto').randomBytes(10).toString('base64url'); }

  const proto = req.protocol, host = req.get('host');
  const baseUrl = `${proto}://${host}`;
  const graphicsToken = state.settings && state.settings.graphicsToken;
  const tokenSuffix = graphicsToken ? `?token=${encodeURIComponent(graphicsToken)}` : '';
  const connId = genId();

  const GRAPHIC_LABELS = {
    lowerThird:'Lower Third', headToHead:'Head to Head', playerIntro:'Player Intro',
    draft:'Draft', bracket:'Bracket', groupStage:'Group Stage',
    breakScreen:'Break Screen', winScreen:'Win Screen', playerSpotlight:'Player Spotlight', prizepool:'Prizepool', ticker:'Ticker',
  };
  const GRAPHICS = Object.keys(GRAPHIC_LABELS);

  const PAGE_ACTIONS = {
    1: GRAPHICS.flatMap(id => [
      { label: `Show\n${GRAPHIC_LABELS[id]}`,   path: `/api/graphic/${id}/show` },
      { label: `Hide\n${GRAPHIC_LABELS[id]}`,   path: `/api/graphic/${id}/hide` },
    ]),
    2: GRAPHICS.map(id => ({ label: `Toggle\n${GRAPHIC_LABELS[id]}`, path: `/api/graphic/${id}/toggle` })),
    3: [
      { label: 'T1 Score\n+1',    path: '/api/match/score/team1/increment' },
      { label: 'T1 Score\n-1',    path: '/api/match/score/team1/decrement' },
      { label: 'T2 Score\n+1',    path: '/api/match/score/team2/increment' },
      { label: 'T2 Score\n-1',    path: '/api/match/score/team2/decrement' },
      { label: 'Next\nGame',      path: '/api/match/next-game' },
      { label: 'Prev\nGame',      path: '/api/match/prev-game' },
      { label: 'Draft\nTimer',    path: '/api/draft/timer/toggle' },
      { label: 'Reset\nDraft',    path: '/api/draft', body: '{"phase":"notstarted","currentStep":0}' },
      { label: 'Replay\nIntro',   path: '/api/draft', body: '{"replayIntro":true}' },
    ],
    4: (state.settings.buses || []).map(b => ({ label: `${b.name || b.id}\nNext`, path: `/api/bus/${b.id}/next` })),
  };
  const PAGE_NAMES = { 1: 'GFX Show/Hide', 2: 'GFX Toggle', 3: 'Match & Draft', 4: 'Bus' };

  const pages = {};
  for (const [pageNum, pageName] of Object.entries(PAGE_NAMES)) {
    const acts = PAGE_ACTIONS[pageNum] || [];
    const controls = {};
    acts.forEach((a, idx) => {
      const row = Math.floor(idx / 8), col = idx % 8;
      if (!controls[row]) controls[row] = {};
      controls[row][col] = {
        type: 'button',
        style: { text: a.label, textExpression: false, size: 'auto', png64: null,
                 alignment: 'center:center', pngalignment: 'center:center',
                 color: 16777215, bgcolor: 0, show_topbar: 'default' },
        options: { stepProgression: 'auto', stepExpression: '', rotaryActions: false },
        feedbacks: [],
        steps: { '0': {
          action_sets: {
            down: [{ id: genId(), type: 'action', connectionId: connId,
                     definitionId: 'post',
                     options: {
                       url:                    { value: `${baseUrl}${a.path}${tokenSuffix}`, isExpression: false },
                       body:                   { value: a.body || '',                         isExpression: false },
                       contenttype:            { value: 'application/json',                  isExpression: false },
                       // Must be wrapped like the other options — Companion unwraps {value} at
                       // runtime; a bare '' resolves to undefined → String(undefined)='undefined'
                       // → the module logs "set variable $(custom:undefined)" on every press.
                       statusCodeVariable:     { value: '', isExpression: false },
                       jsonResultDataVariable: { value: '', isExpression: false },
                     },
                     upgradeIndex: 1 }],
            up: [],
          },
          options: { runWhileHeld: [] },
        }},
        localVariables: [],
      };
    });
    pages[pageNum] = {
      id: genId(), name: pageName, controls,
      gridSize: { minColumn: 0, maxColumn: 7, minRow: 0, maxRow: Math.max(3, acts.length > 0 ? Math.floor((acts.length - 1) / 8) : 0) },
    };
  }

  const profile = {
    version: 12,
    type: 'full',
    companionBuild: '4.0.0+metagfx-generated',
    pages,
    triggers: {},
    triggerCollections: [],
    custom_variables: {},
    customVariablesCollections: [],
    expressionVariables: {},
    expressionVariablesCollections: [],
    instances: {
      [connId]: {
        moduleInstanceType: 'connection',
        moduleVersionId: null,
        updatePolicy: 'stable',
        sortOrder: 0,
        label: 'MetaGFX',
        isFirstInit: true,
        config: { prefix: baseUrl },
        secrets: {},
        lastUpgradeIndex: 0,
        enabled: true,
        moduleId: 'generic-http',
      },
    },
    connectionCollections: [],
    surfaces: {},
    surfaceGroups: {},
    surfacesRemote: {},
    surfaceInstances: {},
    surfaceInstanceCollections: [],
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="metagfx-companion.companionconfig"');
  res.json(profile);
});

app.post('/api/lowerThird',  (req, res) => { Object.assign(state.lowerThird,  req.body); broadcast(); res.json({ok:true}); });
app.post('/api/draft', (req, res) => {
  const prevStep = state.draft.currentStep;
  // replayIntro:true is a signal, not a stored value — convert to counter increment
  if (req.body.replayIntro) {
    state.draft.introTrigger = (state.draft.introTrigger || 0) + 1;
    delete req.body.replayIntro;
  }
  deepMerge(state.draft, req.body);
  // Auto-reset timer when step advances and timer is active
  if (state.draft.currentStep !== prevStep && state.draft.timerDuration > 0 && state.draft.timerVisible) {
    state.draft.timerEnd = Date.now() + state.draft.timerDuration * 1000;
  }
  broadcast(); res.json({ ok: true });
});
app.post('/api/bgOutput', requireAdmin, (req, res) => { deepMerge(state.bgOutput, req.body); broadcast(); res.json({ok:true}); });
app.post('/api/breakScreen', (req, res) => { Object.assign(state.breakScreen, req.body); broadcast(); res.json({ok:true}); });
app.post('/api/winScreen',   (req, res) => { Object.assign(state.winScreen,   req.body); broadcast(); res.json({ok:true}); });
app.post('/api/playerSpotlight', (req, res) => { Object.assign(state.playerSpotlight, req.body); broadcast(); res.json({ok:true}); });
app.post('/api/headToHead',  (req, res) => { Object.assign(state.headToHead,  req.body); broadcast(); res.json({ok:true}); });
app.post('/api/playerIntro', (req, res) => { Object.assign(state.playerIntro, req.body); broadcast(); res.json({ok:true}); });
app.post('/api/preShow',     (req, res) => { Object.assign(state.preShow,     req.body); broadcast(); res.json({ok:true}); });
app.post('/api/bracket',     requireAdmin, (req, res) => { deepMerge(state.bracket, req.body); deriveTodayGames(); broadcast(); res.json({ok:true}); });
app.post('/api/groupStage',           requireAdmin, (req, res) => { Object.assign(state.groupStage,           req.body); broadcast(); res.json({ok:true}); });
app.post('/api/tournamentStructure',  requireAdmin, (req, res) => { Object.assign(state.tournamentStructure,  req.body); broadcast(); res.json({ok:true}); });
app.post('/api/prizepool', requireAdmin, (req, res) => {
  const { entries, ...settings } = req.body;
  Object.assign(state.prizepool, settings);
  if (entries !== undefined) state.prizepool.entries = entries;
  broadcast(); res.json({ ok: true });
});
app.post('/api/prizepool/entry/add', requireAdmin, (req, res) => {
  if (!state.prizepool.entries) state.prizepool.entries = [];
  const entry = {
    id: 'pp_' + Date.now(),
    type: req.body.type || 'placement',
    label: req.body.label || '',
    value: req.body.value || '',
    highlight: !!req.body.highlight,
    sponsorName: req.body.sponsorName || '',
    sponsorLogo: req.body.sponsorLogo || '',
    prizeImage:  req.body.prizeImage  || '',
    imageScale:  req.body.imageScale != null ? req.body.imageScale : 15
  };
  state.prizepool.entries.push(entry);
  broadcast(); res.json({ ok: true, entry });
});
app.post('/api/prizepool/entry/update', requireAdmin, (req, res) => {
  const entry = (state.prizepool.entries || []).find(e => e.id === req.body.id);
  if (entry) Object.assign(entry, req.body);
  broadcast(); res.json({ ok: true });
});
app.post('/api/prizepool/entry/delete', requireAdmin, (req, res) => {
  state.prizepool.entries = (state.prizepool.entries || []).filter(e => e.id !== req.body.id);
  broadcast(); res.json({ ok: true });
});
app.post('/api/prizepool/entry/reorder', requireAdmin, (req, res) => {
  const entries = state.prizepool.entries || [];
  const idx = entries.findIndex(e => e.id === req.body.id);
  if (idx === -1) return res.json({ ok: true });
  const ni = req.body.direction === 'up' ? idx - 1 : idx + 1;
  if (ni < 0 || ni >= entries.length) return res.json({ ok: true });
  [entries[idx], entries[ni]] = [entries[ni], entries[idx]];
  broadcast(); res.json({ ok: true });
});
app.post('/api/ticker',      (req, res) => { Object.assign(state.ticker,      req.body); broadcast(); res.json({ok:true}); });

// ── Riot API rank fetch ───────────────────────────────────────────────────────
const RIOT_REGION_MAP = {
  kr:   { platform: 'kr',    routing: 'asia'     },
  euw:  { platform: 'euw1',  routing: 'europe'   },
  na:   { platform: 'na1',   routing: 'americas' },
  eune: { platform: 'eune1', routing: 'europe'   },
  jp:   { platform: 'jp1',   routing: 'asia'     },
  oce:  { platform: 'oc1',   routing: 'americas' }, // sea cluster blocked on dev keys
  br:   { platform: 'br1',   routing: 'americas' },
  las:  { platform: 'la2',   routing: 'americas' },
  lan:  { platform: 'la1',   routing: 'americas' },
  ru:   { platform: 'ru',    routing: 'europe'   },
  tr:   { platform: 'tr1',   routing: 'europe'   },
};

app.post('/api/ranks/refresh', requireAdmin, async (req, res) => {
  const key = process.env.RIOT_API_KEY;
  if (!key) {
    logAction(resolveUserFromReq(req), resolveRoleFromReq(req), 'ranks-refresh', 'FAILED: RIOT_API_KEY not set in .env');
    return res.status(500).json({ error: 'RIOT_API_KEY not set in .env' });
  }

  const updated = [], errors = [];

  for (const slot of ['team1', 'team2']) {
    const players = state.players[slot] || [];
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (!p.riotId || !p.opggRegion) continue;
      const parts = p.riotId.split('#');
      if (parts.length !== 2 || !parts[0] || !parts[1]) continue;
      const [gameName, tagLine] = parts;
      const region = RIOT_REGION_MAP[(p.opggRegion || '').toLowerCase()];
      if (!region) { errors.push(`${p.handle}: unknown region "${p.opggRegion}"`); continue; }

      try {
        // 1 — Riot ID → PUUID (account-v1, routing cluster)
        const acctR = await fetch(
          `https://${region.routing}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
          { headers: { 'X-Riot-Token': key } }
        );
        if (!acctR.ok) throw new Error(`Account lookup ${acctR.status}`);
        const acct = await acctR.json();

        // 2 — PUUID → ranked entries directly (summoner ID no longer needed)
        const rankR = await fetch(
          `https://${region.platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${acct.puuid}`,
          { headers: { 'X-Riot-Token': key } }
        );
        if (!rankR.ok) throw new Error(`Rank lookup ${rankR.status}`);
        const entries = await rankR.json();

        const solo = entries.find(e => e.queueType === 'RANKED_SOLO_5x5');
        state.players[slot][i].rank = solo
          ? { tier: solo.tier, division: solo.rank, lp: solo.leaguePoints, wins: solo.wins, losses: solo.losses }
          : null;

        updated.push(p.handle);
        await new Promise(r => setTimeout(r, 120)); // stay within rate limits
      } catch (err) {
        errors.push(`${p.handle}: ${err.message}`);
      }
    }
  }

  if (errors.length) logAction(resolveUserFromReq(req), resolveRoleFromReq(req), 'ranks-refresh', _logTrunc('FAILED ' + errors.length + ': ' + errors.join('; ')));

  broadcast();
  res.json({ ok: true, updated, errors });
});

// ── op.gg champion pool fetch ─────────────────────────────────────────────────
async function opggCall(toolName, args) {
  const r = await fetch('https://mcp-api.op.gg/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: toolName, arguments: args }, id: 1 }),
  });
  if (!r.ok) throw new Error(`op.gg HTTP ${r.status}`);
  const json = await r.json();
  if (json.error) throw new Error(json.error.message || 'op.gg error');
  return (json.result && json.result.content && json.result.content[0] && json.result.content[0].text) || '';
}

function parseChampPool(text) {
  const pool = [];
  const re = /MyChampionStat\("([^"]+)",(\d+),(\d+),(\d+)\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    pool.push({ name: m[1], games: parseInt(m[2]), wins: parseInt(m[3]), losses: parseInt(m[4]) });
  }
  return pool;
}

function normChampKey(s) {
  // Strip apostrophes, spaces, dots, ampersands — handles Kai'Sa→kaisa, Cho'Gath→chogath etc.
  return s.toLowerCase().replace(/['\s.&]/g, '');
}

function parseChampStatsForChamp(text, targetChamp) {
  // Matches MyChampionStat("Name",play,win,lose,Basic(k,d,a,cs,kp,dmg,vs))
  const re = /MyChampionStat\("([^"]+)",(\d+),(\d+),(\d+),Basic\(([^)]+)\)\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (normChampKey(m[1]) !== normChampKey(targetChamp)) continue;
    const play = parseInt(m[2]);
    if (!play) return null;
    const wins = parseInt(m[3]);
    const [kt, dt, at, cst, kpt, dmgt, vst] = m[5].split(',').map(Number);
    return {
      champ:   m[1],
      games:   play,
      wins,
      losses:  parseInt(m[4]),
      winRate: Math.round(wins / play * 100),
      kda:     { k: (kt/play).toFixed(1), d: (dt/play).toFixed(1), a: (at/play).toFixed(1) },
      cs:      (cst/play).toFixed(1),
      kp:      Math.round(kpt / play * 100),   // stored as fraction sum → % per game
      damage:  Math.round(dmgt / play),
      vision:  (vst/play).toFixed(1),
    };
  }
  return null; // champion not in ranked pool this season
}

app.post('/api/champpool/refresh', requireAdmin, async (req, res) => {
  const updated = [], errors = [];

  for (const slot of ['team1', 'team2']) {
    const players = state.players[slot] || [];
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (!p.riotId || !p.opggRegion) continue;
      const parts = p.riotId.split('#');
      if (parts.length !== 2 || !parts[0] || !parts[1]) continue;

      try {
        const text = await opggCall('lol_get_summoner_profile', {
          game_name: parts[0],
          tag_line:  parts[1],
          region:    p.opggRegion.toUpperCase(),
          desired_output_fields: [
            'data.summoner.ranked_most_champions.my_champion_stats[].{champion_name,play,win,lose}'
          ]
        });
        state.players[slot][i].champPool = parseChampPool(text);
        updated.push(p.handle);
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        errors.push(`${p.handle}: ${err.message}`);
      }
    }
  }

  if (errors.length) logAction(resolveUserFromReq(req), resolveRoleFromReq(req), 'champpool-refresh', _logTrunc('FAILED ' + errors.length + ': ' + errors.join('; ')));

  broadcast();
  res.json({ ok: true, updated, errors });
});

app.post('/api/champstats/draft', requireAdmin, async (req, res) => {
  const t1Picks = state.draft.team1RolePicks || [];
  const t2Picks = state.draft.team2RolePicks || [];
  const updated = [], errors = [];

  function champFromUrl(url) {
    if (!url) return '';
    return url.split('/').pop().replace(/\.[^.]+$/, '').replace(/_\d+$/, '');
  }

  for (const [slot, picks] of [['team1', t1Picks], ['team2', t2Picks]]) {
    const players = state.players[slot] || [];
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const champName = champFromUrl(picks[i]);
      if (!p.riotId || !p.opggRegion || !champName) continue;
      const parts = p.riotId.split('#');
      if (parts.length !== 2 || !parts[0] || !parts[1]) continue;

      try {
        const text = await opggCall('lol_get_summoner_profile', {
          game_name: parts[0],
          tag_line:  parts[1],
          region:    p.opggRegion.toUpperCase(),
          desired_output_fields: [
            'data.summoner.ranked_most_champions.my_champion_stats[].{champion_name,play,win,lose}',
            'data.summoner.ranked_most_champions.my_champion_stats[].basic.{kill,death,assist,cs,kill_participation,damage_to_champion,vision_score}',
          ]
        });
        state.players[slot][i].draftChampStats = parseChampStatsForChamp(text, champName);
        updated.push(p.handle + '(' + champName + ')');
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        errors.push(p.handle + ': ' + err.message);
      }
    }
  }

  broadcast();
  res.json({ ok: true, updated, errors });
});

// Teams CRUD (admin only)
app.get('/api/teams', (req, res) => res.json({ teams: _teams }));
app.post('/api/teams/save', requireAdmin, (req, res) => {
  const teams = _teams.slice();
  const inc = req.body;
  if (!inc || !inc.name) return res.status(400).json({ error: 'Team name required' });
  const addToPool = inc.addToPool; delete inc.addToPool; // control flag, not part of the team record
  if (inc.id) {
    const idx = teams.findIndex(t => t.id === inc.id);
    if (idx !== -1) teams[idx] = { ...teams[idx], ...inc }; else teams.push(inc);
  } else {
    inc.id = 'team_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
    teams.push(inc);
  }
  saveTeams(teams);

  // Optionally add the saved team to the active tournament's competing-teams pool
  let poolChanged = false;
  if (addToPool && inc.id) {
    _ensureTeamPool();
    if (!state.tournament.teamPool.includes(inc.id)) { state.tournament.teamPool.push(inc.id); poolChanged = true; }
  }

  // Sync live state for any active-match slot that has this team loaded
  if (inc.id) {
    let synced = false;
    ['team1', 'team2'].forEach(slot => {
      const slotMatch = state.match[slot];
      // Match by stored teamId (direct loads) or schedule reference
      const matchById  = slotMatch && slotMatch.teamId === inc.id;
      const _day = (state.tournament.schedule || []).find(d => d.id === state.match.scheduleDayId);
      const _sg  = _day && _day.games.find(g => g.id === state.match.scheduleGameId);
      const matchBySched = _sg && _sg[slot + 'Id'] === inc.id && slotMatch;
      if (!matchById && !matchBySched) return;

      // Sync match header (name / tag / logo / colour)
      Object.assign(slotMatch, {
        name:  inc.name  || '',
        tag:   inc.tag   || '',
        logo:  inc.logo  != null ? inc.logo  : slotMatch.logo,
      });

      // Sync players + subs so roster, H2H, draft all reflect the updated team
      const tp = inc.players || [];
      DEFAULT_ROLES.forEach((role, i) => {
        const p = tp[i] || {};
        state.players[slot][i] = { name: p.name||'', handle: p.handle||'', role, country: p.country||'', active: true, opggRegion: p.opggRegion||'', riotId: p.riotId||'' };
      });
      const subsKey = slot + 'subs';
      const ts = inc.subs || [];
      state.players[subsKey] = [0,1,2].map(i => {
        const s = ts[i] || {};
        return { name: s.name||'', handle: s.handle||'', role: s.role||'', country: s.country||'', active: false, opggRegion: s.opggRegion||'', riotId: s.riotId||'' };
      });
      synced = true;
    });
    if (synced) { deriveTodayGames(); broadcast(); poolChanged = false; }
  }
  // Pool changed without an active-slot sync — still broadcast + persist
  if (poolChanged) broadcast();

  res.json({ ok: true, team: inc });
});
app.post('/api/teams/delete', requireAdmin, (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  saveTeams(_teams.filter(t => t.id !== id));
  // Drop the deleted team from the active tournament's pool so it can't linger
  if (state.tournament && Array.isArray(state.tournament.teamPool)) {
    state.tournament.teamPool = state.tournament.teamPool.filter(tid => tid !== id);
  }
  broadcast(); res.json({ ok: true });
});

// ── Per-tournament competing-teams pool (subset of the global Teams DB) ──────────
app.post('/api/tournament/pool/add', requireAdmin, (req, res) => {
  const { teamId } = req.body;
  if (!teamId) return res.status(400).json({ error: 'teamId required' });
  if (!_teams.find(t => t.id === teamId)) return res.status(404).json({ error: 'Team not found' });
  _ensureTeamPool();
  if (!state.tournament.teamPool.includes(teamId)) state.tournament.teamPool.push(teamId);
  logAction(resolveUserFromReq(req), resolveRoleFromReq(req), 'pool-add', (_teams.find(t => t.id === teamId) || {}).name || teamId);
  broadcast(); res.json({ ok: true, teamPool: state.tournament.teamPool });
});
app.post('/api/tournament/pool/remove', requireAdmin, (req, res) => {
  const { teamId } = req.body;
  if (!teamId) return res.status(400).json({ error: 'teamId required' });
  _ensureTeamPool();
  state.tournament.teamPool = state.tournament.teamPool.filter(tid => tid !== teamId);
  logAction(resolveUserFromReq(req), resolveRoleFromReq(req), 'pool-remove', (_teams.find(t => t.id === teamId) || {}).name || teamId);
  broadcast(); res.json({ ok: true, teamPool: state.tournament.teamPool });
});

// Champions
const CHAMP_DIR = path.join(__dirname, 'public', 'champions');
app.get('/api/champions', (req, res) => {
  try {
    if (!fs.existsSync(CHAMP_DIR)) { fs.mkdirSync(CHAMP_DIR,{recursive:true}); return res.json({champions:[]}); }
    const champions = fs.readdirSync(CHAMP_DIR)
      .filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
      .map(f => ({ name: f.replace(/\.[^.]+$/,'').replace(/_\d+$/,''), url: '/champions/'+f }))
      .filter((c,i,arr) => arr.findIndex(x=>x.name.toLowerCase()===c.name.toLowerCase())===i)
      .sort((a,b) => a.name.localeCompare(b.name));
    res.json({ champions });
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Upload / Import (admin only)
app.post('/api/upload', requireAdmin, singleUpload(upload.single('file')), (req, res) => {
  if (!req.file) return res.status(400).json({error:'No file'});
  res.json({ ok: true, url: '/uploads/' + req.file.filename });
});

// ── Custom overlay fonts ───────────────────────────────────────────────────────
app.post('/api/fonts/upload', requireAdmin, singleUpload(uploadFont.single('file')), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const remove = () => { try { fs.unlink(path.join(fontUploadDir, req.file.filename), () => {}); } catch (e) {} };
  // Display name: user-provided, else derived from the filename.
  let name = String((req.body && req.body.name) || '').replace(/[<>"'\\;{}]/g, '').trim();
  if (!name) name = path.basename(req.file.originalname || 'Custom Font').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  name = name.slice(0, 40).trim() || 'Custom Font';
  if (!state.settings.customFonts) state.settings.customFonts = [];
  const taken = BUNDLED_FONT_NAMES.concat(state.settings.customFonts.map(f => String(f.name).toLowerCase()));
  if (taken.indexOf(name.toLowerCase()) !== -1) { remove(); return res.status(400).json({ error: 'A font named "' + name + '" already exists — choose another name' }); }
  const ext = ((req.file.filename.match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase();
  const font = { id: 'font_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), name, url: '/uploads/fonts/' + req.file.filename, format: ext };
  state.settings.customFonts.push(font);
  logAction(resolveUserFromReq(req), resolveRoleFromReq(req), 'upload-font', name);
  broadcast();
  res.json({ ok: true, font });
});

app.post('/api/fonts/delete', requireAdmin, (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  const list = state.settings.customFonts || [];
  const font = list.find(f => f.id === id);
  if (!font) return res.status(404).json({ error: 'Font not found' });
  state.settings.customFonts = list.filter(f => f.id !== id);
  // If the deleted font was the active overlay font, revert overlays to default.
  if (state.settings.overlayFont && state.settings.overlayFont === font.name) state.settings.overlayFont = '';
  try { if (/^\/uploads\/fonts\/[A-Za-z0-9._-]+$/.test(font.url)) fs.unlink(path.join(__dirname, 'public', font.url), () => {}); } catch (e) {}
  logAction(resolveUserFromReq(req), resolveRoleFromReq(req), 'delete-font', font.name);
  broadcast();
  res.json({ ok: true });
});
app.post('/api/import/csv', requireAdmin, singleUpload(uploadData.single('file')), (req, res) => {
  if (!req.file) return res.status(400).json({error:'No file'});
  const results = [];
  fs.createReadStream(req.file.path).pipe(csv()).on('data',d=>results.push(d)).on('end',()=>res.json({ok:true,data:results})).on('error',e=>res.status(400).json({error:e.message}));
});
app.post('/api/import/json', requireAdmin, singleUpload(uploadData.single('file')), (req, res) => {
  if (!req.file) return res.status(400).json({error:'No file'});
  try { res.json({ok:true,data:JSON.parse(fs.readFileSync(req.file.path,'utf8'))}); } catch(e) { res.status(400).json({error:'Invalid JSON'}); }
});
app.post('/api/import/gsheets', requireAdmin, async (req, res) => {
  const { sheetId, apiKey, range } = req.body;
  if (!sheetId||!apiKey) return res.status(400).json({error:'sheetId and apiKey required'});
  try {
    const fetch = require('node-fetch');
    const json = await (await fetch('https://sheets.googleapis.com/v4/spreadsheets/'+sheetId+'/values/'+encodeURIComponent(range||'Sheet1')+'?key='+apiKey)).json();
    if (json.error) return res.status(400).json({error:json.error.message});
    const [headers,...rows] = json.values||[];
    if (!headers) return res.json({ok:true,data:[]});
    res.json({ok:true,data:rows.map(row=>{const o={};headers.forEach((h,i)=>{o[h.trim().toLowerCase()]=(row[i]||'').trim();});return o;})});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── Asset sync ─────────────────────────────────────────────────────────────────
const assetSync = require('./scripts/sync-assets');

app.post('/api/assets/check', requireAdmin, async (req, res) => {
  try {
    const results = await assetSync.syncAll({ dryRun: true });
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/assets/sync', requireAdmin, async (req, res) => {
  try {
    const targets = assetSync.TARGETS;
    io.emit('assets:progress', { phase: 'init', targets: targets.map(t => ({ key: t.key, label: t.label })) });
    const results = [];
    for (const target of targets) {
      io.emit('assets:progress', { phase: 'start', key: target.key });
      const result = await assetSync.syncTarget(target, {
        dryRun: false,
        forceRoles: !!req.body.forceRoles,
        onProgress: (key, n, total, name) => io.emit('assets:progress', { phase: 'file', key, n, total, name }),
      });
      io.emit('assets:progress', { phase: 'done', key: target.key, result });
      results.push(result);
    }
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Tournament config ──────────────────────────────────────────────────────────
app.post('/api/tournament', requireAdmin, (req, res) => {
  const { name, game, logo, sponsorLogos, ...rest } = req.body;
  if (name !== undefined) state.match.tournament = name;
  if (game !== undefined) state.match.game = game;
  if (logo !== undefined) state.match.tournamentLogo = logo;
  if (sponsorLogos !== undefined) state.match.sponsorLogos = sponsorLogos;
  if (!state.tournament) state.tournament = {};
  if (name !== undefined) state.tournament.name = name;
  if (game !== undefined) state.tournament.game = game;
  if (logo !== undefined) state.tournament.logo = logo;
  if (sponsorLogos !== undefined) state.tournament.sponsorLogos = sponsorLogos;
  deepMerge(state.tournament, rest);
  // Keep bracket.type in sync with playoffFormat
  if (rest.playoffFormat !== undefined) {
    state.bracket.type = state.tournament.playoffFormat === 'doubleElim' ? 'double' : 'single';
  }
  broadcast(); res.json({ ok: true });
});

// ── Schedule management ────────────────────────────────────────────────────────
app.post('/api/schedule/day/add', requireAdmin, (req, res) => {
  if (!state.tournament.schedule) state.tournament.schedule = [];
  const day = { id: 'day_' + Date.now(), label: req.body.label || 'New Day', date: req.body.date || '', games: [] };
  state.tournament.schedule.push(day);
  broadcastSchedule(); broadcast(); res.json({ ok: true, day, schedule: state.tournament.schedule });
});
app.post('/api/schedule/day/update', requireAdmin, (req, res) => {
  const { id, ...updates } = req.body;
  const day = (state.tournament.schedule || []).find(d => d.id === id);
  if (!day) return res.status(404).json({ error: 'Day not found' });
  Object.assign(day, updates);
  broadcastSchedule(); broadcast(); res.json({ ok: true, schedule: state.tournament.schedule });
});
app.post('/api/schedule/day/delete', requireAdmin, (req, res) => {
  state.tournament.schedule = (state.tournament.schedule || []).filter(d => d.id !== req.body.id);
  broadcastSchedule(); broadcast(); res.json({ ok: true, schedule: state.tournament.schedule });
});
app.post('/api/schedule/game/add', requireAdmin, (req, res) => {
  const { dayId, ...gd } = req.body;
  const day = (state.tournament.schedule || []).find(d => d.id === dayId);
  if (!day) return res.status(404).json({ error: 'Day not found' });
  const game = { id: 'sgame_' + Date.now(), team1Id: gd.team1Id || '', team2Id: gd.team2Id || '', team1Override: gd.team1Override || '', team2Override: gd.team2Override || '', stage: gd.stage || 'groupStage', format: gd.format || 'Bo3', fearlessDraft: !!gd.fearlessDraft, result: null };
  if (gd.bracketMatchRef && typeof gd.bracketMatchRef === 'string' && gd.bracketMatchRef.includes('-')) {
    const parts = gd.bracketMatchRef.split('-').map(Number);
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      game.bracketRoundIdx = parts[0];
      game.bracketMatchIdx = parts[1];
    }
  }
  day.games.push(game);
  _seedLinkedBracketTeams(game);
  deriveTodayGames(); broadcastSchedule(); broadcast(); res.json({ ok: true, game, schedule: state.tournament.schedule });
});
app.post('/api/schedule/game/update', requireAdmin, (req, res) => {
  const { dayId, gameId, team1Id, team2Id, team1Override, team2Override, stage, format, fearlessDraft, bracketMatchRef } = req.body;
  const day = (state.tournament.schedule || []).find(d => d.id === dayId);
  if (!day) return res.status(404).json({ error: 'Day not found' });
  const game = day.games.find(g => g.id === gameId);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (game.result && game.result.completed) return res.status(400).json({ error: 'Cannot edit a completed game' });
  if (team1Id        !== undefined) game.team1Id        = team1Id;
  if (team2Id        !== undefined) game.team2Id        = team2Id;
  if (team1Override  !== undefined) game.team1Override  = team1Override;
  if (team2Override  !== undefined) game.team2Override  = team2Override;
  if (stage          !== undefined) game.stage          = stage;
  if (format         !== undefined) game.format         = format;
  if (fearlessDraft  !== undefined) game.fearlessDraft  = !!fearlessDraft;
  if (bracketMatchRef !== undefined) {
    if (bracketMatchRef && bracketMatchRef.includes('-')) {
      const parts = bracketMatchRef.split('-').map(Number);
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        game.bracketRoundIdx = parts[0];
        game.bracketMatchIdx = parts[1];
      }
    } else {
      delete game.bracketRoundIdx;
      delete game.bracketMatchIdx;
    }
  }
  _seedLinkedBracketTeams(game);
  deriveTodayGames(); broadcastSchedule(); broadcast(); res.json({ ok: true, schedule: state.tournament.schedule });
});
app.post('/api/schedule/game/delete', requireAdmin, (req, res) => {
  const { dayId, gameId } = req.body;
  const day = (state.tournament.schedule || []).find(d => d.id === dayId);
  if (!day) return res.status(404).json({ error: 'Day not found' });
  day.games = day.games.filter(g => g.id !== gameId);
  broadcastSchedule(); broadcast(); res.json({ ok: true, schedule: state.tournament.schedule });
});
app.post('/api/schedule/game/reorder', requireAdmin, (req, res) => {
  const { dayId, gameId, direction } = req.body;
  const day = (state.tournament.schedule || []).find(d => d.id === dayId);
  if (!day) return res.status(404).json({ error: 'Day not found' });
  const idx = day.games.findIndex(g => g.id === gameId);
  if (idx === -1) return res.json({ ok: true });
  const ni = direction === 'up' ? idx - 1 : idx + 1;
  if (ni >= 0 && ni < day.games.length) { [day.games[idx], day.games[ni]] = [day.games[ni], day.games[idx]]; }
  broadcastSchedule(); broadcast(); res.json({ ok: true, schedule: state.tournament.schedule });
});

// ── Schedule groups ────────────────────────────────────────────────────────────
app.post('/api/tournament/generate-groups', requireAdmin, (req, res) => {
  const n = parseInt(req.body.numGroups) || 0;
  if (!n || n > 32) return res.status(400).json({ error: 'numGroups must be 1–32' });
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  state.tournament.groups = Array.from({ length: n }, (_, i) => ({
    id: 'grp_' + Date.now() + '_' + i,
    name: 'Group ' + (i < letters.length ? letters[i] : i + 1),
    teamIds: []
  }));
  state.tournament.numGroups = n;
  broadcast(); res.json({ ok: true });
});

app.post('/api/tournament/group/add', requireAdmin, (req, res) => {
  if (!state.tournament.groups) state.tournament.groups = [];
  state.tournament.groups.push({ id: 'grp_' + Date.now(), name: req.body.name || 'New Group', teamIds: [] });
  broadcast(); res.json({ ok: true });
});
app.post('/api/tournament/group/update', requireAdmin, (req, res) => {
  const grp = (state.tournament.groups || []).find(g => g.id === req.body.id);
  if (!grp) return res.status(404).json({ error: 'Group not found' });
  Object.assign(grp, req.body);
  broadcast(); res.json({ ok: true });
});
app.post('/api/tournament/group/delete', requireAdmin, (req, res) => {
  state.tournament.groups = (state.tournament.groups || []).filter(g => g.id !== req.body.id);
  broadcast(); res.json({ ok: true });
});

// ── Active match management ────────────────────────────────────────────────────
app.post('/api/match/load-schedule-game', (req, res) => {
  const { dayId, gameId, restore } = req.body;
  const day = (state.tournament.schedule || []).find(d => d.id === dayId);
  if (!day) return res.status(404).json({ error: 'Day not found' });
  const sg = day.games.find(g => g.id === gameId);
  if (!sg) return res.status(404).json({ error: 'Game not found' });
  const teams = _teams;
  const loadTeamIntoSlot = (teamId, slot) => {
    const t = teamId ? teams.find(x => x.id === teamId) : null;
    if (!t) {
      // No team assigned — clear slot to TBD so stale data from a previous match doesn't persist
      state.match[slot] = { name: 'TBD', tag: 'TBD', logo: '', score: 0 };
      state.players[slot]            = makeDefaultPlayers();
      state.players[slot + 'subs']   = makeDefaultSubs();
      return;
    }
    state.match[slot] = { name: t.name||'', tag: t.tag||'', logo: t.logo||'', score: 0 };
    const tp = t.players || [];
    DEFAULT_ROLES.forEach((role, i) => {
      const p = tp[i] || {};
      state.players[slot][i] = { name: p.name||'', handle: p.handle||'', role, country: p.country||'', active: true, opggRegion: p.opggRegion||'', riotId: p.riotId||'' };
    });
    const subsKey = slot + 'subs';
    state.players[subsKey] = [0,1,2].map(i => {
      const s = (t.subs||[])[i] || {};
      return { name: s.name||'', handle: s.handle||'', role: s.role||'', country: s.country||'', active: false, opggRegion: s.opggRegion||'', riotId: s.riotId||'' };
    });
  };
  loadTeamIntoSlot(sg.team1Id, 'team1');
  loadTeamIntoSlot(sg.team2Id, 'team2');
  state.match.format = sg.format || 'Bo3';
  state.match.fearlessDraft = !!sg.fearlessDraft;
  state.match.scheduleDayId = dayId;
  state.match.scheduleGameId = gameId;

  const result = sg.result;
  const savedGames = (result && result.games) || [];
  if (restore && result && savedGames.length) {
    // Restore saved series state (completed OR in-progress) so progress survives a reload
    state.match.seriesGames = savedGames;
    state.match.team1.score = result.team1SeriesScore || 0;
    state.match.team2.score = result.team2SeriesScore || 0;
    if (result.completed) {
      // Completed — show the last game's draft as the final state
      state.match.currentGameNum = savedGames.length || 1;
      const lastGame = savedGames[savedGames.length - 1];
      if (lastGame) {
        state.draft.picks       = lastGame.draftPicks   || [];
        state.draft.banFirstTeam= lastGame.banFirstTeam || 'blue';
        state.draft.blueSideTeam= lastGame.blueSideTeam || 'team1';
        state.draft.sideChooser = lastGame.sideChooser  || '';
        state.draft.team1RolePicks = lastGame.t1RolePicks || [];
        state.draft.team2RolePicks = lastGame.t2RolePicks || [];
        state.draft.phase       = 'complete';
        state.draft.currentStep = 21;
        state.draft.timerEnd    = null;
      }
    } else {
      // In progress — resume on the next unplayed game with a clean draft
      // (preserve the operator's timer config, like profile load does).
      state.match.currentGameNum = savedGames.length + 1;
      state.draft = Object.assign(makeDefault().draft, {
        timerDuration: state.draft.timerDuration,
        timerVisible:  state.draft.timerVisible,
      });
    }
  } else {
    // Fresh start
    state.match.currentGameNum = 1;
    state.match.seriesGames    = [];
    state.match.team1.score    = 0;
    state.match.team2.score    = 0;
    // Reset the live draft so the previous match's picks/sides don't leak in
    // (preserve the operator's timer config, like profile load does).
    state.draft = Object.assign(makeDefault().draft, {
      timerDuration: state.draft.timerDuration,
      timerVisible:  state.draft.timerVisible,
    });
  }
  logAction(resolveUserFromReq(req), resolveRoleFromReq(req), 'load-game', (restore ? 'restore ' : '') + dayId + '/' + gameId);
  deriveTodayGames(); broadcast(); res.json({ ok: true });
});

// Save edit-mode changes to both match state and the linked schedule game entry
app.post('/api/match/edit-save', requireAdmin, (req, res) => {
  const { format, fearlessDraft } = req.body;
  if (format      !== undefined) state.match.format       = format;
  if (fearlessDraft !== undefined) state.match.fearlessDraft = !!fearlessDraft;
  // Sync back to the schedule game entry so Schedule page stays consistent
  if (state.match.scheduleGameId && state.match.scheduleDayId) {
    const day = (state.tournament.schedule || []).find(d => d.id === state.match.scheduleDayId);
    if (day) {
      const sg = day.games.find(g => g.id === state.match.scheduleGameId);
      if (sg) {
        if (format      !== undefined) sg.format       = format;
        if (fearlessDraft !== undefined) sg.fearlessDraft = !!fearlessDraft;
      }
    }
  }
  deriveTodayGames(); broadcastSchedule(); broadcast(); res.json({ ok: true });
});

// Write the just-played match (state.match teams + scores) into its linked bracket
// match so the bracket graphic reflects the result. Where the bracket slots are
// already named, match by name (in either order) so scores land on the right slot;
// otherwise fill the slots from the played match.
function _updateLinkedBracket(sg) {
  if (!sg || sg.bracketRoundIdx == null || sg.bracketMatchIdx == null) return;
  const bRound = (state.bracket.rounds || [])[sg.bracketRoundIdx];
  const bMatch = bRound && bRound.matches[sg.bracketMatchIdx];
  if (!bMatch) return;
  const t1Name = state.match.team1.name || state.match.team1.tag || 'TBD';
  const t2Name = state.match.team2.name || state.match.team2.tag || 'TBD';
  const t1Score = state.match.team1.score, t2Score = state.match.team2.score;
  const norm = s => String(s || '').trim().toLowerCase();
  const resolved = nm => { const n = norm(nm); return n && n !== 'tbd' && n !== 'bye' && n.indexOf('winner of') !== 0 && n.indexOf('loser of') !== 0; };
  bMatch.team1 = bMatch.team1 || {};
  bMatch.team2 = bMatch.team2 || {};
  const b1 = bMatch.team1.name, b2 = bMatch.team2.name;
  if (resolved(b1) && resolved(b2) && norm(b1) === norm(t2Name) && norm(b2) === norm(t1Name)) {
    bMatch.team1.score = t2Score; bMatch.team2.score = t1Score; // bracket slots reversed vs played match
  } else if (resolved(b1) && resolved(b2) && norm(b1) === norm(t1Name) && norm(b2) === norm(t2Name)) {
    bMatch.team1.score = t1Score; bMatch.team2.score = t2Score;
  } else {
    bMatch.team1.name = t1Name; bMatch.team1.score = t1Score; // slots unresolved (TBD/pending) — fill from played match
    bMatch.team2.name = t2Name; bMatch.team2.score = t2Score;
  }
  bMatch.complete = true;
}

// Revert a linked bracket match when its result is cleared (scores 0, not complete).
function _clearLinkedBracket(sg) {
  if (!sg || sg.bracketRoundIdx == null || sg.bracketMatchIdx == null) return;
  const bRound = (state.bracket.rounds || [])[sg.bracketRoundIdx];
  const bMatch = bRound && bRound.matches[sg.bracketMatchIdx];
  if (!bMatch) return;
  if (bMatch.team1) bMatch.team1.score = 0;
  if (bMatch.team2) bMatch.team2.score = 0;
  bMatch.complete = false;
}

// Forward-fill: when a schedule game is linked to a bracket match and has teams
// assigned, show that matchup on the bracket (0-0) before it's played. Only fills
// unresolved (TBD/pending) slots of a not-yet-complete match — never overwrites
// teams that advanced into the slot, nor a recorded result.
function _seedLinkedBracketTeams(sg) {
  if (!sg || sg.bracketRoundIdx == null || sg.bracketMatchIdx == null) return;
  const bRound = (state.bracket.rounds || [])[sg.bracketRoundIdx];
  const bMatch = bRound && bRound.matches[sg.bracketMatchIdx];
  if (!bMatch || bMatch.complete) return;
  const nameFor = (id, ov) => ov || (id ? ((_teams.find(t => t.id === id) || {}).name || '') : '');
  const t1 = nameFor(sg.team1Id, sg.team1Override);
  const t2 = nameFor(sg.team2Id, sg.team2Override);
  const unresolved = nm => { const n = String(nm || '').trim().toLowerCase(); return !n || n === 'tbd' || n.indexOf('winner of') === 0 || n.indexOf('loser of') === 0; };
  bMatch.team1 = bMatch.team1 || {};
  bMatch.team2 = bMatch.team2 || {};
  if (t1 && unresolved(bMatch.team1.name)) { bMatch.team1.name = t1; if (bMatch.team1.score == null) bMatch.team1.score = 0; }
  if (t2 && unresolved(bMatch.team2.name)) { bMatch.team2.name = t2; if (bMatch.team2.score == null) bMatch.team2.score = 0; }
}

// Persist the current series state onto its linked schedule game so it survives
// switching matches / reloads. Writes a completed result when the series is over,
// an in-progress snapshot (completed:false) while games remain, or null when empty.
// Keeps the linked bracket in sync (only a completed series writes a bracket result).
function _persistSeriesProgress() {
  if (!state.match.scheduleDayId || !state.match.scheduleGameId) return;
  const day = (state.tournament.schedule || []).find(d => d.id === state.match.scheduleDayId);
  const sg  = day && day.games.find(g => g.id === state.match.scheduleGameId);
  if (!sg) return;
  const games = state.match.seriesGames || [];
  const formatNum  = parseInt((state.match.format || 'Bo3').replace('Bo','')) || 3;
  const winsNeeded = Math.ceil(formatNum / 2);
  const t1 = state.match.team1.score || 0, t2 = state.match.team2.score || 0;
  const over = t1 >= winsNeeded || t2 >= winsNeeded;
  if (games.length === 0) {
    sg.result = null;
    _clearLinkedBracket(sg);
  } else if (over) {
    sg.result = { completed: true, winner: t1 >= winsNeeded ? 'team1' : 'team2', team1SeriesScore: t1, team2SeriesScore: t2, games: [...games] };
    _updateLinkedBracket(sg);
  } else {
    sg.result = { completed: false, team1SeriesScore: t1, team2SeriesScore: t2, games: [...games] };
    _clearLinkedBracket(sg);
  }
}

app.post('/api/match/record-game', (req, res) => {
  const { winner, t1Side, t2Side, t1Picks, t2Picks, t1RolePicks, t2RolePicks } = req.body;
  if (!winner || !['team1','team2'].includes(winner)) return res.status(400).json({ error: 'winner must be team1 or team2' });
  state.match.seriesGames = state.match.seriesGames || [];
  state.match.seriesGames.push({
    gameNum: state.match.currentGameNum || 1,
    winner, t1Side: t1Side || 'blue', t2Side: t2Side || 'red',
    t1Picks: t1Picks || [], t2Picks: t2Picks || [],
    t1RolePicks: t1RolePicks || [], t2RolePicks: t2RolePicks || [],
    // Full draft snapshot for history view
    draftPicks:   Array.isArray(state.draft.picks) ? state.draft.picks.slice() : [],
    banFirstTeam: state.draft.banFirstTeam || 'blue',
    blueSideTeam: state.draft.blueSideTeam || 'team1',
    sideChooser:  state.draft.sideChooser  || '',
    players: {
      team1: (state.players.team1 || []).map(function(p) { return { handle: p.handle || '', role: p.role || '' }; }),
      team2: (state.players.team2 || []).map(function(p) { return { handle: p.handle || '', role: p.role || '' }; }),
    },
  });
  if (winner === 'team1') state.match.team1.score = (state.match.team1.score || 0) + 1;
  else state.match.team2.score = (state.match.team2.score || 0) + 1;
  const formatNum = parseInt((state.match.format || 'Bo3').replace('Bo','')) || 3;
  const winsNeeded = Math.ceil(formatNum / 2);
  const seriesOver = state.match.team1.score >= winsNeeded || state.match.team2.score >= winsNeeded;
  if (!seriesOver) state.match.currentGameNum = (state.match.currentGameNum || 1) + 1;
  // Auto-reset draft so the next game starts clean without manual intervention
  state.draft.phase       = 'notstarted';
  state.draft.picks       = [];
  state.draft.currentStep = 0;
  state.draft.timerEnd    = null;
  // Always auto-populate win screen from the result
  state.winScreen.team = winner;
  const isBO1 = formatNum === 1;
  if (!isBO1 && seriesOver) {
    state.winScreen.message = 'WINS THE SERIES';
  } else {
    state.winScreen.message = 'WINS THE MATCH';
  }
  state.winScreen.seriesScore = (formatNum > 1)
    ? (state.match.team1.score + ' — ' + state.match.team2.score)
    : '';
  // Persist progress to the linked schedule game after every game (completed
  // result on series end, in-progress snapshot otherwise) so it survives reloads.
  _persistSeriesProgress();
  invalidateStatsCache();
  const _rgWinner = winner === 'team1' ? (state.match.team1.tag||state.match.team1.name||'Team 1') : (state.match.team2.tag||state.match.team2.name||'Team 2');
  logAction(resolveUserFromReq(req), resolveRoleFromReq(req), 'record-game', _rgWinner + (seriesOver ? ' — series over' : ''));
  deriveTodayGames(); broadcastSchedule(); broadcast(); res.json({ ok: true, seriesOver });
});

// Record a BYE win — awards +1 game win without draft/picks data.
// seriesWalkover:true awards enough BYE wins to end the series immediately.
app.post('/api/match/record-bye', requireAdmin, (req, res) => {
  const { winner, seriesWalkover } = req.body;
  if (!winner || !['team1','team2'].includes(winner)) return res.status(400).json({ error: 'winner must be team1 or team2' });
  const formatNum  = parseInt((state.match.format || 'Bo3').replace('Bo','')) || 3;
  const winsNeeded = Math.ceil(formatNum / 2);
  state.match.seriesGames = state.match.seriesGames || [];

  const recordOne = () => {
    state.match.seriesGames.push({
      gameNum: state.match.currentGameNum || 1,
      winner, isBye: true,
      t1Side: '', t2Side: '',
      t1Picks: [], t2Picks: [], t1RolePicks: [], t2RolePicks: [],
      draftPicks: [], banFirstTeam: state.draft.banFirstTeam || 'blue',
      blueSideTeam: state.draft.blueSideTeam || 'team1', sideChooser: '',
      players: { team1: [], team2: [] },
    });
    if (winner === 'team1') state.match.team1.score = (state.match.team1.score || 0) + 1;
    else                    state.match.team2.score = (state.match.team2.score || 0) + 1;
    const over = state.match.team1.score >= winsNeeded || state.match.team2.score >= winsNeeded;
    if (!over) state.match.currentGameNum = (state.match.currentGameNum || 1) + 1;
    return over;
  };

  if (seriesWalkover) {
    let over = false; let safety = 0;
    while (!over && safety++ < 10) over = recordOne();
  } else {
    recordOne();
  }

  // Auto-populate win screen on series end
  const seriesNowOver = state.match.team1.score >= winsNeeded || state.match.team2.score >= winsNeeded;
  if (seriesNowOver) {
    state.winScreen.team    = winner;
    state.winScreen.message = formatNum === 1 ? 'WINS THE MATCH' : 'WINS THE SERIES';
    state.winScreen.seriesScore = formatNum > 1 ? (state.match.team1.score + ' — ' + state.match.team2.score) : '';
  }
  // Persist progress to the linked schedule game (completed on end, in-progress otherwise)
  _persistSeriesProgress();
  invalidateStatsCache();
  logAction(resolveUserFromReq(req), resolveRoleFromReq(req), 'record-bye', (seriesWalkover ? 'walkover → ' : 'bye → ') + winner);
  deriveTodayGames(); broadcastSchedule(); broadcast(); res.json({ ok: true, seriesOver: seriesNowOver });
});

app.post('/api/match/reset-series', (req, res) => {
  state.match.currentGameNum = 1;
  state.match.seriesGames    = [];
  state.match.team1.score    = 0;
  state.match.team2.score    = 0;
  // Clear draft picks so previous game data doesn't bleed into the reset state
  state.draft.phase            = 'notstarted';
  state.draft.currentStep      = 0;
  state.draft.picks            = ['','','','','','','','','','','','','','','','','','','',''];
  state.draft.committedT1Picks = [];
  state.draft.committedT2Picks = [];
  state.draft.team1RolePicks   = [];
  state.draft.team2RolePicks   = [];
  state.draft.timerEnd         = null;
  // Clear result on the linked schedule entry so Schedule page and todayGames reflect the reset
  if (state.match.scheduleDayId && state.match.scheduleGameId) {
    const _day = (state.tournament.schedule || []).find(d => d.id === state.match.scheduleDayId);
    const _sg  = _day && _day.games.find(g => g.id === state.match.scheduleGameId);
    if (_sg) { _sg.result = null; _clearLinkedBracket(_sg); }
  }
  invalidateStatsCache();
  logAction(resolveUserFromReq(req), resolveRoleFromReq(req), 'reset-series', '');
  deriveTodayGames(); broadcastSchedule(); broadcast(); res.json({ ok: true });
});

// Clear a single recorded game from the current series, recompute the series
// score from the remaining games, renumber them, and re-sync the linked
// schedule result + bracket. Unlike RESET SERIES (full wipe), this keeps the
// other games intact — for fixing a single data-entry error mid-series.
app.post('/api/match/game/:index/clear', (req, res) => {
  const idx = parseInt(req.params.index, 10);
  const games = state.match.seriesGames || [];
  if (isNaN(idx) || idx < 0 || idx >= games.length) {
    return res.status(404).json({ error: 'Game not found' });
  }
  const removed = games.splice(idx, 1)[0];
  // Renumber remaining games sequentially so gameNum stays consistent
  games.forEach(function(gm, i) { gm.gameNum = i + 1; });
  // Recompute series score from the remaining winners
  state.match.team1.score = games.filter(function(gm) { return gm.winner === 'team1'; }).length;
  state.match.team2.score = games.filter(function(gm) { return gm.winner === 'team2'; }).length;
  const formatNum  = parseInt((state.match.format || 'Bo3').replace('Bo','')) || 3;
  const winsNeeded = Math.ceil(formatNum / 2);
  const seriesOver = state.match.team1.score >= winsNeeded || state.match.team2.score >= winsNeeded;
  // Next game to play (or the deciding game number if the series is still over)
  state.match.currentGameNum = seriesOver ? games.length : games.length + 1;
  // Keep the win-screen series score string in sync with the new score
  if (formatNum > 1) state.winScreen.seriesScore = state.match.team1.score + ' — ' + state.match.team2.score;
  // Re-sync the linked schedule result + bracket (in-progress snapshot if games remain)
  _persistSeriesProgress();
  invalidateStatsCache();
  logAction(resolveUserFromReq(req), resolveRoleFromReq(req), 'clear-series-game', 'Game ' + ((removed && removed.gameNum) || (idx + 1)));
  deriveTodayGames(); broadcastSchedule(); broadcast(); res.json({ ok: true, seriesOver });
});

app.post('/api/schedule/game/clear-result', requireAdmin, (req, res) => {
  const { dayId, gameId } = req.body;
  const day = (state.tournament.schedule || []).find(d => d.id === dayId);
  const sg  = day && day.games.find(g => g.id === gameId);
  if (!sg) return res.status(404).json({ error: 'Game not found' });
  sg.result = null;
  _clearLinkedBracket(sg);
  // If this game is currently loaded, reset the series state too
  if (state.match.scheduleDayId === dayId && state.match.scheduleGameId === gameId) {
    state.match.currentGameNum = 1;
    state.match.seriesGames    = [];
    state.match.team1.score    = 0;
    state.match.team2.score    = 0;
  }
  invalidateStatsCache();
  logAction(resolveUserFromReq(req), resolveRoleFromReq(req), 'clear-game-result', dayId + '/' + gameId);
  deriveTodayGames(); broadcastSchedule(); broadcast(); res.json({ ok: true, schedule: state.tournament.schedule });
});

app.get('/api/tournament-stats', (req, res) => {
  if (!tournamentStatsCache) tournamentStatsCache = buildTournamentStats();
  res.json(tournamentStatsCache);
});

// ── Broadcast settings ────────────────────────────────────────────────────────
app.post('/api/settings', requireAdmin, (req, res) => {
  if (!state.settings) state.settings = {};
  if (req.body && req.body.uiTheme) req.body.uiTheme = sanitizeTheme(req.body.uiTheme);  // panel-wide default
  const switcherChanged = req.body && Object.prototype.hasOwnProperty.call(req.body, 'switcher');
  deepMerge(state.settings, req.body);
  if (req.body.buses) initBusState();
  if (switcherChanged) { state.settings.switcher = sanitizeSwitcher(state.settings.switcher); switcher.reconfigure(state.settings); }
  broadcast(); res.json({ ok: true });
});

// Apply a generated bracket to the bracket tab
app.post('/api/tournament/apply-bracket', requireAdmin, (req, res) => {
  const { rounds, title } = req.body;
  if (!Array.isArray(rounds)) return res.status(400).json({ error: 'rounds array required' });
  state.bracket.rounds = rounds;
  if (title) state.bracket.title = title;
  // Derive bracket type from tournament format so the graphic knows the layout
  state.bracket.type = state.tournament.playoffFormat === 'doubleElim' ? 'double' : 'single';
  deriveTodayGames(); broadcast(); res.json({ ok: true });
});

// ── Profiles (admin only) ─────────────────────────────────────────────────────
app.get('/api/profiles', requireAdmin, (req, res) => {
  res.json({ profiles: loadProfiles() });
});

app.post('/api/profiles/save', requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Profile name required' });
  const profiles = loadProfiles();
  const profile = {
    id: 'prof_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name: name.trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    data: snapshotForProfile(),
  };
  profiles.unshift(profile); // newest first
  saveProfiles(profiles);
  state.meta.activeProfileId = profile.id;
  state.meta.activeProfileName = profile.name;
  logAction(resolveUserFromReq(req), resolveRoleFromReq(req), 'save-profile', name.trim());
  broadcast();
  res.json({ ok: true, profile, savedSnapshot: profile.data });
});

app.post('/api/profiles/save-empty', requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Profile name required' });
  const profiles = loadProfiles();
  // Use system defaults — don't inherit colours/logos from whatever is currently loaded
  const defaultSettingsSnap = JSON.parse(JSON.stringify(makeDefault().settings));
  delete defaultSettingsSnap.graphicsToken;
  const emptyTeam = { name: '', tag: '', logo: '' };
  const profile = {
    id: 'prof_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name: name.trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    data: {
      tournament: {},
      bracket: { title: '', rounds: [] },
      match: { team1: { ...emptyTeam }, team2: { ...emptyTeam }, game: 'lol', format: 'bo3',
               tournament: name.trim(), tournamentLogo: '', sponsorLogos: [],
               fearlessDraft: false, currentGameNum: 1, seriesGames: [] },
      players: { team1: [], team2: [] },
      prizepool: { showLogo: false, logoScale: 7, logoPosition: 'left', entries: [] },
      settings: defaultSettingsSnap,
    },
  };
  profiles.unshift(profile);
  saveProfiles(profiles);
  res.json({ ok: true, profile });
});

app.post('/api/profiles/update', requireAdmin, (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'Profile id required' });
  const profiles = loadProfiles();
  const idx = profiles.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Profile not found' });
  profiles[idx].data = snapshotForProfile();
  profiles[idx].updatedAt = new Date().toISOString();
  saveProfiles(profiles);
  res.json({ ok: true, savedSnapshot: profiles[idx].data });
});

app.post('/api/profiles/load', requireAdmin, (req, res) => {
  const { id, keepSchedule } = req.body;
  if (!id) return res.status(400).json({ error: 'Profile id required' });
  const profile = loadProfiles().find(p => p.id === id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  const d = profile.data;
  if (d.tournament) {
    const currentSchedule = (state.tournament && state.tournament.schedule)
      ? JSON.parse(JSON.stringify(state.tournament.schedule)) : [];
    state.tournament = deepMerge({}, d.tournament);
    if (keepSchedule) state.tournament.schedule = currentSchedule;
    _ensureTeamPool(); // legacy profiles without a pool: seed from referenced teams
  }
  if (d.bracket)    { state.bracket.title = d.bracket.title || state.bracket.title; state.bracket.rounds = d.bracket.rounds || []; }
  if (d.match) {
    const keep = ['team1','team2','game','format','tournament','tournamentLogo','sponsorLogos',
                  'fearlessDraft','currentGameNum','seriesGames','scheduleDayId','scheduleGameId'];
    keep.forEach(k => { if (d.match[k] !== undefined) state.match[k] = d.match[k]; });
  }
  if (d.players) deepMerge(state.players, d.players);
  if (d.prizepool) {
    const { entries, showLogo, logoScale, logoPosition } = d.prizepool;
    if (entries     !== undefined) state.prizepool.entries      = JSON.parse(JSON.stringify(entries));
    if (showLogo    !== undefined) state.prizepool.showLogo     = showLogo;
    if (logoScale   !== undefined) state.prizepool.logoScale    = logoScale;
    if (logoPosition !== undefined) state.prizepool.logoPosition = logoPosition;
  }
  if (d.settings) {
    const incoming = JSON.parse(JSON.stringify(d.settings));
    delete incoming.graphicsToken; // never restore token from profile
    deepMerge(state.settings, incoming);
  }
  // Draft is live per-game state and is never part of a profile snapshot — reset it
  // to a clean slate so the previous tournament's picks/phase/committed picks don't
  // leak into the new profile (preserve the operator's timer config).
  state.draft = Object.assign(makeDefault().draft, {
    timerDuration: state.draft.timerDuration,
    timerVisible:  state.draft.timerVisible,
  });
  state.meta.activeProfileId   = id;
  state.meta.activeProfileName = profile.name;
  logAction(resolveUserFromReq(req), resolveRoleFromReq(req), 'load-profile', profile.name);
  broadcastSchedule(); broadcast();
  res.json({ ok: true, savedSnapshot: profile.data });
});

app.post('/api/profiles/rename', requireAdmin, (req, res) => {
  const { id, name } = req.body;
  if (!id || !name || !name.trim()) return res.status(400).json({ error: 'id and name required' });
  const profiles = loadProfiles();
  const p = profiles.find(x => x.id === id);
  if (!p) return res.status(404).json({ error: 'Profile not found' });
  p.name = name.trim();
  p.updatedAt = new Date().toISOString();
  saveProfiles(profiles);
  if (state.meta.activeProfileId === id) { state.meta.activeProfileName = p.name; broadcast(); }
  res.json({ ok: true });
});

app.post('/api/profiles/delete', requireAdmin, (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  const _delProf = loadProfiles().find(p => p.id === id);
  saveProfiles(loadProfiles().filter(p => p.id !== id));
  logAction(resolveUserFromReq(req), resolveRoleFromReq(req), 'delete-profile', (_delProf && _delProf.name) || id);
  if (state.meta.activeProfileId === id) { state.meta.activeProfileId = null; state.meta.activeProfileName = null; broadcast(); }
  res.json({ ok: true });
});

// ── Looks (admin only) ─────────────────────────────────────────────────────────
app.get('/api/looks', requireAdmin, (req, res) => res.json({ looks: getLooks() }));

app.post('/api/looks/save', requireAdmin, (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Look name required' });
  const data = {};
  LOOK_FIELDS.forEach(f => { if (state.settings[f] !== undefined) data[f] = JSON.parse(JSON.stringify(state.settings[f])); });
  const look = { id: 'look_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), name: name.trim(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), data };
  const looks = getLooks(); looks.unshift(look); saveLooks(looks);
  logAction(resolveUserFromReq(req), resolveRoleFromReq(req), 'save-look', look.name);
  res.json({ ok: true, look });
});

app.post('/api/looks/update', requireAdmin, (req, res) => {
  const { id } = req.body || {};
  const looks = getLooks();
  const lk = looks.find(l => l.id === id);
  if (!lk) return res.status(404).json({ error: 'Look not found' });
  const data = {};
  LOOK_FIELDS.forEach(f => { if (state.settings[f] !== undefined) data[f] = JSON.parse(JSON.stringify(state.settings[f])); });
  lk.data = data; lk.updatedAt = new Date().toISOString();
  saveLooks(looks);
  logAction(resolveUserFromReq(req), resolveRoleFromReq(req), 'update-look', lk.name);
  res.json({ ok: true });
});

app.post('/api/looks/apply', requireAdmin, (req, res) => {
  const { id } = req.body || {};
  const look = getLooks().find(l => l.id === id);
  if (!look) return res.status(404).json({ error: 'Look not found' });
  // Replace (not merge) each captured field so stale per-graphic overrides don't linger.
  LOOK_FIELDS.forEach(f => { if (look.data[f] !== undefined) state.settings[f] = JSON.parse(JSON.stringify(look.data[f])); });
  if (look.data.buses) initBusState();
  logAction(resolveUserFromReq(req), resolveRoleFromReq(req), 'apply-look', look.name);
  broadcast();
  res.json({ ok: true });
});

app.post('/api/looks/rename', requireAdmin, (req, res) => {
  const { id, name } = req.body || {};
  if (!id || !name || !name.trim()) return res.status(400).json({ error: 'id and name required' });
  const looks = getLooks();
  const lk = looks.find(l => l.id === id);
  if (!lk) return res.status(404).json({ error: 'Look not found' });
  lk.name = name.trim(); lk.updatedAt = new Date().toISOString();
  saveLooks(looks);
  res.json({ ok: true });
});

app.post('/api/looks/delete', requireAdmin, (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  const looks = getLooks();
  const lk = looks.find(l => l.id === id);
  saveLooks(looks.filter(l => l.id !== id));
  logAction(resolveUserFromReq(req), resolveRoleFromReq(req), 'delete-look', (lk && lk.name) || id);
  res.json({ ok: true });
});

// ── User management (admin only) ───────────────────────────────────────────────
app.get('/api/users', requireAdmin, (req, res) => {
  const me = req.session.user;
  res.json({ users: _users.map(u => ({ id: u.id, username: u.username, role: u.role })), myRole: me.role, myId: me.id });
});
app.post('/api/users/create', requireAdmin, (req, res) => {
  const me = req.session.user;
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (!['admin','operator'].includes(role)) return res.status(400).json({ error: 'Role must be admin or operator' });
  if (role === 'admin' && me.role !== 'superadmin') return res.status(403).json({ error: 'Only superadmin can create admin accounts' });
  const users = _users.slice();
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(409).json({ error: 'Username already exists' });
  users.push({ id: 'u' + Date.now(), username, passwordHash: bcrypt.hashSync(password, 10), role });
  saveUsers(users); res.json({ ok: true });
});
app.post('/api/users/change-password', (req, res) => {
  const me = req.session && req.session.user;
  if (!me) return res.status(403).json({ error: 'Session required' }); // token auth has no user
  const { userId, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const users = _users.slice();
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  const target = users[idx];
  if (me.role === 'superadmin') {
    // full access
  } else if (me.role === 'admin') {
    if (me.id !== userId && target.role !== 'operator') return res.status(403).json({ error: 'Admins cannot change another admin\'s password' });
  } else {
    if (me.id !== userId) return res.status(403).json({ error: 'Forbidden' });
  }
  users[idx].passwordHash = bcrypt.hashSync(newPassword, 10);
  saveUsers(users); res.json({ ok: true });
});
app.post('/api/users/delete', requireAdmin, (req, res) => {
  const me = req.session.user;
  const { userId } = req.body;
  if (me.id === userId) return res.status(400).json({ error: 'Cannot delete your own account' });
  const target = _users.find(u => u.id === userId);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (me.role !== 'superadmin' && target.role !== 'operator') return res.status(403).json({ error: 'Admins can only delete operator accounts' });
  saveUsers(_users.filter(u => u.id !== userId)); res.json({ ok: true });
});

// ── Socket ─────────────────────────────────────────────────────────────────────
app.post('/api/settings/regenerate-token', requireAdmin, (req, res) => {
  if (!state.settings) state.settings = {};
  state.settings.graphicsToken = require('crypto').randomBytes(16).toString('hex');
  broadcast(); res.json({ ok: true, token: state.settings.graphicsToken });
});

// ── Multi-user workflow — in-memory state ──────────────────────────────────────
const connectedUsers  = {};  // socketId → { username, role, page, connectedAt }
const pageClaims      = {};  // pageKey  → { user, role, socketId, claimedAt }
const pageLastActions = {};  // pageKey  → { user, action, timestamp }
const actionLog       = [];  // ring buffer, max 200 entries

function resolveUser(socket) {
  const u = socket.request.session && socket.request.session.user;
  return u ? (u.username || u.role || 'Unknown') : 'Unknown';
}
function resolveRole(socket) {
  const u = socket.request.session && socket.request.session.user;
  return u ? (u.role || 'operator') : 'operator';
}
function resolveUserFromReq(req) {
  const u = req.session && req.session.user;
  return u ? (u.username || u.role || 'Unknown') : 'Unknown';
}
function resolveRoleFromReq(req) {
  const u = req.session && req.session.user;
  return u ? (u.role || 'operator') : 'operator';
}
function recordAction(pageKey, username, action) {
  pageLastActions[pageKey] = { user: username, action, timestamp: Date.now() };
  io.emit('lastActions:update', pageLastActions);
}
function logAction(username, role, action, detail) {
  actionLog.unshift({ timestamp: Date.now(), user: username, role, action, detail: detail || '' });
  if (actionLog.length > 200) actionLog.length = 200;
}
// Cap noisy multi-error detail strings so one failure can't blow out a log row.
function _logTrunc(str, max) { max = max || 240; return str.length > max ? str.slice(0, max - 1) + '…' : str; }

// ── Action log API (admin only) ────────────────────────────────────────────────
app.get('/api/action-log', requireAdmin, (req, res) => res.json(actionLog));

io.on('connection', socket => {
  const sess  = socket.request.session;
  const token = socket.handshake.auth.token || socket.handshake.query.token || '';

  // Allow logged-in users, OR read-only graphics token connections
  const isUser     = sess && sess.user;
  const isGraphics = token && state.settings && state.settings.graphicsToken === token;

  if (!isUser && !isGraphics) { socket.disconnect(true); return; }

  const label = isUser ? sess.user.username + ' (' + sess.user.role + ')' : 'graphics[token]';
  console.log('Connected:', label);
  // Admins receive the graphics token in state (for output-URL rendering); everyone
  // else is stripped. Room membership keeps the broadcast() hot path a simple emit.
  const isAdmin = isUser && ['admin','superadmin'].includes(sess.user.role);
  socket.join(isAdmin ? 'gfxAdmins' : 'gfxBasic');
  socket.emit('state', buildStatePayload(isAdmin));
  socket.emit('schedule', state.tournament.schedule || []);

  if (isUser) {
    // Populate presence
    connectedUsers[socket.id] = {
      username: resolveUser(socket), role: resolveRole(socket),
      page: null, connectedAt: Date.now()
    };
    logAction(resolveUser(socket), resolveRole(socket), 'connect', '');
    io.emit('presence:list', Object.values(connectedUsers));
    // Sync current multi-user state to new connection
    socket.emit('lastActions:update', pageLastActions);
    socket.emit('claims:update', pageClaims);

    socket.on('presence:page', ({ page }) => {
      if (connectedUsers[socket.id]) {
        connectedUsers[socket.id].page = page;
        connectedUsers[socket.id].pageUpdatedAt = Date.now();
        io.emit('presence:list', Object.values(connectedUsers));
      }
    });

    socket.on('claim:page', ({ page }) => {
      pageClaims[page] = { user: resolveUser(socket), role: resolveRole(socket), socketId: socket.id, claimedAt: Date.now() };
      io.emit('claims:update', pageClaims);
    });

    socket.on('claim:release', ({ page }) => {
      if (pageClaims[page] && pageClaims[page].socketId === socket.id) {
        delete pageClaims[page];
        io.emit('claims:update', pageClaims);
      }
    });

    socket.on('state:patch', patch => {
      if (!['admin','superadmin'].includes(sess.user.role)) return;
      deepMerge(state, patch);
      if (patch.settings && patch.settings.buses) initBusState();
      broadcast();
    });

    socket.on('bus:switch', ({ busId, graphic, visible }) => {
      const show = visible !== false && !!graphic;
      // Is `g` still live on a bus other than `busId`? Used so switching/clearing
      // one bus doesn't yank a graphic that's genuinely live on another bus.
      const liveOnOtherBus = (gKey) => Object.keys(busState).some(bid =>
        bid !== busId && busState[bid] && busState[bid].visible && busState[bid].activeGraphic === gKey);
      // Hide the currently active graphic on this bus (if switching away from it)
      const prev = busState[busId] && busState[busId].activeGraphic;
      if (prev && prev !== graphic && state[prev] && !liveOnOtherBus(prev)) state[prev].visible = false;
      // Show or hide the target graphic (don't hide globally if another bus still shows it)
      if (graphic && state[graphic]) {
        if (show) state[graphic].visible = true;
        else if (!liveOnOtherBus(graphic)) state[graphic].visible = false;
      }
      // Update busState tracking
      if (!busState[busId]) busState[busId] = {};
      busState[busId].activeGraphic = show ? graphic : (prev || null);
      busState[busId].visible = show;
      io.emit('busState', busState);
      broadcast();   // push updated state[graphic].visible so the /bus/<id> output page actually re-renders
      logAction(resolveUser(socket), resolveRole(socket), 'bus:switch', busId + ' → ' + (graphic || 'none'));
    });
  }

  socket.on('disconnect', () => {
    console.log('Disconnected:', label);
    if (isUser) {
      logAction(resolveUser(socket), resolveRole(socket), 'disconnect', '');
      delete connectedUsers[socket.id];
      Object.keys(pageClaims).forEach(p => { if (pageClaims[p].socketId === socket.id) delete pageClaims[p]; });
      io.emit('presence:list', Object.values(connectedUsers));
      io.emit('claims:update', pageClaims);
    }
  });
});

server.listen(PORT, () => {
  console.log('\n  Esports GFX -> http://localhost:' + PORT + '/\n');
});
