import { api } from '../api.js';
import { store, connectRealtime } from '../store.js';
import { navigate, safePath } from '../router.js';
import { h, icon, memberCard, cardSince } from '../dom.js';

function authLayout(content) {
  return h(
    'div',
    { class: 'auth' },
    h(
      'aside',
      { class: 'auth-art' },
      h('a', { href: '/', class: 'logo' }, 'AURUM'),
      memberCard({ name: store.user?.displayName || 'Votre nom', number: null, since: cardSince(Date.now()) }),
      h('blockquote', null, h('p', null, 'Dis-moi qui tu fréquentes, je te dirai qui tu es.'), h('footer', null, 'Proverbe')),
    ),
    h('main', { class: 'auth-form' }, h('a', { href: '/', class: 'logo' }, 'AURUM'), h('div', { class: 'auth-box fade-up' }, content)),
  );
}

function errorBox() {
  const el = h('div', { class: 'form-error', role: 'alert', hidden: true });
  return {
    el,
    show(msg) {
      el.textContent = msg;
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
    },
  };
}

function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', null, label), input, hint ? h('small', { class: 'hint' }, hint) : null);
}

function busy(btn, on, label) {
  btn.disabled = on;
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.textContent = label;
  } else if (btn.dataset.label) {
    btn.textContent = btn.dataset.label;
  }
}

function afterAuth(user, fallbackPath) {
  store.setUser(user);
  if (user.isMember) {
    connectRealtime();
    return navigate(fallbackPath, { replace: true });
  }
  navigate('/rejoindre', { replace: true });
}

// ---------------------------------------------------------------------------
export function loginView(ctx) {
  const err = errorBox();
  const login = h('input', { class: 'input', name: 'login', autocomplete: 'username', required: true, placeholder: 'vous@exemple.com ou @pseudo' });
  const password = h('input', { class: 'input', type: 'password', name: 'password', autocomplete: 'current-password', required: true, placeholder: '••••••••' });
  const btn = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' }, 'Entrer dans le cercle');
  const form = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        err.hide();
        busy(btn, true, 'Vérification…');
        try {
          const { user } = await api.post('/api/auth/login', { login: login.value, password: password.value });
          await store.refresh();
          afterAuth(user, safePath(ctx.query.get('suite'), '/salon'));
        } catch (e2) {
          err.show(e2.message);
          busy(btn, false);
        }
      },
    },
    err.el,
    field('Identifiant', login),
    field('Mot de passe', password),
    h('div', { style: { textAlign: 'right', marginTop: '-6px' } }, h('a', { href: '/mot-de-passe-oublie', class: 'small', style: { color: 'var(--link)' } }, 'Mot de passe oublié ?')),
    btn,
  );
  ctx.title = 'Connexion — AURUM';
  return authLayout([
    h('span', { class: 'eyebrow' }, 'Membres'),
    h('h1', null, 'Bon retour parmi nous.'),
    h('p', { class: 'sub' }, 'Présentez votre carte pour entrer.'),
    form,
    h('p', { class: 'auth-alt' }, 'Pas encore membre ? ', h('a', { href: '/inscription' }, 'Demander ma carte')),
  ]);
}

// ---------------------------------------------------------------------------
function slugify(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 20);
}

function scorePassword(pw) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  return Math.max(1, s);
}

