// Recadrage d'une photo : glisser pour placer, pincer / molette / curseur pour zoomer.
// Renvoie un fichier JPEG aux bonnes proportions (jamais déformé), ou null si annulé.
import { h, icon, modal } from '../dom.js';

export function cropImage(file, { aspect = 1, round = false, outWidth = 1000, title = 'Recadrer' } = {}) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = h('img', { class: 'crop-img', src: url, alt: '', draggable: 'false' });
    const stage = h('div', { class: `crop-stage${round ? ' round' : ''}`, style: { aspectRatio: String(aspect) } }, img, h('div', { class: 'crop-mask' }));
    const zoom = h('input', { type: 'range', min: '1', max: '4', step: '0.01', value: '1', class: 'crop-zoom', 'aria-label': 'Zoom' });
    const save = h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, 'Enregistrer');
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(value);
    };

    const m = modal(
      title,
      h(
        'div',
        { class: 'modal-body crop' },
        stage,
        h('div', { class: 'crop-controls' }, icon('image', 'icon-sm'), zoom, icon('image')),
        h('p', { class: 'muted small', style: { textAlign: 'center' } }, 'Faites glisser pour placer la photo, pincez ou utilisez le curseur pour zoomer.'),
        h('div', { class: 'row-end' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Annuler'), save),
      ),
      { onClose: () => finish(null) },
    );

    // État : échelle de base (l'image couvre le cadre), zoom, position du coin haut-gauche.
    let W = 0;
    let H = 0;
    let iw = 0;
    let ih = 0;
    let base = 1;
    let z = 1;
    let x = 0;
    let y = 0;
    const scale = () => base * z;
    const clamp = () => {
      const s = scale();
      x = Math.min(0, Math.max(W - iw * s, x));
      y = Math.min(0, Math.max(H - ih * s, y));
    };
    const paint = () => {
      img.style.width = `${iw * scale()}px`;
      img.style.height = `${ih * scale()}px`;
      img.style.transform = `translate(${x}px, ${y}px)`;
    };
    const setZoom = (next, cx = W / 2, cy = H / 2) => {
      const old = scale();
      z = Math.min(4, Math.max(1, next));
      const s = scale();
      // Le point sous les doigts reste en place
      x = cx - ((cx - x) * s) / old;
      y = cy - ((cy - y) * s) / old;
      clamp();
      paint();
      zoom.value = String(z);
    };
    const layout = () => {
      const r = stage.getBoundingClientRect();
      W = r.width;
      H = r.height;
      base = Math.max(W / iw, H / ih);
      x = (W - iw * scale()) / 2;
      y = (H - ih * scale()) / 2;
      clamp();
      paint();
    };

    img.addEventListener('load', () => {
      iw = img.naturalWidth;
      ih = img.naturalHeight;
      requestAnimationFrame(layout);
      save.disabled = false;
    });

    // Glisser et pincer (pointeurs multiples)
    const pointers = new Map();
    let pinch = null;
    stage.addEventListener('pointerdown', (e) => {
      stage.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z };
      }
    });
    stage.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, cur);
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const r = stage.getBoundingClientRect();
        setZoom((pinch.z * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      } else if (pointers.size === 1) {
        x += cur.x - prev.x;
        y += cur.y - prev.y;
        clamp();
        paint();
      }
    });
    const release = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    stage.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = stage.getBoundingClientRect();
        setZoom(z * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false },
    );
    zoom.addEventListener('input', () => setZoom(Number(zoom.value)));

    save.addEventListener('click', async () => {
      save.disabled = true;
      const s = scale();
      const outW = Math.min(outWidth, Math.round(W / s)); // jamais agrandir au-delà de la photo d'origine
      const outH = Math.round((outW * H) / W); // mêmes proportions que le cadre affiché : aucune déformation
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const g = canvas.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, outW, outH);
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, -x / s, -y / s, W / s, H / s, 0, 0, outW, outH);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
      done = true;
      URL.revokeObjectURL(url);
      m.close();
      resolve(blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : null);
    });
  });
}
