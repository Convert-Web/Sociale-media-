// Créer : caméra (15 s, 60 s, 3 min, en plusieurs prises, minuteur, filtres, flash, son ajouté),
// import depuis l'appareil, Duo, Stitch, mode Photo et mode Texte ; puis montage (textes,
// autocollants, filtre, son, volumes), couverture, description, confidentialité, brouillon,
// et publication en arrière-plan (l'envoi continue pendant que l'on regarde des vidéos).
import { api, enc } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { h, icon, avatar, toast, spinner, emptyState, short, duration, shrinkImage, confirmDialog, timeAgo, debounce } from '../dom.js';
import { openSheet, closeSheet } from '../components/sheet.js';
import { readVideoInfo, isVideoFile, maxSeconds, reportImportIssue } from '../components/video.js';
import { sendInBackground } from '../components/uploads.js';
import { FILTERS, filterCss, fxLayer, paintOverlays, overlayEl, fitFor, TEXT_COLORS, STICKERS } from '../components/fx.js';
import { recorderMime, extFor, loadVideoBlob, mixSound, duet as composeDuet, stitch as composeStitch, frameAt, mediaFor, onScreen } from '../components/compose.js';
import { attachMentions } from '../components/mentions.js';
import { toggle, PRIVACY } from '../components/postedit.js';
import { saveDraft, listDrafts, deleteDraft, getDraft, countDrafts } from '../drafts.js';

const BGS = ['violet', 'rose', 'ocean', 'soleil', 'menthe', 'nuit', 'feu', 'ciel'];
const MAX_PHOTOS = 20;

// Dernière caméra utilisée (avant ou arrière) : retrouvée à la prochaine ouverture
const FACING = 'vibz:camera';
function savedFacing() {
  try {
    return localStorage.getItem(FACING) === 'environment' ? 'environment' : 'user';
  } catch {
    return 'user';
  }
}
function saveFacing(v) {
  try {
    localStorage.setItem(FACING, v);
  } catch {
    /* navigation privée : sans importance */
  }
}

// ---------------------------------------------------------------------------
// Choisir un son (populaires, favoris, recherche ; écoute avant de choisir)
// ---------------------------------------------------------------------------
export function pickSound(onPick) {
  const audio = new Audio();
  let playing = null;
  let tab = 'popular';
  const list = h('div', { class: 'sound-list' }, spinner());
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Rechercher un son' });
  const tabs = h('div', { class: 'tabs' });
  const paintTabs = () => tabs.replaceChildren(...[['popular', 'Populaires'], ['favorites', 'Favoris']].map(([k, l]) => h('button', { type: 'button', class: `tab-link${k === tab ? ' on' : ''}`, onclick: () => { tab = k; paintTabs(); load(); } }, l)));
  const load = async () => {
    list.replaceChildren(spinner());
    try {
      const { sounds } = await api.get(`/api/sounds?tab=${tab}${search.value.trim() ? `&q=${enc(search.value.trim())}` : ''}`);
      list.replaceChildren(...(sounds.length ? sounds.map((s) => {
        const play = h('button', { type: 'button', class: 'sound-play small', 'aria-label': 'Écouter' }, icon('play'));
        play.addEventListener('click', () => {
          if (playing === s.id) {
            audio.pause();
            playing = null;
            play.replaceChildren(icon('play'));
            return;
          }
          list.querySelectorAll('.sound-play').forEach((b) => b.replaceChildren(icon('play')));
          audio.src = s.url;
          audio.play().catch(() => {});
          playing = s.id;
          play.replaceChildren(icon('pause'));
        });
        return h('div', { class: 'sound-row' }, h('span', { class: 'sound-cover' }, s.cover ? h('img', { src: s.cover, alt: '' }) : icon('music'), play), h('span', { class: 'sound-text' }, h('b', null, s.title), h('small', null, `${s.author?.displayName || ''} · ${short(s.uses)} vidéo${s.uses > 1 ? 's' : ''}${s.duration ? ` · ${duration(s.duration)}` : ''}`)), h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => { audio.pause(); closeSheet(); onPick(s); } }, 'Utiliser'));
      }) : [emptyState('music', tab === 'favorites' ? 'Aucun son favori' : 'Aucun son trouvé', tab === 'favorites' ? 'Ajoute des sons à tes favoris depuis leur page.' : 'Publie une vidéo : son son original pourra être réutilisé.')]));
    } catch (err) {
      list.replaceChildren(emptyState('alert', 'Sons indisponibles', err.message));
    }
  };
  search.addEventListener('input', debounce(load, 250));
  paintTabs();
  load();
  openSheet({ title: 'Ajouter un son', body: h('div', { class: 'sound-picker' }, search, tabs, list), tall: true, onClose: () => audio.pause() });
}

