// Starts the app with a scripted fake Claude and a temporary database, to try the UI without an API key.
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDb } from '../src/db.js';
import { createScanner } from '../src/scan.js';
import { buildApp } from '../src/server.js';
import { createTcgdex } from '../src/tcgdex.js';

const reading = (over) => ({
  name: 'Fouinar',
  setName: null,
  setCode: null,
  number: '136',
  printedTotal: 189,
  language: 'fr',
  variant: 'reverse',
  condition: 'Near Mint',
  defects: ['coin haut gauche blanchi'],
  confidence: 'high',
  ...over,
});

const SCRIPT = [
  reading(),
  reading({ name: 'Pikachu', number: null, printedTotal: null, variant: 'normal', condition: 'Played', defects: [], confidence: 'low' }),
  reading({ name: null, number: null, printedTotal: null, defects: [], confidence: 'low' }),
];
let step = 0;
const identify = async () => {
  const identification = SCRIPT[step % SCRIPT.length];
  step += 1;
  return { identification, usage: { input_tokens: 0, output_tokens: 0 }, raw: {} };
};

const dataDir = mkdtempSync(join(tmpdir(), 'pokecard-dev-'));
const photosDir = join(dataDir, 'photos');
mkdirSync(photosDir);
const db = openDb(join(dataDir, 'pokecard.sqlite'));
const tcgdex = createTcgdex();
const scanner = createScanner({ db, identify, tcgdex, photosDir });
const app = buildApp({ db, scanner, tcgdex, photosDir, publicDir: resolve('public') });

const port = Number(process.env.PORT ?? 3001);
await app.listen({ host: '127.0.0.1', port });
console.log(`Pokécard (faux Claude) sur http://localhost:${port}, données dans ${dataDir}`);
