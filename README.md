# Pokécard

Application web locale pour cataloguer une collection de cartes Pokémon depuis un téléphone. Tu photographies une carte, Claude Sonnet 5.5 la lit, et l'app retrouve la carte officielle et son prix Cardmarket via [TCGdex](https://tcgdex.dev). Tu confirmes l'état, la langue, la variante et la quantité, puis la carte rejoint ta collection.

## Installation dans le LXC (Debian ou Ubuntu)

En root dans le conteneur (installe `curl` d'abord s'il manque: `apt update && apt install -y curl`):

```bash
curl -fsSL https://raw.githubusercontent.com/tristanbasb/pokecard/main/deploy/install.sh | bash
```

Le script installe Node.js 24, place l'app dans `/opt/pokecard`, te demande ta clé API Anthropic et un code PIN, puis démarre le service et affiche l'adresse à ouvrir. Tu peux le relancer sans risque: il ne touche ni à `.env` ni à `data/`.

Ta clé et ton PIN sont rangés dans `/opt/pokecard/.env`, lisible par root seulement. Pour les changer, modifie ce fichier puis lance `systemctl restart pokecard`.

## Mise à jour

```bash
pokecard-update
```

La commande récupère la dernière version sur GitHub. Elle sauvegarde d'abord la base dans `data/backups/` (5 dernières copies gardées). Si l'app ne répond plus après la mise à jour, elle revient à la version précédente et restaure la base.

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
