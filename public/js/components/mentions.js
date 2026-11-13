import { api, enc } from '../api.js';
import { h, avatar } from '../dom.js';

// Suggestions de membres quand on tape « @… » dans un champ de texte.
// placement : « below » (sous le champ) ou « above » (au-dessus, pour les champs en bas d'écran).
export function attachMentions(textarea, { placement = 'below' } = {}) {
  const host = textarea.parentElement;
  host.classList.add('mention-host');
  const box = h('div', { class: `mention-box ${placement}`, role: 'listbox', hidden: true });
  host.append(box);
  let users = [];
  let active = 0;
  let timer = null;
  let seq = 0;

  const query = () => {
    const before = textarea.value.slice(0, textarea.selectionStart);
    const m = /(?:^|[\s(])@([a-z0-9_.]{1,20})$/i.exec(before);
    return m ? m[1] : null;
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
          avatar(u, 'xs'),
          h('span', { class: 'mention-name' }, u.displayName),
          h('small', null, `@${u.username}`),
        ),
      ),
    );
    box.hidden = !users.length;
  };
  const choose = (u) => {
    const pos = textarea.selectionStart;
    const before = textarea.value.slice(0, pos).replace(/@([a-z0-9_.]{0,20})$/i, `@${u.username} `);
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
        const res = await api.get(`/api/search?only=users&q=${enc(q)}`);
        if (mine !== seq) return;
        users = res.users.filter((u) => !u.isMe).slice(0, 5);
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
