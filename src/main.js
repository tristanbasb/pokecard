import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { createIdentifier } from './claude.js';
import { openDb } from './db.js';
import { startDailyRefresh } from './pricing.js';
import { createScanner } from './scan.js';
import { buildApp } from './server.js';
import { createTcgdex } from './tcgdex.js';

const {
  ANTHROPIC_API_KEY, PIN, PORT = '3000', CLAUDE_EFFORT = 'medium', DATA_DIR = './data',
} = process.env;

if (!ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY manquante: copie .env.example vers .env et renseigne ta clé API.');
  process.exit(1);
}

const dataDir = resolve(DATA_DIR);
const photosDir = join(dataDir, 'photos');
mkdirSync(photosDir, { recursive: true });

const db = openDb(join(dataDir, 'pokecard.sqlite'));
const tcgdex = createTcgdex();
const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 });
const identify = createIdentifier({ client, effort: CLAUDE_EFFORT });
const scanner = createScanner({ db, identify, tcgdex, photosDir });

const app = buildApp({
  db,
  scanner,
  tcgdex,
  pin: PIN || null,
  photosDir,
  publicDir: resolve('public'),
  logger: { level: 'warn' },
});

startDailyRefresh(db, tcgdex);
await app.listen({ host: '0.0.0.0', port: Number(PORT) });
console.log(`Pokécard écoute sur le port ${PORT}`);
