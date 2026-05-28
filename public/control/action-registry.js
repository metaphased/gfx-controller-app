// action-registry.js — Bindable actions for keybinds and Companion integration
(function () {
  'use strict';

  function post(path) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  }
  function postBody(path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  const GRAPHICS = [
    { id: 'lowerThird',        label: 'Lower Third' },
    { id: 'headToHead',        label: 'Head to Head' },
    { id: 'playerIntro',       label: 'Player Intro' },
    { id: 'draft',             label: 'Draft' },
    { id: 'bracket',           label: 'Bracket' },
    { id: 'groupStage',        label: 'Group Stage' },
    { id: 'breakScreen',       label: 'Break Screen' },
    { id: 'winScreen',         label: 'Win Screen' },
    { id: 'prizepool',         label: 'Prizepool' },
    { id: 'ticker',            label: 'Ticker' },
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

  window.ActionRegistry = {
    _static,
    _buses: [],

    getAll() { return [...this._static, ...this._buses]; },

    getById(id) { return this.getAll().find(a => a.id === id); },

    updateBuses(buses) {
      this._buses = (buses || []).map(bus => ({
        id: `bus.${bus.id}.next`,
        label: `${bus.name || bus.id}: Next Graphic`,
        category: 'Bus',
        handler: () => post(`/api/bus/${bus.id}/next`),
      }));
    },
  };
})();
