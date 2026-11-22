'use strict';
// Catégories de l'Explorer (choisies à la publication, et au premier lancement comme centres d'intérêt)
const CATEGORIES = [
  { id: 'humour', label: 'Humour', emoji: '😂' },
  { id: 'danse', label: 'Danse', emoji: '💃' },
  { id: 'musique', label: 'Musique', emoji: '🎵' },
  { id: 'sport', label: 'Sport', emoji: '⚽' },
  { id: 'cuisine', label: 'Cuisine', emoji: '🍳' },
  { id: 'beaute', label: 'Beauté', emoji: '💄' },
  { id: 'mode', label: 'Mode', emoji: '👗' },
  { id: 'animaux', label: 'Animaux', emoji: '🐶' },
  { id: 'jeux', label: 'Jeux vidéo', emoji: '🎮' },
  { id: 'voyage', label: 'Voyage', emoji: '✈️' },
  { id: 'savoir', label: 'Savoir', emoji: '📚' },
  { id: 'tech', label: 'Tech', emoji: '📱' },
  { id: 'auto', label: 'Auto & moto', emoji: '🏎️' },
  { id: 'art', label: 'Art & DIY', emoji: '🎨' },
  { id: 'fitness', label: 'Fitness', emoji: '💪' },
  { id: 'quotidien', label: 'Vie quotidienne', emoji: '☀️' },
];
const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

module.exports = { CATEGORIES, CATEGORY_IDS };
