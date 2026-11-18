import { api } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import {
  h, icon, avatar, nameLine, memberChip, timeAgo, fullDate, richText, toast, popMenu,
  confirmDialog, lightbox, autosize, spinner, clear, shrinkImage, TOO_BIG_GIF, modal, num,
} from '../dom.js';
import { reportDialog } from './report.js';
import { attachMentions } from './mentions.js';
import { translateLink } from './translate.js';
import { sensitive, flaggedNotice } from './sensitive.js';
import { readVideoInfo, uploadVideo, videoPlayer, isVideoFile, clockLabel, MAX_SECONDS } from './video.js';

const MAX_POST = 2000;
const MAX_PHOTOS = 6;
const MAX_UPLOAD = 4.2 * 1024 * 1024; // limite d'une requête sur l'hébergement

// Réactions : la première est celle d'un simple toucher.
export const REACTIONS = [
  ['love', '❤️', 'J’adore'],
  ['like', '👍', 'J’aime'],
  ['bravo', '👏', 'Bravo'],
  ['fire', '🔥', 'Génial'],
  ['haha', '😂', 'Drôle'],
  ['wow', '😮', 'Impressionnant'],
];
export const EMOJI = Object.fromEntries(REACTIONS.map(([k, e]) => [k, e]));

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Lien copié.');
  } catch {
    toast('Copie impossible sur ce navigateur.', 'error');
  }
}

// ---------------------------------------------------------------------------
// Photos : une seule, ou un carrousel qui se fait défiler du doigt
// ---------------------------------------------------------------------------
// Contenu du Journal partagé dans le Salon : carte avec photo, source et titre
function journalLink(j) {
  const external = j.kind === 'article';
  const img = j.image ? h('img', { src: j.image, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }) : null;
  img?.addEventListener('error', () => img.remove());
  return h(
    'a',
    external ? { href: j.url, target: '_blank', rel: 'noopener noreferrer', class: 'post-journal' } : { href: `/journal/${j.id}`, class: 'post-journal' },
    h('span', { class: `post-journal-img${j.kind === 'article' ? '' : ' media'}` }, img, j.kind !== 'article' ? h('span', { class: 'journal-video-badge' }, icon(j.kind === 'video' ? 'play' : 'headphones')) : null),
    h('span', { class: 'post-journal-text' }, h('small', null, j.siteName || 'Le Journal'), h('b', null, j.title), j.summary ? h('span', null, j.summary) : null),
  );
}

function gallery(images) {
  if (images.length === 1) {
    return h('div', { class: 'post-image', onclick: () => lightbox(images[0]) }, h('img', { src: images[0], alt: '', loading: 'lazy', decoding: 'async' }));
  }
  const track = h(
    'div',
    { class: 'carousel-track' },
    images.map((src) => h('div', { class: 'carousel-slide', onclick: () => lightbox(src) }, h('img', { src, alt: '', loading: 'lazy', decoding: 'async' }))),
  );
  const dots = h('div', { class: 'carousel-dots' }, images.map((_, i) => h('i', { class: i === 0 ? 'on' : '' })));
  const counter = h('span', { class: 'carousel-count' }, `1/${images.length}`);
  const go = (dir) => track.scrollBy({ left: dir * track.clientWidth, behavior: 'smooth' });
  const prev = h('button', { class: 'carousel-nav prev', type: 'button', 'aria-label': 'Photo précédente', onclick: () => go(-1) }, icon('chevronLeft'));
  const next = h('button', { class: 'carousel-nav next', type: 'button', 'aria-label': 'Photo suivante', onclick: () => go(1) }, icon('chevron'));
  const paint = () => {
    const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    counter.textContent = `${i + 1}/${images.length}`;
    [...dots.children].forEach((d, j) => d.classList.toggle('on', j === i));
    prev.hidden = i === 0;
    next.hidden = i === images.length - 1;
  };
  track.addEventListener('scroll', () => requestAnimationFrame(paint), { passive: true });
  prev.hidden = true;
  return h('div', { class: 'carousel' }, track, counter, dots, prev, next);
}

