const HEADER = ['Nom', 'Extension', 'Numéro', 'Rareté', 'Langue', 'Variante', 'État', 'Quantité', 'Prix de référence (€)', 'Note'];

function text(value) {
  if (value === null || value === undefined) return '';
  const safe = /^[=+\-@]/.test(String(value)) ? `'${value}` : String(value);
  return /[;"\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const price = (value) => (value === null ? '' : String(value).replace('.', ','));

export function toCsv(rows) {
  const lines = rows.map((row) => [
    text(row.card.name),
    text(row.card.setName),
    text(row.card.number),
    text(row.card.rarity),
    text(row.lang),
    text(row.variant),
    text(row.condition),
    row.quantity,
    price(row.price),
    text(row.note),
  ].join(';'));
  return `﻿${[HEADER.join(';'), ...lines].join('\r\n')}`;
}
