import { api } from '../api.js';
import { store, disconnectRealtime } from '../store.js';
import { navigate } from '../router.js';
import { h, icon, avatar, toast, memberCard, cardSince, fullDate, memberNo, confirmDialog, modal, shrinkImage, TOO_BIG_GIF } from '../dom.js';
import { backHead } from './feed.js';
import { cropImage } from '../components/cropper.js';
import { pushCard } from '../components/pushcard.js';
import { LANG_CHOICES, myLang } from '../components/translate.js';

function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', null, label), input, hint ? h('small', { class: 'hint' }, hint) : null);
}

function imagePicker(onFile) {
  const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true });
  input.addEventListener('change', () => {
    const f = input.files[0];
    input.value = '';
    if (!f) return;
    if (f.type === 'image/gif' && f.size > TOO_BIG_GIF) return toast('GIF trop lourd (4 Mo maximum).', 'error');
    onFile(f);
  });
  return input;
}

export function settingsView(ctx) {
  const u = store.user;

  // --- Photo & couverture --------------------------------------------------
  const avatarHost = h('div');
  const coverHost = h('div', { class: 'cover cover-edit' });
  const paintMedia = () => {
    avatarHost.replaceChildren(avatar(store.user, 'lg'));
    coverHost.replaceChildren(...(store.user.cover ? [h('img', { src: store.user.cover, alt: '' })] : []));
  };
  paintMedia();

  const upload = async (kind, file) => {
    const fd = new FormData();
    // Recadrage : jamais d'image étirée, l'utilisateur choisit le cadre (GIF animés conservés tels quels)
    let small;
    if (file.type === 'image/gif') small = file;
    else {
      const cropped = await cropImage(file, kind === 'avatar' ? { aspect: 1, round: true, outWidth: 800, title: 'Photo de profil' } : { aspect: 3, outWidth: 1500, title: 'Photo de couverture' });
      if (!cropped) return;
      small = await shrinkImage(cropped, kind === 'avatar' ? 800 : 1600);
    }
    fd.append('image', small, small.name || 'photo.jpg');
    try {
      const { user } = await api.post(`/api/me/${kind}`, fd);
      store.setUser(user);
      paintMedia();
      toast(kind === 'avatar' ? 'Photo mise à jour.' : 'Couverture mise à jour.');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const removeMedia = async (kind) => {
    try {
      const { user } = await api.del(`/api/me/${kind}`);
      store.setUser(user);
      paintMedia();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const avatarInput = imagePicker((f) => upload('avatar', f));
  const coverInput = imagePicker((f) => upload('cover', f));

  // --- Profil ---------------------------------------------------------------
  const displayName = h('input', { class: 'input', value: u.displayName, maxlength: 40, required: true });
  const profession = h('input', { class: 'input', value: u.profession, maxlength: 60, placeholder: 'Fondatrice, investisseur, architecte…' });
  const city = h('input', { class: 'input', value: u.city, maxlength: 60, placeholder: 'Paris, Genève, Monaco…' });
  const website = h('input', { class: 'input', value: u.website, maxlength: 120, placeholder: 'votre-site.com' });
  const bio = h('textarea', { class: 'textarea', maxlength: 280, placeholder: 'Quelques mots pour vous présenter au cercle.' });
  bio.value = u.bio;
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Enregistrer');

  const profileForm = h(
    'form',
    {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        saveBtn.disabled = true;
        try {
          const { user } = await api.patch('/api/me', {
            displayName: displayName.value,
            profession: profession.value,
            city: city.value,
            website: website.value,
            bio: bio.value,
          });
          store.setUser(user);
          website.value = user.website;
          toast('Profil enregistré.');
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          saveBtn.disabled = false;
        }
      },
    },
    h('h2', null, 'Votre profil'),
    h('p', { class: 'desc' }, 'Ce que voient les autres membres.'),
    h(
      'div',
      { class: 'media-edit' },
      avatarHost,
      h(
        'div',
        { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => avatarInput.click() }, icon('camera', 'icon-sm'), 'Changer la photo'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => coverInput.click() }, icon('image', 'icon-sm'), 'Changer la couverture'),
        h('button', { type: 'button', class: 'btn btn-sm', style: { color: 'var(--muted)' }, onclick: () => removeMedia('avatar') }, 'Retirer la photo'),
      ),
      avatarInput,
      coverInput,
    ),
    coverHost,
    h('div', { class: 'grid-2' }, field('Nom affiché', displayName), field('Profession', profession)),
    h('div', { class: 'grid-2' }, field('Ville', city), field('Site web', website)),
    field('Biographie', bio, '280 caractères maximum. Les @mentions et #sujets sont cliquables.'),
    h('div', { class: 'row-end' }, h('a', { href: `/@${u.username}`, class: 'btn btn-ghost' }, 'Voir mon profil'), saveBtn),
  );

  // --- Carte de membre ------------------------------------------------------
  const membership = h(
    'div',
    { class: 'card' },
    h('h2', null, 'Votre carte'),
    h('p', { class: 'desc' }, u.founder ? 'Carte Fondateur : entrée gratuite à vie et avant-premières du cercle.' : 'Membre du cercle, à vie.'),
    h('div', { style: { maxWidth: '380px' } }, memberCard({ name: u.displayName, number: u.memberNumber, since: cardSince(u.joinedAt), founder: u.founder })),
    u.founder
      ? h(
          'ul',
          { class: 'founder-perks' },
          [
            ['sparkles', 'Avant-premières', 'Les annonces de la Direction, avant tout le monde.'],
            ['calendar', 'Agenda en avance', 'Les événements de la Direction s’ouvrent d’abord aux Fondateurs, pendant 48 h.'],
            ['gem', 'Entrée gratuite, à vie', 'Votre numéro ne sera jamais réattribué.'],
          ].map(([ic, t, d]) => h('li', null, icon(ic), h('div', null, h('b', null, t), h('small', null, d)))),
        )
      : null,
    h(
      'div',
      { class: 'profile-meta', style: { marginTop: '0' } },
      h('span', null, icon('gem'), memberNo(u.memberNumber)),
      h('span', null, icon('calendar'), `Admis le ${fullDate(u.joinedAt)}`),
      h('span', null, icon('mail'), u.email),
    ),
  );

  // --- Sécurité ---------------------------------------------------------------
  const current = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
  const next = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', minlength: 8, required: true });
  const pwBtn = h('button', { class: 'btn btn-ghost', type: 'submit' }, 'Changer le mot de passe');
  const security = h(
    'form',
    {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        pwBtn.disabled = true;
        try {
          await api.post('/api/auth/password', { current: current.value, next: next.value });
          security.reset();
          toast('Mot de passe modifié. Vos autres sessions ont été fermées.');
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          pwBtn.disabled = false;
        }
      },
    },
    h('h2', null, 'Sécurité'),
    h('div', { class: 'grid-2' }, field('Mot de passe actuel', current), field('Nouveau mot de passe', next, '8 caractères minimum.')),
    h('div', { class: 'row-end' }, pwBtn),
  );

  // --- Données ---------------------------------------------------------------
  const deleteAccount = async () => {
    const ok = await confirmDialog(
      'Quitter définitivement le cercle ?',
      `Votre profil, vos publications, vos messages et votre numéro seront supprimés.${store.config.paidEntry ? ' Le droit d’entrée ne sera pas remboursé.' : ''} Cette action est irréversible.`,
      'Continuer',
    );
    if (!ok) return;
    const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Votre mot de passe', required: true });
    const btn = h('button', { class: 'btn btn-danger btn-block', type: 'submit' }, 'Supprimer mon compte');
    const m = modal(
      'Confirmez avec votre mot de passe',
      h(
        'form',
        {
          class: 'modal-body',
          style: { display: 'grid', gap: '14px' },
          onsubmit: async (e) => {
            e.preventDefault();
            btn.disabled = true;
            try {
              await api.del('/api/me', { password: pw.value });
              m.close();
              disconnectRealtime();
              store.setUser(null);
              toast('Votre compte a été supprimé.');
              navigate('/');
            } catch (err) {
              toast(err.message, 'error');
              btn.disabled = false;
            }
          },
        },
        pw,
        btn,
      ),
    );
  };

  const data = h(
    'div',
    { class: 'card' },
    h('h2', null, 'Vos données'),
    h('p', { class: 'desc' }, 'Elles vous appartiennent : téléchargez-les ou effacez-les quand vous le souhaitez.'),
    h(
      'div',
      { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
      h('a', { href: '/api/me/export', class: 'btn btn-ghost', download: `aurum-${u.username}.json` }, icon('download', 'icon-sm'), 'Exporter mes données'),
      h('button', { class: 'btn btn-danger', onclick: deleteAccount }, icon('trash', 'icon-sm'), 'Supprimer mon compte'),
    ),
  );

  // --- Membres bloqués ---------------------------------------------------------
  const blockedList = h('div', { class: 'blocked-list' }, h('p', { class: 'muted small' }, 'Chargement…'));
  const paintBlocked = async () => {
    try {
      const { users } = await api.get('/api/me/blocked');
      if (!users.length) {
        blockedList.replaceChildren(h('p', { class: 'muted small' }, 'Vous n’avez bloqué personne.'));
        return;
      }
      blockedList.replaceChildren(
        ...users.map((b) =>
          h(
            'div',
            { class: 'user-row' },
            avatar(b, 'sm'),
            h('span', { class: 'meta' }, h('b', null, b.displayName), h('small', null, `@${b.username}`)),
            h('button', {
              class: 'btn btn-secondary btn-sm',
              onclick: async () => {
                try {
                  await api.del(`/api/users/${encodeURIComponent(b.username)}/block`);
                  toast(`${b.displayName} est débloqué.`);
                  paintBlocked();
                } catch (err) {
                  toast(err.message, 'error');
                }
              },
            }, 'Débloquer'),
          ),
        ),
      );
    } catch (err) {
      blockedList.replaceChildren(h('p', { class: 'muted small' }, err.message));
    }
  };
  paintBlocked();
  const blockedCard = h(
    'div',
    { class: 'card' },
    h('h2', null, 'Membres bloqués'),
    h('p', { class: 'desc' }, 'Ils ne voient plus votre profil ni vos publications, et ne peuvent plus vous écrire.'),
    blockedList,
  );

  const notifCard = pushCard();

  // --- Courriels ------------------------------------------------------------------
  const digest = h('input', { type: 'checkbox', class: 'switch', checked: store.user.emailDigest !== false, 'aria-label': 'Recevoir la Lettre du cercle' });
  digest.addEventListener('change', async () => {
    try {
      const { user } = await api.post('/api/me/emails', { digest: digest.checked });
      store.setUser(user);
      toast(digest.checked ? 'Vous recevrez la Lettre chaque dimanche.' : 'Vous ne recevrez plus la Lettre.');
    } catch (err) {
      digest.checked = !digest.checked;
      toast(err.message, 'error');
    }
  });
  // --- Langue des traductions ----------------------------------------------------
  const langSelect = h('select', { class: 'input', 'aria-label': 'Langue des traductions' }, LANG_CHOICES.map(([code, name]) => h('option', { value: code }, name)));
  langSelect.value = myLang();
  langSelect.addEventListener('change', async () => {
    try {
      const { user } = await api.post('/api/me/lang', { lang: langSelect.value });
      store.setUser(user);
      toast('Langue des traductions enregistrée.');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  const langCard = h(
    'div',
    { class: 'card' },
    h('h2', null, 'Traduction'),
    h('p', { class: 'desc' }, 'Sous chaque publication, commentaire ou message écrit dans une autre langue, « Voir la traduction » le traduit dans la langue de votre choix.'),
    h('label', { class: 'field' }, h('span', null, 'Traduire les contenus en'), langSelect),
  );

  const mailCard = h(
    'div',
    { class: 'card' },
    h('h2', null, 'Courriels'),
    h('p', { class: 'desc' }, `Envoyés à ${u.email}. Les courriels de sécurité (mot de passe oublié) sont toujours envoyés.`),
    h('label', { class: 'admission-mode', style: { boxShadow: 'none', padding: '4px 0', background: 'transparent' } }, h('span', { class: 'grow' }, h('b', null, 'La Lettre du cercle'), h('small', { class: 'muted' }, 'Chaque dimanche matin : les événements, les meilleures publications, le Journal et l’adresse de la semaine.')), digest),
  );
  notifCard.id = 'notifications';
  if (location.hash === '#notifications') setTimeout(() => notifCard.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);

  ctx.title = 'Réglages — AURUM';
  return h('div', null, backHead('Réglages', `@${u.username}`), h('div', { class: 'settings' }, profileForm, notifCard, langCard, mailCard, membership, security, blockedCard, data));
}