// ---------------------------------------------------------------------------
// Réactions
// ---------------------------------------------------------------------------
let openPicker = null;
function closePicker() {
  openPicker?.remove();
  openPicker = null;
}
document.addEventListener('pointerdown', (e) => {
  if (openPicker && !openPicker.contains(e.target)) closePicker();
});

function reactorsModal(postId) {
  const body = h('div', { class: 'modal-body', style: { padding: '8px' } }, spinner());
  modal('Réactions', body);
  api
    .get(`/api/posts/${postId}/likes`)
    .then(({ users }) => {
      clear(body);
      for (const u of users) {
        body.append(
          h(
            'a',
            { href: `/@${u.username}`, class: 'user-row' },
            h('span', { class: 'reactor' }, avatar(u), h('span', { class: 'reactor-emoji' }, EMOJI[u.reaction] || '❤️')),
            h('span', { class: 'meta' }, nameLine(u, { link: false }), h('small', null, `@${u.username}`)),
          ),
        );
      }
    })
    .catch((err) => body.replaceChildren(h('p', { class: 'muted', style: { padding: '12px' } }, err.message)));
}

function reactionControl(post) {
  const btn = h('button', { class: 'act react-btn', 'aria-label': 'Réagir' });
  const faces = h('button', { class: 'reaction-faces', type: 'button', 'aria-label': 'Voir les réactions', onclick: () => reactorsModal(post.id) });

  const paint = () => {
    btn.replaceChildren(post.myReaction ? h('span', { class: 'react-emoji' }, EMOJI[post.myReaction]) : icon('heart'), h('span', null, post.likeCount ? num(post.likeCount) : ''));
    btn.classList.toggle('liked', Boolean(post.myReaction));
    btn.setAttribute('aria-pressed', String(Boolean(post.myReaction)));
    const top = (post.reactions || []).slice(0, 3);
    faces.replaceChildren(...top.map((r) => h('span', null, EMOJI[r.type] || '❤️')));
    faces.hidden = !top.length;
  };

  const send = async (reaction) => {
    const before = { ...post, reactions: [...(post.reactions || [])] };
    // Mise à jour immédiate, confirmée par le serveur
    if (reaction) {
      if (!post.myReaction) post.likeCount += 1;
      post.myReaction = reaction;
      btn.classList.remove('pop');
      void btn.offsetWidth;
      btn.classList.add('pop');
    } else {
      post.likeCount = Math.max(0, post.likeCount - 1);
      post.myReaction = null;
    }
    paint();
    try {
      const res = reaction ? await api.post(`/api/posts/${post.id}/like`, { reaction }) : await api.del(`/api/posts/${post.id}/like`);
      Object.assign(post, { myReaction: res.myReaction, likeCount: res.likeCount, reactions: res.reactions, liked: res.liked });
    } catch (err) {
      Object.assign(post, before);
      toast(err.message, 'error');
    }
    paint();
  };

  const showPicker = () => {
    closePicker();
    const picker = h(
      'div',
      { class: 'reaction-picker', role: 'menu' },
      REACTIONS.map(([key, emoji, label], i) =>
        h(
          'button',
          {
            type: 'button',
            class: post.myReaction === key ? 'on' : '',
            title: label,
            'aria-label': label,
            style: { animationDelay: `${i * 25}ms` },
            onclick: (e) => {
              e.stopPropagation();
              closePicker();
              send(post.myReaction === key ? null : key);
            },
          },
          emoji,
        ),
      ),
    );
    document.body.append(picker);
    const r = btn.getBoundingClientRect();
    const w = picker.offsetWidth;
    const ph = picker.offsetHeight;
    // Au-dessus du bouton, sinon en dessous, et toujours dans l'écran
    const above = r.top - ph - 8;
    const top = above >= 10 ? above : r.bottom + 8;
    picker.style.left = `${Math.max(10, Math.min(r.left - 8, innerWidth - w - 10))}px`;
    picker.style.top = `${Math.max(10, Math.min(top, innerHeight - ph - 10))}px`;
    openPicker = picker;
  };

  // Toucher : ❤️ / retirer. Appui long (mobile) ou survol prolongé (ordinateur) : choix de la réaction.
  let pressTimer = null;
  let longPressed = false;
  btn.addEventListener('pointerdown', (e) => {
    longPressed = false;
    if (e.pointerType === 'mouse') return;
    pressTimer = setTimeout(() => {
      longPressed = true;
      navigator.vibrate?.(10);
      showPicker();
    }, 420);
  });
  const cancelPress = () => clearTimeout(pressTimer);
  btn.addEventListener('pointerup', cancelPress);
  btn.addEventListener('pointerleave', cancelPress);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  let hoverTimer = null;
  btn.addEventListener('mouseenter', () => {
    hoverTimer = setTimeout(showPicker, 550);
  });
  btn.addEventListener('mouseleave', () => clearTimeout(hoverTimer));
  btn.addEventListener('click', () => {
    clearTimeout(hoverTimer);
    if (longPressed) return;
    closePicker();
    send(post.myReaction ? null : REACTIONS[0][0]);
  });

  paint();
  return { btn, faces };
}

