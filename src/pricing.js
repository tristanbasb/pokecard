export function priceFor(card, variant, metric = 'trend') {
  const base = card.prices[metric] ?? null;
  if (variant !== 'reverse') return base;
  return card.prices[`${metric}Holo`] ?? base;
}
