# @branli/claude-console

Console Claude Code intégrée à une app web (PWA). Chaque conversation lance le CLI `claude -p` installé sur la machine : elle utilise l'abonnement Claude Code, pas une clé d'API.

Fonctions : cartes de permission (Demander / Auto), questions `AskUserQuestion` à choix, voix (Piper sur le serveur ou voix de l'appareil), dictée, connexion par mot de passe, synchro git (pull avant, push après chaque réponse), image Docker de base.

## Installation

```sh
npm i @branli/claude-console
```

Prérequis : Node >= 24 et le CLI `claude` connecté (ou `APP_CLAUDE` pointant vers lui).

## Serveur

```js
import { createClaudeServer } from '@branli/claude-console/server';

const { listen, ctx, claude, busy } = createClaudeServer({
  name: 'Mon app',              // nom affiché (connexion, logs) ; défaut « App »
  root: '/chemin/du/repo',      // dossier de travail de Claude (cwd de claude -p)
  publicDir: './public',        // fichiers statiques de l'app
  port: 4173,                   // port par défaut ; APP_PORT prime
  themeColor: '#2f6f5e',        // couleur de la page de connexion
  icon: '/icons/icon.svg',      // icône de la page de connexion
  lang: 'fr',                   // langue de la page de connexion
  allowedTools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Skill', 'Bash(git *)'], // sans validation
  deniedTools: [],              // outils refusés à Claude
  prompt: '',                   // consignes propres à l'app, ajoutées au prompt de base
  voiceSkill: 'discussion',     // skill lancé par un message dicté (mode rapide)
  fastSkills: [],               // skills lancés en mode rapide
  fastArgs: ['--model', 'sonnet', '--effort', 'low'], // options du mode rapide
  restartOn: [],                // RegExp : un git pull qui change ces fichiers redémarre le serveur
  publicPaths: [],              // routes sans connexion (exacte, ou préfixe si finit par /)
  cookie: 'app_session',        // nom du cookie de connexion
  cookieSalt: 'mon-app',        // sel du cookie ; défaut : name en minuscules
  routes,                       // routes propres à l'app
});
listen();
```

`createClaudeServer` renvoie `{ server, listen, ctx, claude, busy }`.

### Routes de l'app

`routes(req, res, url, ctx)` est appelée pour chaque requête non traitée par la console. Elle renvoie `true` si elle a répondu, sinon `false`.

`ctx` expose : `root`, `send`, `readJson`, `resolveInside`, `exists`, `sendFile`, `walk(dir, filter?)`, `git(args)` (sortie ou vide), `gitRun(args)` (`{ ok, out, err }`), `syncError()`, `broadcast(msg)` (aux consoles ouvertes), `running()`.

## Client

```html
<link rel="stylesheet" href="/_claude/claude-panel.css">
<claude-panel lang="fr-FR" server-voice="siwis"></claude-panel>
<script type="module" src="/_claude/claude-panel.js"></script>
```

- Attributs : `lang` (défaut `fr-FR`), `server-voice` (motif de la voix Piper préférée), `layout-buttons` (agrandir / replier).
- Points d'accroche : `renderMarkdown(md)`, `slashArgs(skill)` (valeurs après `/skill`), `toast(msg)`, `messages` (libellés, fusionnés avec les défauts).
- Méthodes : `run(skill, arg?)` lance un skill en nouvelle session ; `send(text, { spoken? })` envoie un message (réponse à la session en cours, sinon nouvelle conversation ; nouveaux essais pendant un redémarrage du serveur) ; `setMaximized(max)` met à jour le bouton agrandir.
- Événements (remontent au `document`) : `claude:state` (état), `claude:refresh` (fichiers mis à jour par git pull), `claude:show` (après un envoi), `claude:close`, `claude:toggle-max`.

## Service worker

```js
// sw.js de l'app
importScripts('/_claude/sw-core.js');
claudeServiceWorker({ version: 'v1', shell: ['/', '/app.js', '/style.css'], cacheFirst: ['/vendor/', '/icons/'] });
```

Options : `version`, `prefix`, `shell`, `cacheFirst`, `skip`, `maxFile`. Réseau d'abord ; la console, la connexion et les lectures partielles ne sont jamais mises en cache.

## Variables d'environnement

| Variable | Rôle |
| --- | --- |
| `APP_HOST` | Adresse d'écoute. Défaut `127.0.0.1`. |
| `APP_PORT` | Port d'écoute. Défaut `4173`. |
| `APP_ORIGIN` | Adresse publique derrière un reverse proxy, ajoutée aux hôtes autorisés. |
| `APP_PASSWORD` | Mot de passe de `/login`. Obligatoire hors `127.0.0.1`. |
| `APP_SECRET` | Ajouté au secret du cookie : le changer déconnecte tout le monde. |
| `APP_GIT_SYNC` | `1` : pull avant chaque conversation et toutes les 5 min, push après chaque réponse. |
| `APP_TTS_PYTHON` | Python avec `piper-tts` : voix naturelles du serveur (`tools/tts.py`). |
| `APP_TTS_VOICES` | Dossier des voix Piper (`.onnx` + `.onnx.json`). |
| `APP_CLAUDE` | Commande du CLI Claude Code. Défaut `claude`. |

Image Docker (lues par `docker/entrypoint.sh`) :

| Variable | Rôle |
| --- | --- |
| `APP_REPO` | Repo git de l'app, clonée dans le volume (obligatoire). |
| `APP_REPO_DIR` | Dossier du clone. Défaut `/data/app`. |
| `APP_START` | Commande de lancement. Défaut `node app/server.mjs`. |
| `APP_ORIGIN`, `APP_PASSWORD` | Adresse publique et mot de passe (obligatoires). |
| `CLAUDE_CODE_OAUTH_TOKEN` | Jeton de `claude setup-token` (obligatoire). |
| `GIT_SSH_KEY_B64` | Clé de déploiement GitHub en base64 (recommandé) ; `APP_REPO` en `git@github.com:…`. |
| `GITHUB_TOKEN` | Alternative : jeton fine-grained ; `APP_REPO` en `https://github.com/…`. |
| `GIT_USER_NAME`, `GIT_USER_EMAIL` | Auteur des commits de Claude. Défauts `Claude App`, `claude-app@localhost`. |

## Image Docker

- `ghcr.io/branlii/claude-pwa-base:<version>` (et `latest`) : Node 24, git, CLI Claude Code, sans voix du serveur.
- `ghcr.io/branlii/claude-pwa-base:<version>-voice-fr` (et `latest-voice-fr`) : idem avec Piper et les voix françaises (≈ 130 Mo de plus).

```yaml
services:
  app:
    image: ghcr.io/branlii/claude-pwa-base:latest-voice-fr
    restart: unless-stopped
    ports: ["4173:4173"]
    environment:
      APP_REPO: git@github.com:moi/mon-app.git
      APP_ORIGIN: https://app.exemple.fr
      APP_PASSWORD: ${APP_PASSWORD}
      CLAUDE_CODE_OAUTH_TOKEN: ${CLAUDE_CODE_OAUTH_TOKEN}
      GIT_SSH_KEY_B64: ${GIT_SSH_KEY_B64}
    volumes:
      - data:/data
      - claude-home:/home/node/.claude

volumes:
  data:
  claude-home:
```

Le conteneur clone le repo dans `/data`, réinstalle les dépendances quand `package-lock.json` change, puis lance l'app.

## Sécurité

- La console pilote Claude (fichiers, commandes, git) : le mot de passe est obligatoire dès que le serveur écoute hors de `127.0.0.1`.
- Les secrets (`APP_PASSWORD`, `APP_SECRET`, `GITHUB_TOKEN`, `GIT_SSH_KEY_B64`, `GIT_SSH_COMMAND`) ne sont pas transmis au process `claude`.
- Avec `APP_GIT_SYNC=1`, Claude ne peut pas lancer `git push`, `pull` ni `fetch` : le serveur s'en charge.
- Garder le mode **Demander** : chaque commande hors liste autorisée est soumise à validation. `allowedTools` doit rester court, car tout ce qui y figure s'exécute sans demande.

## Développement

```sh
npm ci
npm run check                      # types (tsc)
npm test                           # node --test
node examples/minimal/server.mjs   # app d'exemple : http://127.0.0.1:4173
```

Licence MIT.
