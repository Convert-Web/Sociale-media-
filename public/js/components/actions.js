// Actions partagées par toutes les pages : J'aime, favoris, republier, s'abonner, connexion requise.
import { api, enc } from '../api.js';
import { store } from '../store.js';
import { toast } from '../dom.js';

// Sans compte : la feuille de connexion s'ouvre (raison affichée), et l'action n'a pas lieu
export function needLogin(reason = 'Connecte-toi pour continuer.') {
  if (store.user) return false;
  document.dispatchEvent(new CustomEvent('vibz:login', { detail: { reason } }));
  return true;
}

// Bascule optimiste : l'écran change tout de suite, et revient en arrière si le serveur refuse
async function flip(post, key, countKey, path, onChange) {
  const was = post[key];
  post[key] = !was;
  post[countKey] = Math.max(0, (post[countKey] || 0) + (was ? -1 : 1));
  onChange?.(post);
  try {
    const r = was ? await api.del(path) : await api.post(path);
    if (typeof r?.[countKey] === 'number') post[countKey] = r[countKey];
    onChange?.(post);
    document.dispatchEvent(new CustomEvent('vibz:post', { detail: post }));
  } catch (err) {
    post[key] = was;
    post[countKey] = Math.max(0, (post[countKey] || 0) + (was ? 1 : -1));
    onChange?.(post);
    toast(err.message, 'error');
  }
}

export function toggleLike(post, onChange, { force = false } = {}) {
  if (needLogin('Connecte-toi pour aimer cette vidéo.')) return;
  if (force && post.liked) return;
  return flip(post, 'liked', 'likeCount', `/api/posts/${post.id}/like`, onChange);
}

export function toggleSave(post, onChange) {
  if (needLogin('Connecte-toi pour ajouter cette vidéo à tes favoris.')) return;
  const was = post.saved;
  return flip(post, 'saved', 'saveCount', `/api/posts/${post.id}/favorite`, onChange).then(() => {
    if (post.saved !== was) toast(post.saved ? 'Ajoutée aux favoris' : 'Retirée des favoris');
  });
}

export function toggleRepost(post, onChange) {
  if (needLogin('Connecte-toi pour republier cette vidéo.')) return;
  const was = post.reposted;
  return flip(post, 'reposted', 'repostCount', `/api/posts/${post.id}/repost`, onChange).then(() => {
    if (post.reposted !== was) toast(post.reposted ? 'Republiée : tes abonnés la verront' : 'Republication annulée');
  });
}

// S'abonner (ou demander à s'abonner à un compte privé) ; renvoie le profil à jour
export async function follow(username, on = true) {
  if (needLogin('Connecte-toi pour suivre ce compte.')) return null;
  try {
    const { user } = on ? await api.post(`/api/users/${enc(username)}/follow`) : await api.del(`/api/users/${enc(username)}/follow`);
    document.dispatchEvent(new CustomEvent('vibz:follow', { detail: user }));
    if (on && user.requested) toast('Demande d’abonnement envoyée');
    return user;
  } catch (err) {
    toast(err.message, 'error');
    return null;
  }
}

// Lien d'une vidéo (adresse partagée)
export const postPath = (post) => `/@${post.author.username}/video/${post.id}`;
