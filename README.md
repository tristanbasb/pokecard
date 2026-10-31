# Pokécard

Application web locale pour cataloguer une collection de cartes Pokémon depuis un téléphone. Tu photographies une carte, Claude Sonnet 5.5 la lit, et l'app retrouve la carte officielle et son prix Cardmarket via [TCGdex](https://tcgdex.dev). Tu confirmes l'état, la langue, la variante et la quantité, puis la carte rejoint ta collection.

## Installation dans le LXC (Debian ou Ubuntu)

1. Installe Node.js 24, en root dans le conteneur:

   ```bash
   curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
   apt install -y nodejs
   ```

2. Copie le projet depuis ton PC, sans `node_modules`, `data` ni `.env`:

   ```bash
   rsync -a --exclude node_modules --exclude data --exclude .env --exclude .git --exclude .superpowers ./ root@IP_DU_LXC:/opt/pokecard/
   ```

3. Dans le conteneur, crée l'utilisateur du service et installe les dépendances:

   ```bash
   useradd --system --home /opt/pokecard --shell /usr/sbin/nologin pokecard
   cd /opt/pokecard
   npm ci --omit=dev
   ```

   Si `better-sqlite3` n'a pas de binaire précompilé pour ton système, lance `apt install -y build-essential python3`, puis relance `npm ci --omit=dev`.

4. Configure l'app. Renseigne au minimum `ANTHROPIC_API_KEY`, et de préférence `PIN`:

   ```bash
   cp .env.example .env
   nano .env
   mkdir -p data
   chown -R pokecard:pokecard /opt/pokecard
   chmod 600 .env
   ```

5. Active le service:

   ```bash
   cp deploy/pokecard.service /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now pokecard
   systemctl status pokecard
   ```

## Sur le téléphone

Ouvre `http://IP_DU_LXC:3000` sur le même réseau Wi-Fi. Pour l'avoir comme une app, utilise «Ajouter à l'écran d'accueil» dans le menu du navigateur.

Le scan ouvre l'appareil photo natif du téléphone. Cela fonctionne en HTTP simple, sans certificat.

## Bon à savoir

- **Prix:** le prix affiché est une référence Cardmarket par carte. Il ne tient compte ni de l'état ni de la langue de ton exemplaire, et la valeur totale reste une estimation. Le repère (tendance, moyenne sur 30 jours, prix bas) se change dans Réglages.
- **État:** l'état proposé est une estimation de Claude d'après la photo. Vérifie-le avant d'enregistrer.
- **Accès:** l'app est prévue pour ton réseau local uniquement. Ne l'expose pas directement sur Internet.
- **Coût:** chaque scan consomme un petit appel à l'API Claude. Les tokens de chaque scan sont gardés dans la table `scans`.
- **Mises à jour des prix:** elles se font une fois par jour, ou à la demande depuis Réglages.

## Sauvegarde

Tout est dans `/opt/pokecard/data`: la base `pokecard.sqlite` et le dossier `photos/`. Une sauvegarde Proxmox du LXC les inclut.

## Développement

```bash
npm install
npm test
npm run dev:fake
```

`npm run dev:fake` lance l'interface sur `http://localhost:3001` avec un faux Claude et une base temporaire, sans clé API.