// ---------------------------------------------------------------------------
// L'écran de création
// ---------------------------------------------------------------------------
export async function createView(ctx) {
  ctx.title = 'Créer — AURUM';
  const q = ctx.query;
  const me = store.user;
  const S = {
    mode: 'video',
    maxDur: Math.min(60, maxSeconds()),
    sound: null,
    soundBaked: false,
    source: null, // vidéo d'origine (Duo ou Stitch)
    kind: q.get('duo') ? 'duet' : q.get('stitch') ? 'stitch' : null,
    sourceBlob: null,
    stitchFrom: 0,
    stitchLen: 5,
    file: null,
    info: null,
    fx: { filter: '', overlays: [] },
    volumes: { original: 1, sound: 1 },
    photos: [],
    bg: 'violet',
    body: q.get('tag') ? `#${q.get('tag')} ` : '',
    privacy: 'public',
    allowComments: true,
    allowDuet: true,
    allowStitch: true,
    allowDownload: true,
    category: '',
    cover: null,
    coverAt: 0.5,
    draftId: null,
    actu: null, // actualité à laquelle la vidéo réagit (« Réagir en vidéo » depuis l'Actu)
  };
  const root = h('div', { class: 'create' });
  document.documentElement.classList.add('feed-mode');
  let cleanupStep = () => {};
  const setStep = (el, cleanup = () => {}) => {
    cleanupStep();
    cleanupStep = cleanup;
    root.replaceChildren(el);
  };
  ctx.onCleanup(() => {
    cleanupStep();
    document.documentElement.classList.remove('feed-mode');
  });
  const leave = async () => {
    if (S.filming && !S.file && !(await confirmDialog('Abandonner ?', 'Ce que tu as filmé sera perdu.', 'Abandonner'))) return;
    if ((S.file || S.photos.length) && !(await confirmDialog('Abandonner ?', 'Ta vidéo et tes modifications seront perdues (sauf si tu les gardes en brouillon).', 'Abandonner'))) return;
    history.length > 1 ? history.back() : navigate('/');
  };

  // « Réagir en vidéo » : l'actualité accompagne la publication
  if (q.get('actu')) {
    try {
      const { item } = await api.get(`/api/actu/${Number(q.get('actu'))}`);
      S.actu = { id: item.id, title: item.title, siteName: item.siteName, kind: item.kind };
      if (!S.body) S.body = '#actu ';
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  // Son choisi d'avance (« Utiliser ce son »)
  if (q.get('son')) {
    try {
      const { sound } = await api.get(`/api/sounds/${Number(q.get('son'))}`);
      if (sound.url) S.sound = sound;
      else toast('Ce son n’est plus disponible.', 'error');
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  // Brouillon repris
  if (q.get('brouillon')) {
    const d = await getDraft(Number(q.get('brouillon'))).catch(() => null);
    if (d) {
      Object.assign(S, d.meta || {});
      S.draftId = d.id;
      S.body = d.body || '';
      if (d.video) {
        S.file = new File([d.video.blob], d.video.name, { type: d.video.type });
        S.info = await readVideoInfo(S.file, { knownDuration: d.video.duration }).catch(() => null);
        if (S.info && d.video.poster) S.info.poster = d.video.poster;
      }
      if (d.photos?.length) S.photos = d.photos.map((p) => new File([p.blob], p.name, { type: p.type }));
    }
  }
  // Duo ou Stitch : la vidéo d'origine est téléchargée d'abord
  if (S.kind) {
    const id = Number(q.get(S.kind === 'duet' ? 'duo' : 'stitch'));
    const wait = h('div', { class: 'create-wait' }, spinner(), h('p', null, 'Chargement de la vidéo d’origine…'));
    root.append(wait);
    try {
      const { post } = await api.get(`/api/posts/${id}`);
      if (S.kind === 'duet' ? !post.allowDuet : !post.allowStitch) throw new Error(S.kind === 'duet' ? 'Cette vidéo n’autorise pas les Duos.' : 'Cette vidéo n’autorise pas les Stitchs.');
      S.source = post;
      S.sourceBlob = await loadVideoBlob(post.video, (p) => (wait.lastChild.textContent = `Chargement de la vidéo d’origine… ${Math.round(p * 100)} %`));
      S.maxDur = S.kind === 'duet' ? Math.min(maxSeconds(), post.video.duration || 60) : Math.min(60, maxSeconds());
    } catch (err) {
      return h('div', { class: 'create' }, h('div', { class: 'create-wait' }, emptyState('alert', 'Impossible', err.message, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => history.back() }, 'Retour'))));
    }
  }

  // =========================================================================
  // 1. Caméra
  // =========================================================================
  function captureStep() {
    let videoTrack = null; // l'image de la caméra
    let micTrack = null; // le micro : gardé quand on change de caméra ou d'objectif
    let facing = savedFacing();
    let lens = 'main'; // objectif arrière : « main » (1×) ou « ultra » (ultra grand-angle, 0,5×)
    let lenses = null; // objectifs trouvés sur l'appareil (connus après l'autorisation)
    let hwZoom = null; // zoom de la caméra elle-même, quand le navigateur le propose
    let zoom = 1; // zoom affiché : 0,5×, 1×, 2×…
    let digital = 1; // part du zoom faite en agrandissant l'image (aperçu et vidéo enregistrée)
    let drawRec = null; // enregistrement à travers un canevas : zoom, changement de caméra entre deux prises
    let opening = 0;
    let closed = false;
    let rec = null;
    let chunks = [];
    let recording = false;
    let elapsed = 0;
    let since = 0;
    let tick = 0;
    let timerSec = 0;
    let micOn = !S.sound;
    let torch = false;
    let ac = null;
    let soundEl = null;
    let origEl = null;
    const marks = [];
    const preview = h('video', { class: 'cam-video mirror', autoplay: true, muted: true, playsinline: true });
    preview.muted = true;
    preview.playsInline = true;
    // L'aperçu garde le format réel de l'image (comme l'appareil photo de l'iPhone) : ce qu'on voit
    // est exactement ce qui est filmé
    const paintAspect = () => preview.videoWidth && preview.videoHeight && el.style.setProperty('--cam-ar', (preview.videoWidth / preview.videoHeight).toFixed(4));
    preview.addEventListener('loadedmetadata', paintAspect);
    preview.addEventListener('resize', paintAspect);
    const camFrame = h('div', { class: 'cam-frame' }, preview);
    const camBox = h('div', { class: `cam-box${S.kind === 'duet' ? ' duet' : ''}` }, camFrame);
    if (S.kind === 'duet') {
      origEl = onScreen(mediaFor(S.sourceBlob));
      origEl.className = 'cam-orig';
      camBox.append(origEl);
    }
    const status = h('div', { class: 'cam-status', hidden: true });
    const bar = h('div', { class: 'cam-progress' }, h('i'));
    const timeEl = h('div', { class: 'cam-time' });
    const countdown = h('div', { class: 'cam-countdown', hidden: true, 'data-hint': 'Toucher pour annuler' });
    let countdownTimer = 0;
    const cancelCountdown = () => {
      clearInterval(countdownTimer);
      countdownTimer = 0;
      countdown.hidden = true;
    };
    countdown.addEventListener('click', cancelCountdown);
    const paintBar = () => {
      S.filming = elapsed > 0;
      const p = Math.min(1, elapsed / S.maxDur);
      bar.firstChild.style.transform = `scaleX(${p})`;
      bar.querySelectorAll('.mark').forEach((m) => m.remove());
      for (const m of marks) bar.append(h('span', { class: 'mark', style: { left: `${(m / S.maxDur) * 100}%` } }));
      timeEl.textContent = elapsed ? `${duration(elapsed)} / ${duration(S.maxDur)}` : '';
      doneBtn.hidden = elapsed < 1 || recording;
      redoBtn.hidden = !elapsed || recording;
      modeTabs.hidden = Boolean(elapsed) || Boolean(S.kind);
      side.classList.toggle('busy', recording);
    };
    const applyFilter = () => (preview.style.filter = filterCss(S.fx.filter));

    async function openCamera({ zoomTo } = {}) {
      const my = ++opening;
      videoTrack?.stop();
      videoTrack = null;
      try {
        const video = {
          // Format demandé « à l'horizontale » (1920 × 1080) : téléphone tenu droit, l'image arrive en
          // portrait et entière. Demandée en portrait (1080 × 1920), Safari sur iPhone n'en gardait que
          // le centre : une image beaucoup trop zoomée.
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
          zoom: true, // Chrome : donne accès au zoom de la caméra
          ...(lens === 'ultra' && lenses?.ultra ? { deviceId: { exact: lenses.ultra.deviceId } } : { facingMode: facing }),
        };
        const s = await navigator.mediaDevices.getUserMedia({ video, audio: micTrack ? false : { echoCancellation: true, noiseSuppression: true } });
        if (my !== opening || closed) return s.getTracks().forEach((t) => t.stop());
        videoTrack = s.getVideoTracks()[0];
        if (!micTrack) micTrack = s.getAudioTracks()[0] || null;
        preview.srcObject = new MediaStream([videoTrack]);
        preview.classList.toggle('mirror', facing === 'user');
        status.hidden = true;
        recordBtn.disabled = false;
        const caps = videoTrack.getCapabilities?.() || {};
        hwZoom = caps.zoom && caps.zoom.max > caps.zoom.min ? caps.zoom : null;
        flashBtn.hidden = !caps.torch;
        torch = false;
        flashBtn.classList.remove('on');
        if (!lenses) lenses = await findLenses();
        setZoom(zoomTo ?? (lens === 'ultra' ? 0.5 : 1));
      } catch (err) {
        if (my !== opening || closed) return;
        // Objectif ultra grand-angle indisponible : retour au 1×
        if (lens === 'ultra') {
          lens = 'main';
          return openCamera();
        }
        status.hidden = false;
        recordBtn.disabled = true;
        status.replaceChildren(icon('videoOff'), h('p', null, err?.name === 'NotAllowedError' ? 'Autorise la caméra et le micro pour filmer, ou importe une vidéo.' : 'Aucune caméra disponible : importe une vidéo depuis ton appareil.'), h('button', { type: 'button', class: 'btn btn-primary', onclick: () => fileInput.click() }, 'Importer'));
      }
    }

    // iPhone : chaque objectif arrière est une caméra à part (« … ultra grand-angle », « … Ultra Wide »).
    // Les caméras « doubles » ou « triples », qui changent d'objectif toutes seules, sont écartées.
    async function findLenses() {
      try {
        const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.label);
        const ultra = cams.find((d) => /ultra/i.test(d.label) && !/dual|double|triple|front|avant/i.test(d.label));
        return { ultra: ultra || null };
      } catch {
        return { ultra: null };
      }
    }

    // ---- Zoom, comme sur l'iPhone : 0,5× (ultra grand-angle), 1×, 2×, et pincer pour ajuster ----
    // Zoom de la caméra quand le navigateur le permet (Chrome sur Android), sinon zoom numérique :
    // l'aperçu est agrandi au centre et la vidéo enregistrée l'est de la même façon (voir drawFrame).
    const canDraw = typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
    const lensBase = () => (lens === 'ultra' ? 0.5 : 1);
    const zoomMax = () => {
      if (!hwZoom && !canDraw) return lensBase();
      if (lens === 'ultra') return 1; // au-delà, l'objectif principal prend le relais
      return hwZoom ? Math.min(hwZoom.max / hwZoom.min, 10) : 3;
    };
    let hwBusy = false;
    let hwWant = null;
    async function hwApply(value) {
      hwWant = value;
      if (hwBusy) return;
      hwBusy = true;
      while (hwWant !== null) {
        const z = hwWant;
        hwWant = null;
        try {
          await videoTrack?.applyConstraints({ advanced: [{ zoom: z }] });
        } catch {
          /* zoom refusé par la caméra : le précédent reste */
        }
      }
      hwBusy = false;
    }
    function setZoom(z) {
      const base = lensBase();
      zoom = Math.min(zoomMax(), Math.max(base, z));
      const rel = zoom / base;
      if (hwZoom) {
        digital = 1;
        hwApply(Math.min(hwZoom.max, hwZoom.min * rel));
      } else digital = rel;
      preview.style.setProperty('--zoom', digital.toFixed(3));
      paintZoom();
    }
    // Changer de caméra ou d'objectif : possible entre deux prises quand la vidéo passe par le canevas
    function canSwitch(what, quiet) {
      const why = recording ? `Mets en pause pour ${what}.` : rec && !drawRec ? `Pour ${what}, fais-le avant de commencer à filmer.` : '';
      if (why && !quiet) toast(why);
      return !why;
    }
    async function switchLens(to, zoomTo, quiet) {
      if (lens === to) return setZoom(zoomTo ?? lensBase());
      if (!canSwitch('changer d’objectif', quiet)) return;
      lens = to;
      await openCamera({ zoomTo });
    }
    function pickZoom(level) {
      if (level === 0.5) return switchLens('ultra', 0.5);
      if (lens === 'ultra') return switchLens('main', level);
      setZoom(level);
    }
    const zoomBar = h('div', { class: 'cam-zoom', role: 'group', 'aria-label': 'Zoom', hidden: true });
    const fmtZoom = (z) => (Math.round(z * 10) / 10).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
    function paintZoom() {
      const levels = [];
      if (facing === 'environment' && lenses?.ultra) levels.push(0.5);
      levels.push(1);
      if (hwZoom || canDraw) levels.push(2);
      const current = levels.filter((l) => l <= zoom + 0.001).pop() ?? levels[0];
      zoomBar.hidden = levels.length < 2;
      zoomBar.replaceChildren(...levels.map((l) => h('button', { type: 'button', class: `cam-zoom-btn${l === current ? ' on' : ''}`, 'aria-label': `Zoom ${fmtZoom(l)}×`, 'aria-pressed': String(l === current), onclick: () => pickZoom(l) }, l === current ? `${fmtZoom(zoom)}×` : fmtZoom(l))));
    }
    // Pincer l'image : zoom continu ; au-delà d'un objectif, l'autre prend le relais (au relâcher)
    let pinch = null;
    const fingers = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
    camBox.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 2 || !videoTrack) return;
      e.preventDefault();
      pinch = { d: fingers(e.touches), z: zoom, want: zoom };
    }, { passive: false });
    camBox.addEventListener('touchmove', (e) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      pinch.want = pinch.z * (fingers(e.touches) / pinch.d);
      setZoom(pinch.want);
    }, { passive: false });
    const endPinch = (e) => {
      if (!pinch || e.touches.length >= 2) return;
      const want = pinch.want;
      pinch = null;
      if (lens === 'ultra' && want >= 0.98) switchLens('main', Math.min(want, 2), true);
      else if (lens === 'main' && want < 0.8 && facing === 'environment' && lenses?.ultra) switchLens('ultra', 0.5, true);
    };
    camBox.addEventListener('touchend', endPinch);
    camBox.addEventListener('touchcancel', endPinch);

    // Vidéo enregistrée à travers un canevas : l'image de la caméra y est recopiée à chaque image,
    // avec le zoom numérique. La vidéo continue d'une prise à l'autre même si l'on change de caméra.
    function drawFrame() {
      const c = drawRec;
      const vw = preview.videoWidth;
      const vh = preview.videoHeight;
      if (!c || !vw || !vh) return;
      const { width: cw, height: ch } = c.canvas;
      const k = Math.max(cw / vw, ch / vh) * digital;
      const sw = cw / k;
      const sh = ch / k;
      c.g.drawImage(preview, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, cw, ch);
    }
    function startDrawing() {
      const c = drawRec;
      if (!c || c.on) return;
      c.on = true;
      const loop = (c.loop || 0) + 1; // une seule boucle à la fois (l'ancienne s'arrête d'elle-même)
      c.loop = loop;
      const step = () => {
        if (!c.on || c.loop !== loop) return;
        drawFrame();
        if (preview.requestVideoFrameCallback && !document.hidden) preview.requestVideoFrameCallback(step);
        else setTimeout(step, 33);
      };
      step();
    }
    const stopDrawing = () => drawRec && (drawRec.on = false);
    // Après un changement de caméra, la boucle reprend sur la nouvelle image
    preview.addEventListener('playing', () => {
      if (drawRec?.on) {
        drawRec.on = false;
        startDrawing();
      }
    });
    function videoForRecorder() {
      if (!canDraw || !preview.videoWidth) return videoTrack;
      const k = Math.min(1, 1920 / Math.max(preview.videoWidth, preview.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round((preview.videoWidth * k) / 2) * 2;
      canvas.height = Math.round((preview.videoHeight * k) / 2) * 2;
      drawRec = { canvas, g: canvas.getContext('2d'), on: false };
      drawFrame();
      return canvas.captureStream(30).getVideoTracks()[0];
    }

    // Flux enregistré : caméra + micro, ou caméra + son ajouté (et le micro si activé)
    function recorderStream() {
      const v = videoForRecorder();
      if (!S.sound) return new MediaStream([v, ...(micTrack ? [micTrack] : [])]);
      ac = ac || new AudioContext();
      const dest = ac.createMediaStreamDestination();
      if (micOn && micTrack) ac.createMediaStreamSource(new MediaStream([micTrack])).connect(dest);
      if (!soundEl) {
        soundEl = mediaFor(S.sound.url, { video: false });
        const src = ac.createMediaElementSource(soundEl);
        src.connect(dest);
        src.connect(ac.destination); // on l'entend pendant le tournage
      }
      return new MediaStream([v, ...dest.stream.getAudioTracks()]);
    }

    function startRec() {
      if (!videoTrack) return;
      if (!rec) {
        const mime = recorderMime();
        if (mime === null) return toast('Ce navigateur ne sait pas enregistrer de vidéo : importe-en une.', 'error');
        chunks = [];
        rec = new MediaRecorder(recorderStream(), { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 128000 });
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        rec.start(1000);
      } else {
        rec.resume();
      }
      ac?.resume();
      soundEl?.play().catch(() => {});
      origEl?.play().catch(() => {});
      startDrawing();
      recording = true;
      since = performance.now();
      recordBtn.classList.add('on');
      tick = setInterval(() => {
        const now = performance.now();
        elapsed += (now - since) / 1000;
        since = now;
        paintBar();
        if (elapsed >= S.maxDur) {
          pauseRec();
          finish();
        }
      }, 100);
      paintBar();
    }
    function pauseRec() {
      if (!recording) return;
      clearInterval(tick);
      elapsed += (performance.now() - since) / 1000;
      rec?.pause();
      stopDrawing();
      soundEl?.pause();
      origEl?.pause();
      recording = false;
      marks.push(elapsed);
      recordBtn.classList.remove('on');
      paintBar();
    }
    async function finish() {
      if (recording) pauseRec();
      if (!rec || elapsed < 1) return;
      const r = rec;
      rec = null;
      const stopped = new Promise((res) => (r.onstop = res));
      r.stop();
      await stopped;
      const type = (r.mimeType || recorderMime() || 'video/webm').split(';')[0];
      const file = new File(chunks, `aurum-${Date.now()}.${extFor(type)}`, { type });
      try {
        const info = await readVideoInfo(file, { knownDuration: elapsed });
        S.file = file;
        S.info = info;
        S.soundBaked = Boolean(S.sound);
        S.camDuration = elapsed;
        editStep();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
    const reset = () => {
      if (recording) pauseRec();
      try {
        rec?.stop();
      } catch {
        /* déjà arrêté */
      }
      rec = null;
      stopDrawing();
      drawRec = null;
      chunks = [];
      elapsed = 0;
      marks.length = 0;
      if (soundEl) soundEl.currentTime = 0;
      if (origEl) origEl.currentTime = 0;
      paintBar();
    };

    // Bouton d'enregistrement : toucher pour commencer / mettre en pause ; maintenir pour filmer tant qu'on appuie
    const recordBtn = h('button', { type: 'button', class: 'rec-btn', 'aria-label': 'Filmer', disabled: true }, h('span'));
    let pressAt = 0;
    recordBtn.addEventListener('pointerdown', () => {
      pressAt = Date.now();
      if (recording) return;
      if (countdownTimer) {
        cancelCountdown();
        pressAt = 0;
        return;
      }
      if (timerSec) {
        let n = timerSec;
        countdown.hidden = false;
        countdown.textContent = String(n);
        countdownTimer = setInterval(() => {
          n -= 1;
          if (n <= 0) {
            cancelCountdown();
            startRec();
          } else countdown.textContent = String(n);
        }, 1000);
        pressAt = 0;
        return;
      }
      startRec();
      recordBtn.dataset.fresh = '1';
    });
    recordBtn.addEventListener('pointerup', () => {
      if (!recording) return;
      if (recordBtn.dataset.fresh === '1' && Date.now() - pressAt < 400) {
        recordBtn.dataset.fresh = '';
        return; // simple toucher : on continue de filmer jusqu'au prochain toucher
      }
      recordBtn.dataset.fresh = '';
      pauseRec();
    });

    const doneBtn = h('button', { type: 'button', class: 'cam-done', 'aria-label': 'Terminer', hidden: true, onclick: finish }, icon('check'));
    const redoBtn = h('button', { type: 'button', class: 'cam-redo', 'aria-label': 'Recommencer', hidden: true, onclick: async () => { if (await confirmDialog('Recommencer ?', 'Tout ce qui a été filmé sera effacé.', 'Recommencer')) reset(); } }, icon('undo'));
    // Champ de fichier invisible mais présent (pas « display: none ») : le bouton « Importer » est une
    // étiquette qui l'ouvre nativement, le plus sûr sur iPhone
    const fileInput = h('input', { type: 'file', accept: 'video/*,image/*', multiple: true, class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
    fileInput.addEventListener('change', async () => {
      const files = [...fileInput.files];
      fileInput.value = '';
      if (!files.length) return;
      const vid = files.find(isVideoFile);
      if (vid) {
        // Ouverture visible tout de suite (une vidéo d'iPhone peut demander quelques secondes)
        const wait = busyOverlay('Ouverture de ta vidéo…', 'Quelques secondes pour une longue vidéo.');
        try {
          const info = await readVideoInfo(vid);
          if (!S.kind && info.duration > maxSeconds() + 1) throw new Error(`Vidéo trop longue (${duration(info.duration)}) : ${duration(maxSeconds())} au maximum. Coupe-la dans Photos, puis réessaie.`);
          S.file = vid;
          S.info = info;
          if (S.kind) S.camDuration = Math.min(info.duration, S.maxDur);
          else S.soundBaked = false;
          editStep();
        } catch (err) {
          reportImportIssue(vid, 'ouverture', err);
          toast(err.message || 'Cette vidéo ne peut pas être ouverte.', 'error');
        } finally {
          wait.remove();
        }
      } else {
        const all = files.filter((f) => f.type.startsWith('image/'));
        if (all.length > MAX_PHOTOS) toast(`${MAX_PHOTOS} photos au maximum : les suivantes n’ont pas été ajoutées.`);
        const imgs = all.slice(0, MAX_PHOTOS);
        if (!imgs.length) return toast('Choisis une vidéo ou des photos.', 'error');
        S.mode = 'photo';
        S.photos = imgs;
        photoStep();
      }
    });
    const importBtn = h('label', { class: 'cam-import', role: 'button' }, h('span', { class: 'cam-import-ic' }, icon('photo')), h('small', null, 'Importer'), fileInput);
    const draftsBtn = h('button', { type: 'button', class: 'cam-import', hidden: true, onclick: () => openDrafts() }, h('span', { class: 'cam-import-ic' }, icon('pen')), h('small', null, 'Brouillons'));
    countDrafts().then((n) => (draftsBtn.hidden = !n || Boolean(S.kind)));

    // Outils
    const tool = (ic, label, fn) => h('button', { type: 'button', class: 'cam-tool', onclick: fn }, icon(ic), h('small', null, label));
    const flashBtn = tool('flash', 'Flash', async () => {
      torch = !torch;
      try {
        await videoTrack.applyConstraints({ advanced: [{ torch }] });
        flashBtn.classList.toggle('on', torch);
      } catch {
        toast('Flash indisponible sur cette caméra.', 'error');
      }
    });
    flashBtn.hidden = true;
    const timerBtn = tool('timer', 'Minuteur', () => {
      timerSec = timerSec === 0 ? 3 : timerSec === 3 ? 10 : 0;
      timerBtn.querySelector('small').textContent = timerSec ? `${timerSec} s` : 'Minuteur';
      timerBtn.classList.toggle('on', Boolean(timerSec));
    });
    const micBtn = tool(micOn ? 'mic' : 'micOff', micOn ? 'Micro' : 'Muet', () => {
      if (rec) return toast('Change le micro avant de commencer à filmer.');
      micOn = !micOn;
      micBtn.replaceChildren(icon(micOn ? 'mic' : 'micOff'), h('small', null, micOn ? 'Micro' : 'Muet'));
    });
    micBtn.hidden = !S.sound;
    const side = h('div', { class: 'cam-side' },
      tool('flip', 'Retourner', () => {
        if (!canSwitch('retourner la caméra')) return;
        facing = facing === 'user' ? 'environment' : 'user';
        lens = 'main';
        saveFacing(facing);
        openCamera();
      }),
      tool('filters', 'Filtres', () => filterSheet(S.fx.filter, (f) => { S.fx.filter = f; applyFilter(); }, preview)),
      timerBtn, flashBtn, micBtn);

    // Son
    const soundChip = h('button', { type: 'button', class: 'sound-chip' });
    const paintSound = () => {
      soundChip.replaceChildren(...[icon('music', 'icon-sm'), h('span', null, S.sound ? S.sound.title : 'Ajouter un son'), S.sound ? h('span', { class: 'chip-x', role: 'button', 'aria-label': 'Retirer le son', onclick: (e) => { e.stopPropagation(); if (rec) return; S.sound = null; soundEl = null; micOn = true; micBtn.hidden = true; paintSound(); } }, icon('x', 'icon-xs')) : null].filter(Boolean));
    };
    soundChip.addEventListener('click', () => {
      if (rec) return toast('Choisis le son avant de commencer à filmer.');
      pickSound((s) => {
        S.sound = s;
        soundEl = null;
        micOn = false;
        micBtn.hidden = false;
        micBtn.replaceChildren(icon('micOff'), h('small', null, 'Muet'));
        paintSound();
      });
    });
    paintSound();
    if (S.kind) soundChip.hidden = true;

    // Durées et modes
    const modeTabs = h('div', { class: 'cam-modes' });
    const modes = [
      ...(maxSeconds() >= 180 ? [['180', duration(180).replace(':00', ' min')]] : []),
      ['60', '60 s'],
      ['15', '15 s'],
      ['photo', 'Photo'],
      ['text', 'Texte'],
    ];
    const paintModes = () => modeTabs.replaceChildren(...modes.map(([k, label]) => h('button', { type: 'button', class: `cam-mode${String(S.maxDur) === k && S.mode === 'video' ? ' on' : ''}`, onclick: () => {
      if (k === 'photo') return fileInput.setAttribute('accept', 'image/*'), fileInput.click(), fileInput.setAttribute('accept', 'video/*,image/*');
      if (k === 'text') return textStep();
      S.mode = 'video';
      S.maxDur = Number(k);
      paintModes();
      paintBar();
    } }, label)));
    paintModes();

    const top = h('header', { class: 'cam-top' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fermer', onclick: leave }, icon('x')), soundChip, h('span', { class: 'icon-btn' }));
    const kindNote = S.kind
      ? h('div', { class: 'cam-kind' }, icon(S.kind === 'duet' ? 'duet' : 'scissors', 'icon-sm'), S.kind === 'duet' ? `Duo avec @${S.source.author.username}` : `Stitch avec @${S.source.author.username}`, S.kind === 'duet' ? h('small', null, 'Avec des écouteurs, le son de l’original ne se mêle pas au tien.') : null)
      : S.actu
        ? h('div', { class: 'cam-kind cam-actu' }, icon('newspaper', 'icon-sm'), h('span', null, `Ta réaction à : ${S.actu.title}`))
        : null;
    const el = h('div', { class: 'cam' }, camBox, status, countdown, bar, timeEl, top, kindNote, side,
      h('div', { class: 'cam-bottom' }, zoomBar, h('div', { class: 'cam-row' }, h('span', { class: 'cam-slot' }, draftsBtn), redoBtn, recordBtn, doneBtn, h('span', { class: 'cam-slot' }, importBtn)), modeTabs));
    applyFilter();
    paintBar();
    openCamera();
    setStep(el, () => {
      closed = true;
      clearInterval(tick);
      try {
        rec?.stop();
      } catch {
        /* déjà arrêté */
      }
      stopDrawing();
      videoTrack?.stop();
      micTrack?.stop();
      soundEl?.pause();
      origEl?.pause();
      ac?.close?.().catch(() => {});
    });
  }

  // Stitch : choisir l'extrait de l'originale (5 secondes au plus)
  function stitchClipStep() {
    const v = onScreen(mediaFor(S.sourceBlob));
    v.className = 'stitch-video';
    v.loop = false;
    const total = S.source.video.duration || 10;
    const from = h('input', { type: 'range', min: 0, max: Math.max(0, total - 1).toFixed(1), step: 0.1, value: S.stitchFrom });
    const len = h('input', { type: 'range', min: 1, max: Math.min(5, total), step: 0.5, value: Math.min(S.stitchLen, total) });
    const label = h('p', { class: 'stitch-label' });
    const paint = () => {
      S.stitchFrom = Number(from.value);
      S.stitchLen = Math.min(Number(len.value), total - S.stitchFrom);
      if (Number(len.value) !== S.stitchLen) len.value = String(S.stitchLen);
      label.textContent = `Extrait : de ${duration(S.stitchFrom)} à ${duration(S.stitchFrom + S.stitchLen)} (${S.stitchLen.toFixed(1).replace('.', ',')} s)`;
    };
    let stopAt = 0;
    const playClip = () => {
      v.currentTime = S.stitchFrom;
      stopAt = S.stitchFrom + S.stitchLen;
      v.play().catch(() => {});
    };
    v.addEventListener('timeupdate', () => v.currentTime >= stopAt && v.pause());
    from.addEventListener('input', () => { paint(); playClip(); });
    len.addEventListener('input', () => { paint(); playClip(); });
    paint();
    const el = h('div', { class: 'stitch-pick' },
      h('header', { class: 'cam-top' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fermer', onclick: leave }, icon('x')), h('b', null, 'Choisis l’extrait'), h('span', { class: 'icon-btn' })),
      h('div', { class: 'stitch-stage' }, v),
      h('div', { class: 'stitch-controls' }, label, h('label', { class: 'field' }, h('span', null, 'Début'), from), h('label', { class: 'field' }, h('span', null, 'Durée (5 s au plus)'), len), h('button', { type: 'button', class: 'btn btn-ghost', onclick: playClip }, icon('play', 'icon-sm'), 'Revoir'), h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => { S.stitchChosen = true; captureStep(); } }, 'Suivant : filme ta suite')));
    setStep(el, () => v.pause());
    setTimeout(playClip, 300);
  }

  // =========================================================================
  // 2. Montage : aperçu, textes, autocollants, filtre, son, volumes
  // =========================================================================
  function editStep() {
    const url = URL.createObjectURL(S.file);
    // Lecture muette d'abord : Safari (iPhone) refuse de lancer une vidéo sonore sans toucher et
    // laissait un écran noir. Un toucher rétablit le son.
    const v = h('video', { class: 'edit-video', src: url, loop: true, autoplay: true, playsinline: true, muted: true });
    v.playsInline = true;
    v.muted = true;
    v.defaultMuted = true;
    const soundHint = h('button', { type: 'button', class: 'edit-unmute' }, icon('mute', 'icon-sm'), h('span', null, 'Activer le son'));
    const unmute = () => {
      v.muted = false;
      soundHint.hidden = true;
      if (v.paused) v.play().catch(() => {});
      soundEl?.play().catch(() => {});
      orig?.play().catch(() => {});
    };
    soundHint.addEventListener('click', (e) => {
      e.stopPropagation();
      unmute();
    });
    requestAnimationFrame(() => v.play().catch(() => {}));
    const ar = S.info.width && S.info.height ? S.info.width / S.info.height : 9 / 16;
    let orig = null;
    if (S.kind === 'duet') {
      orig = onScreen(mediaFor(S.sourceBlob));
      orig.loop = true;
      orig.className = 'edit-orig';
    }
    const layer = fxLayer(S.fx, { ar: S.kind === 'duet' ? 9 / 8 : ar, editable: true });
    const stage = h('div', { class: `edit-stage${S.kind === 'duet' ? ' duet' : ''}`, style: { '--ar': String(S.kind === 'duet' ? 9 / 8 : ar) } }, h('div', { class: 'edit-media' }, v, orig), layer);
    const applyFx = () => {
      v.style.filter = filterCss(S.fx.filter);
      paintOverlays(layer, S.fx, { editable: true });
    };
    // Son ajouté après coup : écouté en même temps que la vidéo (mélangé à la publication)
    let soundEl = null;
    const syncSound = () => {
      soundEl?.pause();
      soundEl = null;
      if (S.sound && !S.soundBaked) {
        soundEl = new Audio(S.sound.url);
        soundEl.loop = true;
        soundEl.volume = S.volumes.sound;
        v.volume = S.volumes.original;
        soundEl.currentTime = 0;
        if (!v.paused) soundEl.play().catch(() => {});
      } else {
        v.volume = 1;
      }
    };
    v.addEventListener('play', () => { soundEl?.play().catch(() => {}); orig?.play().catch(() => {}); });
    v.addEventListener('pause', () => { soundEl?.pause(); orig?.pause(); });
    v.addEventListener('seeked', () => { if (soundEl) soundEl.currentTime = v.currentTime % (soundEl.duration || 1e9); if (orig) orig.currentTime = v.currentTime; });
    stage.addEventListener('click', (e) => {
      if (e.target.closest('.fx-item')) return;
      // Premier toucher : le son revient (la vidéo continue) ; ensuite : pause / lecture
      if (v.muted) return unmute();
      if (v.paused) v.play().catch(() => {});
      else v.pause();
    });

    // Déplacer un texte ou un autocollant au doigt ; le glisser sur la corbeille le retire ;
    // un toucher sans déplacement le modifie
    const trash = h('div', { class: 'edit-trash', hidden: true }, icon('trash'));
    // Zone visible dans le fil de ce téléphone : les bandes apparaissent pendant un déplacement
    const safe = (() => {
      if (S.kind === 'duet' || matchMedia('(min-width: 900px)').matches) return null;
      const tabH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tab-h')) || 56;
      const box = { w: innerWidth, h: innerHeight - tabH };
      if (fitFor(ar, box) !== 'cover') return null;
      const screen = box.w / box.h;
      const band = ar > screen ? ((1 - screen / ar) / 2) * 100 : ((1 - ar / screen) / 2) * 100;
      if (band < 0.5) return null;
      return h('div', { class: `edit-safe ${ar > screen ? 'x' : 'y'}`, style: { '--band': `${band.toFixed(2)}%` } }, h('i'), h('i'));
    })();
    if (safe) stage.append(safe);
    layer.addEventListener('pointerdown', (e) => {
      const item = e.target.closest('.fx-item');
      if (!item) return;
      e.preventDefault();
      const idx = [...layer.children].indexOf(item);
      const o = S.fx.overlays[idx];
      const rect = layer.getBoundingClientRect();
      const start = { x: e.clientX, y: e.clientY, ox: o.x, oy: o.y };
      let moved = false;
      item.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        if (Math.hypot(dx, dy) > 6) moved = true;
        if (!moved) return;
        trash.hidden = false;
        stage.classList.add('dragging');
        o.x = Math.min(1, Math.max(0, start.ox + dx / rect.width));
        o.y = Math.min(1, Math.max(0, start.oy + dy / rect.height));
        item.style.left = `${o.x * 100}%`;
        item.style.top = `${o.y * 100}%`;
        const tr = trash.getBoundingClientRect();
        trash.classList.toggle('hot', ev.clientY > tr.top - 10 && Math.abs(ev.clientX - (tr.left + tr.width / 2)) < 60);
      };
      const up = (ev) => {
        item.removeEventListener('pointermove', move);
        item.removeEventListener('pointerup', up);
        item.removeEventListener('pointercancel', up);
        const drop = trash.classList.contains('hot');
        stage.classList.remove('dragging');
        trash.hidden = true;
        trash.classList.remove('hot');
        if (drop) {
          S.fx.overlays.splice(idx, 1);
          applyFx();
        } else if (!moved && ev.type === 'pointerup') {
          if (o.kind === 'text') textEditor(o, (next) => { if (next) Object.assign(o, next); else S.fx.overlays.splice(idx, 1); applyFx(); });
          else stickerMenu(o, idx);
        }
      };
      item.addEventListener('pointermove', move);
      item.addEventListener('pointerup', up);
      item.addEventListener('pointercancel', up);
    });
    const stickerMenu = (o, idx) => {
      const size = h('input', { type: 'range', min: 0.06, max: 0.5, step: 0.01, value: o.size });
      size.addEventListener('input', () => { o.size = Number(size.value); applyFx(); });
      openSheet({ title: 'Autocollant', body: h('div', { class: 'form-stack' }, h('label', { class: 'field' }, h('span', null, 'Taille'), size), h('button', { type: 'button', class: 'btn btn-danger', onclick: () => { S.fx.overlays.splice(idx, 1); applyFx(); closeSheet(); } }, 'Retirer')) });
    };

    const tool = (ic, label, fn) => h('button', { type: 'button', class: 'cam-tool', onclick: fn }, icon(ic), h('small', null, label));
    const soundTool = tool('music', 'Son', () => {
      if (S.kind) return toast('Le son d’un Duo ou d’un Stitch vient des vidéos.');
      pickSound((s) => {
        S.sound = s;
        S.soundBaked = false;
        S.volumes = { original: 0.4, sound: 1 };
        syncSound();
        paintSoundChip();
        volTool.hidden = false;
      });
    });
    const volTool = tool('sliders', 'Volume', () => {
      const o = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: S.volumes.original });
      const s = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: S.volumes.sound });
      o.addEventListener('input', () => { S.volumes.original = Number(o.value); v.volume = S.volumes.original; });
      s.addEventListener('input', () => { S.volumes.sound = Number(s.value); if (soundEl) soundEl.volume = S.volumes.sound; });
      openSheet({ title: 'Volume', body: h('div', { class: 'form-stack' }, h('label', { class: 'field' }, h('span', null, 'Son original'), o), h('label', { class: 'field' }, h('span', null, 'Son ajouté'), s)) });
    });
    volTool.hidden = !(S.sound && !S.soundBaked);
    const soundChip = h('div', { class: 'sound-chip static' });
    const paintSoundChip = () => {
      soundChip.hidden = !S.sound;
      if (S.sound) soundChip.replaceChildren(...[icon('music', 'icon-sm'), h('span', null, S.sound.title), !S.soundBaked ? h('button', { type: 'button', class: 'chip-x', 'aria-label': 'Retirer le son', onclick: () => { S.sound = null; syncSound(); paintSoundChip(); volTool.hidden = true; } }, icon('x', 'icon-xs')) : null].filter(Boolean));
    };
    paintSoundChip();
    syncSound();
    const side = h('div', { class: 'cam-side' },
      tool('type', 'Texte', () => textEditor(null, (o) => { if (o) { S.fx.overlays.push(o); applyFx(); } })),
      tool('smile', 'Autocollants', () => stickerSheet((emoji) => { S.fx.overlays.push({ kind: 'sticker', emoji, x: 0.5, y: 0.45, size: 0.16, rot: 0 }); applyFx(); })),
      tool('filters', 'Filtres', () => filterSheet(S.fx.filter, (f) => { S.fx.filter = f; applyFx(); })),
      S.kind ? null : soundTool, volTool);
    const el = h('div', { class: 'edit' }, stage, trash, soundHint,
      h('header', { class: 'cam-top' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retour', onclick: async () => { if (await confirmDialog(S.kind === 'stitch' ? 'Revenir au choix de l’extrait ?' : 'Revenir à la caméra ?', 'La vidéo filmée sera effacée.', 'Revenir')) { S.file = null; S.info = null; S.soundBaked = false; S.kind === 'stitch' ? stitchClipStep() : captureStep(); } } }, icon('back')), soundChip, h('span', { class: 'icon-btn' })),
      side,
      h('div', { class: 'edit-bottom' }, h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: () => postStep() }, 'Suivant')));
    applyFx();
    setStep(el, () => {
      v.pause();
      soundEl?.pause();
      orig?.pause();
      URL.revokeObjectURL(url);
    });
  }

  // Éditeur de texte posé sur la vidéo
  function textEditor(o, done) {
    const cur = o ? { ...o } : { kind: 'text', text: '', x: 0.5, y: 0.4, size: 0.065, color: '#ffffff', style: 'plain', rot: 0 };
    const input = h('textarea', { class: 'textarea text-editor-input', rows: 2, maxlength: 150, placeholder: 'Écris quelque chose…' });
    input.value = cur.text;
    const colors = h('div', { class: 'swatches' });
    // Aperçu en direct : couleur, style et taille se voient avant « OK »
    const preview = h('div', { class: 'text-preview', 'aria-hidden': 'true' });
    const paintPreview = () => preview.replaceChildren(overlayEl({ ...cur, text: input.value.trim() || 'Aperçu du texte', x: 0.5, y: 0.5, rot: 0 }));
    input.addEventListener('input', paintPreview);
    const paintColors = () => colors.replaceChildren(...TEXT_COLORS.map((c) => h('button', { type: 'button', class: `swatch${c === cur.color ? ' on' : ''}`, style: { background: c }, 'aria-label': `Couleur ${c}`, onclick: () => { cur.color = c; paintColors(); paintPreview(); } })));
    paintColors();
    const styles = h('div', { class: 'chips' });
    const paintStyles = () => styles.replaceChildren(...[['plain', 'Simple'], ['box', 'Fond'], ['outline', 'Contour']].map(([k, l]) => h('button', { type: 'button', class: `chip${cur.style === k ? ' on' : ''}`, onclick: () => { cur.style = k; paintStyles(); paintPreview(); } }, l)));
    paintStyles();
    const size = h('input', { type: 'range', min: 0.035, max: 0.14, step: 0.005, value: cur.size });
    size.addEventListener('input', () => {
      cur.size = Number(size.value);
      paintPreview();
    });
    paintPreview();
    openSheet({
      title: o ? 'Modifier le texte' : 'Ajouter un texte',
      body: h('div', { class: 'form-stack' }, preview, input, h('label', { class: 'field' }, h('span', null, 'Couleur'), colors), styles, h('label', { class: 'field' }, h('span', null, 'Taille'), size),
        h('div', { class: 'row-end' }, o ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { closeSheet(); done(null); } }, 'Retirer') : null, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { cur.text = input.value.trim(); closeSheet(); done(cur.text ? cur : o ? null : undefined); } }, 'OK'))),
    });
    setTimeout(() => input.focus(), 100);
  }

  function stickerSheet(onPick) {
    openSheet({ title: 'Autocollants', body: h('div', { class: 'sticker-grid' }, STICKERS.map((e) => h('button', { type: 'button', onclick: () => { closeSheet(); onPick(e); } }, e))) });
  }

  function filterSheet(current, onPick, frameFrom = null) {
    let poster = S.info?.poster ? URL.createObjectURL(S.info.poster) : null;
    const owned = Boolean(poster);
    // À la caméra : une image prise sur l'aperçu sert de vignette à chaque filtre
    if (!poster && frameFrom?.videoWidth) {
      try {
        const c = document.createElement('canvas');
        const k = 240 / Math.max(frameFrom.videoWidth, frameFrom.videoHeight);
        c.width = Math.round(frameFrom.videoWidth * k);
        c.height = Math.round(frameFrom.videoHeight * k);
        c.getContext('2d').drawImage(frameFrom, 0, 0, c.width, c.height);
        poster = c.toDataURL('image/jpeg', 0.75);
      } catch {
        poster = null;
      }
    }
    openSheet({
      title: 'Filtres',
      body: h('div', { class: 'filter-strip' }, FILTERS.map((f) => h('button', { type: 'button', class: `filter-opt${f.id === current ? ' on' : ''}`, onclick: (e) => { onPick(f.id); for (const b of e.currentTarget.parentNode.children) b.classList.toggle('on', b === e.currentTarget); } },
        h('span', { class: 'filter-thumb', style: { filter: f.css || 'none' } }, poster ? h('img', { src: poster, alt: '' }) : h('span', { class: 'filter-sample' })), h('small', null, f.label)))),
      onClose: () => owned && URL.revokeObjectURL(poster),
    });
  }

  // =========================================================================
  // Photo et Texte
  // =========================================================================
  function photoStep() {
    const strip = h('div', { class: 'photo-strip' });
    const title = h('b');
    const more = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    // Au-delà de 20 photos : on le dit, plutôt que d'ignorer les suivantes en silence
    const keep = (list) => {
      if (list.length > MAX_PHOTOS) toast(`${MAX_PHOTOS} photos au maximum : les suivantes n’ont pas été ajoutées.`);
      return list.slice(0, MAX_PHOTOS);
    };
    more.addEventListener('change', () => {
      S.photos = keep([...S.photos, ...[...more.files].filter((f) => f.type.startsWith('image/'))]);
      more.value = '';
      paint();
    });
    const urls = [];
    const move = (i, d) => {
      const j = i + d;
      if (j < 0 || j >= S.photos.length) return;
      [S.photos[i], S.photos[j]] = [S.photos[j], S.photos[i]];
      paint();
    };
    const paint = () => {
      urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
      title.textContent = `${S.photos.length} photo${S.photos.length > 1 ? 's' : ''}`;
      const last = S.photos.length - 1;
      strip.replaceChildren(...S.photos.map((f, i) => {
        const u = URL.createObjectURL(f);
        urls.push(u);
        return h('div', { class: 'photo-item' },
          h('img', { src: u, alt: '' }),
          h('span', { class: 'photo-n' }, String(i + 1)),
          h('button', { type: 'button', class: 'photo-x', 'aria-label': 'Retirer', onclick: () => { S.photos.splice(i, 1); if (!S.photos.length) return captureStep(); paint(); } }, icon('x', 'icon-xs')),
          // Changer l'ordre : avant / après
          S.photos.length > 1 ? h('div', { class: 'photo-move' },
            h('button', { type: 'button', 'aria-label': 'Placer plus tôt', disabled: i === 0, onclick: () => move(i, -1) }, icon('back', 'icon-sm')),
            h('button', { type: 'button', 'aria-label': 'Placer plus tard', disabled: i === last, onclick: () => move(i, 1) }, icon('chevron', 'icon-sm'))) : null);
      }), S.photos.length < MAX_PHOTOS ? h('button', { type: 'button', class: 'photo-add', onclick: () => more.click() }, icon('plus'), h('small', null, 'Ajouter')) : null);
    };
    paint();
    const back = async () => {
      if (!(await confirmDialog('Revenir à la caméra ?', 'Les photos choisies seront retirées.', 'Revenir'))) return;
      S.photos = [];
      S.mode = 'video';
      captureStep();
    };
    setStep(h('div', { class: 'photo-edit' },
      h('header', { class: 'cam-top' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retour', onclick: back }, icon('back')), title, h('span', { class: 'icon-btn' })),
      strip, more,
      h('div', { class: 'edit-bottom' }, h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: () => postStep() }, 'Suivant'))), () => urls.forEach((u) => URL.revokeObjectURL(u)));
  }

  function textStep() {
    S.mode = 'text';
    const input = h('textarea', { class: 'text-card-input', maxlength: 2200, placeholder: 'Touche pour écrire', rows: 6 });
    input.value = S.body;
    const card = h('div', { class: `text-card bg-${S.bg}` }, input);
    const swatches = h('div', { class: 'swatches big' });
    const paint = () => swatches.replaceChildren(...BGS.map((b) => h('button', { type: 'button', class: `swatch bg-${b}${b === S.bg ? ' on' : ''}`, 'aria-label': `Fond ${b}`, onclick: () => { S.bg = b; card.className = `text-card bg-${b}`; paint(); } })));
    paint();
    setStep(h('div', { class: 'text-edit' },
      h('header', { class: 'cam-top' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retour', onclick: () => { S.mode = 'video'; S.body = input.value; captureStep(); } }, icon('back')), h('b', null, 'Texte'), h('span', { class: 'icon-btn' })),
      card, swatches,
      h('div', { class: 'edit-bottom' }, h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: () => { S.body = input.value.trim(); if (!S.body) return toast('Écris quelque chose.', 'error'); postStep(); } }, 'Suivant'))));
    setTimeout(() => input.focus(), 100);
  }

  // =========================================================================
  // 3. Publier
  // =========================================================================
  function postStep() {
    const isVideo = S.mode === 'video';
    const body = h('textarea', { class: 'textarea post-desc', rows: 5, maxlength: 2200, placeholder: S.mode === 'text' ? 'Ton texte' : S.mode === 'photo' ? 'Décris tes photos : #hashtags, @mentions…' : 'Décris ta vidéo : #hashtags, @mentions…' });
    body.value = S.body;
    const count = h('small', { class: 'field-hint right' }, `${body.value.length}/2200`);
    body.addEventListener('input', () => {
      S.body = body.value;
      count.textContent = `${body.value.length}/2200`;
    });
    const insert = (ch) => {
      const pre = body.value && !/\s$/.test(body.value) ? ' ' : '';
      body.value += pre + ch;
      body.dispatchEvent(new Event('input'));
      body.focus();
    };
    // Couverture
    let coverUrl = null;
    const coverImg = h('img', { alt: '' });
    const paintCover = () => {
      if (coverUrl) URL.revokeObjectURL(coverUrl);
      const blob = S.cover || S.info?.poster || null;
      coverUrl = blob ? URL.createObjectURL(blob) : null;
      if (coverUrl) coverImg.src = coverUrl;
      coverImg.style.filter = filterCss(S.fx.filter) || '';
    };
    const coverBtn = isVideo && S.kind
      ? h('div', { class: 'post-cover text bg-nuit' }, icon(S.kind === 'duet' ? 'duet' : 'scissors'), h('small', null, S.kind === 'duet' ? 'Duo' : 'Stitch'))
      : isVideo ? h('button', { type: 'button', class: 'post-cover', onclick: () => coverPicker(() => paintCover()) }, coverImg, h('small', null, 'Couverture')) : null;
    if (isVideo) paintCover();
    const photoPreview = S.mode === 'photo' ? h('div', { class: 'post-cover' }, h('img', { src: URL.createObjectURL(S.photos[0]), alt: '' }), h('small', null, `${S.photos.length} photo${S.photos.length > 1 ? 's' : ''}`)) : null;
    const textPreview = S.mode === 'text' ? h('div', { class: `post-cover text bg-${S.bg}` }, h('span', null, 'Aa')) : null;

    const cats = store.config?.categories || [];
    const category = h('select', { class: 'input' }, h('option', { value: '' }, 'Aucune'), cats.map((c) => h('option', { value: c.id, selected: S.category === c.id }, `${c.emoji} ${c.label}`)));
    category.addEventListener('change', () => (S.category = category.value));
    const privacy = h('select', { class: 'input' }, PRIVACY.map(([v, l]) => h('option', { value: v, selected: S.privacy === v }, l)));
    privacy.addEventListener('change', () => (S.privacy = privacy.value));
    const tComments = toggle('Autoriser les commentaires', S.allowComments);
    const tDuet = toggle('Autoriser les Duos', S.allowDuet);
    const tStitch = toggle('Autoriser les Stitchs', S.allowStitch);
    const tDl = toggle('Autoriser le téléchargement', S.allowDownload);
    const sync = () => {
      S.allowComments = tComments.input.checked;
      S.allowDuet = tDuet.input.checked;
      S.allowStitch = tStitch.input.checked;
      S.allowDownload = tDl.input.checked;
    };
    for (const t of [tComments, tDuet, tStitch, tDl]) t.input.addEventListener('change', sync);

    const publish = h('button', { type: 'button', class: 'btn btn-primary btn-lg grow' }, icon('upload', 'icon-sm'), 'Publier');
    const draft = h('button', { type: 'button', class: 'btn btn-ghost btn-lg' }, 'Brouillon');
    draft.addEventListener('click', async () => {
      try {
        const id = await saveDraft({
          id: S.draftId,
          body: S.body,
          photos: S.photos,
          video: S.file ? { file: S.file, info: { ...S.info, poster: S.cover || S.info?.poster } } : null,
          meta: pickMeta(),
        });
        S.draftId = id;
        toast('Brouillon gardé sur cet appareil');
        navigate(`/@${me.username}`);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    publish.addEventListener('click', () => doPublish(publish));
    const el = h('div', { class: 'post-step' },
      h('header', { class: 'page-head' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retour', onclick: () => (S.mode === 'video' ? editStep() : S.mode === 'photo' ? photoStep() : textStep()) }, icon('back')), h('h1', null, 'Publier'), h('span', { class: 'icon-btn' })),
      h('div', { class: 'post-top' }, h('div', { class: 'post-desc-wrap' }, body, count, h('div', { class: 'post-insert' }, h('button', { type: 'button', class: 'chip', onclick: () => insert('#') }, '# Hashtags'), h('button', { type: 'button', class: 'chip', onclick: () => insert('@') }, '@ Mentionner'))), coverBtn || photoPreview || textPreview),
      h('div', { class: 'set-card' },
        h('label', { class: 'set-row static' }, h('span', { class: 'set-ic' }, icon('globe')), h('span', { class: 'set-text' }, 'Qui peut voir', privacy)),
        h('label', { class: 'set-row static' }, h('span', { class: 'set-ic' }, icon('compass')), h('span', { class: 'set-text' }, 'Catégorie (Explorer)', category)),
        tComments.el, isVideo ? tDuet.el : null, isVideo ? tStitch.el : null, S.mode !== 'text' ? tDl.el : null),
      S.sound && isVideo ? h('p', { class: 'muted small' }, icon('music', 'icon-xs'), ` Son : ${S.sound.title}`) : null,
      actuBanner(),
      h('div', { class: 'post-actions' }, draft, publish));
    setStep(el, () => coverUrl && URL.revokeObjectURL(coverUrl));
    attachMentions(body, { placement: 'inline' });
  }

  // L'actualité à laquelle on réagit (retirable)
  function actuBanner() {
    if (!S.actu) return null;
    const el = h('div', { class: 'post-actu' },
      h('span', { class: 'post-actu-ic' }, icon('newspaper', 'icon-sm')),
      h('span', { class: 'post-actu-text' }, h('small', null, 'Tu réagis à l’actualité'), h('b', null, S.actu.title), h('small', null, S.actu.siteName)),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Ne plus lier cette actualité', onclick: () => { S.actu = null; el.remove(); } }, icon('x', 'icon-sm')));
    return el;
  }

  const pickMeta = () => ({
    mode: S.mode,
    actu: S.actu,
    fx: S.fx,
    sound: S.sound,
    soundBaked: S.soundBaked,
    volumes: S.volumes,
    bg: S.bg,
    privacy: S.privacy,
    allowComments: S.allowComments,
    allowDuet: S.allowDuet,
    allowStitch: S.allowStitch,
    allowDownload: S.allowDownload,
    category: S.category,
    coverAt: S.coverAt,
  });

  // Choisir l'image de couverture en faisant défiler la vidéo
  function coverPicker(onDone) {
    const v = h('video', { class: 'cover-video', src: URL.createObjectURL(S.file), muted: true, playsinline: true, preload: 'auto' });
    v.muted = true;
    const range = h('input', { type: 'range', min: 0, max: Math.max(0.1, (S.info.duration || 1) - 0.1).toFixed(2), step: 0.05, value: S.coverAt });
    range.addEventListener('input', () => {
      try {
        v.currentTime = Number(range.value);
      } catch {
        /* pas encore prête */
      }
    });
    v.addEventListener('loadeddata', () => {
      try {
        v.currentTime = S.coverAt;
      } catch {
        /* sans importance */
      }
    });
    const ok = h('button', { type: 'button', class: 'btn btn-primary btn-block' }, 'Choisir cette image');
    ok.addEventListener('click', async () => {
      ok.disabled = true;
      try {
        S.coverAt = Number(range.value);
        S.cover = await frameAt(S.file, S.coverAt);
        closeSheet();
        onDone();
      } catch (err) {
        ok.disabled = false;
        toast(err.message, 'error');
      }
    });
    openSheet({ title: 'Couverture', body: h('div', { class: 'cover-pick' }, h('div', { class: 'cover-stage', style: { filter: filterCss(S.fx.filter) } }, v), range, ok), onClose: () => URL.revokeObjectURL(v.src) });
  }

  async function doPublish(btn) {
    if (S.mode === 'text' && !S.body.trim()) return toast('Écris quelque chose.', 'error');
    btn.disabled = true;
    const common = {
      body: S.body.trim(),
      privacy: S.privacy,
      category: S.category || null,
      allowComments: S.allowComments,
      allowDuet: S.allowDuet,
      allowStitch: S.allowStitch,
      allowDownload: S.allowDownload,
      actuId: S.actu?.id || null,
    };
    try {
      if (S.mode === 'text') {
        const { post } = await api.post('/api/posts', { ...common, bg: S.bg });
        await done();
        toast('Publié !');
        return navigate(`/@${me.username}/video/${post.id}`, { replace: true });
      }
      if (S.mode === 'photo') {
        const overlay = progressOverlay('Envoi des photos…');
        const urls = [];
        for (const [i, f] of S.photos.entries()) {
          const fd = new FormData();
          fd.append('image', await shrinkImage(f, 1600, 0.85), 'photo.jpg');
          urls.push((await api.post('/api/media', fd)).url);
          overlay.set((i + 1) / S.photos.length);
        }
        const { post } = await api.post('/api/posts', { ...common, images: urls });
        overlay.remove();
        await done();
        toast('Publié !');
        return navigate(`/@${me.username}/video/${post.id}`, { replace: true });
      }
      // Vidéo : montage dans le navigateur si besoin (son ajouté, Duo, Stitch), puis envoi en arrière-plan
      let file = S.file;
      let info = S.info;
      const needsMix = (S.sound && !S.soundBaked) || S.kind;
      if (needsMix) {
        const ac = new AudioContext(); // créé pendant le toucher : le son est permis sur iPhone
        const overlay = progressOverlay('Préparation de ta vidéo…', 'Garde cet écran ouvert pendant le montage.');
        try {
          if (S.kind === 'duet') file = await composeDuet({ camFile: S.file, originalBlob: S.sourceBlob, duration: Math.min(S.info.duration, S.source.video.duration || S.info.duration), ac, onProgress: overlay.set });
          else if (S.kind === 'stitch') file = await composeStitch({ originalBlob: S.sourceBlob, from: S.stitchFrom, length: S.stitchLen, camFile: S.file, camDuration: S.info.duration, ac, onProgress: overlay.set });
          else file = await mixSound({ file: S.file, soundUrl: S.sound.url, duration: S.info.duration, volumes: S.volumes, ac, onProgress: overlay.set });
          const total = S.kind === 'stitch' ? S.stitchLen + S.info.duration : S.info.duration;
          info = await readVideoInfo(file, { knownDuration: total });
        } finally {
          overlay.remove();
          ac.close().catch(() => {});
        }
      }
      if (S.cover) info = { ...info, poster: S.cover };
      const payload = {
        ...common,
        fx: S.fx.filter || S.fx.overlays.length ? S.fx : null,
        soundId: S.sound && (S.soundBaked || needsMix) && !S.kind ? S.sound.id : null,
        duetOf: S.kind === 'duet' ? S.source.id : null,
        stitchOf: S.kind === 'stitch' ? S.source.id : null,
      };
      sendInBackground({
        file,
        info,
        title: S.body.trim().slice(0, 40) || 'Ta vidéo',
        finish: async (video) => {
          const { post } = await api.post('/api/posts', { ...payload, videoId: video.id });
          return { href: `/@${me.username}/video/${post.id}`, message: 'Ta vidéo est en ligne !', post };
        },
      });
      await done();
      toast('Envoi en cours : tu peux continuer à regarder des vidéos');
      navigate(`/@${me.username}`, { replace: true });
    } catch (err) {
      btn.disabled = false;
      toast(err.message, 'error');
    }
  }
  async function done() {
    if (S.draftId) await deleteDraft(S.draftId);
    S.file = null;
    S.photos = [];
  }

  // Attente sans avancement mesurable (ouverture d'une vidéo)
  function busyOverlay(title, sub = '') {
    const el = h('div', { class: 'progress-overlay', role: 'status' }, h('div', { class: 'progress-card' }, h('p', null, title), spinner(), sub ? h('small', null, sub) : null));
    document.body.append(el);
    return { remove: () => el.remove() };
  }

  function progressOverlay(title, sub = '') {
    const fill = h('i');
    const pct = h('b', null, '0 %');
    const el = h('div', { class: 'progress-overlay' }, h('div', { class: 'progress-card' }, h('p', null, title), pct, h('div', { class: 'progress-bar' }, fill), sub ? h('small', null, sub) : null));
    document.body.append(el);
    return {
      set: (p) => {
        fill.style.transform = `scaleX(${p})`;
        pct.textContent = `${Math.round(p * 100)} %`;
      },
      remove: () => el.remove(),
    };
  }

  // Brouillons gardés sur l'appareil
  async function openDrafts() {
    const list = h('div', { class: 'drafts' }, spinner());
    const paint = async () => {
      const drafts = await listDrafts();
      if (!drafts.length) return list.replaceChildren(emptyState('pen', 'Aucun brouillon', 'À la dernière étape, « Brouillon » garde ta création sur cet appareil.'));
      list.replaceChildren(...drafts.map((d) => {
        const thumb = d.video?.poster || d.photos?.[0]?.blob || null;
        return h('div', { class: 'draft-row' },
          h('a', { href: `/creer?brouillon=${d.id}`, class: 'draft-open', onclick: (e) => { e.preventDefault(); closeSheet(); navigate(`/creer?brouillon=${d.id}`, { replace: true }); } },
            h('span', { class: 'draft-thumb' }, thumb ? h('img', { src: URL.createObjectURL(thumb), alt: '' }) : icon('textPost')),
            h('span', { class: 'grow' }, h('b', null, (d.body || '').trim().slice(0, 60) || 'Sans description'), h('small', null, `${d.video ? `Vidéo · ${duration(d.video.duration || 0)}` : d.photos?.length ? `${d.photos.length} photo${d.photos.length > 1 ? 's' : ''}` : 'Texte'} · ${timeAgo(d.updatedAt)}`))),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Supprimer', onclick: async () => { if (await confirmDialog('Supprimer ce brouillon ?', 'Il sera effacé de cet appareil.', 'Supprimer')) { await deleteDraft(d.id); paint(); } } }, icon('trash')));
      }));
    };
    paint();
    openSheet({ title: 'Brouillons', body: list, tall: true });
  }

  // Point de départ
  if (S.file && S.info) editStep();
  else if (S.photos.length) photoStep();
  else if (S.mode === 'text') textStep();
  else if (S.kind === 'stitch') stitchClipStep();
  else captureStep();
  return root;
}
