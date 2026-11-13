import { api } from '../api.js';
import { store, connectRealtime, disconnectRealtime } from '../store.js';
import { detachPush } from '../push.js';
import { navigate } from '../router.js';
import { h, icon, memberCard, money, cardSince, modal, toast, memberNo } from '../dom.js';

export async function logout() {
  await detachPush();
  try {
    await api.post('/api/auth/logout');
  } catch {
    /* ignoré */
  }
  disconnectRealtime();
  store.setUser(null);
  navigate('/');
}

export function joinView(ctx) {
  const u = store.user;
  if (u.isMember) {
    navigate('/salon', { replace: true });
    return h('div');
  }
  const cfg = store.config;
  const price = money(cfg.priceCents, cfg.currency);
  const firstName = u.displayName.split(/\s+/)[0];
  const status = ctx.query.get('statut');

  const waiver = h('input', { type: 'checkbox' });
  const cgv = h('input', { type: 'checkbox' });
  const err = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const payBtn = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' }, icon('lock'), `Payer ${price} et entrer`);
  const canPay = cfg.stripeEnabled || cfg.demoPayments;
  if (!canPay) payBtn.disabled = true;

  const notices = [];
  if (ctx.query.get('annule')) notices.push(h('div', { class: 'form-error' }, "Paiement annulé — aucun montant n'a été débité."));
  if (status === 'attente') notices.push(h('div', { class: 'form-ok' }, 'Paiement reçu, confirmation en cours… Cette page se mettra à jour automatiquement.'));
  if (status === 'erreur') notices.push(h('div', { class: 'form-error' }, 'Impossible de vérifier le paiement pour le moment. Si vous avez été débité, votre accès sera activé sous peu.'));
  if (!cfg.stripeEnabled && cfg.demoPayments) {
    notices.push(
      h(
        'div',
        { class: 'demo-banner' },
        icon('info'),
        h('span', null, 'Mode démonstration : aucun paiement réel ne sera effectué. Ajoutez votre clé Stripe (STRIPE_SECRET_KEY) pour encaisser les droits d’entrée.'),
      ),
    );
  }
  if (!canPay) notices.push(h('div', { class: 'form-error' }, 'Le paiement est momentanément indisponible.'));

  const showError = (msg) => {
    err.textContent = msg;
    err.hidden = false;
  };

  async function demoCheckout() {
    const confirmBtn = h('button', { class: 'btn btn-primary btn-lg btn-block' }, `Simuler le paiement de ${price}`);
    const m = modal(
      'Paiement simulé',
      h(
        'div',
        { class: 'modal-body', style: { display: 'grid', gap: '18px' } },
        h('div', { class: 'demo-banner' }, icon('info'), h('span', null, 'Aucune carte bancaire ne sera débitée. Ce mode sert à tester AURUM avant de brancher Stripe.')),
        h('div', { class: 'join-total' }, h('span', { class: 'text-2' }, "Droit d'entrée AURUM"), h('b', { class: 'accent' }, price)),
        confirmBtn,
      ),
    );
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      try {
        const { user } = await api.post('/api/billing/demo', { waiver: true });
        m.close();
        store.setUser(user);
        await store.refresh();
        connectRealtime();
        navigate('/bienvenue', { replace: true });
      } catch (e) {
        confirmBtn.disabled = false;
        toast(e.message, 'error');
      }
    });
  }

  const form = h(
    'form',
    {
      class: 'join-box',
      onsubmit: async (e) => {
        e.preventDefault();
        err.hidden = true;
        if (!cgv.checked) return showError('Merci d’accepter les conditions générales de vente.');
        if (!waiver.checked) return showError("Merci de confirmer votre demande d'accès immédiat.");
        payBtn.disabled = true;
        try {
          const res = await api.post('/api/billing/checkout', { waiver: true });
          if (res.alreadyMember) {
            await store.refresh();
            return navigate('/salon', { replace: true });
          }
          if (res.url) {
            location.href = res.url;
            return;
          }
          if (res.demo) await demoCheckout();
        } catch (e2) {
          showError(e2.message);
        } finally {
          payBtn.disabled = !canPay;
        }
      },
    },
    h('div', { class: 'join-total' }, h('div', null, h('div', { class: 'eyebrow' }, "Droit d'entrée"), h('small', { class: 'muted' }, 'Paiement unique · accès à vie')), h('b', { class: 'accent' }, price)),
    h(
      'ul',
      { class: 'price-list', style: { margin: '0' } },
      ['Accès immédiat et à vie au cercle', 'Votre numéro de membre personnel', 'Messagerie privée entre membres', 'Aucune publicité, jamais'].map((t) => h('li', null, icon('check'), t)),
    ),
    notices,
    err,
    h('label', { class: 'check' }, cgv, h('span', null, "J'accepte les ", h('a', { href: '/cgv', target: '_blank' }, 'conditions générales de vente'), '.')),
    h(
      'label',
      { class: 'check' },
      waiver,
      h('span', null, "Je demande l'accès immédiat au cercle et reconnais perdre mon droit de rétractation dès cet accès (art. L221-28 du Code de la consommation)."),
    ),
    payBtn,
    h('p', { class: 'secure-note' }, icon('shield'), cfg.stripeEnabled ? 'Paiement chiffré et sécurisé par Stripe' : 'Vos coordonnées bancaires ne transitent jamais par AURUM'),
  );

  // Paiement en cours de confirmation : on vérifie régulièrement.
  if (status === 'attente') {
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      try {
        await store.refresh();
        if (store.isMember) {
          clearInterval(timer);
          connectRealtime();
          navigate('/bienvenue', { replace: true });
        }
      } catch {
        /* nouvel essai */
      }
      if (tries > 20) clearInterval(timer);
    }, 3000);
    ctx.onCleanup(() => clearInterval(timer));
  }

  ctx.title = "Droit d'entrée — AURUM";
  return h(
    'div',
    { class: 'join' },
    h(
      'div',
      { class: 'container', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
      h('a', { href: '/', class: 'logo' }, 'AURUM'),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: logout }, 'Se déconnecter'),
    ),
    h(
      'div',
      { class: 'join-grid' },
      h(
        'div',
        { class: 'fade-up' },
        h('div', { class: 'steps' }, h('i', { class: 'on' }), h('i', { class: 'on' }), h('span', null, "Étape 2 sur 2 — Droit d'entrée")),
        h('h1', null, `Plus qu'une porte à franchir, `, h('em', { class: 'accent' }, firstName), '.'),
        h('p', { class: 'lead' }, 'Votre carte est prête. Il ne manque que le droit d’entrée pour y graver votre numéro.'),
        h('div', { style: { marginTop: '34px', maxWidth: '420px' } }, memberCard({ name: u.displayName, number: null, since: cardSince(Date.now()) })),
      ),
      h('div', { class: 'fade-up', style: { animationDelay: '.1s' } }, form),
    ),
  );
}

