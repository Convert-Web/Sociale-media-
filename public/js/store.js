// État global + bus d'événements + connexion temps réel (SSE).
import { api } from './api.js';

const listeners = new Map();

export const store = {
  user: null,
  config: null,
  counters: { notifications: 0, messages: 0 },

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

export function connectRealtime() {
  if (source || !store.isMember) return;
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
  clearTimeout(retryTimer);
  source?.close();
  source = null;
}
