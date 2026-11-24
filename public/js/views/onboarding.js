// Premier lancement : choisir ses centres d'intérêt (le fil « Pour toi » démarre avec eux),
// puis des comptes à suivre.
import { api } from '../api.js';
import { store } from '../store.js';
import { navigate, safePath } from '../router.js';
import { h, toast, logoMark } from '../dom.js';
import { suggestionsPanel } from './home.js';

export const validatePasswordHint = '8 caractères au moins, avec des lettres et un chiffre ou un symbole.';

export function welcomeView(ctx) {
  ctx.title = 'Bienvenue — Vibz';
  const next = safePath(ctx.query.get('suite'), '/');
  const picked = new Set();
  const cats = store.config?.categories || [];
  const go = h('button', { type: 'button', class: 'btn btn-primary btn-lg btn-block', disabled: true }, 'Suivant');
  const grid = h('div', { class: 'interest-grid' }, cats.map((c) => {
    const b = h('button', { type: 'button', class: 'interest', onclick: () => { if (picked.has(c.id)) picked.delete(c.id); else picked.add(c.id); b.classList.toggle('on', picked.has(c.id)); go.disabled = !picked.size; go.textContent = picked.size ? `Suivant (${picked.size})` : 'Suivant'; } }, h('span', { class: 'interest-emoji' }, c.emoji), h('span', null, c.label));
    return b;
  }));
  const step1 = h('div', { class: 'welcome-step' }, h('div', { class: 'auth-logo' }, logoMark(56)), h('h1', null, 'Qu’est-ce qui t’intéresse ?'), h('p', { class: 'auth-sub' }, 'Choisis quelques thèmes : ton fil « Pour toi » démarre avec eux, puis apprend de ce que tu regardes.'), grid, h('div', { class: 'welcome-go' }, go, h('button', { type: 'button', class: 'link-btn', onclick: () => finish([]) }, 'Passer')));
  const root = h('div', { class: 'auth welcome' }, step1);
  async function finish(list) {
    try {
      const { user } = await api.post('/api/me/onboarding', { categories: list });
      store.setUser(user);
    } catch (err) {
      toast(err.message, 'error');
    }
    root.replaceChildren(h('div', { class: 'welcome-step' }, h('h1', null, 'Suis des créateurs'), h('p', { class: 'auth-sub' }, 'Leurs vidéos apparaîtront dans « Abonnements ».'), suggestionsPanel({ welcome: true }), h('div', { class: 'welcome-go' }, h('button', { type: 'button', class: 'btn btn-primary btn-lg btn-block', onclick: () => navigate(next, { replace: true }) }, 'C’est parti !'))));
  }
  go.addEventListener('click', () => finish([...picked]));
  return root;
}
