#!/usr/bin/env node
'use strict';
// Fabrique les vidéos de démonstration (public/demo) avec ffmpeg : visuels générés par calcul
// (fractale, jeu de la vie, automates, dégradés, spectres sonores) et musiques synthétisées note
// par note. Tout est original : aucune image, aucun son ni aucune musique d'autrui.
//   node scripts/make-demo.js
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'public', 'demo');
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const W = 720;
const H = 1280;
fs.mkdirSync(OUT, { recursive: true });

// Musiques (une expression par canal ; t en secondes)
const BEAT = 60 / 110; // 110 battements par minute
const bar = 4 * BEAT;
const root = `if(eq(mod(floor(t/${bar}),4),0),110,if(eq(mod(floor(t/${bar}),4),1),87.31,if(eq(mod(floor(t/${bar}),4),2),130.81,98)))`;
const kick = `sin(2*PI*(45+110*exp(-mod(t,${BEAT})*35))*mod(t,${BEAT}))*exp(-mod(t,${BEAT})*7)`;
const hat = `(random(0)*2-1)*exp(-mod(t+${BEAT / 2},${BEAT})*70)`;
const AUDIO = {
  // Synthwave : basse en croches, arpège carré, grosse caisse et charleston
  synth: (() => {
    const bass = `0.30*sin(2*PI*${root}*t)*exp(-mod(t,${BEAT / 2})*5)`;
    const arp = `0.10*sgn(sin(2*PI*${root}*if(eq(mod(floor(t/${BEAT / 4}),3),0),2,if(eq(mod(floor(t/${BEAT / 4}),3),1),2.38,3))*t))*exp(-mod(t,${BEAT / 4})*10)`;
    const mix = `0.9*(${bass}+${arp}+0.55*${kick}+0.05*${hat})`;
    return [mix, mix];
  })(),
  // Nappe douce : accord de trois notes qui respire
  chill: (() => {
    const pad = `(sin(2*PI*220*t)+0.7*sin(2*PI*277.18*t)+0.6*sin(2*PI*329.63*t)+0.3*sin(2*PI*440*t+sin(2*PI*0.3*t)))*(0.55+0.45*sin(2*PI*0.25*t))*0.16`;
    return [pad, pad.replace('2*PI*220*t)', '2*PI*220.6*t)')];
  })(),
  // Chiptune : mélodie rapide sur une gamme pentatonique
  chip: (() => {
    const note = 'if(eq(mod(floor(t*6),8),0),523.25,if(eq(mod(floor(t*6),8),1),587.33,if(eq(mod(floor(t*6),8),2),659.25,if(eq(mod(floor(t*6),8),3),783.99,if(eq(mod(floor(t*6),8),4),880,if(eq(mod(floor(t*6),8),5),783.99,if(eq(mod(floor(t*6),8),6),659.25,587.33)))))))';
    const lead = `0.12*sgn(sin(2*PI*${note}*t))*exp(-mod(t,1/6)*6)`;
    const bass = `0.18*sgn(sin(2*PI*if(lt(mod(t,2.666),1.333),130.81,98)*t))*exp(-mod(t,1/3)*4)`;
    const mix = `${lead}+${bass}+0.35*${kick}`;
    return [mix, mix];
  })(),
  // Rythme : grosse caisse, caisse claire, basse qui glisse
  beat: (() => {
    const snare = `(random(1)*2-1)*exp(-mod(t+${BEAT},${2 * BEAT})*22)`;
    const bass = `0.28*sin(2*PI*(55+15*sin(2*PI*t/${bar}))*t)*(0.6+0.4*exp(-mod(t,${BEAT / 2})*6))`;
    const mix = `0.85*(0.8*${kick}+0.25*${snare}+${bass}+0.06*${hat})`;
    return [mix, mix];
  })(),
  // Lo-fi : accords tenus, léger vibrato et craquements de vinyle
  lofi: (() => {
    const chord = `if(lt(mod(t,4),2),(sin(2*PI*261.63*t)+sin(2*PI*329.63*t)+sin(2*PI*392*t)),(sin(2*PI*220*t)+sin(2*PI*261.63*t)+sin(2*PI*329.63*t)))`;
    const mix = `0.13*${chord}*(0.8+0.2*sin(2*PI*5*t))+0.04*${kick}+0.015*gt(random(2),0.996)*(random(3)*2-1)`;
    return [mix, mix];
  })(),
  // Cloches : notes claires qui résonnent (pour le spectre)
  bells: (() => {
    const f = 'if(eq(mod(floor(t*2),4),0),659.25,if(eq(mod(floor(t*2),4),1),783.99,if(eq(mod(floor(t*2),4),2),987.77,880)))';
    const mix = `0.22*(sin(2*PI*${f}*t)+0.5*sin(2*PI*2*${f}*t)+0.25*sin(2*PI*3.01*${f}*t))*exp(-mod(t,0.5)*5)`;
    return [mix, mix];
  })(),
  // Bourdon stéréo : deux notes légèrement décalées (figures de Lissajous)
  drone: [
    '0.35*sin(2*PI*196*t)+0.12*sin(2*PI*392*t)',
    '0.35*sin(2*PI*293.66*t+0.8*sin(2*PI*0.2*t))+0.12*sin(2*PI*587.33*t)',
  ],
};

