import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { CONDITIONS, VARIANTS } from './collection.js';

export class ScanRefused extends Error {}
export class ScanInvalid extends Error {}

const IdentificationSchema = z.object({
  name: z.string().nullable(),
  setName: z.string().nullable(),
  setCode: z.string().nullable(),
  number: z.string().nullable(),
  printedTotal: z.number().nullable(),
  language: z.enum(['fr', 'en', 'de', 'es', 'it', 'pt', 'ja', 'ko', 'zh', 'autre']),
  variant: z.enum(VARIANTS),
  condition: z.enum(CONDITIONS),
  defects: z.array(z.string()),
  confidence: z.enum(['low', 'medium', 'high']),
});

const PROMPT = `This photo shows one Pokémon trading card. Read it and report what you see.

- name: the card name exactly as printed, in the printed language, keeping accents, punctuation and suffixes (e.g. "Dracaufeu-ex", "Salamèche", "Charizard VMAX"). It is searched verbatim in a database, so do not translate or correct it.
- number and printedTotal: from the collector number at the bottom of the card. For "025/165", number is "025" and printedTotal is 165. For "TG12/TG30", number is "TG12" and printedTotal is null. Keep leading zeros.
- setName and setCode: only if printed or certain from the set symbol.
- language: the language the card is printed in.
- variant: "reverse" when the holographic foil covers the card body outside the artwork, "holo" when the foil is on the artwork, "normal" with no foil, "autre" for anything else.
- condition: your estimate from visible wear, on the Cardmarket scale. Sleeves and glare can hide wear; do not count them as damage.
- defects: short descriptions in French of the wear you can see, empty if none.
- confidence: "low" if the name or number is hard to read, or if this may not be a card.

Use null for anything you cannot read rather than guessing. Never estimate a price.`;

export function createIdentifier({ client, model = 'claude-sonnet-5-5', effort = 'medium' }) {
  return async function identify(imageBase64) {
    const message = await client.beta.messages.parse({
      model,
      max_tokens: 4096,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort,
        format: betaZodOutputFormat(IdentificationSchema),
      },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: PROMPT },
        ],
      }],
    });

    if (message.stop_reason === 'refusal') throw new ScanRefused('Claude a refusé de lire cette image');
    if (message.stop_reason === 'max_tokens' || !message.parsed_output) {
      throw new ScanInvalid('Réponse de Claude inexploitable');
    }
    return { identification: message.parsed_output, usage: message.usage, raw: message };
  };
}
