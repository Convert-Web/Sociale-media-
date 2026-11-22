// Réglages et confidentialité : compte, confidentialité, notifications, apparence, aide et mentions.
import { api, enc } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { h, icon, toast, confirmDialog, modal, emptyState, spinner } from '../dom.js';
import { pushState, enablePush, disablePush } from '../push.js';
import { LANG_CHOICES } from '../components/translate.js';
import { toggle } from '../components/postedit.js';
import { userRow } from '../components/userlist.js';
import { logout } from './auth.js';
import { validatePasswordHint } from './onboarding.js';

const back = (to = '/reglages') => h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retour', onclick: () => navigate(to) }, icon('back'));
const head = (title, to) => h('header', { class: 'page-head' }, back(to), h('h1', null, title), h('span', { class: 'icon-btn' }));
const group = (title, ...rows) => h('section', { class: 'set-group' }, title ? h('h2', null, title) : null, h('div', { class: 'set-card' }, rows));
const link = (href, ic, label, sub = null) => h('a', { href, class: 'set-row' }, h('span', { class: 'set-ic' }, icon(ic)), h('span', { class: 'set-text' }, label, sub ? h('small', null, sub) : null), icon('chevron', 'icon-sm'));
const button = (ic, label, onclick, danger = false) => h('button', { type: 'button', class: `set-row${danger ? ' danger' : ''}`, onclick }, h('span', { class: 'set-ic' }, icon(ic)), h('span', { class: 'set-text' }, label));

async function saveSettings(patch) {
  try {
    const { user } = await api.patch('/api/me/settings', patch);
    store.setUser(user);
    toast('Réglage enregistré');
    return user;
  } catch (err) {
    toast(err.message, 'error');
    return null;
  }
}