export function signupView(ctx) {
  const err = errorBox();
  let usernameTouched = false;
  const displayName = h('input', { class: 'input', autocomplete: 'name', required: true, minlength: 2, maxlength: 40, placeholder: 'Victoire de Montclar' });
  const username = h('input', { class: 'input', autocomplete: 'username', required: true, maxlength: 20, placeholder: 'victoire', pattern: '[A-Za-z0-9_.]{3,20}' });
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'email', required: true, placeholder: 'vous@exemple.com' });
  const password = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true, minlength: 8, placeholder: '8 caractères minimum' });
  const meter = h('div', { class: 'pw-meter', dataset: { score: '0' } }, h('i'), h('i'), h('i'), h('i'));
  const consent = h('input', { type: 'checkbox', required: true });
  const btn = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' }, store.config.paidEntry ? 'Continuer' : 'Créer mon compte', icon('arrow'));

  displayName.addEventListener('input', () => {
    if (!usernameTouched) username.value = slugify(displayName.value);
  });
  username.addEventListener('input', () => {
    usernameTouched = true;
    username.value = username.value.replace(/[^A-Za-z0-9_.]/g, '');
  });
  password.addEventListener('input', () => (meter.dataset.score = String(scorePassword(password.value))));

  const form = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        err.hide();
        busy(btn, true, 'Création…');
        try {
          const { user } = await api.post('/api/auth/signup', {
            displayName: displayName.value,
            username: username.value,
            email: email.value,
            password: password.value,
          });
          afterAuth(user, '/bienvenue');
        } catch (e2) {
          err.show(e2.message);
          busy(btn, false);
        }
      },
    },
    err.el,
    field('Nom complet', displayName, 'Tel qu’il apparaîtra sur votre carte.'),
    field("Nom d'utilisateur", h('div', { class: 'input-prefix' }, h('b', null, '@'), username)),
    field('E-mail', email),
    h('label', { class: 'field' }, h('span', null, 'Mot de passe'), password, meter),
    h(
      'label',
      { class: 'check' },
      consent,
      h(
        'span',
        null,
        "J'ai 18 ans ou plus et j'accepte les ",
        h('a', { href: '/cgv', target: '_blank' }, 'conditions générales'),
        ' et la ',
        h('a', { href: '/confidentialite', target: '_blank' }, 'politique de confidentialité'),
        '.',
      ),
    ),
    btn,
  );

  ctx.title = 'Inscription — AURUM';
  const paid = store.config.paidEntry;
  return authLayout([
    paid ? h('div', { class: 'steps' }, h('i', { class: 'on' }), h('i'), h('span', null, 'Étape 1 sur 2 — Votre identité')) : null,
    h('h1', null, 'Demandez votre carte.'),
    h('p', { class: 'sub' }, paid ? "Quelques informations, puis le droit d'entrée. Deux minutes, pas plus." : 'Quelques informations et votre carte de membre est à vous. Gratuit.'),
    form,
    h('p', { class: 'auth-alt' }, 'Déjà membre ? ', h('a', { href: '/connexion' }, 'Se connecter')),
  ]);
}

// ---------------------------------------------------------------------------
export function forgotView(ctx) {
  const err = errorBox();
  const ok = h('div', { class: 'form-ok', hidden: true });
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'email', required: true, placeholder: 'vous@exemple.com' });
  const btn = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' }, 'Recevoir un lien');
  const form = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        err.hide();
        busy(btn, true, 'Envoi…');
        try {
          await api.post('/api/auth/forgot', { email: email.value });
          ok.textContent = 'Si un compte correspond à cette adresse, un lien de réinitialisation vient de vous être envoyé. Il est valable une heure.';
          ok.hidden = false;
          form.reset();
        } catch (e2) {
          err.show(e2.message);
        } finally {
          busy(btn, false);
        }
      },
    },
    err.el,
    ok,
    field('E-mail du compte', email),
    btn,
  );
  ctx.title = 'Mot de passe oublié — AURUM';
  return authLayout([
    h('h1', null, 'Clé égarée ?'),
    h('p', { class: 'sub' }, 'Indiquez votre e-mail, nous vous envoyons un lien pour choisir un nouveau mot de passe.'),
    form,
    h('p', { class: 'auth-alt' }, h('a', { href: '/connexion' }, 'Retour à la connexion')),
  ]);
}

export function resetView(ctx) {
  const token = ctx.query.get('jeton') || '';
  const err = errorBox();
  const pw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true, minlength: 8, placeholder: '8 caractères minimum' });
  const pw2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true, minlength: 8, placeholder: 'Confirmez' });
  const btn = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' }, 'Enregistrer');
  const form = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        err.hide();
        if (pw.value !== pw2.value) return err.show('Les deux mots de passe ne correspondent pas.');
        busy(btn, true, 'Enregistrement…');
        try {
          const { user } = await api.post('/api/auth/reset', { token, password: pw.value });
          await store.refresh();
          afterAuth(user, '/salon');
        } catch (e2) {
          err.show(e2.message);
          busy(btn, false);
        }
      },
    },
    err.el,
    field('Nouveau mot de passe', pw),
    field('Confirmation', pw2),
    btn,
  );
  ctx.title = 'Nouveau mot de passe — AURUM';
  return authLayout([h('h1', null, 'Nouveau mot de passe.'), h('p', { class: 'sub' }, 'Choisissez-le solide : il protège votre place au cercle.'), form]);
}
