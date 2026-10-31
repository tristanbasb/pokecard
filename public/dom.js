const present = (children) => children.flat().filter((child) => child !== null && child !== undefined && child !== false);

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== undefined && value !== null && value !== false) {
      if (key in node) node[key] = value;
      else node.setAttribute(key, value);
    }
  }
  node.append(...present(children));
  return node;
}

export function fill(node, ...children) {
  node.replaceChildren(...present(children));
}

export function select(options, value, props = {}) {
  return el('select', props, options.map(([optionValue, label]) => el('option', {
    value: optionValue,
    selected: optionValue === value,
  }, label)));
}

const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
export const formatEuro = (value) => euros.format(value);
export const formatPrice = (value) => (value === null || value === undefined ? 'Prix inconnu' : formatEuro(value));

export function cardImage(src, alt) {
  if (!src) return el('div', { className: 'card-image card-image--empty' }, 'Pas d\'image');
  return el('img', { className: 'card-image', src, alt, loading: 'lazy' });
}

export const CONDITIONS = ['Mint', 'Near Mint', 'Excellent', 'Good', 'Light Played', 'Played', 'Poor']
  .map((value) => [value, value]);
export const VARIANTS = [['normal', 'Normale'], ['holo', 'Holo'], ['reverse', 'Reverse'], ['autre', 'Autre']];
export const LANGS = [
  ['fr', 'Français'], ['en', 'Anglais'], ['de', 'Allemand'], ['es', 'Espagnol'],
  ['it', 'Italien'], ['pt', 'Portugais'], ['ja', 'Japonais'],
];

export function priceFor(card, variant, metric = 'trend') {
  if (!card.prices) return null;
  const base = card.prices[metric] ?? null;
  if (variant !== 'reverse') return base;
  return card.prices[`${metric}Holo`] ?? base;
}