// ---------------------------------------------------------------------------
// Carte de publication
// ---------------------------------------------------------------------------
export function postCard(post, { expanded = false } = {}) {
  const link = `/p/${post.id}`;
  post.images = post.images || (post.image ? [post.image] : []);
  const el = h('article', { class: `post${expanded ? ' big' : ''}`, dataset: { id: post.id } });

  const { btn: reactBtn, faces } = reactionControl(post);

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

  const shareBtn = h('button', { class: 'act', 'aria-label': 'Partager' }, icon('send'));
  shareBtn.addEventListener('click', async () => {
    const url = `${location.origin}${link}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: `${post.author.displayName} sur AURUM`, url });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }
    copy(url);
  });

  const saveBtn = h('button', { class: `act save-btn${post.saved ? ' saved' : ''}`, 'aria-label': 'Enregistrer', 'aria-pressed': String(post.saved) }, icon('bookmark'));
  saveBtn.addEventListener('click', async () => {
    const was = post.saved;
    post.saved = !was;
    saveBtn.classList.toggle('saved', post.saved);
    saveBtn.setAttribute('aria-pressed', String(post.saved));
    try {
      if (was) await api.del(`/api/posts/${post.id}/save`);
      else await api.post(`/api/posts/${post.id}/save`);
      toast(was ? 'Retiré de vos enregistrements.' : 'Enregistré.');
      store.emit('saved:changed', { id: post.id, saved: post.saved });
    } catch (err) {
      post.saved = was;
      saveBtn.classList.toggle('saved', was);
      toast(err.message, 'error');
    }
  });

  // Avec photos : légende sous les boutons, précédée du nom (façon Instagram) ; sans photo : texte en grand
  const hasMedia = post.images.length > 0 || Boolean(post.video);
  const bodyEl = h('div', { class: `post-body${hasMedia ? ' caption' : ''}` });
  const edited = h('span', { class: 'edited', hidden: !post.editedAt, title: post.editedAt ? `Modifié ${fullDate(post.editedAt)}` : '' }, ' · modifié');
  const paintBody = (text = post.body) => {
    bodyEl.replaceChildren(...(hasMedia ? [h('a', { href: `/@${post.author.username}`, class: 'cap-name' }, post.author.displayName), ' '] : []), richText(text || ''));
    bodyEl.hidden = !post.body;
    edited.hidden = !post.editedAt;
  };
  paintBody();

  const editPost = () => {
    const ta = h('textarea', { class: 'textarea', maxlength: MAX_POST, rows: 5 });
    ta.value = post.body || '';
    const save = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Enregistrer');
    const m = modal(
      'Modifier la publication',
      h(
        'form',
        {
          class: 'modal-body',
          style: { display: 'grid', gap: '14px' },
          onsubmit: async (e) => {
            e.preventDefault();
            save.disabled = true;
            try {
              const res = await api.patch(`/api/posts/${post.id}`, { body: ta.value });
              Object.assign(post, { body: res.post.body, editedAt: res.post.editedAt });
              paintBody();
              m.close();
              toast('Publication modifiée.');
              flaggedNotice(res.post);
            } catch (err) {
              save.disabled = false;
              toast(err.message, 'error');
            }
          },
        },
        ta,
        save,
      ),
    );
    autosize(ta);
    attachMentions(ta);
  };

  const menuBtn = h('button', { class: 'icon-btn menu-btn', 'aria-label': 'Options' }, icon('more'));
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const items = [];
    if (post.mine) items.push({ icon: 'pen', label: 'Modifier', action: editPost });
    items.push({ icon: 'bookmark', label: post.saved ? 'Retirer des enregistrements' : 'Enregistrer', action: () => saveBtn.click() });
    items.push({ icon: 'link', label: 'Copier le lien', action: () => copy(`${location.origin}${link}`) });
    if (!post.mine) {
      items.push({ icon: 'mail', label: `Écrire à ${post.author.displayName}`, action: () => navigate(`/messages/${post.author.username}`) });
      items.push({ icon: 'flag', label: 'Signaler la publication', action: () => reportDialog('post', post.id, 'Signaler la publication') });
    }
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

  // « Voir la traduction » : publication écrite dans une autre langue
  const bodyTranslate = translateLink(post.body, post.lang, { show: ([t]) => paintBody(t), hide: () => paintBody() });
  // Filtre automatique : texte flouté derrière un avertissement (sauf pour son auteur)
  const previewTag = post.preview ? h('p', { class: 'preview-tag' }, icon('sparkles', 'icon-xs'), 'Dévoilé en avant-première aux Fondateurs') : null;
  const textParts = post.flagged ? [sensitive(h('div', null, bodyEl, bodyTranslate), post.flagged, { mine: post.mine })] : [bodyEl, bodyTranslate];

  // « Voir les N commentaires » sous la publication
  const moreComments = h('button', { class: 'see-comments', type: 'button', hidden: !post.commentCount || expanded }, post.commentCount > 1 ? `Voir les ${num(post.commentCount)} commentaires` : 'Voir le commentaire');
  moreComments.addEventListener('click', () => {
    moreComments.hidden = true;
    openComments();
  });

  append(el, [
    h(
      'header',
      { class: 'post-head' },
      h('a', { href: `/@${post.author.username}`, class: 'post-avatar', 'aria-label': post.author.displayName }, avatar(post.author)),
      h(
        'div',
        { class: 'who' },
        nameLine(post.author),
        h('span', { class: 'handle' }, memberChip(post.author), h('a', { href: link, title: fullDate(post.createdAt) }, timeAgo(post.createdAt)), edited),
      ),
      menuBtn,
    ),
    previewTag,
    ...(hasMedia ? [] : textParts),
    post.video ? videoPlayer(post.video, { onOpen: () => navigate(`/videos?p=${post.id}`) }) : hasMedia ? gallery(post.images) : null,
    post.journal ? journalLink(post.journal) : null,
    h('div', { class: 'post-actions' }, reactBtn, faces, commentBtn, shareBtn, h('span', { class: 'grow' }), saveBtn),
    ...(hasMedia ? textParts : []),
    moreComments,
    commentsHost,
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
  const actions = [];
  if (c.canDelete) {
    actions.push(
      h(
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
      ),
    );
  }
  if (c.author.id !== store.user.id) {
    actions.push(h('button', { onclick: () => reportDialog('comment', c.id, 'Signaler le commentaire') }, 'Signaler'));
  }
  const commentBody = h('div', { class: 'comment-body' }, richText(c.body));
  const commentTranslate = translateLink(c.body, c.lang, { show: ([t]) => commentBody.replaceChildren(richText(t)), hide: () => commentBody.replaceChildren(richText(c.body)) });
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
        c.flagged ? sensitive(h('div', null, commentBody, commentTranslate), c.flagged, { mine: c.author.id === store.user.id }) : [commentBody, commentTranslate],
      ),
      h('div', { class: 'comment-meta' }, h('span', { title: fullDate(c.createdAt) }, timeAgo(c.createdAt)), actions),
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
          flaggedNotice(comment);
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
  attachMentions(ta, { placement: 'above' });
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
// Éditeur de publication (texte + jusqu'à 6 photos)
// ---------------------------------------------------------------------------
export function composer({ onPosted, placeholder, endpoint = '/api/posts' } = {}) {
  let files = [];
  const ta = h('textarea', {
    placeholder: placeholder || 'Que souhaitez-vous partager ?',
    maxlength: MAX_POST,
    'aria-label': 'Nouvelle publication',
    rows: 2,
  });
  const fit = autosize(ta);
  const counter = h('span', { class: 'char-count' });
  const previewHost = h('div', { class: 'preview-grid' });
  const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', multiple: true, hidden: true });
  const submit = h('button', { class: 'btn btn-primary btn-sm', type: 'submit', disabled: true }, 'Publier');
  const addBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Ajouter des photos', onclick: () => fileInput.click() }, icon('image'));
  // Vidéo : une par publication (une minute au plus), préparée puis envoyée en morceaux
  let video = null; // { file, info, posterUrl }
  const videoInput = h('input', { type: 'file', accept: 'video/mp4,video/quicktime,video/webm,video/*', hidden: true });
  const videoBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Ajouter une vidéo', onclick: () => videoInput.click() }, icon('video'));
  const progress = h('div', { class: 'upload-progress', hidden: true }, h('i'), h('span'));
  const showProgress = (label, ratio) => {
    progress.hidden = false;
    progress.lastChild.textContent = label;
    progress.firstChild.style.transform = `scaleX(${Math.max(0.02, ratio)})`;
  };
  // Direction : annonce réservée d'abord aux Fondateurs, publiée pour tous ensuite
  let early = false;
  const canEarly = Boolean(store.user?.isAdmin) && endpoint === '/api/posts';
  const hoursSel = h('select', { class: 'early-hours', hidden: true, 'aria-label': 'Durée de l’avant-première' }, [24, 48, 168].map((n) => h('option', { value: String(n) }, n === 168 ? '7 jours' : `${n} h`)));
  hoursSel.value = '48';
  const idleLabel = () => (early ? 'Envoyer' : 'Publier');
  const earlyBtn = canEarly
    ? h('button', { class: 'early-toggle', type: 'button', 'aria-pressed': 'false', title: 'Visible d’abord par les Fondateurs, puis par tous' }, icon('sparkles', 'icon-sm'), 'Avant-première')
    : null;
  earlyBtn?.addEventListener('click', () => {
    early = !early;
    earlyBtn.setAttribute('aria-pressed', String(early));
    earlyBtn.classList.toggle('on', early);
    hoursSel.hidden = !early;
    submit.textContent = idleLabel();
    ta.placeholder = early ? 'Annonce réservée aux Fondateurs, puis publiée pour tous…' : placeholder || 'Que souhaitez-vous partager ?';
  });

  const update = () => {
    const len = ta.value.length;
    counter.textContent = len > MAX_POST - 300 ? `${MAX_POST - len}` : '';
    counter.classList.toggle('warn', len > MAX_POST - 50);
    submit.disabled = !ta.value.trim() && !files.length && !video;
    addBtn.disabled = files.length >= MAX_PHOTOS || Boolean(video);
    videoBtn.disabled = files.length > 0 || Boolean(video);
  };
  ta.addEventListener('input', update);

  const paintPreviews = () => {
    if (video) {
      previewHost.replaceChildren(
        h(
          'div',
          { class: 'preview preview-video' },
          video.posterUrl ? h('img', { src: video.posterUrl, alt: '' }) : h('span', { class: 'preview-video-ph' }, icon('video')),
          h('span', { class: 'preview-duration' }, icon('play', 'icon-xs'), clockLabel(video.info.duration)),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Retirer la vidéo', onclick: () => clearVideo() }, icon('x')),
        ),
      );
      previewHost.dataset.count = '1';
      update();
      return;
    }
    previewHost.replaceChildren(
      ...files.map((f, i) =>
        h(
          'div',
          { class: 'preview' },
          h('img', { src: f.url, alt: '' }),
          h('button', {
            class: 'icon-btn',
            type: 'button',
            'aria-label': 'Retirer la photo',
            onclick: () => {
              URL.revokeObjectURL(f.url);
              files.splice(i, 1);
              paintPreviews();
            },
          }, icon('x')),
        ),
      ),
    );
    previewHost.dataset.count = String(files.length);
    update();
  };
  const addFiles = (list) => {
    for (const f of list) {
      if (files.length >= MAX_PHOTOS) {
        toast(`${MAX_PHOTOS} photos maximum par publication.`, 'error');
        break;
      }
      if (f.type === 'image/gif' && f.size > TOO_BIG_GIF) {
        toast('GIF trop lourd (4 Mo maximum).', 'error');
        continue;
      }
      files.push({ file: f, url: URL.createObjectURL(f) });
    }
    fileInput.value = '';
    paintPreviews();
  };
  fileInput.addEventListener('change', () => addFiles([...fileInput.files]));
  const clearVideo = () => {
    if (video?.posterUrl) URL.revokeObjectURL(video.posterUrl);
    if (video?.info?.url) URL.revokeObjectURL(video.info.url);
    video = null;
    paintPreviews();
  };
  videoInput.addEventListener('change', async () => {
    const file = videoInput.files[0];
    videoInput.value = '';
    if (!file) return;
    if (!isVideoFile(file)) return toast('Format de vidéo non pris en charge.', 'error');
    showProgress('Lecture de la vidéo…', 0.05);
    try {
      const info = await readVideoInfo(file);
      if (!(info.duration > 0)) throw new Error('Vidéo illisible sur cet appareil.');
      if (info.duration > MAX_SECONDS + 1) throw new Error('Vidéo trop longue : une minute au maximum.');
      video = { file, info, posterUrl: info.poster ? URL.createObjectURL(info.poster) : null };
      paintPreviews();
    } catch (err) {
      toast(err.message, 'error');
    }
    progress.hidden = true;
  });


  const form = h(
    'form',
    {
      class: 'composer',
      onsubmit: async (e) => {
        e.preventDefault();
        if (submit.disabled) return;
        if (early && video) return toast('Les avant-premières acceptent du texte et des photos, pas encore de vidéo.', 'error');
        submit.disabled = true;
        submit.textContent = 'Publication…';
        // Vidéo : préparation lancée tout de suite, dans le geste (nécessaire pour garder le son)
        const videoJob = video
          ? uploadVideo(video.file, video.info, (step, p) =>
              showProgress(step === 'prepare' ? `Préparation ${Math.round(p * 100)} % · gardez l’app ouverte` : `Envoi ${Math.round(p * 100)} %`, p),
            )
          : null;
        videoJob?.catch(() => {});
        try {
          const fd = new FormData();
          fd.append('body', ta.value);
          let total = 0;
          for (const { file } of files) {
            const small = await shrinkImage(file, 1600);
            total += small.size;
            fd.append('images', small, small.name || 'photo');
          }
          if (total > MAX_UPLOAD) throw new Error('Photos trop lourdes : retirez-en une ou deux.');
          if (early) {
            fd.append('hours', hoursSel.value);
            const res = await api.post('/api/previews', fd);
            ta.value = '';
            files.forEach((f) => URL.revokeObjectURL(f.url));
            files = [];
            paintPreviews();
            fit();
            const label = res.hours === 168 ? '7 jours' : `${res.hours} h`;
            toast(`Avant-première envoyée aux Fondateurs. Publiée pour tous dans ${label}.`);
            store.emit('preview:created', res.preview);
            onPosted?.(null);
            return;
          }
          if (videoJob) fd.append('video', (await videoJob).id);
          const { post } = await api.post(endpoint, fd);
          ta.value = '';
          files.forEach((f) => URL.revokeObjectURL(f.url));
          files = [];
          if (video) clearVideo();
          paintPreviews();
          fit();
          if (post.flagged) flaggedNotice(post);
          else toast(post.groupId ? 'Publié dans le groupe.' : 'Publié dans le Salon.');
          store.emit('post:created', post);
          onPosted?.(post);
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          submit.textContent = idleLabel();
          progress.hidden = true;
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
      progress,
      h(
        'div',
        { class: 'composer-bar' },
        h('div', { class: 'composer-tools' }, addBtn, fileInput, videoBtn, videoInput, earlyBtn, canEarly ? hoursSel : null),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '14px' } }, counter, submit),
      ),
    ),
  );
  attachMentions(ta);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit();
  });
  // Coller une image directement
  ta.addEventListener('paste', (e) => {
    const imgs = [...(e.clipboardData?.items || [])].filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile());
    if (imgs.length) addFiles(imgs);
  });
  form.focusInput = () => ta.focus();
  return form;
}
