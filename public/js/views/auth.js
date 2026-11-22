// Connexion, inscription (avec date de naissance et nom d'utilisateur vérifié pendant la saisie),
// mot de passe oublié, réinitialisation, déconnexion.
import { api, enc } from '../api.js';
import { store, disconnectRealtime } from '../store.js';
import { navigate, safePath } from '../router.js';
import { h, icon, toast, debounce, logoMark } from '../dom.js';
import { detachPush } from '../push.js';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function frame(ctx, title, subtitle, ...content) {
  return h(
    'div',
    { class: 'auth' },
    h('header', { class: 'auth-top' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fermer', onclick: () => navigate(safePath(ctx.query.get('suite'), '/')) }, icon('x')), h('a', { href: '/aide', class: 'icon-btn', 'aria-label': 'Aide' }, icon('help'))),
    h('div', { class: 'auth-card' }, h('div', { class: 'auth-logo' }, logoMark(56)), h('h1', null, title), subtitle ? h('p', { class: 'auth-sub' }, subtitle) : null, ...content),
  );
}

function field(label, input, hint = null) {
  return h('label', { class: 'field' }, h('span', null, label), input, hint);
}

function passwordInput(attrs = {}) {
  const input = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true, minlength: 8, ...attrs });
  const eye = h('button', { type: 'button', class: 'pw-eye', 'aria-label': 'Afficher le mot de passe' }, icon('eye'));
  eye.addEventListener('click', () => {
    input.type = input.type === 'password' ? 'text' : 'password';
    eye.replaceChildren(icon(input.type === 'password' ? 'eye' : 'eyeOff'));
  });
  return { input, el: h('div', { class: 'pw-wrap' }, input, eye) };
}

async function afterAuth(ctx, user, { fresh = false } = {}) {
  store.setUser(user);
  await store.refresh().catch(() => {});
  const next = safePath(ctx.query.get('suite'), '/');
  navigate(fresh ? `/bienvenue?suite=${enc(next)}` : next, { replace: true });
}

export function loginView(ctx) {
  ctx.title = 'Connexion — Vibz';
  const login = h('input', { class: 'input', type: 'text', autocomplete: 'username', required: true, placeholder: 'E-mail ou nom d’utilisateur', autocapitalize: 'none' });
  const pw = passwordInput({ placeholder: 'Mot de passe' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block' }, 'Se connecter');
  const form = h(
    'form',
    {
      class: 'form-stack',
      onsubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        try {
          const { user } = await api.post('/api/auth/login', { login: login.value.trim(), password: pw.input.value });
          await afterAuth(ctx, user);
        } catch (err) {
          submit.disabled = false;
          toast(err.message, 'error');
        }
      },
    },
    field('Identifiant', login),
    field('Mot de passe', pw.el),
    h('a', { href: '/mot-de-passe-oublie', class: 'auth-link' }, 'Mot de passe oublié ?'),
    submit,
  );
  return frame(ctx, 'Connexion à Vibz', 'Retrouve tes abonnements, tes messages et tes vidéos.', form, h('p', { class: 'auth-switch' }, 'Pas encore de compte ? ', h('a', { href: `/inscription${location.search}` }, 'S’inscrire')));
}

export function signupView(ctx) {
  ctx.title = 'Inscription — Vibz';
  const shownAt = Date.now();
  // Étape 1 : date de naissance (comme les grands réseaux : 13 ans au moins)
  const day = h('select', { class: 'input', required: true, 'aria-label': 'Jour' }, h('option', { value: '' }, 'Jour'), Array.from({ length: 31 }, (_, i) => h('option', { value: String(i + 1) }, String(i + 1))));
  const month = h('select', { class: 'input', required: true, 'aria-label': 'Mois' }, h('option', { value: '' }, 'Mois'), MONTHS.map((m, i) => h('option', { value: String(i + 1) }, m)));
  const year = h('select', { class: 'input', required: true, 'aria-label': 'Année' }, h('option', { value: '' }, 'Année'), Array.from({ length: 100 }, (_, i) => new Date().getFullYear() - i).map((y) => h('option', { value: String(y) }, String(y))));
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'email', required: true, placeholder: 'adresse@exemple.fr' });
  const username = h('input', { class: 'input', type: 'text', autocomplete: 'username', required: true, minlength: 2, maxlength: 24, placeholder: 'nom_utilisateur', autocapitalize: 'none', spellcheck: 'false' });
  const userHint = h('small', { class: 'field-hint' }, 'Lettres, chiffres, « _ » et « . » — modifiable ensuite.');
  const name = h('input', { class: 'input', type: 'text', autocomplete: 'name', maxlength: 30, placeholder: 'Ton nom (facultatif)' });
  const pw = passwordInput({ autocomplete: 'new-password', placeholder: '8 caractères au moins' });
  const terms = h('input', { type: 'checkbox', required: true });
  const trap = h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', class: 'trap', 'aria-hidden': 'true' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block' }, 'S’inscrire');
  const check = debounce(async () => {
    const v = username.value.trim().replace(/^@/, '');
    if (!v) return;
    try {
      const r = await api.get(`/api/auth/username?u=${enc(v)}`);
      userHint.textContent = r.ok ? `@${v} est disponible` : r.reason;
      userHint.classList.toggle('ok', r.ok);
      userHint.classList.toggle('bad', !r.ok);
    } catch {
      /* vérification indisponible */
    }
  }, 300);
  username.addEventListener('input', check);
  email.addEventListener('change', () => {
    if (username.value) return;
    const base = email.value.split('@')[0].toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 20);
    if (base.length >= 2) {
      username.value = base;
      check();
    }
  });
  const form = h(
    'form',
    {
      class: 'form-stack',
      onsubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        const birthdate = `${year.value}-${String(month.value).padStart(2, '0')}-${String(day.value).padStart(2, '0')}`;
        try {
          const { user } = await api.post('/api/auth/signup', {
            birthdate,
            email: email.value.trim(),
            username: username.value.trim(),
            displayName: name.value.trim() || username.value.trim(),
            password: pw.input.value,
            terms: terms.checked,
            website: trap.value,
            elapsed: Date.now() - shownAt,
          });
          toast(`Bienvenue sur Vibz, ${user.displayName} !`);
          await afterAuth(ctx, user, { fresh: true });
        } catch (err) {
          submit.disabled = false;
          toast(err.message, 'error');
        }
      },
    },
    h('div', { class: 'field' }, h('span', null, 'Date de naissance'), h('div', { class: 'dob' }, day, month, year), h('small', { class: 'field-hint' }, 'Elle n’apparaîtra pas sur ton profil.')),
    field('E-mail', email),
    field('Nom d’utilisateur', username, userHint),
    field('Nom affiché', name),
    field('Mot de passe', pw.el, h('small', { class: 'field-hint' }, 'Des lettres et au moins un chiffre ou un symbole.')),
    trap,
    h('label', { class: 'check' }, terms, h('span', null, 'J’accepte les ', h('a', { href: '/cgu', target: '_blank' }, 'conditions d’utilisation'), ' et la ', h('a', { href: '/confidentialite', target: '_blank' }, 'politique de confidentialité'), '.')),
    submit,
  );
  return frame(ctx, 'Inscris-toi sur Vibz', 'Crée un compte pour suivre d’autres comptes, aimer des vidéos et créer les tiennes.', form, h('p', { class: 'auth-switch' }, 'Tu as déjà un compte ? ', h('a', { href: `/connexion${location.search}` }, 'Se connecter')));
}

