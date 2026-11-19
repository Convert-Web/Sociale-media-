// Premiers pas, juste après l'inscription : trois étapes courtes, chacune facultative.
// 1. Une photo de profil  2. Suivre quelques membres  3. Notifications (ou ajout à l'écran d'accueil sur iPhone)
import { api } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { h, icon, avatar, toast, shrinkImage, spinner, TOO_BIG_GIF } from '../dom.js';
import { cropImage } from '../components/cropper.js';
import { pushState, enablePush } from '../push.js';
import { userRow } from './profile.js';
import { openSheet } from '../components/sheet.js';

const done = () => {
  try {
    localStorage.setItem('aurum:welcome-done', '1');
  } catch {
    /* stockage indisponible */
  }
};

export function firstSteps() {
  const host = h('div', { class: 'steps' });
  const dots = h('div', { class: 'steps-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
  const label = h('span', { class: 'steps-label' });
  const stage = h('div', { class: 'steps-stage' });
  host.append(h('div', { class: 'steps-head' }, dots, label), stage);

  let index = 0;
  const go = (i) => {
    index = i;
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k <= i));
    label.textContent = `Étape ${i + 1} sur 3`;
    const view = [photoStep, followStep, alertStep][i];
    const el = view(next);
    el.classList.add('step-in');
    stage.replaceChildren(el);
    host.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  function next() {
    if (index < 2) go(index + 1);
    else finish();
  }
  function finish() {
    done();
    stage.replaceChildren(
      h(
        'div',
        { class: 'step step-in step-done' },
        h('span', { class: 'step-badge ok' }, icon('check')),
        h('h2', null, 'Tout est prêt.'),
        h('p', null, 'Votre Salon vous attend : les publications des membres que vous suivez, dans l’ordre, sans publicité.'),
        h('a', { href: '/salon', class: 'btn btn-primary btn-lg btn-block' }, 'Entrer dans le Salon', icon('arrow')),
      ),
    );
  }
  go(0);
  return host;
}

// 1. Photo de profil : on la choisit, on la recadre, c'est enregistré
function photoStep(next) {
  const preview = h('div', { class: 'step-avatar' }, avatar(store.user, 'xl'));
  const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true });
  const pick = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', onclick: () => input.click() }, icon('camera'), store.user.avatar ? 'Changer de photo' : 'Choisir une photo');
  input.addEventListener('change', async () => {
    const f = input.files[0];
    input.value = '';
    if (!f) return;
    if (f.type === 'image/gif' && f.size > TOO_BIG_GIF) return toast('GIF trop lourd (4 Mo maximum).', 'error');
    let small = f;
    if (f.type !== 'image/gif') {
      const cropped = await cropImage(f, { aspect: 1, round: true, outWidth: 800, title: 'Photo de profil' });
      if (!cropped) return;
      small = await shrinkImage(cropped, 800);
    }
    pick.disabled = true;
    pick.replaceChildren(spinner(), 'Enregistrement…');
    const fd = new FormData();
    fd.append('image', small, small.name || 'photo.jpg');
    try {
      const { user } = await api.post('/api/me/avatar', fd);
      store.setUser(user);
      preview.replaceChildren(avatar(user, 'xl'));
      preview.classList.add('pop');
      setTimeout(next, 900);
    } catch (err) {
      toast(err.message, 'error');
      pick.disabled = false;
      pick.replaceChildren(icon('camera'), 'Choisir une photo');
    }
  });
  return h(
    'div',
    { class: 'step' },
    preview,
    h('h2', null, 'Une photo, pour qu’on vous reconnaisse'),
    h('p', null, 'Les membres suivent plus volontiers un visage. Vous pourrez la changer à tout moment.'),
    pick,
    input,
    h('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: next }, store.user.avatar ? 'Garder celle-ci' : 'Plus tard'),
  );
}

