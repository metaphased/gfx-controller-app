const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const csv      = require('csv-parser');
const cors     = require('cors');
const session  = require('express-session');
const bcrypt   = require('bcryptjs');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3000;

// ── Data paths ─────────────────────────────────────────────────────────────────
const DATA_DIR    = path.join(__dirname, 'data');
const DATA_FILE   = path.join(DATA_DIR, 'state.json');
const TEAMS_FILE    = path.join(DATA_DIR, 'teams.json');
const USERS_FILE    = path.join(DATA_DIR, 'users.json');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
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
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 h
});
app.use(sessionMiddleware);
app.use(express.json());

// ── Socket.io (shares express session) ────────────────────────────────────────
const io = new Server(server, { cors: { origin: '*' } });
io.engine.use(sessionMiddleware);

// ── Users ──────────────────────────────────────────────────────────────────────
function loadUsers() {
  try { if (fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch(e) { console.error('Users load:', e.message); }
  return [];
}
function saveUsers(u) { fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2)); }

// Seed a default admin if no users exist
(function ensureAdmin() {
  const users = loadUsers();
  if (users.length === 0) {
    users.push({ id: 'u1', username: 'admin', passwordHash: bcrypt.hashSync('admin', 10), role: 'admin' });
    saveUsers(users);
    console.log('\n  Default admin created — username: admin  password: admin\n  Change this password immediately in the Users tab.\n');
  }
})();

// ── Auth middleware ────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorised' });
  res.redirect('/login/');
}
function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Admin only' });
  res.redirect('/operator/');
}

// ── Auth routes (public) ───────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = loadUsers().find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.passwordHash))
    return res.status(401).json({ error: 'Invalid username or password' });
  req.session.user = { id: user.id, username: user.username, role: user.role };
  const redirect = user.role === 'admin' ? '/control/' : '/operator/';
  res.json({ ok: true, role: user.role, redirect });
});

app.get('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login/'));
});

app.get('/api/auth/me', (req, res) => {
  if (req.session && req.session.user) res.json({ user: req.session.user });
  else res.status(401).json({ error: 'Not logged in' });
});

// ── Static — public (no auth) ──────────────────────────────────────────────────
app.use('/login',    express.static(path.join(__dirname, 'public', 'login')));
app.use('/graphics', express.static(path.join(__dirname, 'public', 'graphics')));
app.use('/uploads',  express.static(path.join(__dirname, 'public', 'uploads')));
app.use('/champions',express.static(path.join(__dirname, 'public', 'champions')));

// Root redirect
app.get('/', (req, res) => {
  if (!req.session || !req.session.user) return res.redirect('/login/');
  res.redirect(req.session.user.role === 'admin' ? '/control/' : '/operator/');
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
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// ── State / defaults ───────────────────────────────────────────────────────────
const DEFAULT_ROLES = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];

function makeDefaultPlayers() {
  return DEFAULT_ROLES.map((role, i) => ({ name: '', handle: 'Player ' + (i+1), role, country: '', active: true }));
}
function makeDefaultSubs() {
  return [1,2,3].map(i => ({ name: '', handle: 'Sub ' + i, role: '', country: '', active: false }));
}
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
    groups: [],
    schedule: []
  },
  tournamentStructure: { visible: false, showLogo: false, logoScale: 7, logoPosition: 'left', displayTitle: '', showTitle: false },
  match: {
    team1: { name: 'Team One', tag: 'T1', logo: '', color: '#1ffaff', score: 0 },
    team2: { name: 'Team Two', tag: 'T2', logo: '', color: '#a7a38e', score: 0 },
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
  scoreboard:  { visible: false },
  lowerThird:  { visible: false, text: '', subtext: '', supertext: '', side: 'left', teamColor: '' },
  headToHead:  { visible: false, mode: 'spotlight', spotlightRole: 0, animStyle: 'standard' },
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
  winScreen:   { visible: false, team: 'team1', message: 'WINS THE SERIES', style: 'blade', seriesScore: '' },
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
    graphicsToken: require('crypto').randomBytes(16).toString('hex'),
    animation: {
      transitionSpeed: 'medium',   // 'instant' | 'fast' | 'medium' | 'slow'
      dataChangeStyle: 'fade',     // 'none' | 'fade' | 'slide' | 'scale'
      motionEnergy:    'smooth',   // 'linear' | 'smooth' | 'bouncy' | 'snap'
      bgSpeed:         'medium',   // 'slow' | 'medium' | 'fast'
    },
    logoSet: { logos: [] },        // [{ name: string, url: string }]
  },
});

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    const val = source[key];
    if (val !== null && val !== undefined && typeof val === 'object' && !Array.isArray(val)) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      deepMerge(target[key], val);
    } else { target[key] = val; }
  }
  return target;
}

