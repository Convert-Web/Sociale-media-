// Parrainage : la page d'invitation (publique) et « Mes invitations » (membres).
import { api, enc } from '../api.js';
import { store, connectRealtime } from '../store.js';
import { navigate } from '../router.js';
import { h, icon, avatar, toast, spinner, memberCard, cardSince, fullDate, emptyState, verifiedMark } from '../dom.js';

const KEY = 'aurum:invitation';
export function rememberInvitation(code) {
  try {
    if (code) sessionStorage.setItem(KEY, code);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* stockage indisponible */
  }
}
export function rememberedInvitation() {
  try {
    return sessionStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}
export const prettyCode = (code) => (code || '').replace(/(.{4})(?=.)/g, '$1 ');

// Utilise un code pour un compte en attente ; renvoie true si l'entrée est accordée.
export async function redeemCode(code) {
  const { user } = await api.post('/api/admission/redeem', { code });
  store.setUser(user);
  if (!user.isMember) return false;
  rememberInvitation(null);
  await store.refresh();
  connectRealtime();
  navigate('/bienvenue', { replace: true });
  return true;
}

// ---------------------------------------------------------------------------
// /invitation/:code — ce que voit la personne invitée
// ---------------------------------------------------------------------------
export async function invitationLanding(ctx) {
  const code = ctx.params.code;
  let d;
  try {
    d = await api.get(`/api/invitations/${enc(code)}/preview`);
  } catch (err) {
    d = { valid: false, error: err.message };
  }
  ctx.title = d.inviter ? `${d.inviter.displayName} vous invite — AURUM` : 'Invitation — AURUM';
  const u = store.user;
  const head = h('div', { class: 'invite-top' }, h('a', { href: '/', class: 'logo' }, 'AURUM'));

  if (!d.valid) {
    rememberInvitation(null);
    return h(
      'div',
      { class: 'invite-page' },
      head,
      h(
        'div',
        { class: 'invite-inner fade-up' },
        h('span', { class: 'invite-seal muted' }, icon('ticket')),
        h('h1', null, d.used ? 'Cette invitation a déjà servi.' : 'Invitation introuvable.'),
        h('p', { class: 'lead' }, 'Chaque invitation ne s’utilise qu’une fois. Demandez une nouvelle invitation à votre parrain, ou présentez votre candidature au cercle.'),
        h('div', { class: 'invite-cta' }, h('a', { href: '/inscription', class: 'btn btn-primary btn-lg' }, 'Demander mon admission'), h('a', { href: '/', class: 'btn btn-ghost btn-lg' }, 'Découvrir AURUM')),
      ),
    );
  }

  rememberInvitation(d.code);
  const first = d.inviter.displayName.split(/\s+/)[0];
  let cta;
  if (u?.isMember) {
    cta = [h('p', { class: 'muted' }, 'Vous êtes déjà membre du cercle.'), h('a', { href: '/salon', class: 'btn btn-primary btn-lg' }, 'Entrer dans le Salon', icon('arrow'))];
  } else if (u) {
    const btn = h('button', { class: 'btn btn-primary btn-lg' }, 'Utiliser cette invitation', icon('arrow'));
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await redeemCode(d.code);
      } catch (err) {
        btn.disabled = false;
        toast(err.message, 'error');
      }
    });
    cta = [btn];
  } else {
    cta = [
      h('a', { href: `/inscription?invitation=${enc(d.code)}`, class: 'btn btn-primary btn-lg' }, 'Accepter l’invitation', icon('arrow')),
      h('a', { href: '/connexion', class: 'btn btn-ghost btn-lg' }, 'J’ai déjà un compte'),
    ];
  }

  return h(
    'div',
    { class: 'invite-page' },
    head,
    h(
      'div',
      { class: 'invite-inner' },
      h('span', { class: 'eyebrow fade-up' }, 'Invitation personnelle'),
      h('div', { class: 'invite-host fade-up' }, avatar(d.inviter, 'xl')),
      h(
        'h1',
        { class: 'fade-up', style: { animationDelay: '.1s' } },
        h('span', { class: 'invite-name' }, d.inviter.displayName, d.inviter.verified ? verifiedMark() : null),
        ' vous invite à rejoindre ',
        h('em', { class: 'accent' }, 'AURUM'),
        '.',
      ),
      h(
        'p',
        { class: 'lead fade-up', style: { animationDelay: '.2s' } },
        'Le cercle privé, sans publicité ni algorithme. On y entre uniquement sur invitation : ',
        first,
        ' a choisi de vous en offrir une.',
      ),
      h('div', { class: 'invite-card fade-up', style: { animationDelay: '.3s' } }, memberCard({ name: 'Votre nom ici', number: null, since: cardSince(Date.now()), founder: d.foundersLeft > 0 })),
      d.foundersLeft > 0
        ? h('p', { class: 'invite-founders fade-up', style: { animationDelay: '.4s' } }, icon('crown'), `Plus que ${d.foundersLeft} place${d.foundersLeft > 1 ? 's' : ''} de Fondateur sur ${d.founderLimit}`)
        : null,
      h('div', { class: 'invite-cta fade-up', style: { animationDelay: '.5s' } }, cta),
      h('p', { class: 'muted small fade-up', style: { animationDelay: '.6s' } }, 'Invitation valable une seule fois.'),
    ),
  );
}

