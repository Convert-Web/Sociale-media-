// Validation des formulaires : messages clairs, en français, sous le champ concerné
// (à la place des bulles du navigateur, différentes d'un téléphone à l'autre).
// Fonctionne pour tous les formulaires de l'application, sans rien ajouter à chacun.

export function messageFor(el) {
  const v = el.validity;
  if (v.valueMissing) {
    if (el.dataset.missing) return el.dataset.missing;
    if (el.type === 'checkbox') return 'Coche cette case pour continuer.';
    if (el.type === 'file') return 'Choisis un fichier.';
    if (el.tagName === 'SELECT') return 'Choisis une option.';
    return 'Ce champ est obligatoire.';
  }
  if (v.typeMismatch) {
    if (el.type === 'email') return 'Adresse e-mail invalide (exemple : prenom@exemple.fr).';
    if (el.type === 'url') return 'Adresse web invalide (exemple : https://exemple.fr).';
    return 'Format non valide.';
  }
  if (v.tooShort) return `Au moins ${el.minLength} caractères (${el.value.length} pour l’instant).`;
  if (v.tooLong) return `${el.maxLength} caractères au maximum.`;
  if (v.patternMismatch) return el.dataset.hint || el.title || 'Format non valide.';
  if (v.rangeUnderflow) return `Valeur minimale : ${el.min}.`;
  if (v.rangeOverflow) return `Valeur maximale : ${el.max}.`;
  if (v.stepMismatch) return 'Valeur non valide.';
  if (v.badInput) return 'Valeur non valide.';
  return el.validationMessage || 'Champ à corriger.';
}

let seq = 0;
function show(el, msg) {
  const host = el.closest('.field') || el.parentElement;
  // Message déjà affiché pour ce champ (une case à cocher le place après son libellé, hors du bloc)
  const known = el.getAttribute('aria-describedby');
  let box = (known && document.getElementById(known)) || host.querySelector(':scope > .field-error');
  if (!box) {
    box = document.createElement('small');
    box.className = 'field-error';
    box.id = `err-${++seq}`;
    box.setAttribute('role', 'alert');
    // Sous le bloc du champ (y compris un champ avec préfixe « @ »), jamais à l'intérieur
    const anchor = el.type === 'checkbox' ? host : [...host.children].find((c) => c.contains(el)) || el;
    anchor.after(box);
  }
  box.textContent = msg;
  el.setAttribute('aria-invalid', 'true');
  el.setAttribute('aria-describedby', box.id);
}

// Erreur renvoyée par le serveur : sous le champ concerné, mise au point dessus
export function fieldError(el, msg) {
  show(el, msg);
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function clearError(el) {
  if (el.getAttribute('aria-invalid') !== 'true') return;
  el.removeAttribute('aria-invalid');
  const id = el.getAttribute('aria-describedby');
  if (id) document.getElementById(id)?.remove();
  el.removeAttribute('aria-describedby');
}

let focused = false;
export function installFormValidation() {
  // Le navigateur signale chaque champ invalide au moment d'envoyer le formulaire
  document.addEventListener(
    'invalid',
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      e.preventDefault(); // pas de bulle du navigateur : notre message à la place
      show(el, messageFor(el));
      if (!focused) {
        focused = true;
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        queueMicrotask(() => setTimeout(() => (focused = false), 0));
      }
    },
    true,
  );
  const recheck = (e) => {
    const el = e.target;
    if (el?.validity && el.getAttribute('aria-invalid') === 'true') {
      if (el.validity.valid) clearError(el);
      else show(el, messageFor(el));
    }
  };
  document.addEventListener('input', recheck, true);
  document.addEventListener('change', recheck, true);
}
