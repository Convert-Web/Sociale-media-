import { api, enc } from '../api.js';
import { h, avatar } from '../dom.js';

// Suggestions de comptes quand on tape « @… », et de hashtags quand on tape « #… ».
// placement : « below » (sous le champ), « above » (au-dessus, pour les champs en bas d'écran)
// ou « inline » (dans le flux, juste sous le texte : jamais coupée par une feuille ou une carte).
export function attachMentions(textarea, { placement = 'below' } = {}) {
  const host = textarea.parentElement;
  host.classList.add('mention-host');
  const box = h('div', { class: `mention-box ${placement}`, role: 'listbox', hidden: true });
  if (placement === 'inline') textarea.after(box);
  else host.append(box);
  let users = [];
  let active = 0;
  let timer = null;
  let seq = 0;

  let kind = '@';
  const query = () => {
    const before = textarea.value.slice(0, textarea.selectionStart);
    const m = /(?:^|[\s(])([@#])([\p{L}\p{N}_.]{1,24})$/iu.exec(before);
    if (!m) return null;
    kind = m[1];
    return m[2];
  };
  const hide = () => {
    box.hidden = true;
    users = [];
  };
  const paint = () => {
    box.replaceChildren(
      ...users.map((u, i) =>
        h(
          'button',
          {
            type: 'button',
            class: `mention-item${i === active ? ' active' : ''}`,
            role: 'option',
            onmousedown: (e) => {
              e.preventDefault();
              choose(u);
            },
          },
          u.tag ? h('span', { class: 'mention-hash' }, '#') : avatar(u, 'xs'),
          h('span', { class: 'mention-name' }, u.tag ? `#${u.tag}` : u.displayName),
          h('small', null, u.tag ? `${u.posts} publication${u.posts > 1 ? 's' : ''}` : `@${u.username}`),
        ),
      ),
    );
    box.hidden = !users.length;
  };
  const choose = (u) => {
    const pos = textarea.selectionStart;
    const before = u.tag
      ? textarea.value.slice(0, pos).replace(/#([\p{L}\p{N}_]{0,40})$/iu, `#${u.tag} `)
      : textarea.value.slice(0, pos).replace(/@([a-z0-9_.]{0,24})$/i, `@${u.username} `);
    textarea.value = before + textarea.value.slice(pos);
    textarea.selectionStart = textarea.selectionEnd = before.length;
    hide();
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
  };

  textarea.addEventListener('input', () => {
    const q = query();
    clearTimeout(timer);
    if (!q) return hide();
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const res = await api.get(`/api/search/suggest?q=${enc(kind === '#' ? `#${q}` : q)}`);
        if (mine !== seq) return;
        users = kind === '#' ? res.tags.slice(0, 6) : res.users.filter((u) => !u.me).slice(0, 6);
        active = 0;
        paint();
      } catch {
        hide();
      }
    }, 160);
  });
  textarea.addEventListener(
    'keydown',
    (e) => {
      if (box.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : users.length - 1)) % users.length;
        paint();
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        e.stopImmediatePropagation();
        choose(users[active]);
      } else if (e.key === 'Escape') {
        hide();
      }
    },
    true,
  );
  textarea.addEventListener('blur', () => setTimeout(hide, 120));
}
