#!/usr/bin/env bash
# Updates an installed Pokécard to the latest version, and rolls back if it no longer starts. Run as root.
set -Eeuo pipefail

KEEP_BACKUPS=5
SERVICE=pokecard

# Everything lives in main because "git merge" below can rewrite this very file while it runs.
main() {
  [ "$(id -u)" -eq 0 ] || fail "Lance ce script en root."
  DIR="$(dirname "$(dirname "$(readlink -f "$0")")")"
  cd "$DIR"
  [ -d .git ] || fail "$DIR n'est pas une installation de Pokécard."
  [ -z "$(git status --porcelain --untracked-files=no)" ] \
    || fail "Des fichiers de $DIR ont été modifiés à la main. Annule ces changements puis relance."

  local branch
  branch="$(git rev-parse --abbrev-ref HEAD)"
  git fetch --quiet origin "$branch"
  PREVIOUS="$(git rev-parse HEAD)"
  local latest
  latest="$(git rev-parse FETCH_HEAD)"
  if [ "$PREVIOUS" = "$latest" ]; then
    echo "Déjà à jour ($(git rev-parse --short HEAD))."
    exit 0
  fi

  echo "Nouveautés:"
  git log --oneline "$PREVIOUS..$latest"

  systemctl stop "$SERVICE"
  back_up_database
  trap rollback ERR

  git merge --quiet --ff-only "$latest"
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error
  install_unit
  systemctl start "$SERVICE"
  wait_healthy || { echo "Le service ne répond pas après la mise à jour."; rollback; }

  trap - ERR
  echo "Mise à jour terminée ($(git rev-parse --short HEAD))."
}

fail() { printf 'Erreur: %s\n' "$1" >&2; exit 1; }

back_up_database() {
  BACKUP="data/backups/$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BACKUP"
  if compgen -G 'data/pokecard.sqlite*' >/dev/null; then
    cp -p data/pokecard.sqlite* "$BACKUP/"
  fi
  chown -R "$SERVICE:$SERVICE" data/backups
  ls -1d data/backups/* | sort | head -n "-$KEEP_BACKUPS" | xargs -r rm -rf
  echo "Base sauvegardée dans $DIR/$BACKUP"
}

install_unit() {
  if ! cmp -s deploy/pokecard.service /etc/systemd/system/pokecard.service; then
    cp deploy/pokecard.service /etc/systemd/system/pokecard.service
    systemctl daemon-reload
  fi
}

wait_healthy() {
  local port attempt
  port="$(sed -n 's/^PORT=//p' .env | head -n 1)"
  for attempt in $(seq 1 20); do
    curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:${port:-3000}/" && return 0
    sleep 1
  done
  return 1
}

rollback() {
  trap - ERR
  set +e
  echo "Échec: retour à la version précédente ($(git rev-parse --short "$PREVIOUS"))."
  systemctl stop "$SERVICE"
  git reset --quiet --hard "$PREVIOUS"
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error
  install_unit
  rm -f data/pokecard.sqlite*
  if compgen -G "$BACKUP/pokecard.sqlite*" >/dev/null; then
    cp -p "$BACKUP"/pokecard.sqlite* data/
  fi
  systemctl start "$SERVICE"
  if wait_healthy; then
    echo "La version précédente tourne de nouveau. La mise à jour n'est pas appliquée."
  else
    echo "La version précédente ne répond pas non plus. Regarde: journalctl -u $SERVICE -n 50"
  fi
  exit 1
}

main "$@"
