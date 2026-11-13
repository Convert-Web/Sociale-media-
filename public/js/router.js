// Navigation côté client (History API).
let renderFn = () => {};

export function setRenderer(fn) {
  renderFn = fn;
}

export function navigate(to, { replace = false } = {}) {
  const url = new URL(to, location.origin);
  const target = url.pathname + url.search + url.hash;
  if (target === location.pathname + location.search + location.hash && !replace) {
    renderFn({ same: true });
    return;
  }
  if (replace) history.replaceState(null, '', target);
  else history.pushState(null, '', target);
  renderFn({});
}

// Chemin de retour sûr (uniquement interne)
export function safePath(p, fallback) {
  return typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/api') ? p : fallback;
}

export function compile(path) {
  const keys = [];
  const re = new RegExp(
    `^${path.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === ':' ? c : `\\${c}`)).replace(/:(\w+)/g, (_, k) => {
      keys.push(k);
      return '([^/]+)';
    })}/?$`,
  );
  return { re, keys };
}
