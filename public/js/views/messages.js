// Messagerie : conversations et discussion en temps réel (« Vu », « écrit… »), vidéos partagées,
// émojis, signalement d'un message, blocage.
import { api, enc } from '../api.js';
import { store, isPolling, fastPoll } from '../store.js';
import { navigate } from '../router.js';
import { h, icon, avatar, spinner, emptyState, clock, dayLabel, richText, autosize, toast, modal, debounce, verifiedMark, short, confirmDialog } from '../dom.js';
import { translateLink, myLang } from '../components/translate.js';
import { sensitive } from '../components/sensitive.js';
import { reportDialog } from '../components/report.js';
import { openSheet, closeSheet } from '../components/sheet.js';
import { convRow, streakChip } from './inbox.js';
import { playNotifSound } from '../notify.js';

// Choisir un compte (nouveau message)
export function pickUser(title, onPick) {
  const input = h('input', { class: 'input', type: 'search', placeholder: 'Rechercher un compte', autofocus: true });
  const list = h('div', { class: 'pick-list' });
  const paint = (users, empty = null, heading = null) =>
    list.replaceChildren(
      ...(heading && users.length ? [h('p', { class: 'pick-head' }, heading)] : []),
      ...(users.length ? users.map((u) => h('button', { type: 'button', class: 'pick-row', onclick: () => { m.close(); onPick(u); } }, avatar(u, 'md'), h('span', null, h('b', null, u.displayName, u.verified ? verifiedMark() : null), h('small', null, `@${u.username}`)))) : [h('p', { class: 'pick-empty' }, empty)]),
    );
  let seq = 0;
  const search = debounce(async () => {
    const q = input.value.trim();
    const mine = ++seq;
    try {
      if (!q) {
        const r = await api.get('/api/share/targets');
        if (mine !== seq) return;
        if (r.users.length) return paint(r.users, null, 'Récents et amis');
        // Nouveau compte : quelques comptes à découvrir
        const s = await api.get('/api/suggestions?limit=8').catch(() => ({ users: [] }));
        if (mine !== seq) return;
        return paint((s.users || []).slice(0, 8), 'Cherche un compte par son nom ou son @nom.', 'Suggestions');
      }
      const r = await api.get(`/api/search/suggest?q=${enc(q)}`);
      if (mine !== seq) return;
      paint(r.users.filter((u) => !u.me), `Aucun compte trouvé pour « ${q} ».`);
    } catch {
      if (mine === seq) paint([], 'Recherche indisponible. Réessaie dans un instant.');
    }
  }, 200);
  input.addEventListener('input', search);
  search();
  const m = modal(title, h('div', { class: 'modal-body form-stack' }, input, list));
}

function bubble(m, meId, other) {
  const mine = m.senderId === meId;
  const parts = [];
  if (m.post || !m.body) {
    parts.push(
      !m.post || m.post.unavailable
        ? h('div', { class: 'dm-post gone' }, icon('eyeOff', 'icon-sm'), 'Publication indisponible')
        : h('a', { href: `/@${enc(m.post.author.username)}/video/${m.post.id}`, class: 'dm-post' }, m.post.image ? h('img', { src: m.post.image, alt: '' }) : h('span', { class: 'dm-post-text' }, m.post.body), h('span', { class: 'dm-post-meta' }, avatar(m.post.author, 'xs'), h('b', null, m.post.author.displayName)), h('span', { class: 'dm-post-play' }, icon('play', 'icon-sm'))),
    );
  }
  if (m.body) {
    const text = h('div', { class: 'dm-text' }, richText(m.body));
    const content = m.flagged && !mine ? sensitive(text, m.flagged) : text;
    const tr = !mine && m.lang && m.lang !== myLang() ? translateLink([m.body], m.lang, { small: true, show: ([t]) => text.replaceChildren(richText(t)), hide: () => text.replaceChildren(richText(m.body)) }) : null;
    parts.push(h('div', { class: 'dm-bubble' }, content, tr));
  }
  const el = h('div', { class: `dm-msg${mine ? ' mine' : ''}`, dataset: { id: m.id }, title: clock(m.createdAt) }, mine ? null : avatar(other, 'xs'), h('div', { class: 'dm-stack' }, parts));
  el.__msg = m;
  if (!mine) {
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      reportDialog('message', m.id, 'Signaler le message');
    });
  }
  return el;
}

