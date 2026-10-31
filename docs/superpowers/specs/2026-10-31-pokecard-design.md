# Pokécard — spec de design

Date: 2026-10-31
Statut: en attente de relecture

## 1. Objectif

Application web personnelle pour cataloguer une collection de cartes Pokémon. L'utilisateur photographie une carte avec son téléphone; Claude Sonnet 5.5 l'identifie; l'app retrouve la carte officielle et son prix de vente (Cardmarket, €); l'utilisateur confirme l'état, la langue, la variante et la quantité; la carte est enregistrée dans sa collection.

Critère de réussite: scanner une carte et l'enregistrer en quelques secondes, puis consulter la collection (liste, filtres, valeur totale) depuis le téléphone.

## 2. Contexte et contraintes

- Usage personnel, un seul utilisateur, réseau local uniquement.
- Hébergement: LXC Proxmox sur le serveur local de l'utilisateur. Accès depuis le téléphone par Wi-Fi, en HTTP (pas de certificat).
- Conséquence caméra: `getUserMedia` (flux vidéo en direct) exige HTTPS. L'app utilise donc `<input type="file" accept="image/*" capture="environment">`, qui ouvre l'appareil photo natif en HTTP.
- La clé API Anthropic reste sur le serveur (variable d'environnement), jamais envoyée au téléphone.
- Les prix viennent d'une base de données de cartes, jamais de Claude. Claude ne fait que lire la carte.

## 3. Hors périmètre (YAGNI)

Plusieurs utilisateurs ou comptes, exposition sur Internet, HTTPS, scan vidéo en continu, estimation de grading professionnel, application native, synchronisation cloud.

## 4. Approche retenue

Node.js 24 LTS + Fastify + SQLite (`better-sqlite3`) + front en JavaScript simple (sans framework ni étape de build), installable sur l'écran d'accueil du téléphone (manifest web). JavaScript ES modules, tests avec `node:test`.

Alternatives écartées: Next.js (build et RAM disproportionnés pour un usage perso), FastAPI (équivalent; à reconsidérer seulement si l'utilisateur préfère Python).

## 5. Architecture

```
pokecard/
  src/
    main.js            lecture de la config, assemblage, démarrage
    server.js          application Fastify, routes, auth PIN
    scan.js            orchestration d'un scan (photo, Claude, TCGdex, statut)
    csv.js             export CSV
    claude.js          identification d'une carte à partir d'une photo
    tcgdex.js          recherche de cartes et lecture des prix (API TCGdex)
    matching.js        choix de la carte officielle parmi les candidats
    pricing.js         règle de choix du prix, mise à jour des prix
    db.js              schéma SQLite et requêtes
    collection.js      ajout/fusion/modification de la collection
  public/
    index.html, app.js, styles.css, manifest.webmanifest
  data/                pokecard.sqlite, photos/ (hors dépôt)
  tests/
  deploy/pokecard.service, .env.example
  README.md
```

Chaque module a une responsabilité unique et une interface claire:

- `claude.identify(imageBase64) -> { name, setName, setCode, number, printedTotal, language, variant, condition, defects, confidence }`
- `tcgdex.searchCards({ name, localId, lang }) -> cartes candidates`, `tcgdex.getCard(id, lang) -> carte détaillée avec prix`
- `matching.pickCard(identification, candidates) -> { card, alternatives, ambiguous }`
- `pricing.priceFor(card, variant) -> { value, low, avg30, updatedAt }`
- `collection.add({ cardId, language, variant, condition, quantity, ... })` additionne la quantité si (carte, langue, variante, état) existe déjà.

## 6. Flux d'un scan

1. Le téléphone ouvre l'appareil photo; la photo est réduite dans le navigateur (côté long ~1280 px, JPEG qualité 0,85) puis envoyée à `POST /api/scan`.
2. Le serveur enregistre la photo dans `data/photos/` et appelle `claude.identify`.
3. Le serveur interroge TCGdex: candidats par nom et numéro (langue de la carte), puis filtrage côté serveur sur le numéro exact et, quand disponible, `set.cardCount.official` = total imprimé (ex. `136/189`). Cela distingue les réimpressions d'une même carte. Le filtre `localId` de TCGdex est une recherche «contient» (`025` remonte `25` mais aussi `125`), et les numéros sont parfois complétés par des zéros (`025` contre `25`): la comparaison se fait donc sur des numéros normalisés. Les cartes numériques de TCG Pocket (sets `A1`, `B2a`, `P-A`…) sont exclues. Si le nom complet ne donne rien (TCGdex est sensible aux accents et à la ponctuation), on réessaie avec le premier mot du nom.
4. `matching.pickCard` renvoie la meilleure carte et les alternatives; `ambiguous = true` si plusieurs candidats restent ou si la confiance de Claude est basse.
5. L'écran de confirmation affiche la photo à côté de l'image officielle, le prix, et l'état/langue/variante/quantité modifiables; en cas d'ambiguïté l'utilisateur choisit parmi les candidats.
6. `POST /api/collection` enregistre ou fusionne. Bouton «Scanner la suivante».

## 7. Appel à Claude

- Modèle `claude-sonnet-5-5`, SDK officiel `@anthropic-ai/sdk`.
- Image en base64 (bloc `image`, avant le bloc texte). Prompt court: lire uniquement ce qui est imprimé sur la carte et estimer l'état visible; ne jamais deviner un prix.
- Sortie contrainte par `output_config.format` (JSON Schema): `name`, `setName`, `setCode`, `number`, `printedTotal`, `language`, `variant` (normal/holo/reverse/autre), `condition` (échelle ci-dessous), `defects` (liste), `confidence` (low/medium/high).
- Paramètres: pas de `temperature`/`top_p`/`top_k`, pas de `tool_choice` forcé, pas de prefill. Thinking laissé en adaptatif; `output_config.effort` réglable par variable d'environnement (défaut `medium`, `low` si la latence prime). `max_tokens` généreux (4096) car la réflexion consomme du budget.
- Toujours tester `stop_reason` avant de lire `content`; traiter `refusal` comme un échec de scan avec message clair. Activer les `fallbacks` côté serveur si le SDK installé les supporte pour ce modèle (à vérifier à l'implémentation).
- Chaque réponse brute et son usage de tokens sont stockés dans `scans`.

## 8. Prix

- Source: TCGdex (`https://api.tcgdex.net/v2/{lang}/...`), sans clé API. Vérifié le 2026-10-31: renvoie noms français, images et `pricing.cardmarket` en EUR (`avg`, `low`, `trend`, `avg7`, `avg30`, et les équivalents `*-holo`).
- Règle par défaut: prix affiché = `trend` Cardmarket. Pour la variante **reverse uniquement**, `trend-holo`, avec repli sur `trend` si absent. Les champs `*-holo` décrivent le reverse: sur une carte holo sans reverse ils sont vides ou incohérents (`sv03-125`: `trend` 3,76 € et `trend-holo` 0). Une valeur 0 est traitée comme absente. Détail affiché: prix bas et moyenne 30 jours. La métrique de référence est un réglage.
- Limite assumée: ce prix est une référence par carte. Il ne dépend ni de l'état ni de la langue de l'exemplaire. L'interface le présente comme «prix de référence», et la valeur totale comme une estimation. Aucune décote automatique par état.
- Les prix sont mis en cache en base; rafraîchis à la demande (par carte ou globalement) et automatiquement une fois par jour par un minuteur dans le processus Node. Un historique (`price_history`) permet d'afficher l'évolution.
- Carte absente de TCGdex ou sans prix: enregistrement possible, marqué «prix inconnu».

## 9. Modèle de données (SQLite)

- `cards(id, lang, name, set_id, set_name, number, printed_total, rarity, image_url, price_trend, price_trend_holo, price_low, price_low_holo, price_avg30, price_avg30_holo, price_updated_at)`, clé primaire `(id, lang)` car TCGdex utilise le même identifiant pour toutes les langues
- `collection(id PK, card_id, lang, variant, condition, quantity, note, photo_path, added_at)`, clé étrangère `(card_id, lang)` vers `cards`, unicité sur `(card_id, lang, variant, condition)`. En cas de fusion, `photo_path` garde la photo du premier scan.
- `price_history(card_id, lang, date, trend, trend_holo)`
- `scans(id PK, created_at, photo_path, claude_response_json, input_tokens, output_tokens, status)`, statut parmi `pending`, `done`, `failed`
- `settings(key PK, value)`, pour la métrique de prix

États (échelle Cardmarket): Mint, Near Mint, Excellent, Good, Light Played, Played, Poor. L'état proposé par Claude est une estimation à partir de la photo et reste modifiable.

## 10. API HTTP

- `POST /api/scan` (photo) → identification + carte proposée + alternatives
- `POST /api/scan/:id/retry` → relance un scan en attente
- `GET /api/cards/search?name=` → saisie manuelle quand la photo n'est pas reconnue
- `POST /api/collection`, `PATCH /api/collection/:id`, `DELETE /api/collection/:id`
- `GET /api/collection?search=&set=&rarity=&condition=&sort=` → liste + totaux (nombre de cartes, valeur estimée)
- `GET /api/cards/:id` (fiche + historique de prix), `POST /api/prices/refresh`
- `GET /api/export.csv`
- Auth: code PIN optionnel (variable d'environnement), cookie de session; désactivable.

## 11. Écrans

- **Scanner**: gros bouton photo, écran de confirmation, boucle «Scanner la suivante».
- **Collection**: recherche, filtres (extension, rareté, état), tri (prix, nom), total en en-tête, fiche détaillée.
- **Réglages**: rafraîchissement des prix, export CSV, métrique de prix, scans en attente. Le PIN se configure dans `.env`, pas dans l'interface.

## 12. Erreurs

- Photo floue ou carte non reconnue: message clair, bouton «Reprendre la photo», saisie manuelle du nom.
- API Claude ou TCGdex indisponible: la photo est conservée, le scan passe en statut «en attente» et peut être relancé.
- Réponse JSON invalide ou refus du modèle: scan en échec, aucune écriture en collection.
- Carte sans prix: voir section 8.

## 13. Tests

- Unitaires (`node:test`) avec fausses réponses d'API: fusion des quantités, choix du prix (normal/holo), `matching` (réimpressions, ambiguïtés), validation du JSON de Claude, gestion de `stop_reason`.
- Intégration: parcours scan → confirmation → collection avec Claude et TCGdex simulés.
- Vérification réelle avant livraison: quelques photos de cartes de l'utilisateur pour mesurer la qualité de reconnaissance.

## 14. Déploiement

Dossier unique avec `README.md`, unité systemd (`deploy/pokecard.service`) et `.env.example` (`ANTHROPIC_API_KEY`, `PIN`, `PORT`, `CLAUDE_EFFORT`). Installation dans le LXC: Node 24, `npm ci`, copie de l'unité, démarrage du service. La base et les photos sont dans `data/`, à inclure dans les sauvegardes Proxmox.

## 15. Points à vérifier à l'implémentation

- Qualité de lecture sur de vraies photos (éclairage, cartes sous pochette).
