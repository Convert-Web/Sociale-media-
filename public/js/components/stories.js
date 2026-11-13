import { api, enc } from '../api.js';
import { store } from '../store.js';
import { h, icon, avatar, timeAgo, toast, modal, spinner, clear, nameLine, shrinkImage, confirmDialog } from '../dom.js';

const DURATION = 5000; // durée d'affichage d'une story

// ---------------------------------------------------------------------------
// Barre des stories (haut du Salon)
// ---------------------------------------------------------------------------
export function storiesBar() {
  const bar = h('div', { class: 'stories-bar', role: 'list', 'aria-label': 'Stories' });
  let groups = [];
  const picker = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true });
  picker.addEventListener('change', () => {
    const f = picker.files[0];
    picker.value = '';
    if (f) createStory(f, load);
  });

  const item = (g, i) => {
    const first = g.user.displayName.split(/\s+/)[0];
    return h(
      'button',
      {
        type: 'button',
        role: 'listitem',
        class: `story-item${g.allViewed ? ' seen' : ''}`,
        onclick: () => openViewer(groups, i, paint),
      },
      h('span', { class: 'story-ring' }, avatar(g.user, 'lg')),
      h('span', { class: 'story-name' }, g.mine ? 'Votre story' : first),
    );
  };

  function paint() {
    const mine = groups.find((g) => g.mine);
    const add = h(
      'button',
      { type: 'button', role: 'listitem', class: 'story-item add', onclick: () => picker.click(), 'aria-label': 'Ajouter une story' },
      h('span', { class: 'story-ring none' }, avatar(store.user, 'lg'), h('span', { class: 'story-plus' }, icon('plus'))),
      h('span', { class: 'story-name' }, mine ? 'Ajouter' : 'Votre story'),
    );
    bar.replaceChildren(add, ...groups.map((g, i) => item(g, i)), picker);
  }

  async function load() {
    try {
      groups = (await api.get('/api/stories')).groups;
    } catch {
      groups = [];
    }
    paint();
  }

  paint();
  load();
  return { el: bar, reload: load };
}

// ---------------------------------------------------------------------------
// Création : aperçu, légende, publication
// ---------------------------------------------------------------------------
function createStory(file, onDone) {
  const url = URL.createObjectURL(file);
  const caption = h('input', { class: 'input', maxlength: 200, placeholder: 'Ajouter une légende (facultatif)' });
  const publish = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Publier la story');
  const m = modal(
    'Nouvelle story',
    h(
      'form',
      {
        class: 'modal-body story-create',
        onsubmit: async (e) => {
          e.preventDefault();
          publish.disabled = true;
          publish.textContent = 'Publication…';
          try {
            const small = await shrinkImage(file, 1440);
            const fd = new FormData();
            fd.append('image', small, small.name || 'story');
            fd.append('caption', caption.value);
            await api.post('/api/stories', fd);
            m.close();
            toast('Story publiée pour 24 heures.');
            onDone?.();
          } catch (err) {
            publish.disabled = false;
            publish.textContent = 'Publier la story';
            toast(err.message, 'error');
          }
        },
      },
      h('div', { class: 'story-create-preview' }, h('img', { src: url, alt: '' })),
      caption,
      publish,
      h('p', { class: 'muted small', style: { textAlign: 'center' } }, 'Visible par les membres pendant 24 heures.'),
    ),
    { onClose: () => URL.revokeObjectURL(url) },
  );
}

// ---------------------------------------------------------------------------
// Lecteur plein écran
// ---------------------------------------------------------------------------
function viewersModal(storyId, onClose) {
  const body = h('div', { class: 'modal-body', style: { padding: '8px' } }, spinner());
  modal('Vue par', body, { onClose });
  api
    .get(`/api/stories/${storyId}/viewers`)
    .then(({ users }) => {
      clear(body);
      if (!users.length) body.append(h('p', { class: 'muted', style: { padding: '16px', textAlign: 'center' } }, 'Personne pour l’instant.'));
      for (const u of users) {
        body.append(h('a', { href: `/@${u.username}`, class: 'user-row' }, avatar(u), h('span', { class: 'meta' }, nameLine(u, { link: false }), h('small', null, timeAgo(u.viewedAt)))));
      }
    })
    .catch((err) => body.replaceChildren(h('p', { class: 'muted', style: { padding: '16px' } }, err.message)));
}