const audioInput = (name, d) => ['-f', 'lavfi', '-i', `aevalsrc=exprs='${AUDIO[name][0]}|${AUDIO[name][1]}':s=44100:d=${d}`];
// Texte posé sur la vidéo (apostrophes et deux-points échappés pour drawtext)
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, '’').replace(/:/g, '\\:').replace(/%/g, '\\%');
// Largeur approchée du texte (DejaVu Sans Bold, en « em ») : sert à le garder dans la zone sûre
// (80 % de la largeur), visible même quand un téléphone très haut recadre un peu les côtés.
const units = (s) => [...s].reduce((n, c) => n + (c === ' ' ? 0.35 : /[A-ZÀ-Ý]/.test(c) ? 0.77 : /[a-zà-ÿ]/.test(c) ? 0.65 : /\d/.test(c) ? 0.7 : 0.62), 0);
const fitSize = (s, size, box) => Math.min(size, Math.floor((0.8 * W - (box ? 44 : 0)) / units(s)));
const text = (s, { y = 'h*0.12', size = 54, from = 0, to = 999, box = true, color = 'white' } = {}) =>
  `drawtext=fontfile=${FONT}:text='${esc(s)}':fontsize=${fitSize(s, size, box)}:fontcolor=${color}:x=(w-text_w)/2:y=${y}:enable='between(t,${from},${to})'` +
  (box ? ':box=1:boxcolor=black@0.38:boxborderw=22' : ':shadowcolor=black@0.6:shadowx=3:shadowy=3');
const slides = (list, { start = 0, step = 3, size = 50, y = 'h*0.42' } = {}) =>
  list.map((line, i) => text(line, { y, size, from: start + i * step, to: start + (i + 1) * step - 0.05 })).join(',');

