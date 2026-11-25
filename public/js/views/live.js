// LIVE : liste des directs, studio du créateur et écran du spectateur.
// L'image passe directement du téléphone du créateur à celui de chaque spectateur (WebRTC) ;
// la mise en relation et le fil du direct (commentaires, cœurs, cadeaux) passent par de simples
// requêtes répétées, ce qui fonctionne sur tous les hébergeurs (Vercel compris).
import { api, enc } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { h, icon, avatar, short, num, toast, emptyState, spinner, verifiedMark, duration, shareLink, plural, confirmDialog } from '../dom.js';

const coinsLabel = (n) => plural(n, 'pièce', 'pièces');
const viewersLabel = (n) => `${short(n)} ${n > 1 ? 'spectateurs' : 'spectateur'}`;
import { openSheet, closeSheet } from '../components/sheet.js';
import { needLogin, follow } from '../components/actions.js';
import { reportDialog } from '../components/report.js';

// Attente de la collecte des candidats ICE (description complète envoyée en une fois)
function waitIce(pc, ms = 2500) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(t);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    pc.addEventListener('icegatheringstatechange', check);
    const t = setTimeout(done, ms);
  });
}

// ---------------------------------------------------------------------------
// Liste des directs
// ---------------------------------------------------------------------------
export async function liveListView(ctx) {
  ctx.title = 'LIVE — AURUM';
  ctx.description = 'Les LIVE en cours sur AURUM.';
  const list = h('div', { class: 'live-grid' }, spinner());
  const go = () => h('a', { href: store.user ? `/live/${enc(store.user.username)}` : '/connexion?suite=/live', class: 'btn btn-primary', onclick: (e) => needLogin('Connecte-toi pour passer en LIVE.') && e.preventDefault() }, icon('broadcast', 'icon-sm'), 'Passer en LIVE');
  const cta = h('div', { class: 'live-cta' }, go());
  const load = async () => {
    try {
      const { lives } = await api.get('/api/live');
      list.replaceChildren(...(lives.length
        ? lives.map((l) => h('a', { href: `/live/${enc(l.host.username)}`, class: 'live-card' },
            h('span', { class: 'live-card-bg' }, avatar(l.host, 'xxl')),
            h('span', { class: 'live-badge' }, 'LIVE'),
            h('span', { class: 'live-card-viewers' }, icon('eye', 'icon-xs'), short(l.viewers)),
            h('span', { class: 'live-card-info' }, h('b', null, l.host.displayName), h('small', null, l.title || 'En direct'))))
        : [emptyState('live', 'Aucun LIVE en ce moment', 'Lance le tien : tes abonnés seront prévenus.', go())]));
      // Sans LIVE, le bouton est dans le message (sous le texte qui l'annonce)
      cta.hidden = !lives.length;
    } catch (err) {
      list.replaceChildren(emptyState('alert', 'LIVE indisponibles', err.message));
    }
  };
  await load();
  const timer = setInterval(load, 15000);
  ctx.onCleanup(() => clearInterval(timer));
  return h('div', { class: 'page live-list' }, h('header', { class: 'page-head' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retour', onclick: () => (history.length > 1 ? history.back() : navigate('/')) }, icon('back')), h('h1', null, 'LIVE'), h('span', { class: 'icon-btn' })), cta, list);
}

// ---------------------------------------------------------------------------
// Fil du direct (commentaires, arrivées, cœurs, cadeaux) et animations
// ---------------------------------------------------------------------------
function chatFeed() {
  const list = h('div', { class: 'live-chat', 'aria-live': 'polite' });
  const gifts = h('div', { class: 'live-gifts' });
  const hearts = h('div', { class: 'live-hearts' });
  let likeBuffer = 0;
  const push = (el) => {
    list.append(el);
    while (list.children.length > 60) list.firstChild.remove();
    list.scrollTop = list.scrollHeight;
  };
  const floatHeart = () => {
    const colors = ['#ff2d55', '#ff7a1a', '#ffc83d', '#6c4dff', '#00d1a0', '#3ea6ff'];
    const el = h('span', { class: 'float-heart', style: { '--x': `${Math.round(Math.random() * 40 - 20)}px`, color: colors[Math.floor(Math.random() * colors.length)] } }, icon('heart-fill'));
    hearts.append(el);
    setTimeout(() => el.remove(), 2200);
  };
  const show = (e) => {
    const who = e.user ? h('b', null, e.user.displayName) : h('b', null, 'Quelqu’un');
    if (e.type === 'comment') push(h('div', { class: 'chat-line' }, e.user ? avatar(e.user, 'xs') : null, h('span', null, who, ' ', e.body)));
    else if (e.type === 'join') push(h('div', { class: 'chat-line sys' }, h('span', null, who, ' a rejoint')));
    else if (e.type === 'follow') push(h('div', { class: 'chat-line sys' }, h('span', null, who, ' suit maintenant le créateur')));
    else if (e.type === 'share') push(h('div', { class: 'chat-line sys' }, h('span', null, who, ' a partagé le LIVE')));
    else if (e.type === 'like') {
      likeBuffer += e.count;
      for (let i = 0; i < Math.min(6, e.count); i++) setTimeout(floatHeart, i * 140);
    } else if (e.type === 'gift' && e.gift) {
      push(h('div', { class: 'chat-line is-gift' }, h('span', null, who, ` a envoyé ${e.gift.name}${e.count > 1 ? ` ×${e.count}` : ''} `, e.gift.emoji)));
      const card = h('div', { class: 'gift-pop' }, e.user ? avatar(e.user, 'sm') : null, h('span', null, h('b', null, e.user?.displayName || ''), h('small', null, `a envoyé ${e.gift.name}`)), h('span', { class: 'gift-pop-emoji' }, e.gift.emoji), e.count > 1 ? h('span', { class: 'gift-pop-count' }, `×${e.count}`) : null);
      gifts.append(card);
      setTimeout(() => card.remove(), 3600);
    }
  };
  return { list, gifts, hearts, show, floatHeart, takeLikes: () => { const n = likeBuffer; likeBuffer = 0; return n; } };
}

// Feuille des cadeaux : catalogue, solde, envoi
function giftSheet(liveId, onSent, back) {
  const balance = h('b', null, '…');
  const unit = h('span', null, 'pièces');
  const grid = h('div', { class: 'gift-grid' }, spinner());
  let coins = 0;
  const paintBalance = () => {
    balance.textContent = num(coins);
    unit.textContent = coins > 1 ? 'pièces' : 'pièce';
    for (const b of grid.querySelectorAll('.gift')) b.classList.toggle('too-much', Number(b.dataset.coins) > coins);
  };
  api.get('/api/wallet').then((w) => {
    coins = w.coins;
    grid.replaceChildren(...w.gifts.map((g) => h('button', { type: 'button', class: 'gift', dataset: { coins: g.coins }, 'aria-label': `${g.name}, ${coinsLabel(g.coins)}`, onclick: async (e) => {
      const btn = e.currentTarget;
      if (g.coins > coins) return toast(`Il te faut ${coinsLabel(g.coins)} pour offrir ${g.name} : recharge ton portefeuille.`, 'error');
      btn.disabled = true;
      try {
        const r = await api.post(`/api/live/${liveId}/gift`, { gift: g.id, count: 1 });
        coins = r.coins;
        paintBalance();
        if (store.user) store.user.coins = r.coins;
        onSent?.(g);
      } catch (err) {
        toast(err.code === 'NO_COINS' ? 'Pas assez de pièces : recharge ton portefeuille.' : err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    } }, h('span', { class: 'gift-emoji' }, g.emoji), h('b', null, g.name), h('small', null, icon('coin', 'icon-xs'), num(g.coins)))));
    paintBalance();
  }).catch((err) => grid.replaceChildren(emptyState('alert', 'Cadeaux indisponibles', err.message)));
  openSheet({ title: 'Cadeaux', body: h('div', { class: 'gifts' }, h('div', { class: 'gift-balance' }, icon('coin'), balance, unit, h('a', { href: `/portefeuille?suite=${enc(back)}`, class: 'btn btn-primary btn-sm', onclick: () => closeSheet() }, 'Recharger')), grid) });
}

// ---------------------------------------------------------------------------
// Écran d'un direct
// ---------------------------------------------------------------------------
export async function liveRoomView(ctx) {
  const username = ctx.params.username;
  const mine = store.user && store.user.username.toLowerCase() === username.toLowerCase();
  document.documentElement.classList.add('feed-mode');
  ctx.onCleanup(() => document.documentElement.classList.remove('feed-mode'));
  if (mine) return hostView(ctx);
  return viewerView(ctx, username);
}

function topBar(host, viewersEl, extra = []) {
  return h('header', { class: 'live-top' },
    h('a', { href: `/@${enc(host.username)}`, class: 'live-host' }, avatar(host, 'sm'), h('span', null, h('b', null, host.displayName, host.verified ? verifiedMark() : null), viewersEl)),
    ...extra);
}

async function viewerView(ctx, username) {
  let data;
  try {
    data = await api.get(`/api/live/user/${enc(username)}`);
  } catch (err) {
    ctx.title = 'LIVE — AURUM';
    const closeX = h('button', { type: 'button', class: 'icon-btn live-close live-ended-close', 'aria-label': 'Fermer', onclick: () => (history.length > 1 ? history.back() : navigate('/live')) }, icon('x'));
    const body = err.code === 'USER_NOT_FOUND'
      ? emptyState('user', 'Ce compte est introuvable', 'Le lien est peut-être incomplet, ou le compte a été supprimé.')
      : err.code === 'NOT_LIVE'
        ? emptyState('live', `@${username} n’est pas en LIVE`, 'Abonne-toi pour être prévenu de son prochain LIVE.', h('a', { href: `/@${enc(username)}`, class: 'btn btn-primary' }, 'Voir le profil'))
        : emptyState('live', 'LIVE indisponible', err.message);
    return h('div', { class: 'live-room ended' }, closeX, h('div', { class: 'live-ended' }, body, h('a', { href: '/live', class: 'link-btn' }, 'Autres LIVE')));
  }
  const live = data.live;
  ctx.title = `${live.host.displayName} en LIVE — AURUM`;
  const video = h('video', { class: 'live-video', autoplay: true, playsinline: true, 'webkit-playsinline': '' });
  video.playsInline = true;
  // Le son du LIVE remplace l'épisode de podcast en cours
  video.addEventListener('playing', () => !video.muted && document.dispatchEvent(new CustomEvent('vibz:sound')));
  const status = h('div', { class: 'live-status' }, spinner(), h('span', null, 'Connexion au LIVE…'));
  // Compteur affiché après sa propre arrivée (sinon « 0 spectateur » pendant la connexion)
  const viewersEl = h('small', null, live.viewers ? viewersLabel(live.viewers) : '');
  const chat = chatFeed();
  const unmute = h('button', { type: 'button', class: 'feed-unmute', hidden: true, onclick: () => { video.muted = false; unmute.hidden = true; video.play().catch(() => {}); } }, icon('mute', 'icon-sm'), 'Activer le son');
  let following = live.following;
  const followBtn = h('button', { type: 'button', class: 'btn btn-primary btn-sm live-follow', hidden: following });
  followBtn.textContent = 'Suivre';
  followBtn.addEventListener('click', async () => {
    const u = await follow(live.host.username, true);
    if (!u) return;
    following = true;
    followBtn.hidden = true;
    api.post(`/api/live/${live.id}/event`, { type: 'follow' }).catch(() => {});
  });
  const close = h('button', { type: 'button', class: 'icon-btn live-close', 'aria-label': 'Quitter le LIVE', onclick: () => (history.length > 1 ? history.back() : navigate('/live')) }, icon('x'));
  const more = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Signaler ce LIVE', onclick: () => !needLogin('Connecte-toi pour signaler.') && reportDialog('live', live.id, 'Signaler ce LIVE') }, icon('flag'));
  const input = h('input', { class: 'live-input', type: 'text', maxlength: 150, placeholder: store.user ? 'Commenter…' : 'Connecte-toi pour commenter', 'aria-label': 'Commenter le LIVE', enterkeyhint: 'send' });
  const form = h('form', { class: 'live-form', onsubmit: async (e) => {
    e.preventDefault();
    if (needLogin('Connecte-toi pour commenter.')) return;
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    try {
      await api.post(`/api/live/${live.id}/comment`, { body });
      pollNow();
    } catch (err) {
      // Refusé : le texte revient dans le champ, pour être corrigé
      if (!input.value) input.value = body;
      toast(err.message, 'error');
    }
  } }, input);
  input.addEventListener('focus', () => needLogin('Connecte-toi pour commenter.') && input.blur());
  let pendingLikes = 0;
  const sentLikes = []; // envois d'un visiteur (sans compte) : ses cœurs sont déjà affichés
  const heartBtn = h('button', { type: 'button', class: 'live-act', 'aria-label': 'Envoyer des cœurs', onclick: () => { pendingLikes++; chat.floatHeart(); } }, icon('heart-fill'));
  const giftBtn = h('button', { type: 'button', class: 'live-act', 'aria-label': 'Cadeaux', onclick: () => !needLogin('Connecte-toi pour offrir des cadeaux.') && giftSheet(live.id, () => pollNow(), `/live/${live.host.username}`) }, icon('gift'));
  const shareBtn = h('button', { type: 'button', class: 'live-act', 'aria-label': 'Partager', onclick: async () => { await shareLink(`${live.host.displayName} est en LIVE sur AURUM`, `/live/${enc(live.host.username)}`); if (store.user) api.post(`/api/live/${live.id}/event`, { type: 'share' }).catch(() => {}); } }, icon('shareFill'));
  const root = h('div', { class: 'live-room' },
    video, status, unmute, chat.gifts, chat.hearts,
    topBar(live.host, viewersEl, [followBtn, h('span', { class: 'grow' }), h('span', { class: 'live-badge' }, 'LIVE'), more, close]),
    h('footer', { class: 'live-bottom' }, h('div', { class: 'live-title' }, live.title || ''), chat.list, h('div', { class: 'live-bar' }, form, giftBtn, shareBtn, heartBtn)));

  // Connexion WebRTC (refaite automatiquement en cas de coupure)
  let peer = null;
  let pc = null;
  let after = 0;
  let ended = false;
  let destroyed = false;
  let awaitingAnswer = false;
  let retryTimer = 0;
  let pollTimer = 0;
  async function connect() {
    if (destroyed || ended) return;
    clearTimeout(retryTimer);
    pc?.close();
    try {
      const j = await api.post(`/api/live/${live.id}/join`, peer ? { peer } : {});
      peer = j.peer;
      if (!after) {
        for (const e of j.recent) chat.show(e);
        after = j.recent[j.recent.length - 1]?.id || 0;
      }
      pc = new RTCPeerConnection({ iceServers: j.iceServers });
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });
      pc.ontrack = (e) => {
        const stream = e.streams[0] || new MediaStream([e.track]);
        if (video.srcObject !== stream) video.srcObject = stream;
        video.play().catch(() => {
          video.muted = true;
          unmute.hidden = false;
          video.play().catch(() => {});
        });
      };
      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (s === 'connected') status.hidden = true;
        if (s === 'failed') {
          status.hidden = false;
          status.replaceChildren(spinner(), h('span', null, 'Reconnexion…'));
          retryTimer = setTimeout(connect, 2000);
        }
        if (s === 'disconnected') {
          status.hidden = false;
          status.replaceChildren(spinner(), h('span', null, 'Reconnexion…'));
          retryTimer = setTimeout(() => pc.connectionState !== 'connected' && connect(), 6000);
        }
      };
      await pc.setLocalDescription(await pc.createOffer());
      await waitIce(pc);
      await api.post(`/api/live/${live.id}/offer`, { peer, sdp: pc.localDescription.sdp });
      awaitingAnswer = true;
      // Pas de réponse au bout de 15 s : nouvelle tentative
      retryTimer = setTimeout(() => awaitingAnswer && connect(), 15000);
    } catch (err) {
      if (err.code === 'LIVE_FULL' || err.code === 'LIVE_ENDED') {
        status.replaceChildren(h('span', null, err.message));
        if (err.code === 'LIVE_ENDED') showEnded();
        return;
      }
      retryTimer = setTimeout(connect, 4000);
    }
  }
  function showEnded() {
    ended = true;
    pc?.close();
    status.hidden = true;
    unmute.hidden = true;
    root.classList.add('ended');
    root.append(h('div', { class: 'live-ended' }, h('h2', null, 'Le LIVE est terminé'), avatar(live.host, 'xl'), h('b', null, live.host.displayName), !following ? h('button', { type: 'button', class: 'btn btn-primary', onclick: () => followBtn.click() }, 'Suivre') : null, h('a', { href: `/@${enc(live.host.username)}`, class: 'btn btn-ghost' }, 'Voir le profil'), h('a', { href: '/live', class: 'link-btn' }, 'Autres LIVE')));
  }
  async function poll() {
    if (destroyed || ended) return;
    try {
      const likes = pendingLikes;
      pendingLikes = 0;
      if (likes) {
        if (!store.user) sentLikes.push(likes);
        api.post(`/api/live/${live.id}/like`, { count: likes }).catch(() => {});
      }
      const d = await api.get(`/api/live/${live.id}/poll?peer=${peer || ''}&after=${after}`);
      if (d.answer && pc && pc.signalingState === 'have-local-offer') {
        awaitingAnswer = false;
        clearTimeout(retryTimer);
        await pc.setRemoteDescription({ type: 'answer', sdp: d.answer });
      }
      for (const e of d.events) {
        after = Math.max(after, e.id);
        // Ses propres cœurs sont déjà affichés (avec un compte : par l'identifiant ; sans : par l'envoi)
        if (e.type === 'like' && e.user && e.user.id === store.user?.id) continue;
        if (e.type === 'like' && !e.user && !store.user) {
          const i = sentLikes.indexOf(e.count);
          if (i >= 0) {
            sentLikes.splice(i, 1);
            continue;
          }
        }
        chat.show(e);
      }
      viewersEl.textContent = viewersLabel(d.viewers);
      if (d.ended) return showEnded();
    } catch {
      /* nouvel essai au prochain tour */
    }
    pollTimer = setTimeout(poll, document.hidden ? 4000 : 1300);
  }
  const pollNow = () => {
    clearTimeout(pollTimer);
    poll();
  };
  connect().then(poll);
  const leave = () => {
    if (!peer) return;
    const body = JSON.stringify({ peer });
    if (navigator.sendBeacon?.(`/api/live/${live.id}/leave`, new Blob([body], { type: 'application/json' }))) return;
    fetch(`/api/live/${live.id}/leave`, { method: 'POST', headers: { 'x-vibz': '1', 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  };
  addEventListener('pagehide', leave);
  ctx.onCleanup(() => {
    destroyed = true;
    clearTimeout(retryTimer);
    clearTimeout(pollTimer);
    removeEventListener('pagehide', leave);
    leave();
    pc?.close();
    video.srcObject = null;
  });
  return root;
}

// ---------------------------------------------------------------------------
// Studio du créateur
// ---------------------------------------------------------------------------
async function hostView(ctx) {
  ctx.title = 'Passer en LIVE — AURUM';
  const me = store.user;
  const video = h('video', { class: 'live-video mirror', autoplay: true, muted: true, playsinline: true });
  video.muted = true;
  video.playsInline = true;
  let stream = null;
  let facing = 'user';
  const status = h('div', { class: 'live-status' }, spinner(), h('span', null, 'Ouverture de la caméra…'));
  async function openCamera() {
    stream?.getTracks().forEach((t) => t.stop());
    try {
      // Format demandé « à l'horizontale » : téléphone tenu droit, l'image arrive en portrait et entière
      // (demandée en portrait, Safari sur iPhone n'en gardait que le centre, beaucoup trop zoomé)
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: { echoCancellation: true, noiseSuppression: true } });
      // Micro coupé : il le reste avec la nouvelle caméra (sinon les spectateurs entendraient tout)
      stream.getAudioTracks().forEach((t) => (t.enabled = micOn));
      video.srcObject = stream;
      video.classList.toggle('mirror', facing === 'user');
      status.hidden = true;
      // Connexions déjà ouvertes : la nouvelle caméra remplace l'ancienne
      for (const pc of peers.values()) {
        for (const sender of pc.getSenders()) {
          const track = stream.getTracks().find((t) => t.kind === sender.track?.kind);
          if (track) sender.replaceTrack(track).catch(() => {});
        }
      }
      return true;
    } catch (err) {
      status.hidden = false;
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      status.replaceChildren(icon('videoOff'), h('span', null, err?.name === 'NotAllowedError' ? (ios ? 'Autorise la caméra et le micro : Réglages de l’iPhone → Safari → Caméra et Micro, puis recharge la page.' : 'Autorise la caméra et le micro (icône à gauche de l’adresse), puis recharge la page.') : 'Caméra introuvable sur cet appareil.'));
      toast(err?.name === 'NotAllowedError' ? 'Accès à la caméra refusé' : 'Caméra introuvable', 'error');
      return false;
    }
  }
  const peers = new Map();
  let live = null;
  let iceServers = [];
  let after = 0;
  let pollTimer = 0;
  let clockTimer = 0;
  let destroyed = false;
  const chat = chatFeed();
  const viewersEl = h('small', { hidden: true }, '');
  const statsEl = h('span', { class: 'live-stats' });
  const clock = h('span', { class: 'live-clock' }, '0:00');
  const title = h('input', { class: 'input live-title-input', maxlength: 80, placeholder: 'Ajoute un titre à ton LIVE' });
  const flip = h('button', { type: 'button', class: 'live-tool', 'aria-label': 'Retourner la caméra', onclick: () => { facing = facing === 'user' ? 'environment' : 'user'; openCamera(); } }, icon('flip'), h('small', null, 'Retourner'));
  let micOn = true;
  const mic = h('button', { type: 'button', class: 'live-tool', 'aria-label': 'Micro', onclick: () => { micOn = !micOn; stream?.getAudioTracks().forEach((t) => (t.enabled = micOn)); mic.replaceChildren(icon(micOn ? 'mic' : 'micOff'), h('small', null, micOn ? 'Micro' : 'Muet')); } }, icon('mic'), h('small', null, 'Micro'));
  const startBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg live-go' }, 'Passer en LIVE');
  const endBtn = h('button', { type: 'button', class: 'btn btn-danger btn-sm', hidden: true }, 'Terminer');
  // Pendant le LIVE, quitter l'écran termine le direct : on le demande d'abord
  const leaveRoom = () => (history.length > 1 ? history.back() : navigate('/live'));
  const close = h('button', { type: 'button', class: 'icon-btn live-close', 'aria-label': 'Fermer', onclick: async () => {
    if (live && !(await confirmDialog('Terminer le LIVE ?', 'Quitter cet écran termine le direct pour tous tes spectateurs.', 'Terminer'))) return;
    if (live) await finish({ silent: true });
    leaveRoom();
  } }, icon('x'));
  const setup = h('div', { class: 'live-setup' }, h('div', { class: 'live-setup-who' }, avatar(me, 'md'), h('b', null, me.displayName)), title, h('p', { class: 'muted small' }, 'Tes abonnés seront prévenus dès que tu passes en LIVE. Les spectateurs reçoivent l’image directement depuis ton appareil.'), startBtn);
  const hostTop = h('header', { class: 'live-top' }, h('span', { class: 'live-host' }, avatar(me, 'sm'), h('span', null, h('b', null, me.displayName), viewersEl)), h('span', { class: 'grow' }), h('span', { class: 'live-badge', hidden: true }, 'LIVE'), clock, endBtn, close);
  clock.hidden = true;
  const root = h('div', { class: 'live-room host' }, video, status, chat.gifts, chat.hearts, hostTop,
    h('div', { class: 'live-tools' }, flip, mic),
    h('footer', { class: 'live-bottom' }, chat.list, statsEl),
    setup);

  async function answer(offer) {
    try {
      const pc = new RTCPeerConnection({ iceServers });
      peers.get(offer.peer)?.close();
      peers.set(offer.peer, pc);
      for (const t of stream.getTracks()) pc.addTrack(t, stream);
      pc.onconnectionstatechange = () => {
        if (['failed', 'closed'].includes(pc.connectionState)) {
          pc.close();
          if (peers.get(offer.peer) === pc) peers.delete(offer.peer);
        }
      };
      await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await waitIce(pc);
      await api.post(`/api/live/${live.id}/answer`, { peer: offer.peer, sdp: pc.localDescription.sdp });
    } catch (err) {
      console.warn('LIVE : connexion d’un spectateur impossible', err);
    }
  }
  async function poll() {
    if (destroyed || !live) return;
    try {
      const d = await api.get(`/api/live/${live.id}/host?after=${after}`);
      for (const o of d.offers) answer(o);
      for (const p of d.gone) {
        peers.get(p)?.close();
        peers.delete(p);
      }
      for (const e of d.events) {
        chat.show(e);
        after = Math.max(after, e.id);
      }
      viewersEl.textContent = viewersLabel(d.viewers);
      statsEl.replaceChildren(h('span', null, icon('heart-fill', 'icon-xs'), short(d.likes)), h('span', null, icon('diamond', 'icon-xs'), short(d.diamonds)));
    } catch (err) {
      if (err.code === 'LIVE_ENDED') return finish();
    }
    pollTimer = setTimeout(poll, 1000);
  }
  startBtn.addEventListener('click', async () => {
    if (!stream && !(await openCamera())) return;
    startBtn.disabled = true;
    try {
      const r = await api.post('/api/live', { title: title.value.trim() });
      live = r.live;
      iceServers = r.iceServers;
      setup.remove();
      endBtn.hidden = false;
      hostTop.querySelector('.live-badge').hidden = false;
      clock.hidden = false;
      viewersEl.hidden = false;
      viewersEl.textContent = viewersLabel(0);
      const t0 = Date.now();
      clockTimer = setInterval(() => (clock.textContent = duration((Date.now() - t0) / 1000)), 1000);
      toast('Tu es en LIVE !');
      poll();
    } catch (err) {
      startBtn.disabled = false;
      toast(err.message, 'error');
    }
  });
  async function finish({ silent = false } = {}) {
    clearTimeout(pollTimer);
    clearInterval(clockTimer);
    for (const pc of peers.values()) pc.close();
    peers.clear();
    let summary = null;
    if (live) summary = (await api.post(`/api/live/${live.id}/end`).catch(() => null))?.summary;
    live = null;
    stream?.getTracks().forEach((t) => t.stop());
    if (silent) return;
    root.classList.add('ended');
    root.append(h('div', { class: 'live-ended' }, h('h2', null, 'LIVE terminé'),
      summary ? h('div', { class: 'kpis small' },
        h('div', { class: 'kpi' }, h('small', null, 'Durée'), h('b', null, duration(summary.duration / 1000))),
        h('div', { class: 'kpi' }, h('small', null, 'Spectateurs'), h('b', null, short(summary.viewersTotal)), h('span', null, `max ${short(summary.peakViewers)} à la fois`)),
        h('div', { class: 'kpi' }, h('small', null, 'Cœurs'), h('b', null, short(summary.likes))),
        h('div', { class: 'kpi' }, h('small', null, 'Diamants'), h('b', null, short(summary.diamonds))),
        h('div', { class: 'kpi' }, h('small', null, 'Nouveaux abonnés'), h('b', null, short(summary.newFollowers)))) : null,
      h('a', { href: '/studio', class: 'btn btn-ghost' }, 'Studio créateur'), h('a', { href: '/', class: 'btn btn-primary' }, 'Retour à l’accueil')));
  }
  endBtn.addEventListener('click', async () => {
    if (await confirmDialog('Terminer le LIVE ?', 'Tes spectateurs verront la fin du direct.', 'Terminer')) finish();
  });
  const endOnLeave = () => live && fetch(`/api/live/${live.id}/end`, { method: 'POST', headers: { 'x-vibz': '1' }, keepalive: true }).catch(() => {});
  addEventListener('pagehide', endOnLeave);
  ctx.onCleanup(() => {
    destroyed = true;
    removeEventListener('pagehide', endOnLeave);
    if (live) endOnLeave();
    clearTimeout(pollTimer);
    clearInterval(clockTimer);
    for (const pc of peers.values()) pc.close();
    stream?.getTracks().forEach((t) => t.stop());
  });
  openCamera();
  // Déjà en LIVE sur un autre appareil : on le dit avant de proposer d'en lancer un ici
  api.get(`/api/live/user/${enc(me.username)}`).then(() => {
    if (destroyed || live) return;
    startBtn.textContent = 'Reprendre le LIVE ici';
    setup.querySelector('.muted')?.replaceWith(h('p', { class: 'live-elsewhere' }, icon('info', 'icon-sm'), 'Tu es déjà en LIVE sur un autre appareil. Le reprendre ici le terminera là-bas.'));
  }).catch(() => {});
  return root;
}