// 2. Suivre des membres : leur actualité remplit le Salon
function followStep(next) {
  const list = h('div', { class: 'step-list' }, spinner());
  const all = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', hidden: true }, 'Tout suivre');
  const cont = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', onclick: next }, 'Continuer');
  let users = [];
  const paintCount = () => {
    const n = users.filter((u) => u.isFollowing).length;
    cont.textContent = n ? `Continuer · ${n} suivi${n > 1 ? 's' : ''}` : 'Continuer';
    all.hidden = !users.some((u) => !u.isFollowing);
  };
  all.addEventListener('click', async () => {
    all.disabled = true;
    for (const u of users.filter((x) => !x.isFollowing)) {
      try {
        await api.post(`/api/users/${encodeURIComponent(u.username)}/follow`);
        u.isFollowing = true;
      } catch {
        /* on continue avec les autres */
      }
    }
    list.replaceChildren(...users.map((u) => userRow(u)));
    all.disabled = false;
    paintCount();
  });
  api
    .get('/api/suggestions?limit=8')
    .then((d) => {
      users = d.users.filter((u) => !u.isMe);
      if (!users.length) return next(); // personne à proposer : étape suivante
      list.replaceChildren(...users.map((u) => userRow(u)));
      paintCount();
    })
    .catch(() => next());
  const el = h(
    'div',
    { class: 'step' },
    h('span', { class: 'step-badge' }, icon('users')),
    h('h2', null, 'Suivez quelques membres'),
    h('p', null, 'Leurs publications apparaîtront dans votre Salon, dans l’ordre où ils publient.'),
    h('div', { class: 'step-list-head' }, h('b', null, 'Suggestions'), all),
    list,
    cont,
  );
  const off = store.on('follow:changed', () => (el.isConnected ? paintCount() : off?.()));
  return el;
}

// 3. Être prévenu : notifications, ou d'abord l'icône sur l'écran d'accueil (iPhone)
function alertStep(next) {
  const el = h('div', { class: 'step' }, spinner());
  pushState()
    .then((state) => {
      if (state === 'on' || state === 'unsupported' || state === 'denied') return next();
      if (state === 'install') {
        el.replaceChildren(
          h('span', { class: 'step-badge' }, icon('share')),
          h('h2', null, 'AURUM sur votre écran d’accueil'),
          h('p', null, 'Comme une vraie application : plein écran, ouverture instantanée, et les notifications de vos messages.'),
          h(
            'ol',
            { class: 'step-howto' },
            h('li', null, h('span', null, '1'), h('p', null, 'Touchez ', h('b', null, 'Partager'), ' ', h('span', { class: 'inline-icon' }, icon('share')), ' en bas de Safari')),
            h('li', null, h('span', null, '2'), h('p', null, 'Choisissez ', h('b', null, 'Sur l’écran d’accueil'))),
            h('li', null, h('span', null, '3'), h('p', null, 'Ouvrez AURUM depuis sa nouvelle icône')),
          ),
          h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', onclick: next }, 'C’est noté'),
        );
        return;
      }
      const on = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button' }, icon('bellRing'), 'Activer les notifications');
      on.addEventListener('click', async () => {
        on.disabled = true;
        try {
          await enablePush();
          toast('Notifications activées.');
          next();
        } catch (err) {
          toast(err.message, 'error');
          on.disabled = false;
        }
      });
      el.replaceChildren(
        h('span', { class: 'step-badge' }, icon('bellRing')),
        h('h2', null, 'Ne manquez aucun message'),
        h('p', null, 'Une notification quand un membre vous écrit, vous répond ou vous invite. Jamais de publicité.'),
        on,
        h('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: next }, 'Plus tard'),
      );
    })
    .catch(() => next());
  return el;
}

// Une étape seule, dans une feuille (carte « Bien démarrer » du Salon)
export function stepSheet(kind, onDone) {
  const sheet = openSheet({ title: kind === 'photo' ? 'Photo de profil' : 'Suivre des membres', body: h('div', { class: 'step-sheet' }), tall: kind !== 'photo', onClose: onDone });
  const finish = () => sheet.close();
  sheet.el.querySelector('.step-sheet').append((kind === 'photo' ? photoStep : followStep)(finish));
}

export function skipSteps() {
  done();
  navigate('/salon');
}
