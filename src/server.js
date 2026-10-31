import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { getCard, getScan, upsertCard } from './db.js';
import { addToCollection, deleteRow, listCollection, updateRow } from './collection.js';
import { toCsv } from './csv.js';
import { SUPPORTED_LANGS } from './matching.js';
import { getPriceHistory, refreshCard, refreshPrices } from './pricing.js';
import { TcgdexUnavailable } from './tcgdex.js';

const BODY_LIMIT = 10 * 1024 * 1024;
const SESSION_COOKIE = 'session';
const YEAR_SECONDS = 365 * 24 * 3600;

const sessionToken = (pin) => createHmac('sha256', pin).update('pokecard-session').digest('hex');

function sameSecret(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

function assertLang(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) throw new RangeError('Langue invalide');
}

function createManualCard(db, { name, setName, number }, lang) {
  if (typeof name !== 'string' || !name.trim()) throw new RangeError('Nom de carte requis');
  const id = `manual-${randomUUID()}`;
  upsertCard(db, {
    id,
    lang,
    name: name.trim(),
    setId: null,
    setName: setName ?? null,
    number: number ?? null,
    printedTotal: null,
    rarity: null,
    imageUrl: null,
    prices: {
      trend: null, trendHolo: null, low: null, lowHolo: null, avg30: null, avg30Holo: null, updatedAt: null,
    },
  });
  return id;
}

export function buildApp({
  db, scanner, tcgdex, pin = null, photosDir, publicDir, logger = false,
}) {
  const app = Fastify({ bodyLimit: BODY_LIMIT, logger });

  app.register(fastifyCookie);
  app.register(fastifyStatic, { root: publicDir });
  app.register(fastifyStatic, { root: photosDir, prefix: '/photos/', decorateReply: false });

  app.addContentTypeParser('image/jpeg', { parseAs: 'buffer' }, (_req, buffer, done) => done(null, buffer));

  app.setErrorHandler((error, _req, reply) => {
    if (error.statusCode && error.statusCode < 500) return reply.code(error.statusCode).send({ message: error.message });
    if (error instanceof RangeError) return reply.code(400).send({ message: error.message });
    if (error instanceof TcgdexUnavailable) {
      return reply.code(503).send({ message: 'La base de cartes est indisponible, réessaie plus tard.' });
    }
    app.log.error(error);
    return reply.code(500).send({ message: 'Erreur interne du serveur.' });
  });

  app.addHook('onRequest', async (req, reply) => {
    if (!pin || req.url === '/api/login') return;
    if (!req.url.startsWith('/api/') && !req.url.startsWith('/photos/')) return;
    if (!sameSecret(req.cookies[SESSION_COOKIE], sessionToken(pin))) {
      reply.code(401).send({ message: 'Code PIN requis.' });
    }
  });

  const notFound = (reply, message) => reply.code(404).send({ message });

  app.post('/api/login', async (req, reply) => {
    if (!pin) return { ok: true };
    if (!sameSecret(req.body?.pin, pin)) return reply.code(401).send({ message: 'Code PIN incorrect.' });
    reply.setCookie(SESSION_COOKIE, sessionToken(pin), {
      httpOnly: true, sameSite: 'strict', path: '/', maxAge: YEAR_SECONDS,
    });
    return { ok: true };
  });

  app.post('/api/scan', async (req, reply) => {
    if (req.headers['content-type'] !== 'image/jpeg') {
      return reply.code(415).send({ message: 'La photo doit être au format JPEG.' });
    }
    if (!req.body?.length) return reply.code(400).send({ message: 'Photo manquante.' });
    return scanner.scan(req.body);
  });

  app.post('/api/scan/:id/retry', async (req, reply) => {
    const result = await scanner.retry(Number(req.params.id));
    return result ?? notFound(reply, 'Scan introuvable.');
  });

  app.get('/api/cards/search', async (req) => {
    const lang = req.query.lang ?? 'fr';
    assertLang(lang);
    if (!req.query.name?.trim()) throw new RangeError('Nom de carte requis');
    return tcgdex.searchCards({ name: req.query.name.trim(), lang });
  });

  app.get('/api/cards/:id', async (req, reply) => {
    const lang = req.query.lang ?? 'fr';
    const card = getCard(db, req.params.id, lang);
    if (!card) return notFound(reply, 'Carte introuvable.');
    return { card, history: getPriceHistory(db, card.id, lang) };
  });

  app.post('/api/collection', async (req, reply) => {
    const { cardId, lang, variant, condition, quantity, note, scanId, manualCard } = req.body ?? {};
    assertLang(lang);

    let id = cardId;
    if (manualCard) {
      id = createManualCard(db, manualCard, lang);
    } else if (!getCard(db, id, lang)) {
      const fetched = await tcgdex.getCard(String(id), lang);
      if (!fetched) return notFound(reply, 'Carte introuvable dans cette langue.');
      upsertCard(db, fetched);
    }

    const row = addToCollection(db, {
      cardId: id,
      lang,
      variant,
      condition,
      quantity,
      note: note ?? null,
      scanId: scanId ?? null,
      photoPath: scanId ? getScan(db, scanId)?.photoPath ?? null : null,
    });
    return reply.code(201).send(row);
  });

  app.patch('/api/collection/:id', async (req, reply) => {
    const row = updateRow(db, Number(req.params.id), req.body ?? {});
    return row ?? notFound(reply, 'Ligne introuvable.');
  });

  app.delete('/api/collection/:id', async (req, reply) => {
    if (!deleteRow(db, Number(req.params.id))) return notFound(reply, 'Ligne introuvable.');
    return reply.code(204).send();
  });

  app.get('/api/collection', async (req) => listCollection(db, req.query));

  app.get('/api/export.csv', async (_req, reply) => reply
    .type('text/csv; charset=utf-8')
    .header('content-disposition', 'attachment; filename="pokecard-collection.csv"')
    .send(toCsv(listCollection(db, { sort: 'name' }).rows)));

  app.post('/api/prices/refresh', async (req, reply) => {
    const { id, lang } = req.body ?? {};
    if (!id) return refreshPrices(db, tcgdex);
    const card = await refreshCard(db, tcgdex, id, lang);
    return card ? { card } : notFound(reply, 'Carte introuvable.');
  });

  return app;
}
