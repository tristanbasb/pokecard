const POCKET_ID = /^((A|B)\d|P-A)/;
const TIMEOUT_MS = 10_000;

export class TcgdexUnavailable extends Error {}

const positive = (value) => (typeof value === 'number' && value > 0 ? value : null);
const imageUrl = (base) => (base ? `${base}/high.webp` : null);

function mapCard(raw, lang) {
  const market = raw.pricing?.cardmarket;
  return {
    id: raw.id,
    lang,
    name: raw.name,
    setId: raw.set?.id ?? null,
    setName: raw.set?.name ?? null,
    number: raw.localId ?? null,
    printedTotal: raw.set?.cardCount?.official ?? null,
    rarity: raw.rarity ?? null,
    imageUrl: imageUrl(raw.image),
    prices: {
      trend: positive(market?.trend),
      trendHolo: positive(market?.['trend-holo']),
      low: positive(market?.low),
      lowHolo: positive(market?.['low-holo']),
      avg30: positive(market?.avg30),
      avg30Holo: positive(market?.['avg30-holo']),
      updatedAt: market?.updated ?? null,
    },
  };
}

export function createTcgdex({ fetch = globalThis.fetch, baseUrl = 'https://api.tcgdex.net/v2' } = {}) {
  async function get(url) {
    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (cause) {
      throw new TcgdexUnavailable('TCGdex injoignable', { cause });
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new TcgdexUnavailable(`TCGdex a répondu ${response.status}`);
    try {
      return await response.json();
    } catch (cause) {
      throw new TcgdexUnavailable('Réponse TCGdex illisible', { cause });
    }
  }

  return {
    async getCard(id, lang) {
      const raw = await get(`${baseUrl}/${lang}/cards/${encodeURIComponent(id)}`);
      return raw ? mapCard(raw, lang) : null;
    },

    async searchCards({ name, number = null, lang }) {
      const params = new URLSearchParams({ name });
      if (number) params.set('localId', number);
      const raw = await get(`${baseUrl}/${lang}/cards?${params}`);
      return (raw ?? [])
        .filter((card) => !POCKET_ID.test(card.id))
        .map((card) => ({ id: card.id, localId: card.localId, name: card.name, imageUrl: imageUrl(card.image) }));
    },
  };
}