function loadState() {
  try { if (fs.existsSync(DATA_FILE)) return deepMerge(makeDefault(), JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); }
  catch(e) { console.error('State load:', e.message); }
  return makeDefault();
}
function saveState() { try { fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2)); } catch(e) { console.error(e); } }
function loadTeams() { try { if (fs.existsSync(TEAMS_FILE)) return JSON.parse(fs.readFileSync(TEAMS_FILE, 'utf8')); } catch(e) {} return []; }
function saveTeams(t) { try { fs.writeFileSync(TEAMS_FILE, JSON.stringify(t, null, 2)); } catch(e) { console.error(e); } }

function loadProfiles() { try { if (fs.existsSync(PROFILES_FILE)) return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8')); } catch(e) {} return []; }
function saveProfiles(p) { try { fs.writeFileSync(PROFILES_FILE, JSON.stringify(p, null, 2)); } catch(e) { console.error(e); } }

function snapshotForProfile() {
  // Settings snapshot — exclude graphicsToken so each install keeps its own auth token
  const settingsSnap = JSON.parse(JSON.stringify(state.settings || {}));
  delete settingsSnap.graphicsToken;
  return {
    tournament: JSON.parse(JSON.stringify(state.tournament)),
    bracket: { title: state.bracket.title, rounds: JSON.parse(JSON.stringify(state.bracket.rounds)) },
    match: (({ team1, team2, game, format, tournament, tournamentLogo, sponsorLogos,
                fearlessDraft, currentGameNum, seriesGames, scheduleDayId, scheduleGameId }) =>
      ({ team1, team2, game, format, tournament, tournamentLogo, sponsorLogos,
         fearlessDraft, currentGameNum, seriesGames, scheduleDayId, scheduleGameId }))(state.match),
    players: JSON.parse(JSON.stringify(state.players)),
    settings: settingsSnap,
  };
}

let state = loadState();
function broadcast() { saveState(); io.emit('state', Object.assign({}, state, { teams: loadTeams() })); }

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
  const teams = loadTeams();
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

// ── State API ──────────────────────────────────────────────────────────────────
app.get('/api/state', (req, res) => res.json(state));
app.post('/api/state/reset', requireAdmin, (req, res) => { state = makeDefault(); broadcast(); res.json({ ok: true }); });
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
  const team = loadTeams().find(t => t.id === teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const score = state.match[slot] ? state.match[slot].score : 0;
  state.match[slot] = { name: team.name||'', tag: team.tag||'', logo: team.logo||'', color: team.color||'#1ffaff', score };
  const tp = team.players || [];
  DEFAULT_ROLES.forEach((role, i) => {
    const p = tp[i] || {};
    state.players[slot][i] = { name: p.name||'', handle: p.handle||'', role, country: p.country||'', active: true };
  });
  const subsKey = slot + 'subs';
  const ts = team.subs || [];
  state.players[subsKey] = [0,1,2].map(i => {
    const s = ts[i] || {};
    return { name: s.name||'', handle: s.handle||'', role: s.role||'', country: s.country||'', active: false };
  });
  broadcast(); res.json({ ok: true });
});

// Graphic visibility (both roles)
app.post('/api/graphic/:name/show', (req, res) => { if (state[req.params.name]!==undefined) state[req.params.name].visible=true; broadcast(); res.json({ok:true}); });
app.post('/api/graphic/:name/hide', (req, res) => { if (state[req.params.name]!==undefined) state[req.params.name].visible=false; broadcast(); res.json({ok:true}); });

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
app.post('/api/headToHead',  (req, res) => { Object.assign(state.headToHead,  req.body); broadcast(); res.json({ok:true}); });
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

// Teams CRUD (admin only)
app.get('/api/teams', (req, res) => res.json({ teams: loadTeams() }));
app.post('/api/teams/save', requireAdmin, (req, res) => {
  const teams = loadTeams();
  const inc = req.body;
  if (!inc || !inc.name) return res.status(400).json({ error: 'Team name required' });
  if (inc.id) {
    const idx = teams.findIndex(t => t.id === inc.id);
    if (idx !== -1) teams[idx] = { ...teams[idx], ...inc }; else teams.push(inc);
  } else {
    inc.id = 'team_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
    teams.push(inc);
  }
  saveTeams(teams);

  // If this team is currently loaded into the active match, sync live state so
  // Game Setup, Draft, Roster, and all graphics reflect the updated name/tag/logo/color
  if (inc.id && state.match.scheduleDayId && state.match.scheduleGameId) {
    const _day = (state.tournament.schedule || []).find(d => d.id === state.match.scheduleDayId);
    const _sg  = _day && _day.games.find(g => g.id === state.match.scheduleGameId);
    if (_sg) {
      ['team1', 'team2'].forEach(slot => {
        if (_sg[slot + 'Id'] === inc.id && state.match[slot]) {
          Object.assign(state.match[slot], {
            name:  inc.name  || '',
            tag:   inc.tag   || '',
            logo:  inc.logo  != null ? inc.logo  : state.match[slot].logo,
            color: inc.color != null ? inc.color : state.match[slot].color,
          });
        }
      });
      deriveTodayGames();
      broadcast();
    }
  }

  res.json({ ok: true, team: inc });
});
app.post('/api/teams/delete', requireAdmin, (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  saveTeams(loadTeams().filter(t => t.id !== id)); res.json({ ok: true });
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
app.post('/api/upload', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({error:'No file'});
  res.json({ ok: true, url: '/uploads/' + req.file.filename });
});
app.post('/api/import/csv', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({error:'No file'});
  const results = [];
  fs.createReadStream(req.file.path).pipe(csv()).on('data',d=>results.push(d)).on('end',()=>res.json({ok:true,data:results})).on('error',e=>res.status(400).json({error:e.message}));
});
app.post('/api/import/json', requireAdmin, upload.single('file'), (req, res) => {
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
  broadcast(); res.json({ ok: true, day });
});
app.post('/api/schedule/day/update', requireAdmin, (req, res) => {
  const { id, ...updates } = req.body;
  const day = (state.tournament.schedule || []).find(d => d.id === id);
  if (!day) return res.status(404).json({ error: 'Day not found' });
  Object.assign(day, updates);
  broadcast(); res.json({ ok: true });
});
app.post('/api/schedule/day/delete', requireAdmin, (req, res) => {
  state.tournament.schedule = (state.tournament.schedule || []).filter(d => d.id !== req.body.id);
  broadcast(); res.json({ ok: true });
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
  broadcast(); res.json({ ok: true, game });
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
  deriveTodayGames(); broadcast(); res.json({ ok: true });
});
app.post('/api/schedule/game/delete', requireAdmin, (req, res) => {
  const { dayId, gameId } = req.body;
  const day = (state.tournament.schedule || []).find(d => d.id === dayId);
  if (!day) return res.status(404).json({ error: 'Day not found' });
  day.games = day.games.filter(g => g.id !== gameId);
  broadcast(); res.json({ ok: true });
});
app.post('/api/schedule/game/reorder', requireAdmin, (req, res) => {
  const { dayId, gameId, direction } = req.body;
  const day = (state.tournament.schedule || []).find(d => d.id === dayId);
  if (!day) return res.status(404).json({ error: 'Day not found' });
  const idx = day.games.findIndex(g => g.id === gameId);
  if (idx === -1) return res.json({ ok: true });
  const ni = direction === 'up' ? idx - 1 : idx + 1;
  if (ni >= 0 && ni < day.games.length) { [day.games[idx], day.games[ni]] = [day.games[ni], day.games[idx]]; }
  broadcast(); res.json({ ok: true });
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
  const teams = loadTeams();
  const loadTeamIntoSlot = (teamId, slot) => {
    const t = teamId ? teams.find(x => x.id === teamId) : null;
    if (!t) {
      // No team assigned — clear slot to TBD so stale data from a previous match doesn't persist
      const defaultColor = slot === 'team1' ? '#1ffaff' : '#a7a38e';
      state.match[slot] = { name: 'TBD', tag: 'TBD', logo: '', color: defaultColor, score: 0 };
      state.players[slot]            = makeDefaultPlayers();
      state.players[slot + 'subs']   = makeDefaultSubs();
      return;
    }
    state.match[slot] = { name: t.name||'', tag: t.tag||'', logo: t.logo||'', color: t.color||(slot==='team1'?'#1ffaff':'#a7a38e'), score: 0 };
    const tp = t.players || [];
    DEFAULT_ROLES.forEach((role, i) => {
      const p = tp[i] || {};
      state.players[slot][i] = { name: p.name||'', handle: p.handle||'', role, country: p.country||'', active: true };
    });
    const subsKey = slot + 'subs';
    state.players[subsKey] = [0,1,2].map(i => {
      const s = (t.subs||[])[i] || {};
      return { name: s.name||'', handle: s.handle||'', role: s.role||'', country: s.country||'', active: false };
    });
  };
  loadTeamIntoSlot(sg.team1Id, 'team1');
  loadTeamIntoSlot(sg.team2Id, 'team2');
  state.match.format = sg.format || 'Bo3';
  state.match.fearlessDraft = !!sg.fearlessDraft;
  state.match.scheduleDayId = dayId;
  state.match.scheduleGameId = gameId;

  const result = sg.result;
  if (restore && result && result.completed) {
    // Restore saved series state so the overlay shows the completed game correctly
    const savedGames = result.games || [];
    state.match.seriesGames = savedGames;
    state.match.team1.score = result.team1SeriesScore || 0;
    state.match.team2.score = result.team2SeriesScore || 0;
    state.match.currentGameNum = savedGames.length || 1;

    // Restore draft state from the last completed game so the overlay reflects it
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
    // Fresh start
    state.match.currentGameNum = 1;
    state.match.seriesGames    = [];
    state.match.team1.score    = 0;
    state.match.team2.score    = 0;
  }
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
  deriveTodayGames(); broadcast(); res.json({ ok: true });
});

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
  if (seriesOver && state.match.scheduleGameId && state.match.scheduleDayId) {
    const day = (state.tournament.schedule || []).find(d => d.id === state.match.scheduleDayId);
    if (day) {
      const sg = day.games.find(g => g.id === state.match.scheduleGameId);
      if (sg) {
        sg.result = { completed: true, winner: state.match.team1.score >= winsNeeded ? 'team1' : 'team2', team1SeriesScore: state.match.team1.score, team2SeriesScore: state.match.team2.score, games: [...state.match.seriesGames] };
        // Auto-update linked bracket match with series scores
        if (sg.bracketRoundIdx != null && sg.bracketMatchIdx != null) {
          const bRound = (state.bracket.rounds || [])[sg.bracketRoundIdx];
          const bMatch = bRound && bRound.matches[sg.bracketMatchIdx];
          if (bMatch) {
            bMatch.team1 = bMatch.team1 || {};
            bMatch.team2 = bMatch.team2 || {};
            bMatch.team1.score = state.match.team1.score;
            bMatch.team2.score = state.match.team2.score;
            bMatch.complete = true;
          }
        }
      }
    }
  }
  deriveTodayGames(); broadcast(); res.json({ ok: true, seriesOver });
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

  // Auto-populate win screen and sync schedule on series end
  const seriesNowOver = state.match.team1.score >= winsNeeded || state.match.team2.score >= winsNeeded;
  if (seriesNowOver) {
    state.winScreen.team    = winner;
    state.winScreen.message = formatNum === 1 ? 'WINS THE MATCH' : 'WINS THE SERIES';
    state.winScreen.seriesScore = formatNum > 1 ? (state.match.team1.score + ' — ' + state.match.team2.score) : '';
    if (state.match.scheduleGameId && state.match.scheduleDayId) {
      const day = (state.tournament.schedule || []).find(d => d.id === state.match.scheduleDayId);
      if (day) {
        const sg = day.games.find(g => g.id === state.match.scheduleGameId);
        if (sg) sg.result = { completed: true, winner, team1SeriesScore: state.match.team1.score, team2SeriesScore: state.match.team2.score, games: [...state.match.seriesGames] };
      }
    }
  }
  deriveTodayGames(); broadcast(); res.json({ ok: true, seriesOver: seriesNowOver });
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
    if (_sg) _sg.result = null;
  }
  deriveTodayGames(); broadcast(); res.json({ ok: true });
});

