// Activation des notifications sur le téléphone : carte des Réglages et bandeau de la messagerie.
import { api } from '../api.js';
import { h, icon, toast } from '../dom.js';
import { pushState, enablePush, disablePush } from '../push.js';

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function installSteps() {
  return h(
    'ol',
    { class: 'install-steps' },
    h('li', null, 'Ouvrez AURUM dans ', h('b', null, 'Safari'), '.'),
    h('li', null, 'Touchez ', h('span', { class: 'kbd' }, icon('share', 'icon-xs'), 'Partager'), ' en bas de l’écran.'),
    h('li', null, 'Choisissez ', h('b', null, '« Sur l’écran d’accueil »'), ', puis ', h('b', null, 'Ajouter'), '.'),
    h('li', null, 'Ouvrez AURUM depuis son icône et revenez ici pour activer les notifications.'),
  );
}

export function pushCard() {
  const body = h('div', { class: 'push-body' }, h('p', { class: 'muted small' }, 'Vérification…'));
  const card = h(
    'div',
    { class: 'card' },
    h('h2', null, 'Notifications'),
    h('p', { class: 'desc' }, 'Soyez prévenu sur ce téléphone dès qu’un membre vous écrit, vous ajoute en ami ou vous invite dans un groupe.'),
    body,
  );

  async function paint() {
    const state = await pushState().catch(() => 'unsupported');
    const status = (on, label) => h('div', { class: `push-status${on ? ' on' : ''}` }, h('span', { class: 'push-dot' }), label);
    if (state === 'install') {
      body.replaceChildren(status(false, 'À activer depuis l’écran d’accueil'), h('p', { class: 'small' }, 'Sur iPhone, les notifications fonctionnent une fois AURUM ajouté à l’écran d’accueil :'), installSteps());
    } else if (state === 'unsupported') {
      body.replaceChildren(status(false, 'Non disponible sur ce navigateur'), h('p', { class: 'muted small' }, 'Essayez avec Safari (iPhone), Chrome (Android) ou un navigateur récent sur ordinateur.'));
    } else if (state === 'denied') {
      body.replaceChildren(
        status(false, 'Bloquées'),
        h('p', { class: 'muted small' }, isIOS() ? 'Autorisez-les dans Réglages › Notifications › AURUM.' : 'Autorisez-les dans les réglages du site de votre navigateur (icône à gauche de l’adresse).'),
      );
    } else if (state === 'off') {
      const btn = h('button', { class: 'btn btn-primary' }, icon('bellRing', 'icon-sm'), 'Activer les notifications');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await enablePush();
          toast('Notifications activées sur cet appareil.');
        } catch (err) {
          toast(err.message, 'error');
        }
        paint();
      });
      body.replaceChildren(status(false, 'Désactivées sur cet appareil'), h('div', { class: 'row-start' }, btn));
    } else {
      const test = h('button', { class: 'btn btn-secondary' }, 'Envoyer un test');
      test.addEventListener('click', async () => {
        test.disabled = true;
        try {
          await api.post('/api/push/test');
          toast('Notification de test envoyée.');
        } catch (err) {
          toast(err.message, 'error');
        }
        setTimeout(() => (test.disabled = false), 3000);
      });
      const off = h('button', { class: 'btn btn-ghost' }, 'Désactiver');
      off.addEventListener('click', async () => {
        off.disabled = true;
        await disablePush();
        toast('Notifications désactivées sur cet appareil.');
        paint();
      });
      body.replaceChildren(status(true, 'Activées sur cet appareil'), h('div', { class: 'row-start' }, test, off));
    }
  }
  paint();
  return card;
}

// Bandeau discret en haut de la messagerie, tant que les notifications sont désactivées.
export function pushBanner() {
  const host = h('div');
  let dismissed = false;
  try {
    dismissed = localStorage.getItem('aurum:push-banner') === '1';
  } catch {
    /* stockage indisponible */
  }
  if (dismissed) return host;
  pushState()
    .then((state) => {
      if (state !== 'off' && state !== 'install') return;
      const hide = () => {
        try {
          localStorage.setItem('aurum:push-banner', '1');
        } catch {
          /* stockage indisponible */
        }
        host.replaceChildren();
      };
      const action =
        state === 'off'
          ? h(
              'button',
              {
                class: 'btn btn-primary btn-sm',
                onclick: async () => {
                  try {
                    await enablePush();
                    toast('Notifications activées.');
                    host.replaceChildren();
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                },
              },
              'Activer',
            )
          : h('a', { href: '/reglages#notifications', class: 'btn btn-secondary btn-sm' }, 'Comment ?');
      host.replaceChildren(
        h(
          'div',
          { class: 'push-banner' },
          h('span', { class: 'requests-icon' }, icon('bellRing')),
          h('span', { class: 'grow' }, h('b', null, 'Ne manquez aucun message'), h('small', null, state === 'off' ? 'Recevez une notification sur ce téléphone.' : 'Ajoutez AURUM à l’écran d’accueil pour être notifié.')),
          action,
          h('button', { class: 'icon-btn', 'aria-label': 'Masquer', onclick: hide }, icon('x', 'icon-sm')),
        ),
      );
    })
    .catch(() => {});
  return host;
}
