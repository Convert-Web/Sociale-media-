// Commentaires d'une vidéo, dans une feuille qui monte par-dessus (la vidéo continue de jouer) :
// commentaire épinglé, « Aimé par le créateur », réponses repliées, J'aime, réponses à plat,
// suggestions @ et #, émojis rapides, appui long pour répondre, copier, épingler, supprimer, signaler.
import { api } from '../api.js';
import { store } from '../store.js';
import { h, icon, avatar, richText, short, toast, timeAgo, spinner, autosize, verifiedMark, emptyState } from '../dom.js';
import { openSheet } from './sheet.js';
import { needLogin } from './actions.js';
import { attachMentions } from './mentions.js';
import { reportDialog } from './report.js';
import { sensitive } from './sensitive.js';
import { translateLink, myLang } from './translate.js';

const QUICK = ['😂', '😍', '🔥', '👏', '😮', '😢', '🥰', '💯'];
const label = (n) => (n ? `${short(n)} commentaire${n > 1 ? 's' : ''}` : 'Commentaires');

export function openComments(post, { onCount, focusId = null } = {}) {
  let count = post.commentCount || 0;
  let cursor = null;
  let loading = false;
  let replyTo = null; // { id, username }
  const list = h('div', { class: 'cm-list' }, spinner());
  const sentinel = h('div', { class: 'cm-sentinel' });
  const body = h('div', { class: 'cm-body' }, list, sentinel);
  let sheet = null;

  const setCount = (n) => {
    count = n;
    post.commentCount = n;
    sheet?.setTitle(label(n));
    onCount?.(n);
    document.dispatchEvent(new CustomEvent('vibz:post', { detail: post }));
  };

  function row(c, { reply = false } = {}) {
    const likeCount = h('small', null, c.likeCount ? short(c.likeCount) : '');
    const likeBtn = h('button', { type: 'button', class: `cm-like${c.liked ? ' on' : ''}`, 'aria-label': 'J’aime le commentaire' }, icon(c.liked ? 'heart-fill' : 'heart'), likeCount);
    likeBtn.addEventListener('click', async () => {
      if (needLogin('Connecte-toi pour aimer ce commentaire.')) return;
      const was = c.liked;
      c.liked = !was;
      c.likeCount = Math.max(0, c.likeCount + (was ? -1 : 1));
      paintLike();
      try {
        const r = was ? await api.del(`/api/comments/${c.id}/like`) : await api.post(`/api/comments/${c.id}/like`);
        c.likeCount = r.likeCount;
        paintLike();
      } catch (err) {
        c.liked = was;
        c.likeCount = Math.max(0, c.likeCount + (was ? 1 : -1));
        paintLike();
        toast(err.message, 'error');
      }
    });
    const paintLike = () => {
      likeBtn.classList.toggle('on', c.liked);
      likeBtn.firstChild.replaceWith(icon(c.liked ? 'heart-fill' : 'heart'));
      likeCount.textContent = c.likeCount ? short(c.likeCount) : '';
    };
    const textEl = h('div', { class: 'cm-text' }, richText(c.body));
    const content = c.flagged && !c.mine ? sensitive(textEl, c.flagged, { mine: c.mine }) : textEl;
    const tr = c.lang && c.lang !== myLang() && store.user
      ? translateLink([c.body], c.lang, { small: true, show: ([t]) => textEl.replaceChildren(richText(t)), hide: () => textEl.replaceChildren(richText(c.body)) })
      : null;
    const replyBtn = h('button', { type: 'button', class: 'cm-reply-btn' }, 'Répondre');
    replyBtn.addEventListener('click', () => startReply(c));
    const el = h(
      'div',
      { class: `cm${reply ? ' cm-sub' : ''}${c.pinned ? ' pinned' : ''}`, dataset: { id: c.id } },
      h('a', { href: `/@${c.author.username}`, class: 'cm-avatar' }, avatar(c.author, reply ? 'xs' : 'sm')),
      h(
        'div',
        { class: 'cm-main' },
        h('div', { class: 'cm-name' }, h('a', { href: `/@${c.author.username}` }, c.author.displayName), c.author.verified ? verifiedMark() : null, c.byCreator ? h('span', { class: 'cm-badge' }, 'Créateur') : null),
        content,
        tr,
        h(
          'div',
          { class: 'cm-meta' },
          c.pinned ? h('span', { class: 'cm-pin' }, icon('pushpin', 'icon-xs'), 'Épinglé') : null,
          h('span', null, timeAgo(c.createdAt)),
          replyBtn,
          c.authorLiked && !c.byCreator ? h('span', { class: 'cm-creator-like' }, icon('heart-fill', 'icon-xs'), 'Aimé par le créateur') : null,
        ),
      ),
      likeBtn,
    );
    el.__c = c;
    // Appui long (ou clic droit) : options du commentaire
    let timer = 0;
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('a, button')) return;
      timer = setTimeout(() => menu(c, el), 480);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => clearTimeout(timer));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      menu(c, el);
    });
    if (!reply && c.replyCount) el.append(repliesToggle(c, el));
    return el;
  }

  function repliesToggle(c, el) {
    const box = h('div', { class: 'cm-replies' });
    let shown = 0;
    let rcursor = null;
    let open = false;
    const btn = h('button', { type: 'button', class: 'cm-more' }, `Afficher ${c.replyCount} réponse${c.replyCount > 1 ? 's' : ''}`, icon('chevronDown', 'icon-xs'));
    const hide = h('button', { type: 'button', class: 'cm-more', hidden: true }, 'Masquer', icon('arrowUp', 'icon-xs'));
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const d = await api.get(`/api/comments/${c.id}/replies${rcursor ? `?cursor=${rcursor}` : ''}`);
        for (const r of d.comments) {
          if (!box.querySelector(`[data-id="${r.id}"]`)) box.append(row(r, { reply: true }));
        }
        shown += d.comments.length;
        rcursor = d.cursor;
        open = true;
        hide.hidden = false;
        btn.hidden = !d.cursor;
        btn.replaceChildren(`Afficher plus`, icon('chevronDown', 'icon-xs'));
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
    hide.addEventListener('click', () => {
      box.replaceChildren();
      open = false;
      shown = 0;
      rcursor = null;
      hide.hidden = true;
      btn.hidden = false;
      btn.replaceChildren(`Afficher ${c.replyCount} réponse${c.replyCount > 1 ? 's' : ''}`, icon('chevronDown', 'icon-xs'));
    });
    el.__replies = {
      box,
      add: (r) => {
        const before = c.replyCount || 0;
        c.replyCount = before + 1;
        box.append(row(r, { reply: true }));
        hide.hidden = false;
        // Première réponse : elle est déjà affichée, rien d'autre à « afficher »
        if (!open && !before) btn.hidden = true;
      },
      get open() {
        return open;
      },
    };
    return h('div', { class: 'cm-thread' }, box, h('div', { class: 'cm-thread-actions' }, btn, hide));
  }

  function menu(c, el) {
    const items = [];
    const item = (ic, text, fn, danger) => h('button', { type: 'button', class: `opt-item${danger ? ' danger' : ''}`, onclick: () => { m.close(); fn(); } }, h('span', { class: 'opt-ic' }, icon(ic)), text);
    items.push(item('comment', 'Répondre', () => startReply(c)));
    items.push(item('copy', 'Copier', async () => {
      try {
        await navigator.clipboard.writeText(c.body);
        toast('Commentaire copié');
      } catch {
        /* presse-papiers refusé */
      }
    }));
    if (c.canPin) {
      items.push(item('pushpin', c.pinned ? 'Désépingler' : 'Épingler', async () => {
        try {
          if (c.pinned) await api.del(`/api/comments/${c.id}/pin`);
          else await api.post(`/api/comments/${c.id}/pin`);
          toast(c.pinned ? 'Commentaire désépinglé' : 'Commentaire épinglé');
          reload();
        } catch (err) {
          toast(err.message, 'error');
        }
      }));
    }
    if (!c.mine) items.push(item('flag', 'Signaler', () => !needLogin('Connecte-toi pour signaler.') && reportDialog('comment', c.id, 'Signaler le commentaire'), true));
    if (c.canDelete) {
      items.push(item('trash', 'Supprimer', async () => {
        try {
          const r = await api.del(`/api/comments/${c.id}`);
          el.remove();
          setCount(r.count);
          toast('Commentaire supprimé');
        } catch (err) {
          toast(err.message, 'error');
        }
      }, true));
    }
    const m = openSheetOver(h('div', { class: 'opt-list' }, h('p', { class: 'opt-quote' }, `${c.author.displayName} : ${c.body.slice(0, 80)}`), items));
  }

  // Petite feuille d'options par-dessus la feuille des commentaires
  function openSheetOver(content) {
    const back = h('div', { class: 'mini-sheet-backdrop' }, h('div', { class: 'mini-sheet' }, h('span', { class: 'sheet-handle' }), content));
    const close = () => back.remove();
    back.addEventListener('click', (e) => e.target === back && close());
    document.body.append(back);
    return { close };
  }

  async function loadMore() {
    if (loading || cursor === false) return;
    loading = true;
    try {
      const d = await api.get(`/api/posts/${post.id}/comments${cursor ? `?cursor=${cursor}` : ''}`);
      if (cursor === null) {
        list.replaceChildren();
        if (d.count !== undefined && d.count !== count) setCount(d.count);
        if (!d.comments.length) list.append(emptyState('comment', 'Aucun commentaire pour l’instant', d.allowComments ? 'Sois le premier ou la première à commenter.' : null));
      }
      for (const c of d.comments) if (!list.querySelector(`.cm[data-id="${c.id}"]`)) list.append(row(c));
      cursor = d.cursor ?? false;
      if (focusId) {
        const el = list.querySelector(`.cm[data-id="${focusId}"]`);
        if (el) {
          el.classList.add('flash');
          el.scrollIntoView({ block: 'center' });
          focusId = null;
        }
      }
    } catch (err) {
      toast(err.message, 'error');
      cursor = false;
    } finally {
      loading = false;
    }
  }
  function reload() {
    cursor = null;
    loadMore();
  }
  const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && loadMore(), { root: null, rootMargin: '300px' });

  // Zone de saisie
  let footer;
  let input = null;
  const replyChip = h('div', { class: 'cm-replying', hidden: true });
  function startReply(c) {
    if (needLogin('Connecte-toi pour répondre.')) return;
    if (!input) return;
    replyTo = { id: c.id, username: c.author.username, displayName: c.author.displayName };
    replyChip.hidden = false;
    replyChip.replaceChildren(h('span', null, `Réponse à ${c.author.displayName}`), h('button', { type: 'button', 'aria-label': 'Annuler la réponse', onclick: cancelReply }, icon('x', 'icon-xs')));
    if (!input.value.startsWith(`@${c.author.username}`) && !c.byCreator) input.value = c.parentId ? `@${c.author.username} ${input.value}` : input.value;
    input.focus();
  }
  function cancelReply() {
    replyTo = null;
    replyChip.hidden = true;
  }

  if (!post.allowComments && !post.mine) {
    footer = h('p', { class: 'cm-closed' }, icon('lock', 'icon-sm'), 'Les commentaires sont désactivés pour cette vidéo.');
  } else if (!store.user) {
    footer = h('button', { type: 'button', class: 'cm-login', onclick: () => needLogin('Connecte-toi pour commenter.') }, 'Connecte-toi pour commenter');
  } else {
    input = h('textarea', { class: 'cm-input', rows: 1, maxlength: 150, placeholder: 'Ajouter un commentaire…', 'aria-label': 'Ajouter un commentaire' });
    autosize(input);
    const send = h('button', { type: 'submit', class: 'cm-send', 'aria-label': 'Envoyer', disabled: true }, icon('arrowUp'));
    input.addEventListener('input', () => (send.disabled = !input.value.trim()));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    const quick = h('div', { class: 'cm-quick' }, QUICK.map((emo) => h('button', { type: 'button', onclick: () => { input.value += emo; input.dispatchEvent(new Event('input')); input.focus(); } }, emo)));
    const atBtn = h('button', { type: 'button', class: 'cm-tool', 'aria-label': 'Mentionner', onclick: () => { input.value += (input.value && !/\s$/.test(input.value) ? ' @' : '@'); input.dispatchEvent(new Event('input')); input.focus(); } }, icon('at'));
    const form = h(
      'form',
      {
        class: 'cm-form',
        onsubmit: async (e) => {
          e.preventDefault();
          const text = input.value.trim();
          if (!text) return;
          send.disabled = true;
          try {
            const r = await api.post(`/api/posts/${post.id}/comments`, { body: text, parentId: replyTo?.id || null });
            input.value = '';
            input.dispatchEvent(new Event('input'));
            const c = r.comment;
            if (c.parentId) {
              const parentEl = list.querySelector(`.cm[data-id="${c.parentId}"]`);
              if (parentEl) {
                if (!parentEl.__replies) parentEl.append(repliesToggle({ ...parentEl.__c, replyCount: 0 }, parentEl));
                parentEl.__replies.add(c);
              }
            } else {
              list.querySelector('.empty')?.remove();
              list.prepend(row(c));
              list.scrollTop = 0;
            }
            cancelReply();
            setCount(r.count);
          } catch (err) {
            toast(err.message, 'error');
          } finally {
            send.disabled = !input.value.trim();
          }
        },
      },
      h('div', { class: 'cm-field' }, input, atBtn),
      send,
    );
    footer = h('div', { class: 'cm-foot' }, quick, replyChip, h('div', { class: 'cm-compose' }, avatar(store.user, 'sm'), form));
    attachMentions(input, { placement: 'above' });
  }

  sheet = openSheet({ title: label(count), body, footer, tall: true, side: true, onClose: () => io.disconnect() });
  sheet.el.classList.add('comments-sheet');
  io.observe(sentinel);
  loadMore();
  return sheet;
}