export function forgotView(ctx) {
  ctx.title = 'Mot de passe oublié — Vibz';
  const email = h('input', { class: 'input', type: 'email', required: true, autocomplete: 'email', placeholder: 'adresse@exemple.fr' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block' }, 'Recevoir le lien');
  const done = h('p', { class: 'auth-done', hidden: true }, 'Si un compte existe avec cette adresse, un lien vient de partir. Pense à regarder dans les indésirables.');
  const form = h('form', {
    class: 'form-stack',
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        await api.post('/api/auth/forgot', { email: email.value.trim() });
        done.hidden = false;
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        submit.disabled = false;
      }
    },
  }, field('E-mail du compte', email), submit, done);
  return frame(ctx, 'Mot de passe oublié', 'Nous t’envoyons un lien pour en choisir un nouveau.', form, h('p', { class: 'auth-switch' }, h('a', { href: '/connexion' }, 'Retour à la connexion')));
}

export function resetView(ctx) {
  ctx.title = 'Nouveau mot de passe — Vibz';
  const token = ctx.query.get('jeton') || '';
  const pw = passwordInput({ autocomplete: 'new-password', placeholder: '8 caractères au moins' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block' }, 'Enregistrer');
  const form = h('form', {
    class: 'form-stack',
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        const { user } = await api.post('/api/auth/reset', { token, password: pw.input.value });
        toast('Mot de passe modifié');
        await afterAuth(ctx, user);
      } catch (err) {
        submit.disabled = false;
        toast(err.message, 'error');
      }
    },
  }, field('Nouveau mot de passe', pw.el), submit);
  return frame(ctx, 'Nouveau mot de passe', null, form);
}

export async function logout() {
  try {
    await detachPush();
  } catch {
    /* sans importance */
  }
  await api.post('/api/auth/logout').catch(() => {});
  disconnectRealtime();
  store.setUser(null);
  store.setCounters({ notifications: 0, messages: 0, requests: 0 });
  toast('Tu es déconnecté·e');
  navigate('/', { replace: true });
}
