import { api } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import {
  h, icon, avatar, nameLine, memberChip, timeAgo, fullDate, richText, toast, popMenu,
  confirmDialog, lightbox, autosize, spinner, clear,
} from '../dom.js';

const MAX_POST = 2000;

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Lien copié.');
  } catch {
    toast('Copie impossible sur ce navigateur.', 'error');
  }
}

// ---------------------------------------------------------------------------
// Carte de publication
// ---------------------------------------------------------------------------
export function postCard(post, { expanded = false } = {}) {
  const link = `/p/${post.id}`;

  const likeCount = h('span', null, post.likeCount || '');
  const likeBtn = h(
    'button',
    { class: `act${post.liked ? ' liked' : ''}`, 'aria-label': "J'aime", 'aria-pressed': String(post.liked) },
    icon('heart'),
    likeCount,
  );
  likeBtn.addEventListener('click', async () => {
    const was = post.liked;
    post.liked = !was;
    post.likeCount += was ? -1 : 1;
    render();
    if (!was) {
      likeBtn.classList.remove('pop');
      void likeBtn.offsetWidth;
      likeBtn.classList.add('pop');
    }
    try {
      const res = was ? await api.del(`/api/posts/${post.id}/like`) : await api.post(`/api/posts/${post.id}/like`);
      post.liked = res.liked;
      post.likeCount = res.likeCount;
    } catch (err) {
      post.liked = was;
      post.likeCount += was ? 1 : -1;
      toast(err.message, 'error');
    }
    render();
  });
  function render() {
    likeBtn.classList.toggle('liked', post.liked);
    likeBtn.setAttribute('aria-pressed', String(post.liked));
    likeCount.textContent = post.likeCount || '';
  }

  const commentCount = h('span', null, post.commentCount || '');
  const commentBtn = h('button', { class: 'act', 'aria-label': 'Commenter' }, icon('comment'), commentCount);
  const commentsHost = h('div');
  let section = null;
  const openComments = () => {
    if (section) {
      section.focus();
      return;
    }
    section = commentsSection(post, (n) => {
      post.commentCount = n;
      commentCount.textContent = n || '';
    });
    commentsHost.append(section.el);
  };
  commentBtn.addEventListener('click', () => {
    if (section && !expanded) {
      section.el.remove();
      section = null;
      return;
    }
    openComments();
    section?.focus();
  });

  const shareBtn = h('button', { class: 'act', 'aria-label': 'Copier le lien' }, icon('link'));
  shareBtn.addEventListener('click', () => copy(`${location.origin}${link}`));

  const el = h('article', { class: `post${expanded ? ' big' : ''}` });
  const menuBtn = h('button', { class: 'icon-btn menu-btn', 'aria-label': 'Options' }, icon('more'));
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const items = [{ icon: 'link', label: 'Copier le lien', action: () => copy(`${location.origin}${link}`) }];
    if (!post.mine) items.push({ icon: 'mail', label: `Écrire à ${post.author.displayName}`, action: () => navigate(`/messages/${post.author.username}`) });
    if (post.canDelete) {
      items.push({
        icon: 'trash',
        label: 'Supprimer la publication',
        danger: true,
        action: async () => {
          if (!(await confirmDialog('Supprimer la publication ?', 'Cette action est définitive.', 'Supprimer'))) return;
          try {
            await api.del(`/api/posts/${post.id}`);
            el.style.transition = 'opacity .3s';
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 300);
            toast('Publication supprimée.');
            if (expanded) navigate('/salon');
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      });
    }
    popMenu(menuBtn, items);
  });

  append(el, [
    h('a', { href: `/@${post.author.username}`, 'aria-label': post.author.displayName }, avatar(post.author)),
    h(
      'div',
      { class: 'post-main' },
      h(
        'div',
        { class: 'post-head' },
        h(
          'div',
          { class: 'who' },
          nameLine(post.author),
          memberChip(post.author),
          h('span', { class: 'handle' }, `@${post.author.username} · `, h('a', { href: link, title: fullDate(post.createdAt) }, timeAgo(post.createdAt))),
        ),
        menuBtn,
      ),
      post.body ? h('div', { class: 'post-body' }, richText(post.body)) : null,
      post.image
        ? h('div', { class: 'post-image', onclick: () => lightbox(post.image) }, h('img', { src: post.image, alt: '', loading: 'lazy', decoding: 'async' }))
        : null,
      h('div', { class: 'post-actions' }, likeBtn, commentBtn, shareBtn),
      commentsHost,
    ),
  ]);

  if (expanded) openComments();
  return el;
}

function append(el, kids) {
  for (const k of kids) if (k) el.append(k);
}