// ---------------------------------------------------------------------------
// /invitations — mes cartons
// ---------------------------------------------------------------------------
async function share(invite) {
  const me = store.user;
  const text = `${me.displayName} vous invite à rejoindre AURUM, le cercle privé. Votre invitation personnelle (valable une seule fois) :`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Invitation — AURUM', text, url: invite.url });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  copy(`${text} ${invite.url}`, 'Invitation copiée : collez-la dans un message.');
}
function copy(value, message) {
  navigator.clipboard?.writeText(value).then(
    () => toast(message),
    () => toast('Copie impossible : sélectionnez le lien à la main.', 'error'),
  );
}

export function invitationsView(ctx) {
  const body = h('div', null, spinner());
  const newBtn = h('button', { class: 'btn btn-secondary btn-sm', hidden: true }, icon('plus', 'icon-sm'), 'Nouvelle');

  const card = (inv) => {
    if (inv.usedAt) {
      return h(
        'div',
        { class: 'ticket used' },
        h('div', { class: 'ticket-main' }, inv.usedBy ? avatar(inv.usedBy) : h('span', { class: 'ticket-icon' }, icon('check')), h('div', { class: 'grow' }, h('b', null, inv.usedBy ? inv.usedBy.displayName : 'Invitation utilisée'), h('small', null, `A rejoint le cercle le ${fullDate(inv.usedAt).split(' à ')[0]}`))),
        inv.usedBy ? h('a', { href: `/@${inv.usedBy.username}`, class: 'btn btn-ghost btn-sm' }, 'Profil') : null,
      );
    }
    return h(
      'div',
      { class: 'ticket' },
      h('div', { class: 'ticket-main' }, h('span', { class: 'ticket-icon' }, icon('ticket')), h('div', { class: 'grow' }, h('b', null, 'Invitation disponible'), h('code', { class: 'ticket-code' }, prettyCode(inv.code)))),
      h(
        'div',
        { class: 'ticket-actions' },
        h('button', { class: 'btn btn-primary btn-sm', onclick: () => share(inv) }, icon('send', 'icon-sm'), 'Partager'),
        h('button', { class: 'btn btn-ghost btn-sm btn-icon', 'aria-label': 'Copier le lien', title: 'Copier le lien', onclick: () => copy(inv.url, 'Lien copié.') }, icon('copy', 'icon-sm')),
      ),
    );
  };

  async function load() {
    const d = await api.get('/api/invitations');
    newBtn.hidden = !d.unlimited;
    body.replaceChildren(
      h(
        'section',
        { class: 'invite-intro' },
        h('div', { class: 'invite-stats' }, h('div', null, h('b', null, String(d.available)), h('small', null, d.available > 1 ? 'disponibles' : 'disponible')), h('div', null, h('b', null, String(d.invitedCount)), h('small', null, d.invitedCount > 1 ? 'membres parrainés' : 'membre parrainé'))),
        h('p', null, d.unlimited ? 'En tant que Direction, vous pouvez créer autant d’invitations que nécessaire.' : `Chaque membre dispose de ${d.quota} invitations. Choisissez-les avec soin : le cercle vaut ce que valent ses membres.`),
      ),
      d.invites.length ? h('div', { class: 'tickets' }, d.invites.map(card)) : emptyState('ticket', 'Aucune invitation', null),
      h('p', { class: 'muted small', style: { padding: '14px 4px 28px', textAlign: 'center' } }, 'Chaque lien ne fonctionne qu’une fois. La personne invitée entre directement, sans attendre la validation de la Direction.'),
    );
  }
  newBtn.addEventListener('click', async () => {
    try {
      await api.post('/api/invitations');
      toast('Nouvelle invitation créée.');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  load().catch((err) => body.replaceChildren(h('p', { class: 'muted', style: { padding: '20px' } }, err.message)));
  ctx.title = 'Invitations — AURUM';
  return h('div', null, h('header', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', null, 'Invitations'), h('div', { class: 'sub' }, 'Faites entrer vos proches')), newBtn), body);
}