export async function messagesView(ctx) {
  const username = ctx.params.username || null;
  ctx.title = 'Messages — AURUM';
  const listHost = h('div', { class: 'dm-list' }, spinner());
  const newBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Nouveau message', onclick: () => pickUser('Nouveau message', (u) => navigate(`/messages/${enc(u.username)}`)) }, icon('pen'));
  const side = h('aside', { class: 'dm-side' }, h('header', { class: 'page-head' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retour', onclick: () => navigate('/boite') }, icon('back')), h('h1', null, 'Messages'), newBtn), listHost);
  const threadHost = h('section', { class: 'dm-thread' });
  const root = h('div', { class: `dm${username ? ' has-thread' : ''}` }, side, threadHost);

  async function loadList() {
    try {
      const { conversations } = await api.get('/api/conversations');
      listHost.replaceChildren(...(conversations.length ? conversations.map((c) => convRow(c, username && c.user.username.toLowerCase() === username.toLowerCase())) : [emptyState('send', 'Aucune conversation', 'Écris à quelqu’un pour commencer.')]));
    } catch (err) {
      listHost.replaceChildren(emptyState('alert', 'Messages indisponibles', err.message));
    }
  }
  loadList();

  ctx.onCleanup(fastPoll());
  if (!username) {
    threadHost.append(emptyState('send', 'Tes messages', 'Choisis une conversation, ou écris à quelqu’un.', h('button', { type: 'button', class: 'btn btn-primary', onclick: () => newBtn.click() }, 'Nouveau message')));
    const off = store.on('rt:message', loadList);
    ctx.onCleanup(off);
    return root;
  }

  // Discussion
  let data;
  try {
    data = await api.get(`/api/conversations/${enc(username)}`);
  } catch (err) {
    threadHost.append(emptyState('user', 'Conversation impossible', err.message));
    return root;
  }
  const other = data.user;
  const meId = store.user.id;
  // Sur téléphone, la discussion occupe tout l'écran (sans la barre d'onglets)
  document.body.classList.add('in-chat');
  ctx.onCleanup(() => document.body.classList.remove('in-chat'));
  ctx.title = `${other.displayName} — Messages`;
  const scroller = h('div', { class: 'dm-scroll' });
  const msgs = h('div', { class: 'dm-msgs' });
  const seenEl = h('div', { class: 'dm-seen', hidden: true }, 'Vu');
  const typing = h('div', { class: 'dm-typing', hidden: true }, avatar(other, 'xs'), h('span', { class: 'dots' }, h('i'), h('i'), h('i')));
  // Début de la conversation : la personne, ses abonnés, votre relation
  const relation = other.isFollowing && other.followsMe ? 'Vous vous suivez mutuellement' : other.followsMe ? 'Te suit' : other.isFollowing ? 'Tu suis ce compte' : null;
  const intro = h('div', { class: 'dm-intro', hidden: data.hasMore },
    avatar(other, 'xl'),
    h('b', null, other.displayName, other.verified ? verifiedMark() : null),
    h('small', null, `@${other.username}${other.followers !== undefined ? ` · ${short(other.followers)} abonné${other.followers > 1 ? 's' : ''}` : ''}`),
    relation ? h('small', { class: 'dm-intro-rel' }, relation) : null,
    h('a', { href: `/@${enc(other.username)}`, class: 'btn btn-ghost btn-sm' }, 'Voir le profil'));
  scroller.append(intro, msgs, seenEl, typing);
  let lastDay = '';
  let lastId = 0;
  let firstId = null;
  let seenUpTo = data.seenUpTo;
  const appendMsg = (m) => {
    if (msgs.querySelector(`[data-id="${m.id}"]`)) return;
    const day = dayLabel(m.createdAt);
    if (day !== lastDay) {
      msgs.append(h('div', { class: 'dm-day' }, day));
      lastDay = day;
    }
    msgs.append(bubble(m, meId, other));
    lastId = Math.max(lastId, m.id);
  };
  // Page plus ancienne : on reconstruit depuis le début (séparateurs de jour justes)
  let older = [];
  const prependOlder = (list) => {
    const known = [...msgs.querySelectorAll('.dm-msg')].map((el) => el.__msg).filter(Boolean);
    older = [...list, ...known];
    msgs.replaceChildren();
    lastDay = '';
    for (const m of older) appendMsg(m);
  };
  // « Vu » : seulement si le dernier message du fil est le mien et qu'il a été lu
  const paintSeen = () => {
    const last = [...msgs.querySelectorAll('.dm-msg')].pop();
    seenEl.hidden = !last || !last.classList.contains('mine') || Number(last.dataset.id) > seenUpTo;
  };
  for (const m of data.messages) appendMsg(m);
  firstId = data.messages[0]?.id || null;
  paintSeen();
  const toBottom = () => requestAnimationFrame(() => (scroller.scrollTop = scroller.scrollHeight));
  toBottom();

  // Plus anciens : en remontant
  let more = data.hasMore;
  scroller.addEventListener('scroll', async () => {
    if (scroller.scrollTop > 60 || !more || !firstId) return;
    more = false;
    const h0 = scroller.scrollHeight;
    const d = await api.get(`/api/conversations/${enc(username)}?before=${firstId}`).catch(() => null);
    if (!d) {
      more = true;
      return;
    }
    prependOlder(d.messages);
    firstId = d.messages[0]?.id || firstId;
    more = d.hasMore;
    intro.hidden = more;
    scroller.scrollTop = scroller.scrollHeight - h0;
  });

  // Saisie
  const input = h('textarea', { class: 'dm-input', rows: 1, maxlength: 2000, placeholder: 'Envoyer un message…', 'aria-label': 'Message' });
  autosize(input);
  const send = h('button', { type: 'submit', class: 'dm-send', 'aria-label': 'Envoyer', disabled: true, onpointerdown: (e) => e.preventDefault() }, icon('send'));
  const emojis = h('div', { class: 'dm-emojis', hidden: true }, ['😂', '😍', '🔥', '👍', '🙏', '😮', '😢', '🥳', '❤️', '👀', '💯', '✨'].map((e) => h('button', { type: 'button', onclick: () => { input.value += e; input.dispatchEvent(new Event('input')); input.focus(); } }, e)));
  const emojiBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Émojis', onclick: () => emojis.toggleAttribute('hidden') }, icon('smile'));
  let typingSent = 0;
  input.addEventListener('input', () => {
    send.disabled = !input.value.trim();
    if (input.value && Date.now() - typingSent > 3000) {
      typingSent = Date.now();
      api.post(`/api/conversations/${enc(username)}/typing`).catch(() => {});
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  const form = h('form', {
    class: 'dm-form',
    onsubmit: async (e) => {
      e.preventDefault();
      const body = input.value.trim();
      if (!body) return;
      send.disabled = true;
      try {
        const { message } = await api.post(`/api/conversations/${enc(username)}`, { body });
        input.value = '';
        input.dispatchEvent(new Event('input'));
        emojis.hidden = true;
        appendMsg(message);
        paintSeen();
        toBottom();
        loadList();
      } catch (err) {
        toast(err.message, 'error');
        send.disabled = false;
      }
      input.focus();
    },
  }, emojiBtn, input, send);

  const blockedByMe = data.blockedByMe ?? data.blocked;
  const blocked = data.blocked || data.refused;
  const optBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Options' }, icon('moreH'));
  optBtn.addEventListener('click', () => {
    const item = (ic, label, fn, danger) => h('button', { type: 'button', class: `opt-item${danger ? ' danger' : ''}`, onclick: () => { closeSheet(); fn(); } }, h('span', { class: 'opt-ic' }, icon(ic)), label);
    openSheet({ title: other.displayName, body: h('div', { class: 'opt-list' },
      item('user', 'Voir le profil', () => navigate(`/@${enc(other.username)}`)),
      item('flag', 'Signaler', () => reportDialog('user', other.id, 'Signaler ce compte'), true),
      item('ban', blockedByMe ? 'Débloquer' : 'Bloquer', async () => {
        if (!blockedByMe && !(await confirmDialog(`Bloquer ${other.displayName} ?`, 'Ce compte ne pourra plus voir tes vidéos, te suivre, te commenter ni t’écrire. Cette personne ne sera pas prévenue.', 'Bloquer'))) return;
        try {
          if (blockedByMe) await api.del(`/api/users/${enc(other.username)}/block`);
          else await api.post(`/api/users/${enc(other.username)}/block`);
          toast(blockedByMe ? `${other.displayName} est débloqué` : `${other.displayName} est bloqué`);
          navigate(`/messages/${enc(other.username)}`, { replace: true });
        } catch (err) {
          toast(err.message, 'error');
        }
      }, true),
    ) });
  });
  const who = h('a', { href: `/@${enc(other.username)}`, class: 'dm-who' });
  const paintWho = () => who.replaceChildren(avatar(other, 'sm', { presence: true }), h('span', null, h('b', null, other.displayName, other.verified ? verifiedMark() : null, streakChip(data.streak)), h('small', null, other.online ? 'En ligne' : `@${other.username}`)));
  paintWho();
  const showTyping = () => {
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    typing.hidden = false;
    if (atBottom) toBottom();
    clearTimeout(typing._t);
    typing._t = setTimeout(() => (typing.hidden = true), isPolling() ? 6500 : 4000);
  };
  // Série en danger (personne n'a encore écrit de son côté aujourd'hui) : un mot pour la garder
  const st = data.streak;
  const streakHint = st?.atRisk && !st.mine && !blocked ? h('div', { class: 'dm-streak-hint' }, `⏳ Votre série de ${st.days} jours s’arrête ce soir : écris-lui pour la garder 🔥`) : null;
  threadHost.append(
    h('header', { class: 'dm-head' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retour', onclick: () => navigate('/messages') }, icon('back')), who, optBtn),
    streakHint,
    scroller,
    blocked ? h('p', { class: 'dm-blocked' }, blockedByMe ? 'Tu as bloqué ce compte. Débloque-le (menu ⋯) pour vous écrire.' : data.blocked ? 'Tu ne peux pas répondre à cette conversation.' : data.refused) : h('div', { class: 'dm-compose' }, emojis, form),
  );

  // Temps réel : messages, « Vu », « écrit… » ; sur Vercel, relecture toutes les 3 secondes
  const fetchNew = async () => {
    const d = await api.get(`/api/conversations/${enc(username)}?after=${lastId}`).catch(() => null);
    if (!d) return;
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    for (const m of d.messages) appendMsg(m);
    // Un message de l'autre personne arrive dans la conversation ouverte : petite bulle sonore
    if (d.messages.some((m) => m.senderId === other.id)) playNotifSound('soft');
    seenUpTo = d.seenUpTo;
    paintSeen();
    if (d.messages.length && atBottom) toBottom();
    if (d.messages.length) typing.hidden = true;
    else if (d.typing) showTyping();
    if (d.user && Boolean(d.user.online) !== Boolean(other.online)) {
      other.online = d.user.online;
      paintWho();
    }
  };
  const offs = [
    store.on('rt:message', ({ message }) => {
      // Sans détail (rafraîchissement régulier) : on relit la discussion par précaution
      if (!message || message.senderId === other.id || message.recipientId === other.id) fetchNew();
      loadList();
    }),
    store.on('rt:read', ({ by }) => {
      if (by !== other.id) return;
      seenUpTo = lastId;
      paintSeen();
    }),
    store.on('rt:typing', ({ from }) => {
      if (from === other.id) showTyping();
    }),
  ];
  let poll = 0;
  if (isPolling()) poll = setInterval(() => !document.hidden && fetchNew(), 3000);
  ctx.onCleanup(() => {
    offs.forEach((fn) => fn());
    clearInterval(poll);
  });
  setTimeout(() => input.focus(), 100);
  return root;
}
