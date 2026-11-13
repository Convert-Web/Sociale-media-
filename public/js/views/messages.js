import { api, enc } from '../api.js';
import { store, isPolling } from '../store.js';
import { navigate } from '../router.js';
import { h, icon, avatar, nameLine, memberChip, clear, spinner, emptyState, timeAgo, clock, dayLabel, richText, autosize, toast } from '../dom.js';
import { pickMember } from './profile.js';

export function messagesView(ctx) {
  const other = ctx.params.username || null;
  const listItems = h('div', { class: 'dm-items' }, spinner());
  const threadHost = h('section', { class: 'dm-thread' });
  const root = h('div', { class: `dm${other ? ' has-thread' : ''}` });

  const newBtn = h('button', { class: 'icon-btn', 'aria-label': 'Nouveau message', title: 'Nouveau message' }, icon('pen'));
  newBtn.addEventListener('click', () => pickMember('Nouveau message', (u) => navigate(`/messages/${u.username}`)));

  async function loadList() {
    try {
      const { conversations } = await api.get('/api/conversations');
      clear(listItems);
      if (!conversations.length) {
        listItems.append(
          emptyState('mail', 'Aucune conversation', 'Écrivez à un membre : vos échanges restent entre vous.', h('button', { class: 'btn btn-primary btn-sm', onclick: () => newBtn.click() }, 'Nouveau message')),
        );
      }
      for (const c of conversations) {
        const active = other && c.user.username.toLowerCase() === other.toLowerCase();
        listItems.append(
          h(
            'a',
            { href: `/messages/${c.user.username}`, class: `dm-item${active ? ' active' : ''}${c.unread && !active ? ' unread' : ''}` },
            avatar(c.user, '', { presence: true }),
            h(
              'div',
              { class: 'meta' },
              h('div', { class: 'line1' }, nameLine(c.user, { link: false }), h('small', null, timeAgo(c.lastMessage.createdAt))),
              h('div', { class: 'preview-text' }, `${c.lastMessage.fromMe ? 'Vous : ' : ''}${c.lastMessage.body}`),
            ),
            c.unread && !active ? h('span', { class: 'dot', 'aria-label': 'Non lu' }) : null,
          ),
        );
      }
    } catch (err) {
      clear(listItems).append(h('p', { class: 'muted small', style: { padding: '16px' } }, err.message));
    }
  }

  // ---------------------------------------------------------------------
  async function loadThread() {
    if (!other) {
      threadHost.append(h('div', { class: 'dm-empty' }, emptyState('mail', 'Vos messages', 'Choisissez une conversation, ou écrivez à un membre du cercle.', h('button', { class: 'btn btn-primary', onclick: () => newBtn.click() }, 'Nouveau message'))));
      return;
    }
    threadHost.append(spinner());
    let data;
    try {
      data = await api.get(`/api/conversations/${enc(other)}`);
    } catch (err) {
      clear(threadHost).append(h('div', { class: 'dm-empty' }, emptyState('alert', 'Conversation indisponible', err.message)));
      return;
    }
    const peer = data.user;
    const me = store.user.id;
    const box = h('div', { class: 'dm-messages' });
    const seen = h('div', { class: 'seen', hidden: true }, 'Vu');
    let lastDay = null;
    let lastMine = null;

    let lastId = 0;
    const addMessage = (m, { animate = true } = {}) => {
      lastId = Math.max(lastId, m.id);
      if (box.querySelector(`[data-id="${m.id}"]`)) return;
      const day = dayLabel(m.createdAt);
      if (day !== lastDay) {
        box.insertBefore(h('div', { class: 'day-sep' }, day), seen);
        lastDay = day;
      }
      const mine = m.senderId === me;
      const bubble = h('div', { class: `bubble ${mine ? 'mine' : 'theirs'}`, dataset: { id: m.id } }, richText(m.body), h('time', null, clock(m.createdAt)));
      if (!animate) bubble.style.animation = 'none';
      box.insertBefore(bubble, seen);
      if (mine) {
        lastMine = m;
        seen.hidden = !m.readAt;
      } else {
        seen.hidden = true;
      }
    };
    box.append(seen);
    for (const m of data.messages) addMessage(m, { animate: false });
    const applySeen = (upTo) => {
      if (lastMine && upTo >= lastMine.id) seen.hidden = false;
    };
    applySeen(data.seenUpTo || 0);
    if (!data.messages.length) {
      box.prepend(h('div', { class: 'day-sep', style: { textTransform: 'none', letterSpacing: '0' } }, `Début de votre conversation avec ${peer.displayName}.`));
    }
    const scrollDown = () => requestAnimationFrame(() => (box.scrollTop = box.scrollHeight));

    const ta = h('textarea', { placeholder: `Écrire à ${peer.displayName.split(' ')[0]}…`, rows: 1, maxlength: 2000, 'aria-label': 'Message' });
    autosize(ta);
    const send = h('button', { class: 'btn btn-primary btn-icon', type: 'submit', 'aria-label': 'Envoyer' }, icon('send'));
    const form = h(
      'form',
      {
        class: 'dm-composer',
        onsubmit: async (e) => {
          e.preventDefault();
          const body = ta.value.trim();
          if (!body) return;
          send.disabled = true;
          try {
            const { message } = await api.post(`/api/conversations/${enc(peer.username)}`, { body });
            addMessage(message);
            ta.value = '';
            ta.dispatchEvent(new Event('input'));
            scrollDown();
            loadList();
          } catch (err) {
            toast(err.message, 'error');
          } finally {
            send.disabled = false;
            ta.focus();
          }
        },
      },
      ta,
      send,
    );
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        form.requestSubmit();
      }
    });

    // Temps réel
    ctx.onCleanup(
      store.on('rt:message', ({ message }) => {
        const involves = message.senderId === peer.id || message.recipientId === peer.id;
        if (involves) {
          addMessage(message);
          scrollDown();
          if (message.senderId === peer.id) api.post(`/api/conversations/${enc(peer.username)}/read`).catch(() => {});
        }
      }),
    );
    // Rafraîchissement régulier (hébergement serverless) : nouveaux messages toutes les 4 s
    if (isPolling()) {
      let busy = false;
      const timer = setInterval(async () => {
        if (document.hidden || busy) return;
        busy = true;
        try {
          const upd = await api.get(`/api/conversations/${enc(peer.username)}?after=${lastId}`);
          for (const m of upd.messages) addMessage(m);
          if (upd.messages.length) {
            scrollDown();
            loadList();
          }
          applySeen(upd.seenUpTo || 0);
        } catch {
          /* nouvel essai au prochain tour */
        } finally {
          busy = false;
        }
      }, 4000);
      ctx.onCleanup(() => clearInterval(timer));
    }
    ctx.onCleanup(
      store.on('rt:read', ({ by }) => {
        if (by === peer.id && lastMine) seen.hidden = false;
      }),
    );

    clear(threadHost).append(
      h(
        'header',
        { class: 'page-head' },
        h('a', { href: '/messages', class: 'icon-btn mobile-only', 'aria-label': 'Retour' }, icon('back')),
        h('a', { href: `/@${peer.username}` }, avatar(peer, 'sm', { presence: true })),
        h(
          'div',
          { class: 'grow' },
          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, nameLine(peer), memberChip(peer)),
          h('div', { class: 'sub' }, peer.online ? 'En ligne' : `@${peer.username}`),
        ),
      ),
      box,
      data.blocked
        ? h('div', { class: 'dm-blocked' }, icon('ban', 'icon-sm'), 'Vous ne pouvez plus échanger avec ce membre.')
        : form,
    );
    scrollDown();
    if (!data.blocked && window.matchMedia('(min-width: 721px)').matches) ta.focus();
    loadList();
  }

  // Rafraîchit la liste quand un message arrive ailleurs
  ctx.onCleanup(store.on('rt:message', () => loadList()));
  ctx.onCleanup(store.on('rt:tick', () => loadList()));

  loadList();
  loadThread();

  ctx.title = 'Messages — AURUM';
  root.append(
    h('section', { class: 'dm-list' }, h('header', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', null, 'Messages'), h('div', { class: 'sub' }, 'Privés, entre membres')), newBtn), listItems),
    threadHost,
  );
  return root;
}