export function getTheme() {
  try {
    return localStorage.getItem('vibz:theme') || 'system';
  } catch {
    return 'system';
  }
}
export function setTheme(v) {
  try {
    if (v === 'system') localStorage.removeItem('vibz:theme');
    else localStorage.setItem('vibz:theme', v);
  } catch {
    /* stockage indisponible */
  }
  if (v === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = v;
}

export async function settingsView(ctx) {
  const section = ctx.params.section || '';
  const u = store.user;
  const s = u.settings;
  ctx.title = 'Réglages — Vibz';

  if (section === 'compte') {
    const lang = h('select', { class: 'input' }, h('option', { value: '' }, 'Langue de l’appareil'), LANG_CHOICES.map(([c, l]) => h('option', { value: c, selected: u.lang === c }, l)));
    lang.addEventListener('change', async () => {
      try {
        const r = await api.post('/api/me/lang', { lang: lang.value || null });
        store.setUser(r.user);
        toast('Langue de traduction enregistrée');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    return h('div', { class: 'page settings' }, head('Compte'),
      group('Informations', h('div', { class: 'set-row static' }, h('span', { class: 'set-ic' }, icon('mail')), h('span', { class: 'set-text' }, 'E-mail', h('small', null, u.email))), h('div', { class: 'set-row static' }, h('span', { class: 'set-ic' }, icon('at')), h('span', { class: 'set-text' }, 'Nom d’utilisateur', h('small', null, `@${u.username}`)))),
      group('Sécurité', button('key', 'Changer de mot de passe', changePassword)),
      group('Traduction', h('label', { class: 'set-row static' }, h('span', { class: 'set-ic' }, icon('globe')), h('span', { class: 'set-text' }, 'Traduire les contenus en', lang))),
      group('Tes données', h('a', { href: '/api/me/export', class: 'set-row', download: `vibz-${u.username}.json` }, h('span', { class: 'set-ic' }, icon('download')), h('span', { class: 'set-text' }, 'Télécharger mes données', h('small', null, 'Profil, vidéos, commentaires, messages… au format JSON')))),
      group(null, button('logout', 'Se déconnecter', logout), button('trash', 'Supprimer mon compte', deleteAccount, true)),
    );
  }

  if (section === 'confidentialite') {
    const priv = toggle('Compte privé', s.privateAccount, 'Seuls les abonnés que tu acceptes voient tes vidéos.');
    priv.input.addEventListener('change', async () => {
      if (!priv.input.checked && !(await confirmDialog('Passer en compte public ?', 'Tout le monde pourra voir tes vidéos et s’abonner. Les demandes en attente seront acceptées.', 'Passer en public', false))) {
        priv.input.checked = true;
        return;
      }
      await saveSettings({ privateAccount: priv.input.checked });
    });
    const liked = toggle('Vidéos aimées visibles', s.showLiked, 'Affiche l’onglet « J’aime » de ton profil aux autres.');
    liked.input.addEventListener('change', () => saveSettings({ showLiked: liked.input.checked }));
    const perso = toggle('Fil « Pour toi » personnalisé', s.personalized, 'Désactivé : les vidéos sont classées par popularité et fraîcheur, sans tenir compte de ce que tu regardes.');
    perso.input.addEventListener('change', () => saveSettings({ personalized: perso.input.checked }));
    const dm = h('select', { class: 'input' }, [['everyone', 'Tout le monde'], ['friends', 'Amis'], ['none', 'Personne']].map(([v, l]) => h('option', { value: v, selected: s.dmPolicy === v }, l)));
    dm.addEventListener('change', () => saveSettings({ dmPolicy: dm.value }));
    const blocked = h('div', { class: 'set-card' }, spinner());
    api.get('/api/me/blocked').then(({ users }) => {
      blocked.replaceChildren(...(users.length ? users.map((b) => userRow(b, { action: h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: async (e) => { await api.del(`/api/users/${enc(b.username)}/block`); e.target.closest('.user-row').remove(); toast('Compte débloqué'); } }, 'Débloquer') })) : [h('p', { class: 'muted small pad' }, 'Aucun compte bloqué.')]));
    }).catch(() => blocked.replaceChildren());
    return h('div', { class: 'page settings' }, head('Confidentialité'),
      group('Visibilité', priv.el, liked.el),
      group('Messages', h('label', { class: 'set-row static' }, h('span', { class: 'set-ic' }, icon('send')), h('span', { class: 'set-text' }, 'Qui peut t’envoyer des messages', dm))),
      group('Ton fil « Pour toi »', perso.el, button('refresh', 'Actualiser ton fil « Pour toi »', async () => {
        if (!(await confirmDialog('Actualiser ton fil ?', 'Les centres d’intérêt appris par Vibz sont effacés : ton fil repart de zéro, comme pour un nouveau compte.', 'Actualiser', false))) return;
        await api.del('/api/me/interests');
        toast('Ton fil « Pour toi » repart de zéro');
      })),
      h('section', { class: 'set-group' }, h('h2', null, 'Comptes bloqués'), blocked),
    );
  }

  if (section === 'notifications') {
    const n = s.notify;
    const pushRow = h('div', { class: 'set-card' }, spinner());
    const paintPush = async () => {
      const st = await pushState();
      const texts = {
        unsupported: 'Ce navigateur ne gère pas les notifications.',
        install: 'Sur iPhone : ajoute d’abord Vibz à l’écran d’accueil (Partager → Sur l’écran d’accueil), puis ouvre-le depuis l’icône.',
        denied: 'Les notifications sont bloquées pour ce site dans les réglages du navigateur.',
      };
      if (texts[st]) return pushRow.replaceChildren(h('p', { class: 'muted small pad' }, texts[st]));
      const t = toggle('Notifications sur cet appareil', st === 'on', 'Messages, abonnés, commentaires, LIVE…');
      t.input.addEventListener('change', async () => {
        try {
          if (t.input.checked) await enablePush();
          else await disablePush();
          toast(t.input.checked ? 'Notifications activées' : 'Notifications désactivées');
          if (t.input.checked) api.post('/api/push/test').catch(() => {});
        } catch (err) {
          t.input.checked = !t.input.checked;
          toast(err.message, 'error');
        }
      });
      pushRow.replaceChildren(t.el);
    };
    paintPush();
    const pref = (key, label, hint) => {
      const t = toggle(label, n[key] !== false, hint);
      t.input.addEventListener('change', () => saveSettings({ notify: { [key]: t.input.checked } }));
      return t.el;
    };
    return h('div', { class: 'page settings' }, head('Notifications'),
      h('section', { class: 'set-group' }, h('h2', null, 'Sur cet appareil'), pushRow),
      group('Me prévenir pour', pref('messages', 'Messages'), pref('comments', 'Commentaires et réponses'), pref('mentions', 'Mentions'), pref('follows', 'Nouveaux abonnés'), pref('live', 'LIVE des comptes suivis'), pref('likes', 'Cadeaux reçus')),
    );
  }

  if (section === 'apparence') {
    const current = getTheme();
    const opt = (v, label, ic) => h('label', { class: 'set-row' }, h('span', { class: 'set-ic' }, icon(ic)), h('span', { class: 'set-text' }, label), h('input', { type: 'radio', name: 'theme', value: v, checked: current === v, onchange: () => { setTheme(v); toast('Apparence enregistrée'); } }));
    return h('div', { class: 'page settings' }, head('Apparence'), group(null, opt('system', 'Comme l’appareil', 'sliders'), opt('light', 'Clair', 'sun'), opt('dark', 'Sombre', 'moon')), h('p', { class: 'muted small pad' }, 'Le fil des vidéos reste toujours sombre, pour mieux les voir.'));
  }

  return h('div', { class: 'page settings' }, head('Réglages et confidentialité', `/@${u.username}`),
    group('Compte', link('/reglages/compte', 'user', 'Compte', u.email), link('/reglages/confidentialite', 'lock', 'Confidentialité', s.privateAccount ? 'Compte privé' : 'Compte public'), link('/reglages/notifications', 'bell', 'Notifications'), link('/reglages/apparence', 'moon', 'Apparence')),
    group('Créer et gagner', link('/studio', 'creator', 'Studio créateur', 'Statistiques de tes vidéos'), link('/portefeuille', 'wallet', 'Portefeuille', `${u.coins} pièce${u.coins > 1 ? 's' : ''}`)),
    u.isAdmin ? group('Administration', link('/admin', 'shield', 'Administration')) : null,
    group('Aide', link('/aide', 'help', 'Aide'), link('/regles', 'shield', 'Règles de la communauté'), link('/cgu', 'book', 'Conditions d’utilisation'), link('/cgv', 'book', 'Conditions de vente (pièces)'), link('/confidentialite', 'lock', 'Politique de confidentialité'), link('/mentions-legales', 'info', 'Mentions légales'), button('info', 'Gérer les cookies', () => document.dispatchEvent(new CustomEvent('vibz:cookies')))),
    group(null, button('logout', 'Se déconnecter', logout)),
    h('p', { class: 'muted small center' }, `Vibz · version ${String(store.config?.version || '').slice(0, 7)}`),
  );
}

function changePassword() {
  const cur = h('input', { class: 'input', type: 'password', required: true, autocomplete: 'current-password' });
  const next = h('input', { class: 'input', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' });
  const save = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Changer le mot de passe');
  const m = modal('Mot de passe', h('form', {
    class: 'modal-body form-stack',
    onsubmit: async (e) => {
      e.preventDefault();
      save.disabled = true;
      try {
        await api.post('/api/auth/password', { current: cur.value, next: next.value });
        m.close();
        toast('Mot de passe changé : les autres appareils sont déconnectés');
      } catch (err) {
        save.disabled = false;
        toast(err.message, 'error');
      }
    },
  }, h('label', { class: 'field' }, h('span', null, 'Mot de passe actuel'), cur), h('label', { class: 'field' }, h('span', null, 'Nouveau mot de passe'), next, h('small', { class: 'field-hint' }, validatePasswordHint)), save));
}

function deleteAccount() {
  const pw = h('input', { class: 'input', type: 'password', required: true, autocomplete: 'current-password' });
  const go = h('button', { type: 'submit', class: 'btn btn-danger btn-block' }, 'Supprimer définitivement');
  const m = modal('Supprimer ton compte', h('form', {
    class: 'modal-body form-stack',
    onsubmit: async (e) => {
      e.preventDefault();
      go.disabled = true;
      try {
        await api.del('/api/me', { password: pw.value });
        m.close();
        store.setUser(null);
        toast('Ton compte a été supprimé');
        navigate('/', { replace: true });
      } catch (err) {
        go.disabled = false;
        toast(err.message, 'error');
      }
    },
  }, h('p', null, 'Tes vidéos, commentaires, messages, abonnements et pièces seront effacés définitivement. Cette action est irréversible.'), h('label', { class: 'field' }, h('span', null, 'Confirme avec ton mot de passe'), pw), go));
}

export const noBlocked = () => emptyState('ban', 'Aucun compte bloqué', null);