// ── Broadcast settings ────────────────────────────────────────────────────────
app.post('/api/settings', requireAdmin, (req, res) => {
  if (!state.settings) state.settings = {};
  deepMerge(state.settings, req.body);
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
  broadcast();
  res.json({ ok: true, profile, savedSnapshot: profile.data });
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
  }
  if (d.bracket)    { state.bracket.title = d.bracket.title || state.bracket.title; state.bracket.rounds = d.bracket.rounds || []; }
  if (d.match) {
    const keep = ['team1','team2','game','format','tournament','tournamentLogo','sponsorLogos',
                  'fearlessDraft','currentGameNum','seriesGames','scheduleDayId','scheduleGameId'];
    keep.forEach(k => { if (d.match[k] !== undefined) state.match[k] = d.match[k]; });
  }
  if (d.players) deepMerge(state.players, d.players);
  if (d.settings) {
    const incoming = JSON.parse(JSON.stringify(d.settings));
    delete incoming.graphicsToken; // never restore token from profile
    deepMerge(state.settings, incoming);
  }
  state.meta.activeProfileId   = id;
  state.meta.activeProfileName = profile.name;
  broadcast();
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
  saveProfiles(loadProfiles().filter(p => p.id !== id));
  if (state.meta.activeProfileId === id) { state.meta.activeProfileId = null; state.meta.activeProfileName = null; broadcast(); }
  res.json({ ok: true });
});

