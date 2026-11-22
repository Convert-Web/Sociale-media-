// État global + bus d'événements + connexion temps réel (SSE, ou rafraîchissement régulier sur Vercel).
import { api, fromResponse } from './api.js';

const listeners = new Map();

export const store = {
  user: null,
  config: null,
  counters: { notifications: 0, messages: 0, requests: 0 },

  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event)?.delete(fn);
  },
  emit(event, data) {
    for (const fn of listeners.get(event) || []) {
      try {
        fn(data);
      } catch (err) {
        console.error(err);
      }
    }
  },

  async refresh() {
    // Première fois : la session demandée par boot.js dès l'ouverture de la page
    const early = window.__vibzSession;
    window.__vibzSession = null;
    const data = early ? await fromResponse(early).catch(() => api.get('/api/session')) : await api.get('/api/session');
    this.user = data.user;
    this.config = data.config;
    if (data.counters) this.setCounters(data.counters);
    this.emit('user', this.user);
    return data;
  },

  setUser(user) {
    this.user = user;
    this.emit('user', user);
  },

  setCounters(c) {
    this.counters = { ...this.counters, ...c };
    this.emit('counters', this.counters);
  },

  get loggedIn() {
    return Boolean(this.user);
  },
};

let source = null;
let retryTimer = null;
let pollTimer = null;

// Mode « rafraîchissement régulier » (hébergeurs serverless) : compteurs relus régulièrement et
// signal « rt:tick » pour que les pages ouvertes se mettent à jour.
export const isPolling = () => store.config?.realtime === 'poll';

async function poll() {
  if (document.hidden || !store.user) return;
  try {
    store.setCounters(await api.get('/api/counters'));
  } catch {
    /* nouvel essai au prochain tour */
  }
  store.emit('rt:tick');
}

function onVisible() {
  if (!document.hidden) poll();
}

// Rythme adaptatif : toutes les 15 s quand on utilise l'application, toutes les 60 s au repos
let lastActive = Date.now();
for (const ev of ['pointerdown', 'keydown', 'scroll']) addEventListener(ev, () => (lastActive = Date.now()), { passive: true });
function schedule() {
  clearTimeout(pollTimer);
  const idle = Date.now() - lastActive > 120000;
  pollTimer = setTimeout(async () => {
    await poll();
    if (pollTimer) schedule();
  }, idle ? 60000 : 15000);
}

export function connectRealtime() {
  if (!store.user) return;
  if (isPolling()) {
    if (pollTimer) return;
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return;
  }
  if (source) return;
  source = new EventSource('/api/stream');
  const relay = (name) =>
    source.addEventListener(name, (e) => {
      const data = JSON.parse(e.data);
      if (name === 'counters') store.setCounters(data);
      store.emit(`rt:${name}`, data);
    });
  ['counters', 'notification', 'message', 'read', 'typing', 'comment'].forEach(relay);
  source.onerror = () => {
    if (source?.readyState === EventSource.CLOSED) {
      source = null;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connectRealtime, 5000);
    }
  };
}

export function disconnectRealtime() {
  clearTimeout(pollTimer);
  pollTimer = null;
  document.removeEventListener('visibilitychange', onVisible);
  clearTimeout(retryTimer);
  source?.close();
  source = null;
}
