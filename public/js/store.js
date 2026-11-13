// État global + bus d'événements + connexion temps réel (SSE).
import { api } from './api.js';

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
    const data = await api.get('/api/session');
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

  get isMember() {
    return Boolean(this.user?.isMember);
  },
};

let source = null;
let retryTimer = null;
let pollTimer = null;

// Mode « rafraîchissement régulier » (hébergeurs serverless) : les compteurs sont
// relus toutes les 20 s et un signal « rt:tick » permet aux pages de se mettre à jour.
export const isPolling = () => store.config?.realtime === 'poll';

async function poll() {
  if (document.hidden || !store.isMember) return;
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

export function connectRealtime() {
  if (!store.isMember) return;
  if (isPolling()) {
    if (pollTimer) return;
    pollTimer = setInterval(poll, 20000);
    document.addEventListener('visibilitychange', onVisible);
    return;
  }
  if (source) return;
  source = new EventSource('/api/events');
  const relay = (name) =>
    source.addEventListener(name, (e) => {
      const data = JSON.parse(e.data);
      if (name === 'counters') store.setCounters(data);
      store.emit(`rt:${name}`, data);
    });
  ['counters', 'notification', 'message', 'read', 'post'].forEach(relay);
  source.onerror = () => {
    if (source?.readyState === EventSource.CLOSED) {
      source = null;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connectRealtime, 5000);
    }
  };
}

export function disconnectRealtime() {
  clearInterval(pollTimer);
  pollTimer = null;
  document.removeEventListener('visibilitychange', onVisible);
  clearTimeout(retryTimer);
  source?.close();
  source = null;
}
