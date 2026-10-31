import { getCard, getSetting, setSetting, upsertCard } from './db.js';

const DAY_MS = 86_400_000;
const PRICE_FIELDS = ['trend', 'trendHolo', 'low', 'lowHolo', 'avg30', 'avg30Holo'];

export function priceFor(card, variant, metric = 'trend') {
  const base = card.prices[metric] ?? null;
  if (variant !== 'reverse') return base;
  return card.prices[`${metric}Holo`] ?? base;
}

export const hasPrice = (card) => PRICE_FIELDS.some((field) => card.prices[field] !== null);
const isManual = (id) => id.startsWith('manual-');
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function savePrices(db, card) {
  upsertCard(db, card);
  db.prepare(`
    INSERT INTO price_history (card_id, lang, date, trend, trend_holo) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (card_id, lang, date) DO UPDATE SET trend = excluded.trend, trend_holo = excluded.trend_holo
  `).run(card.id, card.lang, new Date().toISOString().slice(0, 10), card.prices.trend, card.prices.trendHolo);
}

export async function refreshCard(db, tcgdex, id, lang) {
  if (!isManual(id)) {
    const fresh = await tcgdex.getCard(id, lang);
    if (fresh && hasPrice(fresh)) savePrices(db, fresh);
  }
  return getCard(db, id, lang);
}

export async function refreshPrices(db, tcgdex, { delayMs = 200 } = {}) {
  const owned = db.prepare('SELECT DISTINCT card_id AS id, lang FROM collection').all()
    .filter((card) => !isManual(card.id));
  let updated = 0;
  let failed = 0;
  for (const { id, lang } of owned) {
    try {
      const fresh = await tcgdex.getCard(id, lang);
      if (!fresh) {
        failed += 1;
      } else if (hasPrice(fresh)) {
        savePrices(db, fresh);
        updated += 1;
      }
    } catch {
      failed += 1;
    }
    if (delayMs) await sleep(delayMs);
  }
  return { updated, failed };
}

export function getPriceHistory(db, id, lang) {
  return db.prepare(`
    SELECT date, trend, trend_holo AS trendHolo FROM price_history
    WHERE card_id = ? AND lang = ? ORDER BY date
  `).all(id, lang);
}

export function startDailyRefresh(db, tcgdex, {
  intervalMs = DAY_MS, delayMs, log = console.error,
} = {}) {
  const run = async () => {
    try {
      await refreshPrices(db, tcgdex, { delayMs });
      setSetting(db, 'lastPriceRefresh', new Date().toISOString());
    } catch (error) {
      log('Rafraîchissement des prix en échec', error);
    }
  };
  const last = Date.parse(getSetting(db, 'lastPriceRefresh', '')) || 0;
  if (Date.now() - last >= intervalMs) run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
