// Inviter des amis : un lien à son nom (« Camille t'invite sur AURUM »). La personne invitée
// arrive sur une page d'entrée à ton nom ; à son inscription, elle te suit et tu es prévenu.
import { api } from '../api.js';
import { store } from '../store.js';
import { h, icon, avatar, toast } from '../dom.js';
import { openSheet } from './sheet.js';

// Invitation reçue (lien ouvert) : gardée 7 jours, le temps de créer son compte
const INVITE = 'vibz:invitation';
export function rememberInvite(username) {
  try {
    if (/^[a-z0-9._]{2,24}$/i.test(username || '')) localStorage.setItem(INVITE, JSON.stringify({ u: username, at: Date.now() }));
  } catch {
    /* navigation privée */
  }
}
export function pendingInvite() {
  try {
    const d = JSON.parse(localStorage.getItem(INVITE) || 'null');
    return d && Date.now() - d.at < 7 * 86400e3 ? d.u : null;
  } catch {
    return null;
  }
}
export function clearInvite() {
  try {
    localStorage.removeItem(INVITE);
  } catch {
    /* rien à effacer */
  }
}

export const inviteLink = () => `${location.origin}/rejoindre?par=${encodeURIComponent(store.user?.username || '')}`;
const inviteText = () => 'Rejoins-moi sur AURUM 🎬 Des vidéos courtes, l’actu du jour et nous.';

async function copy(url) {
  try {
    await navigator.clipboard.writeText(url);
    toast('Lien d’invitation copié : envoie-le à tes amis !');
  } catch {
    toast(url);
  }
}

export function inviteFriends() {
  if (!store.user) return;
  const url = inviteLink();
  const text = inviteText();
  const full = `${text} ${url}`;
  const app = (cls, ic, label, href) => h('a', { class: `share-app ${cls}`, href, target: '_blank', rel: 'noopener' }, h('span', { class: 'share-app-ic' }, icon(ic)), h('span', null, label));
  const already = h('div', { class: 'invite-done', hidden: true });
  api.get('/api/me/invites').then((d) => {
    if (!d.count) return;
    already.hidden = false;
    already.replaceChildren(h('span', { class: 'invite-faces' }, d.users.slice(0, 4).map((u) => avatar(u, 'xs'))), h('span', null, d.count > 1 ? `${d.count} amis t’ont déjà rejoint grâce à toi` : '1 ami t’a déjà rejoint grâce à toi'));
  }).catch(() => {});
  const body = h('div', { class: 'invite' },
    h('div', { class: 'invite-hero' },
      h('span', { class: 'invite-me' }, avatar(store.user, 'lg')),
      h('b', null, 'Plus on est, plus c’est fun'),
      h('p', null, 'Envoie ton lien : tes amis arrivent sur une page à ton nom, et vous vous retrouvez direct sur AURUM.')),
    already,
    h('button', { type: 'button', class: 'btn btn-primary btn-lg btn-block', onclick: async () => {
      if (navigator.share) {
        try {
          await navigator.share({ title: 'AURUM', text, url });
          return;
        } catch (err) {
          if (err?.name === 'AbortError') return;
        }
      }
      copy(url);
    } }, icon('share', 'icon-sm'), 'Envoyer mon invitation'),
    h('div', { class: 'share-apps invite-apps' },
      app('c-wa', 'whatsapp', 'WhatsApp', `https://wa.me/?text=${encodeURIComponent(full)}`),
      app('c-sms', 'sms', 'SMS', `sms:?&body=${encodeURIComponent(full)}`),
      app('c-mail', 'mail', 'E-mail', `mailto:?subject=${encodeURIComponent('Rejoins-moi sur AURUM')}&body=${encodeURIComponent(full)}`),
      h('button', { type: 'button', class: 'share-app c-link', onclick: () => copy(url) }, h('span', { class: 'share-app-ic' }, icon('link')), h('span', null, 'Copier'))),
    h('p', { class: 'invite-url' }, url),
  );
  openSheet({ title: 'Inviter des amis', body });
}
