#!/bin/sh
# Démarrage du conteneur : vérifie les secrets, clone ou met à jour le repo de l'app dans le volume, installe ses
# dépendances si package-lock.json a changé, puis lance l'app (APP_START, par défaut node app/server.mjs).
set -eu

: "${APP_REPO:?APP_REPO manquant (ex. git@github.com:moi/mon-app.git)}"
: "${APP_ORIGIN:?APP_ORIGIN manquant (ex. https://app.exemple.fr)}"
: "${APP_PASSWORD:?APP_PASSWORD manquant (mot de passe de l interface)}"
: "${CLAUDE_CODE_OAUTH_TOKEN:?CLAUDE_CODE_OAUTH_TOKEN manquant (claude setup-token sur ton ordinateur)}"

git config --global user.name "${GIT_USER_NAME:-Claude App}"
git config --global user.email "${GIT_USER_EMAIL:-claude-app@localhost}"
git config --global pull.ff only
git config --global init.defaultBranch main
# Accès GitHub, au choix :
# - deploy key (recommandé) : clé privée en base64 dans GIT_SSH_KEY_B64, APP_REPO en git@github.com:… ;
# - jeton fine-grained : GITHUB_TOKEN, APP_REPO en https://github.com/… (lu dans l'environnement à chaque appel).
if [ -n "${GIT_SSH_KEY_B64:-}" ]; then
  mkdir -p "$HOME/.ssh"
  chmod 700 "$HOME/.ssh"
  printf '%s' "$GIT_SSH_KEY_B64" | base64 -d > "$HOME/.ssh/deploy_key"
  chmod 600 "$HOME/.ssh/deploy_key"
  # Clé d'hôte publiée par GitHub (docs.github.com, « GitHub's SSH key fingerprints ») : pas de confiance aveugle.
  echo 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' > "$HOME/.ssh/known_hosts"
  export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/deploy_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes"
fi
if [ -n "${GITHUB_TOKEN:-}" ]; then
  git config --global credential.helper \
    '!f() { test "$1" = get && printf "username=x-access-token\npassword=%s\n" "$GITHUB_TOKEN"; }; f'
fi

if [ ! -d "$APP_REPO_DIR/.git" ]; then
  echo "Clone de $APP_REPO dans $APP_REPO_DIR"
  git clone "$APP_REPO" "$APP_REPO_DIR"
else
  git -C "$APP_REPO_DIR" pull --ff-only || echo "git pull impossible : on garde la copie du volume" >&2
fi

cd "$APP_REPO_DIR"

# Dépendances de l'app (dont @branli/claude-console) : réinstallées seulement quand package-lock.json change.
if [ -f package-lock.json ]; then
  want="$(sha256sum package-lock.json | cut -d' ' -f1)"
  have="$(cat node_modules/.lock-sha 2>/dev/null || true)"
  if [ "$want" != "$have" ]; then
    echo "Installation des dépendances (npm ci)"
    npm ci --omit=dev --no-audit --no-fund
    mkdir -p node_modules && printf '%s' "$want" > node_modules/.lock-sha
  fi
fi

exec sh -c "exec ${APP_START:-node app/server.mjs}"