// ---------------------------------------------------------------------------
// Bienvenue : la carte apparaît, le numéro défile jusqu'au vôtre
// ---------------------------------------------------------------------------
export function welcomeView(ctx) {
  const u = store.user;
  const firstName = u.displayName.split(/\s+/)[0];
  const card = memberCard({ name: u.displayName, number: u.memberNumber, since: cardSince(u.joinedAt), founder: u.founder });
  const numberEl = card.querySelector('.mcard-number');

  // Le numéro défile jusqu'au vôtre
  const target = u.memberNumber || 0;
  const start = performance.now();
  const dur = 1800;
  const step = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    numberEl.textContent = memberNo(Math.max(1, Math.round(eased * target)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);

  ctx.title = 'Bienvenue — AURUM';
  return h(
    'div',
    { class: 'welcome' },
    h(
      'div',
      { class: 'welcome-inner' },
      h('span', { class: 'eyebrow fade-up' }, 'Bienvenue dans le cercle'),
      card,
      h('h1', { class: 'fade-up', style: { animationDelay: '1.2s' } }, 'Vous êtes membre, ', h('em', { class: 'accent' }, firstName), '.'),
      h(
        'p',
        { class: 'text-2 fade-up', style: { animationDelay: '1.4s', fontSize: '17px' } },
        u.founder
          ? `Vous faites partie des ${store.config.founderLimit} Fondateurs d'AURUM. Votre couronne est permanente, et votre carte est en or.`
          : 'Votre numéro vous appartient désormais, pour toujours. Il ne sera jamais réattribué.',
      ),
      h(
        'div',
        { class: 'hero-cta fade-up', style: { animationDelay: '1.6s', justifyContent: 'center', margin: '8px 0 0' } },
        h('a', { href: '/reglages', class: 'btn btn-ghost btn-lg' }, 'Compléter mon profil'),
        h('a', { href: '/salon', class: 'btn btn-primary btn-lg' }, 'Entrer dans le Salon', icon('arrow')),
      ),
    ),
  );
}
