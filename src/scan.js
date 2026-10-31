import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { getScan, getSetting, insertScan, updateScan, upsertCard } from './db.js';
import { findCard } from './matching.js';
import { priceFor } from './pricing.js';
import { TcgdexUnavailable } from './tcgdex.js';

const RETRYABLE = [
  Anthropic.APIConnectionError,
  Anthropic.RateLimitError,
  Anthropic.InternalServerError,
  Anthropic.AuthenticationError,
  Anthropic.PermissionDeniedError,
];

const NOT_READ = 'Carte non reconnue. Reprends la photo ou saisis le nom.';
const NOT_FOUND = 'Carte introuvable dans la base. Choisis-la à la main ou enregistre-la sans prix.';
const CLAUDE_DOWN = 'Claude est indisponible. La photo est gardée, tu pourras réessayer depuis Réglages.';
const TCGDEX_DOWN = 'La base de cartes est indisponible. La lecture est gardée, tu pourras réessayer depuis Réglages.';
const FAILED = 'Cette photo n\'a pas pu être lue. Reprends la photo ou saisis le nom.';

export function createScanner({ db, identify, tcgdex, photosDir }) {
  const photoFile = (scanId) => join(photosDir, `${scanId}.jpg`);

  const result = (scanId, status, fields = {}) => ({
    scanId,
    status,
    photoUrl: `/photos/${scanId}.jpg`,
    identification: null,
    card: null,
    alternatives: [],
    ambiguous: false,
    price: null,
    ...fields,
  });

  async function read(scanId, image) {
    const stored = getScan(db, scanId).response?.identification;
    if (stored) return stored;
    const { identification, usage, raw } = await identify(image.toString('base64'));
    updateScan(db, scanId, {
      response: { identification, raw },
      inputTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
    });
    return identification;
  }

  async function run(scanId, image) {
    let identification;
    try {
      identification = await read(scanId, image);
    } catch (error) {
      const status = RETRYABLE.some((type) => error instanceof type) ? 'pending' : 'failed';
      updateScan(db, scanId, { status });
      return result(scanId, status, { message: status === 'pending' ? CLAUDE_DOWN : FAILED });
    }

    let match;
    try {
      match = await findCard(identification, tcgdex);
    } catch (error) {
      if (!(error instanceof TcgdexUnavailable)) throw error;
      updateScan(db, scanId, { status: 'pending' });
      return result(scanId, 'pending', { identification, message: TCGDEX_DOWN });
    }

    updateScan(db, scanId, { status: 'done' });
    if (!match.card) {
      return result(scanId, 'done', {
        identification,
        ambiguous: true,
        message: identification.name ? NOT_FOUND : NOT_READ,
      });
    }

    const metric = getSetting(db, 'priceMetric', 'trend');
    for (const card of [match.card, ...match.alternatives]) upsertCard(db, card);
    return result(scanId, 'done', {
      identification,
      metric,
      card: match.card,
      alternatives: match.alternatives.map((card) => ({
        ...card,
        price: priceFor(card, identification.variant, metric),
      })),
      ambiguous: match.ambiguous,
      price: priceFor(match.card, identification.variant, metric),
    });
  }

  return {
    async scan(jpeg) {
      const scanId = insertScan(db, { photoPath: null });
      await writeFile(photoFile(scanId), jpeg);
      updateScan(db, scanId, { photoPath: `${scanId}.jpg` });
      return run(scanId, jpeg);
    },

    async retry(scanId) {
      if (!getScan(db, scanId)) return null;
      return run(scanId, await readFile(photoFile(scanId)));
    },
  };
}
