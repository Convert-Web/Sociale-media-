// Connexion, inscription (avec date de naissance et nom d'utilisateur vérifié pendant la saisie),
// mot de passe oublié, réinitialisation, déconnexion.
import { api, enc } from '../api.js';
import { store, disconnectRealtime } from '../store.js';
import { navigate, safePath } from '../router.js';
import { h, icon, toast, debounce, logoMark } from '../dom.js';
import { detachPush } from '../push.js';
import { fieldError } from '../forms.js';
import { pendingInvite, clearInvite } from '../components/invite.js';

const PASSWORD_HINT = '8 caractères au moins, avec des lettres et un chiffre ou un symbole.';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function frame(ctx, title, subtitle, ...content) {
  return h(
    'div',
    { class: 'auth' },
    h('header', { class: 'auth-top' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retour', onclick: () => { const s = safePath(ctx.query.get('suite'), ''); navigate(s ? `/rejoindre?suite=${enc(s)}` : '/rejoindre'); } }, icon('back')), h('a', { href: '/aide', class: 'icon-btn', 'aria-label': 'Aide' }, icon('help'))),
    h('div', { class: 'auth-card' }, h('div', { class: 'auth-logo' }, logoMark(56)), h('h1', null, title), subtitle ? h('p', { class: 'auth-sub' }, subtitle) : null, ...content),
  );
}

function field(label, input, hint = null) {
  return h('label', { class: 'field' }, h('span', null, label), input, hint);
}

// Message d'erreur qui reste affiché (et lu par les lecteurs d'écran) jusqu'au prochain envoi
function formError() {
  const el = h('p', { class: 'form-error', role: 'alert', hidden: true });
  return {
    el,
    show(msg) {
      el.textContent = msg;
      el.hidden = false;
    },
    clear() {
      el.hidden = true;
      el.textContent = '';
    },
  };
}

export function passwordInput(attrs = {}) {
  const input = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true, minlength: 8, ...attrs });
  const eye = h('button', { type: 'button', class: 'pw-eye', 'aria-label': 'Afficher le mot de passe', 'aria-pressed': 'false' }, icon('eye'));
  eye.addEventListener('click', () => {
    const shown = input.type === 'password';
    input.type = shown ? 'text' : 'password';
    eye.replaceChildren(icon(shown ? 'eyeOff' : 'eye'));
    eye.setAttribute('aria-label', shown ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
    eye.setAttribute('aria-pressed', String(shown));
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
  ctx.title = 'Connexion — AURUM';
  const login = h('input', { class: 'input', type: 'text', autocomplete: 'username', required: true, placeholder: 'E-mail ou nom d’utilisateur', autocapitalize: 'none' });
  // Connexion : seulement « rempli » (un mot de passe faux reçoit le message du serveur, sans
  // dévoiler les règles des nouveaux mots de passe)
  const pw = passwordInput({ placeholder: 'Mot de passe', minlength: null });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block' }, 'Se connecter');
  const error = formError();
  const form = h(
    'form',
    {
      class: 'form-stack',
      onsubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        error.clear();
        try {
          const { user } = await api.post('/api/auth/login', { login: login.value.trim(), password: pw.input.value });
          await afterAuth(ctx, user);
        } catch (err) {
          submit.disabled = false;
          error.show(err.message);
          // Mauvais mot de passe : il est sélectionné, prêt à être retapé
          if (err.code === 'BAD_LOGIN') {
            pw.input.focus();
            pw.input.select();
          }
        }
      },
    },
    field('Identifiant', login),
    field('Mot de passe', pw.el),
    h('a', { href: '/mot-de-passe-oublie', class: 'auth-link' }, 'Mot de passe oublié ?'),
    error.el,
    submit,
  );
  return frame(ctx, 'Connexion à AURUM', 'Retrouve tes abonnements, tes messages et tes vidéos.', form, h('p', { class: 'auth-switch' }, 'Pas encore de compte ? ', h('a', { href: `/inscription${location.search}` }, 'S’inscrire')));
}

export function signupView(ctx) {
  ctx.title = 'Inscription — AURUM';
  const shownAt = Date.now();
  // Étape 1 : date de naissance (comme les grands réseaux : 13 ans au moins)
  const day = h('select', { class: 'input', required: true, 'aria-label': 'Jour' }, h('option', { value: '' }, 'Jour'), Array.from({ length: 31 }, (_, i) => h('option', { value: String(i + 1) }, String(i + 1))));
  const month = h('select', { class: 'input', required: true, 'aria-label': 'Mois' }, h('option', { value: '' }, 'Mois'), MONTHS.map((m, i) => h('option', { value: String(i + 1) }, m)));
  const year = h('select', { class: 'input', required: true, 'aria-label': 'Année' }, h('option', { value: '' }, 'Année'), Array.from({ length: 100 }, (_, i) => new Date().getFullYear() - i).map((y) => h('option', { value: String(y) }, String(y))));
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'email', required: true, placeholder: 'adresse@exemple.fr' });
  const username = h('input', { class: 'input', type: 'text', autocomplete: 'username', minlength: 2, maxlength: 24, placeholder: 'nom_utilisateur', autocapitalize: 'none', spellcheck: 'false' });
  const HINT = 'Lettres sans accent, chiffres, « _ » et « . » — modifiable ensuite.';
  const userHint = h('small', { class: 'field-hint' }, HINT);
  let suggested = '';
  const name = h('input', { class: 'input', type: 'text', autocomplete: 'name', maxlength: 30, placeholder: 'Ton nom (facultatif)' });
  const pw = passwordInput({ autocomplete: 'new-password', placeholder: '8 caractères au moins' });
  const terms = h('input', { type: 'checkbox', required: true });
  const error = formError();
  const trap = h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', class: 'trap', 'aria-hidden': 'true' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block' }, 'S’inscrire');
  const paintHint = (text, state = null) => {
    userHint.textContent = text;
    userHint.classList.toggle('ok', state === 'ok');
    userHint.classList.toggle('bad', state === 'bad');
  };
  const check = debounce(async () => {
    const v = username.value.trim().replace(/^@/, '');
    // Champ vidé : retour à l'aide, ou au nom proposé à partir de l'e-mail
    if (!v) return paintHint(suggested ? `Sans choix de ta part, tu seras @${suggested}.` : HINT);
    try {
      const r = await api.get(`/api/auth/username?u=${enc(v)}`);
      if (v !== username.value.trim().replace(/^@/, '')) return;
      paintHint(r.ok ? `@${v} est disponible` : r.reason, r.ok ? 'ok' : 'bad');
    } catch {
      /* vérification indisponible */
    }
  }, 300);
  username.addEventListener('input', check);
  // Suggestion tirée de l'e-mail (vérifiée : si elle est prise, une variante libre), utilisée
  // seulement si le champ reste vide
  email.addEventListener('change', async () => {
    const base = email.value.split('@')[0].toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9_.]/g, '').replace(/^[._]+|[._]+$/g, '').slice(0, 20);
    suggested = '';
    username.placeholder = 'nom_utilisateur';
    if (base.length >= 2) {
      for (const candidate of [base, ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${base}${n}`)]) {
        const r = await api.get(`/api/auth/username?u=${enc(candidate)}`).catch(() => null);
        if (r?.ok) {
          suggested = candidate;
          break;
        }
        if (!r) break;
      }
    }
    if (suggested) username.placeholder = suggested;
    if (!username.value.trim()) paintHint(suggested ? `Sans choix de ta part, tu seras @${suggested}.` : HINT);
  });
  // Erreur du serveur : sous le champ concerné quand on sait lequel
  const FIELD_OF = { USERNAME_TAKEN: () => username, USERNAME_INVALID: () => username, EMAIL_TAKEN: () => email, EMAIL_INVALID: () => email, PASSWORD_WEAK: () => pw.input, BIRTHDATE: () => day, TOO_YOUNG: () => day, TERMS: () => terms };
  const form = h(
    'form',
    {
      class: 'form-stack',
      onsubmit: async (e) => {
        e.preventDefault();
        error.clear();
        const chosen = username.value.trim().replace(/^@/, '') || suggested;
        if (!chosen) return fieldError(username, 'Choisis un nom d’utilisateur.');
        submit.disabled = true;
        const birthdate = `${year.value}-${String(month.value).padStart(2, '0')}-${String(day.value).padStart(2, '0')}`;
        try {
          const { user } = await api.post('/api/auth/signup', {
            birthdate,
            email: email.value.trim(),
            username: chosen,
            displayName: name.value.trim() || chosen,
            password: pw.input.value,
            terms: terms.checked,
            ref: pendingInvite() || undefined,
            website: trap.value,
            elapsed: Date.now() - shownAt,
          });
          clearInvite();
          toast(`Bienvenue sur AURUM, ${user.displayName} !`);
          await afterAuth(ctx, user, { fresh: true });
        } catch (err) {
          submit.disabled = false;
          const el = FIELD_OF[err.code]?.();
          if (el) fieldError(el, err.message);
          else error.show(err.message);
        }
      },
    },
    h('div', { class: 'field' }, h('span', null, 'Date de naissance'), h('div', { class: 'dob' }, day, month, year), h('small', { class: 'field-hint' }, 'Elle n’apparaîtra pas sur ton profil.')),
    field('E-mail', email),
    field('Nom d’utilisateur', username, userHint),
    field('Nom affiché', name),
    field('Mot de passe', pw.el, h('small', { class: 'field-hint' }, PASSWORD_HINT)),
    trap,
    h('label', { class: 'check' }, terms, h('span', null, 'J’accepte les ', h('a', { href: '/cgu', target: '_blank' }, 'conditions d’utilisation'), ' et la ', h('a', { href: '/confidentialite', target: '_blank' }, 'politique de confidentialité'), '.')),
    error.el,
    submit,
  );
  return frame(ctx, 'Inscris-toi sur AURUM', 'Crée un compte pour suivre d’autres comptes, aimer des vidéos et créer les tiennes.', form, h('p', { class: 'auth-switch' }, 'Tu as déjà un compte ? ', h('a', { href: `/connexion${location.search}` }, 'Se connecter')));
}

export function forgotView(ctx) {
  ctx.title = 'Mot de passe oublié — AURUM';
  const email = h('input', { class: 'input', type: 'email', required: true, autocomplete: 'email', placeholder: 'adresse@exemple.fr' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block' }, 'Recevoir le lien');
  const done = h('p', { class: 'auth-done', hidden: true }, 'Si un compte existe avec cette adresse, un lien vient de partir. Pense à regarder dans les indésirables.');
  const error = formError();
  const form = h('form', {
    class: 'form-stack',
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      error.clear();
      try {
        await api.post('/api/auth/forgot', { email: email.value.trim() });
        done.hidden = false;
      } catch (err) {
        error.show(err.message);
      } finally {
        submit.disabled = false;
      }
    },
  }, field('E-mail du compte', email), error.el, submit, done);
  return frame(ctx, 'Mot de passe oublié', 'Nous t’envoyons un lien pour en choisir un nouveau.', form, h('p', { class: 'auth-switch' }, h('a', { href: '/connexion' }, 'Retour à la connexion')));
}

export async function resetView(ctx) {
  ctx.title = 'Nouveau mot de passe — AURUM';
  const token = ctx.query.get('jeton') || '';
  const expired = () =>
    frame(ctx, 'Lien expiré', 'Ce lien a expiré ou a déjà été utilisé. Demande un nouveau lien : il est valable une heure.',
      h('div', { class: 'form-stack' }, h('a', { href: '/mot-de-passe-oublie', class: 'btn btn-primary btn-lg btn-block' }, 'Recevoir un nouveau lien'), h('a', { href: '/connexion', class: 'auth-link center' }, 'Retour à la connexion')));
  const check = token ? await api.get(`/api/auth/reset?token=${enc(token)}`).catch(() => ({ valid: true })) : { valid: false };
  if (!check.valid) return expired();
  const pw = passwordInput({ autocomplete: 'new-password', placeholder: '8 caractères au moins' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block' }, 'Enregistrer');
  const error = formError();
  const form = h('form', {
    class: 'form-stack',
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      error.clear();
      try {
        const { user } = await api.post('/api/auth/reset', { token, password: pw.input.value });
        toast('Mot de passe modifié');
        await afterAuth(ctx, user);
      } catch (err) {
        submit.disabled = false;
        if (err.code === 'RESET_EXPIRED') form.closest('.auth')?.replaceWith(expired());
        else if (err.code === 'PASSWORD_WEAK') fieldError(pw.input, err.message);
        else error.show(err.message);
      }
    },
  }, field('Nouveau mot de passe', pw.el, h('small', { class: 'field-hint' }, PASSWORD_HINT)), error.el, submit);
  return frame(ctx, 'Nouveau mot de passe', 'Choisis un mot de passe que tu n’utilises pas ailleurs.', form);
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
  toast('Déconnexion effectuée. À bientôt !');
  navigate('/', { replace: true });
}
