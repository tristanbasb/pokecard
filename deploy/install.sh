#!/usr/bin/env bash
# Installs Pokécard on Debian or Ubuntu (e.g. a Proxmox LXC). Run as root. Safe to run again.
# Optional variables: POKECARD_REPO, POKECARD_BRANCH, POKECARD_DIR, ANTHROPIC_API_KEY, PIN, PORT.
set -euo pipefail

# Everything lives in main so that a truncated "curl | bash" download runs nothing.
main() {
  local repo="${POKECARD_REPO:-https://github.com/tristanbasb/pokecard.git}"
  local branch="${POKECARD_BRANCH:-main}"
  local dir="${POKECARD_DIR:-/opt/pokecard}"
  local service=pokecard
  umask 022

  [ "$(id -u)" -eq 0 ] || fail "Lance ce script en root."
  command -v apt-get >/dev/null || fail "Ce script ne gère que Debian et Ubuntu."
  [ -d /run/systemd/system ] || fail "systemd n'est pas actif sur cette machine."

  step "Paquets système"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq git curl ca-certificates >/dev/null

  step "Node.js 24"
  if [ "$(node_major)" -lt 24 ]; then
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
  fi
  [ "$(node_major)" -ge 24 ] || fail "Impossible d'installer Node.js 24."
  node --version

  step "Utilisateur du service"
  id "$service" >/dev/null 2>&1 \
    || useradd --system --home-dir "$dir" --no-create-home --shell /usr/sbin/nologin "$service"

  step "Code"
  if [ -d "$dir/.git" ]; then
    echo "Déjà présent dans $dir: le code n'est pas modifié (utilise pokecard-update pour le mettre à jour)."
  elif [ -e "$dir" ] && [ -n "$(ls -A "$dir")" ]; then
    fail "$dir existe déjà et n'est pas un dépôt git. Déplace-le puis relance ce script."
  else
    git clone --quiet --branch "$branch" "$repo" "$dir"
  fi
  cd "$dir"

  step "Dépendances"
  systemctl stop "$service" 2>/dev/null || true
  # better-sqlite3 ships its binaries; without this flag npm tries to compile it from source anyway.
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error

  step "Configuration"
  mkdir -p data
  chown -R "$service:$service" data
  if [ -f .env ]; then
    echo ".env existe déjà: il n'est pas modifié."
  else
    write_env
  fi

  step "Service"
  cp deploy/pokecard.service /etc/systemd/system/pokecard.service
  ln -sf "$dir/deploy/update.sh" /usr/local/bin/pokecard-update
  systemctl daemon-reload
  systemctl enable --quiet "$service"

  if ! grep -qE '^ANTHROPIC_API_KEY=.+' .env; then
    echo
    echo "Il manque ta clé API. Renseigne ANTHROPIC_API_KEY dans $dir/.env, puis lance:"
    echo "  systemctl restart $service"
    exit 0
  fi

  systemctl restart "$service"
  local port
  port="$(env_port)"
  if wait_healthy "$port"; then
    echo
    echo "Pokécard est prêt. Ouvre sur ton téléphone: http://$(hostname -I | awk '{print $1}'):$port"
    echo "Pour mettre à jour plus tard: pokecard-update"
  else
    journalctl -u "$service" -n 20 --no-pager 2>/dev/null || true
    fail "Le service ne répond pas sur le port $port."
  fi
}

step() { printf '\n==> %s\n' "$1"; }
fail() { printf 'Erreur: %s\n' "$1" >&2; exit 1; }

node_major() {
  if command -v node >/dev/null; then
    node -p 'process.versions.node.split(".")[0]'
  else
    echo 0
  fi
}

# Reads from the terminal because stdin is the script itself under "curl | bash".
ask_secret() {
  local prompt="$1" answer=''
  if { : </dev/tty; } 2>/dev/null; then
    printf '%s' "$prompt" >/dev/tty
    IFS= read -rs answer </dev/tty
    printf '\n' >/dev/tty
  fi
  printf '%s' "$answer"
}

write_env() {
  local key="${ANTHROPIC_API_KEY:-}" pin="${PIN:-}"
  [ -n "$key" ] || key="$(ask_secret 'Clé API Anthropic (rien ne s'"'"'affiche): ')"
  [ -n "$pin" ] || pin="$(ask_secret 'Code PIN de l'"'"'app (vide pour aucun): ')"
  (
    umask 077
    {
      printf 'ANTHROPIC_API_KEY=%s\n' "$key"
      printf 'PIN=%s\n' "$pin"
      printf 'PORT=%s\n' "${PORT:-3000}"
      printf 'CLAUDE_EFFORT=medium\n'
      printf 'DATA_DIR=./data\n'
    } >.env
  )
}

env_port() {
  local port
  port="$(sed -n 's/^PORT=//p' .env | head -n 1)"
  echo "${port:-3000}"
}

wait_healthy() {
  local attempt
  for attempt in $(seq 1 20); do
    curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$1/" && return 0
    sleep 1
  done
  return 1
}

main "$@"