// Vidéos : visuel (entrée vidéo ou filtre sur le son), musique, durée
const VIDEOS = [
  { id: 'd01', d: 10, audio: 'synth', crf: 38, video: 'mandelbrot=s=240x426:rate=15:start_scale=3:end_scale=0.004:end_pts=150:maxiter=300,scale=720:1280:flags=bicubic,gblur=sigma=1.5,fps=30,format=yuv420p', after: text('ZOOM INFINI', { size: 64, box: false }) },
  { id: 'd02', d: 10, audio: 'chip', crf: 34, video: 'life=s=180x320:mold=10:r=10:ratio=0.12:death_color=#2b1a66:life_color=#00e0a4:seed=7,scale=720:1280:flags=neighbor,fps=30,format=yuv420p', after: text('LE JEU DE LA VIE', { size: 60 }) },
  { id: 'd03', d: 10, audio: 'chip', video: "cellauto=rule=110:s=360x640:rate=30:full=0:scroll=1:start_full=0,scale=720:1280:flags=neighbor,lutrgb=r='val*0.45':g='val*0.25':b='val',format=yuv420p", after: text('RÈGLE 110', { size: 64 }) },
  { id: 'd04', d: 12, audio: 'chill', video: `gradients=s=${W}x${H}:c0=0x6c4dff:c1=0xff3d7f:c2=0x00d1a0:c3=0xffc247:n=4:speed=0.015:type=radial:r=30:seed=3,format=yuv420p`, after: [text('Respire avec les couleurs', { y: 'h*0.45', size: 48, box: false, from: 0, to: 6 }), text('Inspire… expire…', { y: 'h*0.45', size: 52, box: false, from: 6, to: 12 })].join(',') },
  { id: 'd05', d: 10, audio: 'lofi', video: "nullsrc=s=360x640:r=30,geq=r='128+127*sin(X/19+T*2.1)':g='128+127*sin((X+Y)/27+T*1.4)':b='128+127*sin(hypot(X-180,Y-320)/15-T*3)',scale=720:1280,format=yuv420p", after: text('PLASMA RÉTRO', { size: 62 }) },
  { id: 'd06', d: 12, audio: 'synth', filter: `[0:a]showfreqs=s=${W}x${H}:mode=bar:fscale=log:ascale=sqrt:colors=0x6c4dff|0xff3d7f:win_size=2048,format=yuv420p[v]`, after: text('NOUVEAU SON SYNTHWAVE', { size: 46 }) },
  { id: 'd07', d: 10, audio: 'bells', filter: `[0:a]showspectrum=s=${W}x${H}:orientation=vertical:slide=scroll:color=fiery:scale=cbrt:fscale=log,format=yuv420p[v]`, after: text('LE SPECTRE DES CLOCHES', { size: 44 }) },
  { id: 'd08', d: 10, audio: 'drone', crf: 36, filter: `[0:a]avectorscope=s=480x480:mode=lissajous_xy:draw=line:scale=sqrt:rc=110:gc=80:bc=255:rf=6:gf=8:bf=3:zoom=1.4,scale=720:720,pad=720:1280:0:280:color=0x0b0820,format=yuv420p[v]`, after: text('LISSAJOUS EN STÉRÉO', { size: 50 }) },
  {
    id: 'd09', d: 12, audio: 'synth', video: `color=c=0x1b1432:s=${W}x${H}:r=30,format=yuv420p`,
    after: [text('3 RACCOURCIS UTILES', { y: 'h*0.16', size: 52 }), slides(['Ctrl + Z  →  annuler', 'Ctrl + Maj + T  →  onglet fermé', 'Win + V  →  presse-papiers', 'Enregistre pour plus tard !'], { size: 42 })].join(','),
  },
  { id: 'd10', d: 11, audio: 'beat', video: `color=c=0xff3d7f:s=${W}x${H}:r=30,format=yuv420p`, after: [text('DÉFI : 10 SECONDES', { y: 'h*0.14', size: 54 }), `drawtext=fontfile=${FONT}:text='%{eif\\:max(0\\,10-t)\\:d}':fontsize=360:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:shadowcolor=black@0.4:shadowx=6:shadowy=6`].join(',') },
  {
    id: 'd11', d: 12, audio: 'lofi', video: `color=c=0xfff3e0:s=${W}x${H}:r=30,format=yuv420p`,
    after: [text('PÂTES CITRON & BASILIC', { y: 'h*0.15', size: 48, color: 'white' }), slides(['1. Zeste et jus d’un citron', '2. Parmesan + huile d’olive', '3. Mélange aux pâtes chaudes', '4. Basilic frais. C’est prêt !'], { size: 40 })].join(','),
  },
  {
    id: 'd12', d: 12, audio: 'chill', video: `gradients=s=${W}x${H}:c0=0xff7a59:c1=0x6c4dff:c2=0x1b1432:n=3:speed=0.01:type=linear:seed=11,format=yuv420p`,
    after: [text('3 IDÉES DE WEEK-END', { y: 'h*0.15', size: 50 }), slides(['Annecy et son lac', 'Colmar en décembre', 'Biarritz hors saison', 'Tu choisis lequel ?'], { size: 46 })].join(','),
  },
  { id: 'd13', d: 11, audio: 'beat', video: `gradients=s=${W}x${H}:c0=0x00d1a0:c1=0x0b5d4b:n=2:speed=0.02:type=circular:seed=5,format=yuv420p`, after: [text('GAINAGE : TIENS BON', { y: 'h*0.14', size: 52 }), `drawtext=fontfile=${FONT}:text='%{eif\\:max(0\\,10-t)\\:d}':fontsize=300:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:shadowcolor=black@0.4:shadowx=6:shadowy=6`].join(',') },
  { id: 'd14', d: 12, audio: 'beat', filter: `[0:a]showcqt=s=${W}x${H}:bar_g=2:sono_g=4:axis=0:text=0:count=3,format=yuv420p[v]`, after: text('BOUGE SUR CE RYTHME', { size: 50 }) },
];

function run(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(r.stderr || `ffmpeg a échoué (${r.status})`);
}
function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', file], { encoding: 'utf8' });
  const j = JSON.parse(r.stdout);
  const s = j.streams.find((x) => x.width) || {};
  return { duration: Number(j.format.duration), width: s.width, height: s.height };
}

const enc = (crf = 30) => ['-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-g', '60', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-ar', '44100'];
const only = process.argv.slice(2);
const manifest = [];
for (const v of VIDEOS) {
  const file = path.join(OUT, `${v.id}.mp4`);
  const poster = path.join(OUT, `${v.id}.jpg`);
  if (!only.length || only.includes(v.id)) {
    const t0 = Date.now();
    if (v.filter) {
      run([...audioInput(v.audio, v.d), '-filter_complex', `${v.filter};[v]${v.after}[out]`, '-map', '[out]', '-map', '0:a', '-r', '30', '-t', String(v.d), ...enc(v.crf), file]);
    } else {
      run(['-f', 'lavfi', '-i', `${v.video},${v.after}`, ...audioInput(v.audio, v.d), '-map', '0:v', '-map', '1:a', '-t', String(v.d), '-r', '30', ...enc(v.crf), file]);
    }
    run(['-ss', '1.2', '-i', file, '-frames:v', '1', '-vf', 'scale=540:960', '-q:v', '4', poster]);
    console.log(`${v.id} : ${(fs.statSync(file).size / 1024).toFixed(0)} Ko en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  if (!fs.existsSync(file)) continue;
  const info = probe(file);
  manifest.push({ id: v.id, file: `${v.id}.mp4`, poster: `${v.id}.jpg`, audio: v.audio, size: fs.statSync(file).size, ...info });
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Total : ${(manifest.reduce((n, m) => n + m.size, 0) / 1048576).toFixed(1)} Mo`);