// ── User management (admin only) ───────────────────────────────────────────────
app.get('/api/users', requireAdmin, (req, res) => {
  res.json({ users: loadUsers().map(u => ({ id: u.id, username: u.username, role: u.role })) });
});
app.post('/api/users/create', requireAdmin, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (!['admin','operator'].includes(role)) return res.status(400).json({ error: 'Role must be admin or operator' });
  const users = loadUsers();
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(409).json({ error: 'Username already exists' });
  users.push({ id: 'u' + Date.now(), username, passwordHash: bcrypt.hashSync(password, 10), role });
  saveUsers(users); res.json({ ok: true });
});
app.post('/api/users/change-password', (req, res) => {
  const me = req.session.user;
  const { userId, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  // Admins can change anyone's password; operators can only change their own
  if (me.role !== 'admin' && me.id !== userId) return res.status(403).json({ error: 'Forbidden' });
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  users[idx].passwordHash = bcrypt.hashSync(newPassword, 10);
  saveUsers(users); res.json({ ok: true });
});
app.post('/api/users/delete', requireAdmin, (req, res) => {
  const { userId } = req.body;
  if (req.session.user.id === userId) return res.status(400).json({ error: 'Cannot delete your own account' });
  const users = loadUsers().filter(u => u.id !== userId);
  saveUsers(users); res.json({ ok: true });
});

// ── Socket ─────────────────────────────────────────────────────────────────────
app.post('/api/settings/regenerate-token', requireAdmin, (req, res) => {
  if (!state.settings) state.settings = {};
  state.settings.graphicsToken = require('crypto').randomBytes(16).toString('hex');
  broadcast(); res.json({ ok: true, token: state.settings.graphicsToken });
});

io.on('connection', socket => {
  const sess  = socket.request.session;
  const token = socket.handshake.auth.token || socket.handshake.query.token || '';

  // Allow logged-in users, OR read-only graphics token connections
  const isUser     = sess && sess.user;
  const isGraphics = token && state.settings && state.settings.graphicsToken === token;

  if (!isUser && !isGraphics) { socket.disconnect(true); return; }

  const label = isUser ? sess.user.username + ' (' + sess.user.role + ')' : 'graphics[token]';
  console.log('Connected:', label);
  socket.emit('state', Object.assign({}, state, { teams: loadTeams() }));

  // Only authenticated users can patch state
  if (isUser) {
    socket.on('state:patch', patch => {
      if (sess.user.role !== 'admin') return;
      deepMerge(state, patch); broadcast();
    });
  }

  socket.on('disconnect', () => console.log('Disconnected:', label));
});

server.listen(PORT, () => {
  console.log('\n  Esports GFX -> http://localhost:' + PORT + '/\n');
});
