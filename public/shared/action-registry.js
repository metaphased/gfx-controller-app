// action-registry.js — Bindable actions for keybinds and Companion integration
(function () {
  'use strict';

  function post(path) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  }
  function postBody(path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  // Full graphic set — must stay in sync with server.js GRAPHIC_PAGE_KEYS and the
  // Companion generator's GRAPHIC_LABELS. Each entry auto-gets show/hide/toggle.
  const GRAPHICS = [
    { id: 'lowerThird',          label: 'Lower Third' },
    { id: 'headToHead',          label: 'Head to Head' },
    { id: 'playerIntro',         label: 'Player Intro' },
    { id: 'playerSpotlight',     label: 'Player Spotlight' },
    { id: 'draft',               label: 'Draft' },
    { id: 'bracket',             label: 'Bracket' },
    { id: 'tournamentStructure', label: 'Tournament Structure' },
    { id: 'groupStage',          label: 'Group Stage' },
    { id: 'preShow',             label: 'Pre-Show' },
    { id: 'breakScreen',         label: 'Break Screen' },
    { id: 'winScreen',           label: 'Win Screen' },
    { id: 'prizepool',           label: 'Prizepool' },
    { id: 'ticker',              label: 'Ticker' },
  ];

  const _static = [];

  GRAPHICS.forEach(({ id, label }) => {
    _static.push({ id: `graphics.${id}.show`,   label: `Show ${label}`,   category: 'Graphics', handler: () => post(`/api/graphic/${id}/show`) });
    _static.push({ id: `graphics.${id}.hide`,   label: `Hide ${label}`,   category: 'Graphics', handler: () => post(`/api/graphic/${id}/hide`) });
    _static.push({ id: `graphics.${id}.toggle`, label: `Toggle ${label}`, category: 'Graphics', handler: () => post(`/api/graphic/${id}/toggle`) });
  });

  _static.push(
    { id: 'match.team1.score.increment', label: 'Team 1 Score +1',    category: 'Match', handler: () => post('/api/match/score/team1/increment') },
    { id: 'match.team1.score.decrement', label: 'Team 1 Score −1',    category: 'Match', handler: () => post('/api/match/score/team1/decrement') },
    { id: 'match.team2.score.increment', label: 'Team 2 Score +1',    category: 'Match', handler: () => post('/api/match/score/team2/increment') },
    { id: 'match.team2.score.decrement', label: 'Team 2 Score −1',    category: 'Match', handler: () => post('/api/match/score/team2/decrement') },
    { id: 'match.next-game',             label: 'Next Game',           category: 'Match', handler: () => post('/api/match/next-game') },
    { id: 'match.prev-game',             label: 'Previous Game',       category: 'Match', handler: () => post('/api/match/prev-game') },
    { id: 'draft.timer.toggle',          label: 'Toggle Draft Timer',  category: 'Draft', handler: () => post('/api/draft/timer/toggle') },
    { id: 'draft.reset',                 label: 'Reset Draft',         category: 'Draft', handler: () => postBody('/api/draft', { phase: 'notstarted', currentStep: 0, picks: Array(20).fill('') }) },
    { id: 'draft.replay-intro',          label: 'Replay Draft Intro',  category: 'Draft', handler: () => postBody('/api/draft', { replayIntro: true }) },
  );

  // Option actions — set specific graphic options (parallel to the Companion
  // generic-http POSTs, so each is a fixed body, not a client-side toggle).
  _static.push(
    { id: 'playerSpotlight.stage.a',    label: 'Spotlight: Player A (left)',  category: 'Player Spotlight', handler: () => postBody('/api/playerSpotlight', { stage: 'a' }) },
    { id: 'playerSpotlight.stage.b',    label: 'Spotlight: Player B (right)', category: 'Player Spotlight', handler: () => postBody('/api/playerSpotlight', { stage: 'b' }) },
    { id: 'playerSpotlight.stage.both', label: 'Spotlight: Both Players',     category: 'Player Spotlight', handler: () => postBody('/api/playerSpotlight', { stage: 'both' }) },
    { id: 'playerSpotlight.vs.show',    label: 'Spotlight: Show VS Badge',    category: 'Player Spotlight', handler: () => postBody('/api/playerSpotlight', { showVs: true }) },
    { id: 'playerSpotlight.vs.hide',    label: 'Spotlight: Hide VS Badge',    category: 'Player Spotlight', handler: () => postBody('/api/playerSpotlight', { showVs: false }) },
    { id: 'groupStage.mode.live',       label: 'Standings: Group Stage View', category: 'Group Stage', handler: () => postBody('/api/groupStage', { mode: 'live' }) },
    { id: 'groupStage.mode.final',      label: 'Standings: Final Standings',  category: 'Group Stage', handler: () => postBody('/api/groupStage', { mode: 'final' }) },
  );

  // Master "hide all lower thirds" (per-set trigger actions are dynamic, below).
  _static.push(
    { id: 'lowerThird.hideAll', label: 'Lower Third: Hide All', category: 'Lower Third', handler: () => post('/api/lowerThird/hideAll') },
  );

  window.ActionRegistry = {
    _static,
    _buses: [],
    _ltSets: [],

    getAll() { return [...this._static, ...this._buses, ...this._ltSets]; },

    getById(id) { return this.getAll().find(a => a.id === id); },

    updateBuses(buses) {
      this._buses = (buses || []).map(bus => ({
        id: `bus.${bus.id}.next`,
        label: `${bus.name || bus.id}: Next Graphic`,
        category: 'Bus',
        handler: () => post(`/api/bus/${bus.id}/next`),
      }));
    },

    // One bindable action per Lower Third set — animates that set in/out on whichever
    // output(s) it's assigned to. Mirrors updateBuses; call on every state.
    updateLowerThirdSets(lt) {
      this._ltSets = ((lt && lt.sets) || []).map(s => ({
        id: `lowerThird.set.${s.id}`,
        label: `Lower Third Set: ${s.name || s.id}`,
        category: 'Lower Third',
        handler: () => postBody('/api/lowerThird/trigger', { setId: s.id }),
      }));
    },
  };
})();
