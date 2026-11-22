import { api, enc } from '../api.js';
import { store } from '../store.js';
import { h, icon, avatar, timeAgo, toast, modal, spinner, clear, nameLine, shrinkImage, confirmDialog } from '../dom.js';
import { isVideoFile, readVideoInfo, noSave, sound, clockLabel, MAX_SECONDS, preloadVideo, localVideo, setSource } from './video.js';
import { sendInBackground } from './uploads.js';
import { warmImages, warmVideos } from '../warm.js';

const DURATION = 5000; // durée d'affichage d'une story

// Nouvelle story depuis n'importe où (bouton « + ») : choix de la photo ou de la vidéo
export function newStory() {
  const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif,video/*', hidden: true });
  document.body.append(input);
  input.addEventListener('change', () => {
    const f = input.files[0];
    input.remove();
    if (f) (isVideoFile(f) ? createVideoStory : createStory)(f, () => document.dispatchEvent(new CustomEvent('aurum:stories')));
  });
  input.click();
}

// ---------------------------------------------------------------------------
// Barre des stories (haut du Salon)
// ---------------------------------------------------------------------------
export function storiesBar() {
  const bar = h('div', { class: 'stories-bar', role: 'list', 'aria-label': 'Stories' });
  let groups = [];
  // Photo ou vidéo (une minute au plus)
  const picker = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif,video/*', hidden: true });
  picker.addEventListener('change', () => {
    const f = picker.files[0];
    picker.value = '';
    if (f) (isVideoFile(f) ? createVideoStory : createStory)(f, load);
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
    const mi = groups.findIndex((g) => g.mine);
    let first;
    if (mi >= 0) {
      // Sa propre story en tête, une seule fois : toucher l'avatar la montre, le « + » en ajoute une
      first = item(groups[mi], mi);
      first.classList.add('own');
      first.querySelector('.story-ring').append(
        h('span', {
          class: 'story-plus', role: 'button', tabindex: '0', 'aria-label': 'Ajouter une story',
          onclick: (e) => { e.stopPropagation(); picker.click(); },
        }, icon('plus')),
      );
    } else {
      first = h(
        'button',
        { type: 'button', role: 'listitem', class: 'story-item add', onclick: () => picker.click(), 'aria-label': 'Ajouter une story' },
        h('span', { class: 'story-ring none' }, avatar(store.user, 'lg'), h('span', { class: 'story-plus' }, icon('plus'))),
        h('span', { class: 'story-name' }, 'Votre story'),
      );
    }
    bar.replaceChildren(first, ...groups.map((g, i) => (i === mi ? null : item(g, i))).filter(Boolean), picker);
  }

  async function load() {
    try {
      groups = (await api.get('/api/stories')).groups;
    } catch {
      groups = [];
    }
    // Toutes les photos des stories d'avance ; les vidéos des membres non encore vus aussi
    warmImages(groups.flatMap((g) => [g.user.avatar, ...g.stories.map((x) => (x.video ? x.video.poster : x.media))]));
    warmVideos(groups.filter((x) => !x.allViewed).flatMap((g) => g.stories.filter((x) => x.video && !x.viewed).map((x) => x.video)), 4);
    paint();
  }

  paint();
  load();
  // Story publiée depuis le bouton « + » : la barre se met à jour
  const onNew = () => (bar.isConnected ? load() : document.removeEventListener('aurum:stories', onNew));
  document.addEventListener('aurum:stories', onNew);
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

// Story vidéo : aperçu, légende, puis envoi de la vidéo d'origine en morceaux
async function createVideoStory(file, onDone) {
  let info;
  try {
    info = await readVideoInfo(file);
    if (!(info.duration > 0)) throw new Error('Vidéo illisible sur cet appareil.');
    if (info.duration > MAX_SECONDS + 1) throw new Error('Vidéo trop longue : une minute au maximum.');
  } catch (err) {
    return toast(err.message, 'error');
  }
  const posterUrl = info.poster ? URL.createObjectURL(info.poster) : null;
  const caption = h('input', { class: 'input', maxlength: 200, placeholder: 'Ajouter une légende (facultatif)' });
  const publish = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Publier la story');
  const m = modal(
    'Nouvelle story',
    h(
      'form',
      {
        class: 'modal-body story-create',
        onsubmit: (e) => {
          e.preventDefault();
          // Envoi en arrière-plan : on continue de naviguer
          const text = caption.value;
          sendInBackground({
            file,
            info,
            title: 'Votre story',
            finish: async (video) => {
              const fd = new FormData();
              fd.append('video', video.id);
              fd.append('caption', text);
              await api.post('/api/stories', fd);
              onDone?.();
              return { href: '/salon', message: 'Votre story est en ligne pour 24 heures.' };
            },
          });
          m.close();
          toast('Story en cours d’envoi, en qualité d’origine : continuez à naviguer.');
        },
      },
      h(
        'div',
        { class: 'story-create-preview' },
        posterUrl ? h('img', { src: posterUrl, alt: '' }) : h('span', { class: 'preview-video-ph' }, icon('video')),
        h('span', { class: 'preview-duration' }, icon('play', 'icon-xs'), clockLabel(info.duration)),
      ),
      caption,
      publish,
      h('p', { class: 'muted small', style: { textAlign: 'center' } }, 'Visible par les membres pendant 24 heures, puis effacée.'),
    ),
    {
      onClose: () => {
        if (posterUrl) URL.revokeObjectURL(posterUrl);
        URL.revokeObjectURL(info.url);
      },
    },
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
  // Story vidéo : même cadre, durée de la vidéo au lieu de 5 secondes
  const vid = noSave(h('video', { class: 'story-media', playsinline: true, 'webkit-playsinline': '', preload: 'auto', hidden: true }));
  vid.playsInline = true;
  const caption = h('p', { class: 'story-caption' });
  const footer = h('div', { class: 'story-footer' });
  const frame = h('div', { class: 'story-frame' }, img, vid, h('div', { class: 'story-shade' }), bars, head, caption, footer);
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
    if (!vid.hidden) vid.pause();
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
    if (!vid.hidden) vid.play().catch(() => {});
    run();
  };

  function show() {
    stop();
    paused = false;
    const g = group();
    const s = story();
    remaining = s.video?.duration ? Math.max(1500, s.video.duration * 1000) : DURATION;
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
    if (s.video) {
      const soundBtn = h('button', { class: 'story-btn', 'aria-label': 'Son' }, icon(sound.get() ? 'sound' : 'mute'));
      soundBtn.addEventListener('click', () => {
        sound.set(vid.muted);
        vid.muted = !sound.get();
        soundBtn.replaceChildren(icon(vid.muted ? 'mute' : 'sound'));
      });
      extra.unshift(soundBtn);
    }
    head.replaceChildren(
      h('a', { href: `/@${g.user.username}`, class: 'story-author', onclick: () => exit() }, avatar(g.user, 'sm'), h('b', null, g.user.displayName), h('small', null, timeAgo(s.createdAt))),
      h('span', { class: 'grow' }),
      ...extra,
      close,
    );
    // La story suivante (si c'est une vidéo) se télécharge pendant qu'on regarde celle-ci
    const following = g.stories[si + 1] || groups[gi + 1]?.stories[0];
    if (following?.video) preloadVideo(following.video);
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

    const startWhenReady = () => {
      if (story() !== s) return;
      run();
      if (!g.mine && !s.viewed) {
        s.viewed = true;
        g.allViewed = g.stories.every((x) => x.viewed);
        api.post(`/api/stories/${s.id}/view`).catch(() => {});
      }
    };
    if (s.video) {
      img.hidden = true;
      vid.hidden = false;
      vid.poster = s.media || '';
      setSource(vid, s.video, localVideo(s.video) || s.video.url); // déjà téléchargée : démarrage immédiat
      vid.muted = !sound.get();
      const play = () => vid.play().catch(() => {
        vid.muted = true; // son refusé sans geste : lecture muette
        return vid.play().catch(() => {});
      });
      play().then(() => story() === s && startWhenReady());
      return;
    }
    vid.pause();
    vid.removeAttribute('src');
    vid.hidden = true;
    img.hidden = false;
    img.alt = `Story de ${group().user.displayName}${s.caption ? ` : ${s.caption}` : ''}`;
    img.src = s.media;
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
    vid.pause();
    vid.removeAttribute('src');
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
