export const SUPPORTED_LANGS =['fr', 'en', 'de', 'es', 'it', 'pt', 'ja'];
const MAX_DETAILS = 8;

export function normalizeNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const printed = String(raw).split('/')[0].trim().toUpperCase();
  if (!printed) return null;
  const parts = printed.match(/^([A-Z]*)0*(\d+)([A-Z]*)$/);
  return parts ? `${parts[1]}${parts[2]}${parts[3]}` : printed;
}

export function pickCard(identification, candidates) {
  const sameTotal = candidates.filter((card) => card.printedTotal === identification.printedTotal);
  const kept = sameTotal.length > 0 ? sameTotal : candidates;
  if (kept.length === 0) return { card: null, alternatives: [], ambiguous: true };
  const [card, ...alternatives] = kept;
  return {
    card,
    alternatives,
    ambiguous: alternatives.length > 0 || identification.confidence === 'low',
  };
}

export async function findCard(identification, tcgdex) {
  const { name } = identification;
  if (!name) return pickCard(identification, []);

  const lang = SUPPORTED_LANGS.includes(identification.language) ? identification.language : 'en';
  const number = normalizeNumber(identification.number);
  const names = [...new Set([name, name.split(/[\s-]+/)[0]])];

  const details = async (briefs) => {
    const cards = await Promise.all(briefs.slice(0, MAX_DETAILS).map((brief) => tcgdex.getCard(brief.id, lang)));
    return cards.filter(Boolean);
  };

  // TCGdex's localId filter is a substring match on the raw number, so "TG3" misses "TG03": filter here instead.
  let sameName = [];
  for (const searched of names) {
    const briefs = await tcgdex.searchCards({ name: searched, number: null, lang });
    const exact = briefs.filter((brief) => number && normalizeNumber(brief.localId) === number);
    if (exact.length > 0) return pickCard(identification, await details(exact));
    if (sameName.length === 0) sameName = briefs;
  }
  if (sameName.length === 0) return pickCard(identification, []);
  return { ...pickCard(identification, await details(sameName)), ambiguous: true };
}