// ---------------------------------------------------------------------------
// Commentaires
// ---------------------------------------------------------------------------
function commentEl(c, onDelete) {
  const del = c.canDelete
    ? h(
        'button',
        {
          onclick: async () => {
            if (!(await confirmDialog('Supprimer le commentaire ?', 'Cette action est définitive.', 'Supprimer'))) return;
            try {
              await api.del(`/api/comments/${c.id}`);
              onDelete(c);
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        },
        'Supprimer',
      )
    : null;
  return h(
    'div',
    { class: 'comment', dataset: { id: c.id } },
    h('a', { href: `/@${c.author.username}` }, avatar(c.author, 'sm')),
    h(
      'div',
      { class: 'comment-main' },
      h(
        'div',
        { class: 'comment-bubble' },
        h('div', { class: 'post-head' }, h('div', { class: 'who' }, nameLine(c.author), memberChip(c.author))),
        h('div', { class: 'comment-body' }, richText(c.body)),
      ),
      h('div', { class: 'comment-meta' }, h('span', { title: fullDate(c.createdAt) }, timeAgo(c.createdAt)), del),
    ),
  );
}

function commentsSection(post, onCount) {
  const list = h('div', { class: 'comments' }, spinner());
  let count = post.commentCount;
  const ta = h('textarea', { placeholder: 'Écrire un commentaire…', rows: 1, maxlength: 1000, 'aria-label': 'Commentaire' });
  autosize(ta);
  const send = h('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, 'Répondre');
  const removeComment = (c) => {
    list.querySelector(`[data-id="${c.id}"]`)?.remove();
    onCount(--count);
  };
  const form = h(
    'form',
    {
      class: 'comment-form',
      onsubmit: async (e) => {
        e.preventDefault();
        const body = ta.value.trim();
        if (!body) return;
        send.disabled = true;
        try {
          const { comment } = await api.post(`/api/posts/${post.id}/comments`, { body });
          list.append(commentEl(comment, removeComment));
          onCount(++count);
          ta.value = '';
          ta.dispatchEvent(new Event('input'));
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          send.disabled = false;
        }
      },
    },
    avatar(store.user, 'sm'),
    ta,
    send,
  );
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  api
    .get(`/api/posts/${post.id}/comments`)
    .then(({ comments }) => {
      clear(list);
      for (const c of comments) list.append(commentEl(c, removeComment));
      if (comments.length !== count) onCount((count = comments.length));
    })
    .catch((err) => {
      clear(list);
      list.append(h('p', { class: 'muted small' }, err.message));
    });

  return { el: h('div', null, list, form), focus: () => ta.focus() };
}

// ---------------------------------------------------------------------------
// Éditeur de publication
// ---------------------------------------------------------------------------
export function composer({ onPosted, placeholder } = {}) {
  let file = null;
  const ta = h('textarea', {
    placeholder: placeholder || 'Partagez une idée, une adresse, une réussite…',
    maxlength: MAX_POST,
    'aria-label': 'Nouvelle publication',
    rows: 2,
  });
  const fit = autosize(ta);
  const counter = h('span', { class: 'char-count' });
  const previewHost = h('div');
  const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true });
  const submit = h('button', { class: 'btn btn-primary btn-sm', type: 'submit', disabled: true }, 'Publier');

  const update = () => {
    const len = ta.value.length;
    counter.textContent = len > MAX_POST - 300 ? `${MAX_POST - len}` : '';
    counter.classList.toggle('warn', len > MAX_POST - 50);
    submit.disabled = !ta.value.trim() && !file;
  };
  ta.addEventListener('input', update);

  const setFile = (f) => {
    clear(previewHost);
    file = f;
    if (f) {
      if (f.size > 8 * 1024 * 1024) {
        toast('Image trop lourde (8 Mo maximum).', 'error');
        file = null;
      } else {
        const url = URL.createObjectURL(f);
        previewHost.append(
          h(
            'div',
            { class: 'preview' },
            h('img', { src: url, alt: '' }),
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': "Retirer l'image", onclick: () => setFile(null) }, icon('x')),
          ),
        );
      }
    }
    fileInput.value = '';
    update();
  };
  fileInput.addEventListener('change', () => setFile(fileInput.files[0] || null));

  const form = h(
    'form',
    {
      class: 'composer',
      onsubmit: async (e) => {
        e.preventDefault();
        if (submit.disabled) return;
        const fd = new FormData();
        fd.append('body', ta.value);
        if (file) fd.append('image', file);
        submit.disabled = true;
        submit.textContent = 'Publication…';
        try {
          const { post } = await api.post('/api/posts', fd);
          ta.value = '';
          setFile(null);
          fit();
          toast('Publié dans le Salon.');
          store.emit('post:created', post);
          onPosted?.(post);
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          submit.textContent = 'Publier';
          update();
        }
      },
    },
    avatar(store.user),
    h(
      'div',
      { class: 'composer-main' },
      ta,
      previewHost,
      h(
        'div',
        { class: 'composer-bar' },
        h(
          'div',
          { class: 'composer-tools' },
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Ajouter une image', onclick: () => fileInput.click() }, icon('image')),
          fileInput,
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '14px' } }, counter, submit),
      ),
    ),
  );
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit();
  });
  // Coller une image directement
  ta.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) setFile(item.getAsFile());
  });
  form.focusInput = () => ta.focus();
  return form;
}
