'use strict';

// Hub temps réel basé sur Server-Sent Events (aucune dépendance, traverse les proxys HTTP).
class Hub {
  constructor() {
    this.clients = new Map(); // userId -> Set<res>
    this.heartbeat = setInterval(() => this.broadcastRaw(': ping\n\n'), 25000);
    this.heartbeat.unref();
  }

  attach(userId, req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 4000\n\n');
    let set = this.clients.get(userId);
    if (!set) {
      set = new Set();
      this.clients.set(userId, set);
    }
    set.add(res);
    req.on('close', () => {
      set.delete(res);
      if (set.size === 0) this.clients.delete(userId);
    });
  }

  isOnline(userId) {
    return this.clients.has(userId);
  }

  send(userId, event, data) {
    const set = this.clients.get(userId);
    if (!set) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) res.write(payload);
  }

  broadcastRaw(payload) {
    for (const set of this.clients.values()) for (const res of set) res.write(payload);
  }

  close() {
    clearInterval(this.heartbeat);
    for (const set of this.clients.values()) for (const res of set) res.end();
    this.clients.clear();
  }
}

module.exports = { Hub };