export function openViewer(groups, startGroup, onClose) {
  let gi = startGroup;
  let si = 0;
  let timer = null;
  let started = 0;
  let remaining = DURATION;
  let paused = false;

  const bars = h('div', { class: 'story-progress' });
  const head = h('div', { class: 'story-head' });
  const img = h('img', { class: 'story-media', alt: '' });
  const caption = h('p', { class: 'story-caption' });
  const footer = h('div', { class: 'story-footer' });
  const frame = h('div', { class: 'story-frame' }, img, h('div', { class: 'story-shade' }), bars, head, caption, footer);
  const root = h('div', { class: 'story-viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Story' }, frame);

  const group = () => groups[gi];
  const story = () => group().stories[si];

  const stop = () => {
    clearTimeout(timer);
    timer = null;
  };
  const run = () => {
    stop();
    started = performance.now();
    timer = setTimeout(next, remaining);
    const cur = bars.children[si]?.firstChild;
    if (cur) {
      cur.style.transition = `width ${remaining}ms linear`;
      requestAnimationFrame(() => (cur.style.width = '100%'));
    }
  };
  const pause = () => {
    if (paused || !timer) return;
    paused = true;
    stop();
    remaining -= performance.now() - started;
    const cur = bars.children[si]?.firstChild;
    if (cur) {
      const w = getComputedStyle(cur).width;
      cur.style.transition = 'none';
      cur.style.width = w;
    }
  };
  const resume = () => {
    if (!paused) return;
    paused = false;
    run();
  };

  function show() {
    stop();
    paused = false;
    remaining = DURATION;
    const g = group();
    const s = story();
    bars.replaceChildren(
      ...g.stories.map((_, i) => h('i', null, h('b', { style: { width: i < si ? '100%' : '0%' } }))),
    );
    const close = h('button', { class: 'story-btn', 'aria-label': 'Fermer', onclick: exit }, icon('x'));
    const extra = [];
    if (g.mine) {
      extra.push(
        h('button', { class: 'story-btn', 'aria-label': 'Voir qui a regardé', onclick: () => { pause(); viewersModal(s.id, resume); } }, icon('eye'), h('span', null, String(s.views ?? 0))),
        h('button', {
          class: 'story-btn',
          'aria-label': 'Supprimer la story',
          onclick: async () => {
            pause();
            if (!(await confirmDialog('Supprimer la story ?', 'Elle disparaîtra immédiatement.', 'Supprimer'))) return resume();
            try {
              await api.del(`/api/stories/${s.id}`);
              g.stories.splice(si, 1);
              toast('Story supprimée.');
              if (!g.stories.length) {
                groups.splice(gi, 1);
                return exit();
              }
              si = Math.min(si, g.stories.length - 1);
              show();
            } catch (err) {
              toast(err.message, 'error');
              resume();
            }
          },
        }, icon('trash')),
      );
    }
    head.replaceChildren(
      h('a', { href: `/@${g.user.username}`, class: 'story-author', onclick: () => exit() }, avatar(g.user, 'sm'), h('b', null, g.user.displayName), h('small', null, timeAgo(s.createdAt))),
      h('span', { class: 'grow' }),
      ...extra,
      close,
    );
    caption.textContent = s.caption || '';
    caption.hidden = !s.caption;

    // Réponse privée à l'auteur
    if (!g.mine) {
      const input = h('input', { class: 'story-reply-input', maxlength: 500, placeholder: `Répondre à ${g.user.displayName.split(/\s+/)[0]}…`, 'aria-label': 'Répondre' });
      input.addEventListener('focus', pause);
      input.addEventListener('blur', resume);
      footer.replaceChildren(
        h(
          'form',
          {
            class: 'story-reply',
            onsubmit: async (e) => {
              e.preventDefault();
              const text = input.value.trim();
              if (!text) return;
              try {
                await api.post(`/api/conversations/${enc(g.user.username)}`, { body: `↩︎ En réponse à votre story : ${text}` });
                input.value = '';
                input.blur();
                toast('Réponse envoyée en message privé.');
              } catch (err) {
                toast(err.message, 'error');
              }
            },
          },
          input,
          h('button', { class: 'story-btn', type: 'submit', 'aria-label': 'Envoyer' }, icon('send')),
        ),
      );
    } else {
      footer.replaceChildren();
    }

    img.src = s.media;
    const startWhenReady = () => {
      if (story() !== s) return;
      run();
      if (!g.mine && !s.viewed) {
        s.viewed = true;
        g.allViewed = g.stories.every((x) => x.viewed);
        api.post(`/api/stories/${s.id}/view`).catch(() => {});
      }
    };
    if (img.complete && img.naturalWidth) startWhenReady();
    else img.decode().then(startWhenReady, startWhenReady);
  }

  function next() {
    const g = group();
    if (si < g.stories.length - 1) {
      si++;
      show();
    } else if (gi < groups.length - 1) {
      gi++;
      si = 0;
      show();
    } else {
      exit();
    }
  }
  function prev() {
    if (si > 0) {
      si--;
    } else if (gi > 0) {
      gi--;
      si = groups[gi].stories.length - 1;
    }
    show();
  }

  // Toucher à gauche / à droite, appui long = pause, glisser vers le bas = fermer
  let downAt = 0;
  let downY = 0;
  let downX = 0;
  frame.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a, input, form')) return;
    downAt = performance.now();
    downY = e.clientY;
    downX = e.clientX;
    pause();
  });
  frame.addEventListener('pointerup', (e) => {
    if (!downAt) return;
    const held = performance.now() - downAt;
    const dy = e.clientY - downY;
    downAt = 0;
    if (dy > 90) return exit();
    if (held > 250 || Math.abs(e.clientX - downX) > 30) return resume();
    const r = frame.getBoundingClientRect();
    if (e.clientX - r.left < r.width * 0.33) prev();
    else next();
  });
  frame.addEventListener('pointercancel', () => {
    downAt = 0;
    resume();
  });

  const onKey = (e) => {
    if (e.target.closest?.('input')) return;
    if (e.key === 'Escape') exit();
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
  };
  const onVisibility = () => (document.hidden ? pause() : resume());

  function exit() {
    stop();
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('visibilitychange', onVisibility);
    root.classList.add('closing');
    setTimeout(() => root.remove(), 200);
    document.body.style.overflow = '';
    onClose?.();
  }

  document.addEventListener('keydown', onKey, true);
  document.addEventListener('visibilitychange', onVisibility);
  document.body.append(root);
  document.body.style.overflow = 'hidden';
  show();
}
