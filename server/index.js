// claude-console — serveur d'une app pilotée par le CLI Claude Code local (abonnement, pas d'API).
// Fournit : conversations Claude (/api/run*), skills (/api/skills), voix Piper (/api/tts*), connexion (/login),
// synchro git, client du panneau (/_claude/*) et fichiers statiques de l'app. L'app ajoute ses routes (`routes`).
// Variables : APP_HOST, APP_PORT, APP_ORIGIN, APP_PASSWORD, APP_SECRET, APP_GIT_SYNC=1, APP_TTS_PYTHON, APP_CLAUDE.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaude, MODES } from './claude.js';
import { createAuth } from './auth.js';
import { createGitSync, git, gitRun } from './git-sync.js';
import { createTts } from './tts.js';
import { getSkills } from './skills.js';
import { send, readJson, resolveInside, walk, exists, sendFile, serveStatic, MIME, IGNORED } from './http.js';

export { send, readJson, resolveInside, walk, exists, sendFile, serveStatic, MIME, IGNORED, getSkills, git, gitRun };

const CLIENT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client');

// Consignes communes à toutes les apps, complétées par `prompt` (propre à l'app).
const BASE_PROMPT = (/** @type {string} */ name) =>
  `Tu es lancé depuis l'interface web ${name}. L'utilisateur suit ta sortie dans une console. ` +
  "Pour une question à choix (option à retenir, confirmation avant une action), utilise AskUserQuestion : " +
  "l'utilisateur répond dans la console. Pour une question ouverte, termine ton message par la question et arrête-toi ; il répondra au tour suivant. " +
  "Hors liste autorisée, chaque commande shell est soumise à l'utilisateur (mode Demander) ou jugée automatiquement (mode Auto, " +
  "où ce qui demande une validation est refusé) : préfère Read, Glob et Grep à cat, ls ou find, et une seule commande simple par appel Bash " +
  "(pas de `&&`, `;`, `|`, `cd`, sous-shell ni script python/sh) pour que la demande reste lisible. " +
  "Le dossier .claude/ est protégé : toute modification d'un skill ou de CLAUDE.md demande une validation. ";
const GIT_PROMPT = "Ne lance jamais git push, pull ni fetch : tu n'as pas la clé GitHub, le serveur pousse tes commits après ta réponse. ";

/**
 * @typedef {{
 *   root: string, send: typeof send, readJson: typeof readJson, resolveInside: typeof resolveInside,
 *   walk: (dir: string, filter?: (abs: string) => boolean) => ReturnType<typeof walk>,
 *   exists: typeof exists, sendFile: typeof sendFile,
 *   git: (args: string[]) => Promise<string>, gitRun: (args: string[]) => ReturnType<typeof gitRun>,
 *   syncError: () => string, broadcast: (msg: object) => void, running: () => boolean,
 * }} AppContext
 *
 * @typedef {{
 *   name?: string, themeColor?: string, icon?: string, lang?: string,
 *   root: string, publicDir: string, port?: number,
 *   allowedTools?: string[], deniedTools?: string[], prompt?: string,
 *   voiceSkill?: string, fastSkills?: string[], fastArgs?: string[],
 *   restartOn?: RegExp[], publicPaths?: string[],
 *   cookie?: string, cookieSalt?: string,
 *   routes?: (req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: AppContext) => Promise<boolean | void> | boolean | void,
 * }} ClaudeAppConfig
 */

/** @param {ClaudeAppConfig} config */
export function createClaudeServer(config) {
  const env = process.env;
  const name = config.name || 'App';
  const root = path.resolve(config.root);
  const publicDir = path.resolve(config.publicDir);
  const host = env.APP_HOST || '127.0.0.1';
  const port = Number(env.APP_PORT || config.port || 4173);
  // Adresse publique derrière le reverse proxy (ex. https://app.exemple.fr) ; vide en local.
  const origin = (env.APP_ORIGIN || '').replace(/\/+$/, '');
  // Mot de passe de l'interface : obligatoire dès qu'elle écoute ailleurs que sur la machine.
  const password = env.APP_PASSWORD || '';
  const gitSyncOn = env.APP_GIT_SYNC === '1';
  const claudeBin = env.APP_CLAUDE || 'claude';

  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const allowedOrigins = new Set([...allowedHosts].map((h) => `http://${h}`));
  if (origin) {
    allowedHosts.add(new URL(origin).host);
    allowedOrigins.add(origin);
  }
  const publicPaths = ['/login', '/healthz', '/_claude/sw-core.js', ...(config.publicPaths || [])];
  const isPublic = (/** @type {string} */ p) => publicPaths.some((x) => (x.endsWith('/') ? p.startsWith(x) : p === x));

  // Synchro git : la clé GitHub n'est pas transmise à claude (secretEnv), ses push/pull/fetch échoueraient
  // (« Permission denied (publickey) »). Le serveur s'en charge autour de chaque réponse.
  const deniedTools = [...(config.deniedTools || []), ...(gitSyncOn ? ['Bash(git push*)', 'Bash(git pull*)', 'Bash(git fetch*)'] : [])];
  const fastSkills = new Set(config.fastSkills || []);

  /** @type {ReturnType<typeof createGitSync>} */
  let gitSync;
  const claude = createClaude({
    root, claudeBin, deniedTools,
    allowedTools: config.allowedTools || ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'WebSearch', 'WebFetch', 'Skill', 'TodoWrite', 'Bash(git *)'],
    systemPrompt: BASE_PROMPT(name) + (gitSyncOn ? GIT_PROMPT : '') + (config.prompt || ''),
    fastArgs: config.fastArgs || ['--model', 'sonnet', '--effort', 'low'],
    secretEnv: ['APP_PASSWORD', 'APP_SECRET', 'GITHUB_TOKEN', 'GIT_SSH_KEY_B64', 'GIT_SSH_COMMAND'],
    onResult: () => { gitSync.sync('push'); },
    onClose: () => { gitSync.restartIfPending(); },
  });
  const { run } = claude;
  const busy = () => run.status === 'running' || !!run.proc;
  gitSync = createGitSync({
    root, enabled: gitSyncOn, restartOn: config.restartOn || [],
    busy, running: () => run.status === 'running',
    onPushError: (text) => claude.pushEvent({ kind: 'error', text }),
    onPulled: () => claude.broadcast({ type: 'refresh' }),
  });
  const tts = createTts(env.APP_TTS_PYTHON || '');
  const auth = createAuth({
    password, secret: env.APP_SECRET || '', salt: config.cookieSalt ?? name.toLowerCase(),
    cookie: config.cookie || 'app_session', secure: origin.startsWith('https:'),
    name, themeColor: config.themeColor || '#2f6f5e', icon: config.icon || '/icons/icon.svg', lang: config.lang || 'fr',
  });

  /** @type {AppContext} */
  const ctx = {
    root, send, readJson, resolveInside, exists, sendFile,
    walk: (dir, filter) => walk(root, dir, filter),
    git: (args) => git(root, args),
    gitRun: (args) => gitRun(root, args),
    syncError: () => gitSync.error,
    broadcast: claude.broadcast,
    running: () => run.status === 'running',
  };

  /** @param {http.IncomingMessage} req @param {http.ServerResponse} res @param {URL} url */
  async function runApi(req, res, url) {
    const p = url.pathname;
    if (req.method === 'GET' && p === '/api/skills') return send(res, 200, await getSkills(root)), true;
    if (req.method === 'GET' && p === '/api/tts/voices') return send(res, 200, { voices: await tts.voices() }), true;
    if (req.method === 'POST' && p === '/api/tts') {
      const { text = '', voice = '', rate = 1 } = await readJson(req);
      const clean = String(text).replace(/\s+/g, ' ').trim().slice(0, 600);
      if (!clean) return send(res, 400, { error: 'texte vide' }), true;
      const r = await synthesize(clean, String(voice), Number(rate) || 1);
      if (r.error || !r.wav) return send(res, 503, { error: r.error }), true;
      return send(res, 200, Buffer.from(r.wav, 'base64'), 'audio/wav'), true;
    }
    if (!p.startsWith('/api/run')) return false;

    if (req.method === 'GET' && p === '/api/run/events') return claude.subscribe(req, res), true;

    if (req.method === 'POST' && p === '/api/run') {
      if (run.status === 'running') return send(res, 409, { error: 'un skill tourne déjà' }), true;
      // `{ skill, arg }` lance un skill ; `{ text }` ouvre une conversation libre (Claude choisit le skill) ;
      // `{ text, voice: true }` (message dicté) part directement sur `voiceSkill`, en mode rapide.
      const body = await readJson(req);
      const voice = body.voice === true;
      const skill = String(body.skill || (voice && config.voiceSkill) || '');
      const text = String(body.text || '').trim().slice(0, 8000);
      let prompt;
      let cleanArg = '';
      if (skill) {
        const skills = await getSkills(root);
        if (!skills.some((s) => s.name === skill)) return send(res, 400, { error: 'skill inconnu' }), true;
        cleanArg = String(body.arg || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
        prompt = voice ? `/${skill} ${text}`.trim() : `/${skill}${cleanArg ? ' ' + cleanArg : ''}`;
      } else {
        prompt = text;
        if (!prompt) return send(res, 400, { error: 'message vide' }), true;
      }
      claude.endClaude();
      const pullError = await gitSync.sync('pull');
      if (gitSync.restartPending && !run.proc && run.status !== 'running') {
        send(res, 503, { error: 'Serveur mis à jour, il redémarre : renvoie ton message dans quelques secondes.' });
        gitSync.restartIfPending();
        return true;
      }
      Object.assign(run, { id: run.id + 1, skill: skill || null, arg: cleanArg, sessionId: null, events: [], startedAt: Date.now(), fast: voice || fastSkills.has(skill) });
      if (pullError) claude.pushEvent({ kind: 'error', text: `${pullError} — le skill part de la copie du serveur.` });
      claude.pushEvent({ kind: 'user', text: voice ? text : prompt });
      claude.startClaude(prompt);
      return send(res, 202, claude.publicState()), true;
    }

    if (req.method === 'POST' && p === '/api/run/reply') {
      if (run.status === 'running') return send(res, 409, { error: 'claude est encore en train de répondre' }), true;
      if (!run.sessionId) return send(res, 400, { error: 'aucune session à reprendre' }), true;
      const { text = '' } = await readJson(req);
      const msg = String(text).trim().slice(0, 8000);
      if (!msg) return send(res, 400, { error: 'message vide' }), true;
      claude.pushEvent({ kind: 'user', text: msg });
      // Même process si toujours ouvert et dans le bon mode ; sinon reprise de la session.
      if (run.proc && run.proc.mode === run.mode) claude.userMessage(msg);
      else { claude.endClaude(); claude.startClaude(msg, { resume: run.sessionId }); }
      return send(res, 202, claude.publicState()), true;
    }

    if (req.method === 'POST' && p === '/api/run/answer') {
      if (!claude.answer(await readJson(req))) return send(res, 409, { error: 'demande expirée' }), true;
      return send(res, 200, { ok: true }), true;
    }

    if (req.method === 'POST' && p === '/api/run/mode') {
      const { mode } = await readJson(req);
      if (!Object.hasOwn(MODES, mode)) return send(res, 400, { error: 'mode inconnu' }), true;
      run.mode = mode;
      // Appliqué au prochain message (le process en attente est relancé avec --resume).
      if (run.proc && run.status !== 'running') claude.endClaude();
      claude.sendState();
      return send(res, 200, claude.publicState()), true;
    }

    if (req.method === 'POST' && p === '/api/run/stop') {
      if (run.proc) run.proc.kill('SIGTERM');
      return send(res, 200, { ok: true }), true;
    }

    if (req.method === 'POST' && p === '/api/run/reset') {
      if (run.status === 'running') return send(res, 409, { error: 'un skill tourne encore' }), true;
      claude.endClaude();
      Object.assign(run, { skill: null, arg: '', sessionId: null, events: [], status: 'idle', startedAt: null });
      claude.broadcast({ type: 'snapshot', state: claude.publicState(), events: [] });
      return send(res, 200, { ok: true }), true;
    }
    return false;
  }

  /** @param {string} text @param {string} voice @param {number} rate */
  const synthesize = (text, voice, rate) => tts.synthesize(text, voice, rate);

  const server = http.createServer(async (req, res) => {
    try {
      // Anti DNS-rebinding et anti CSRF : seule l'app elle-même peut parler au serveur.
      if (!allowedHosts.has(req.headers.host || '')) return send(res, 403, { error: 'host refusé' });
      const safeMethod = req.method === 'GET' || req.method === 'HEAD';
      if (!safeMethod && !allowedOrigins.has(req.headers.origin || '')) return send(res, 403, { error: 'origine refusée' });
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      if (url.pathname === '/healthz') return send(res, 200, { ok: true });
      if (password && url.pathname === '/login') return await auth.login(req, res);
      if (!auth.authed(req) && !isPublic(url.pathname)) {
        if (url.pathname.startsWith('/api/')) return send(res, 401, { error: 'connexion requise' });
        res.writeHead(302, { Location: '/login', 'Cache-Control': 'no-store' });
        return res.end();
      }
      if (url.pathname.startsWith('/api/') && await runApi(req, res, url)) return;
      if (config.routes && await config.routes(req, res, url, ctx)) return;
      if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'route inconnue' });
      if (!safeMethod) return send(res, 405, { error: 'méthode' });
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith('/_claude/')) return await serveStatic(res, CLIENT_DIR, pathname.slice('/_claude'.length));
      return await serveStatic(res, publicDir, pathname);
    } catch (err) {
      if (!res.headersSent) send(res, 500, { error: /** @type {Error} */ (err).message });
      else res.end();
    }
  });

  function listen() {
    if (!password && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
      console.error(`APP_PASSWORD obligatoire pour écouter sur ${host} : l'interface pilote Claude (fichiers, commandes, git).`);
      process.exit(1);
    }
    server.listen(port, host, () => {
      tts.worker(); // voix chargées dès le démarrage (≈ 10 s) plutôt qu'à la première phrase
      console.log(`${name} → ${origin || `http://${host}:${port}`}  (repo : ${root}${password ? ', mot de passe' : ''}${gitSyncOn ? ', synchro git' : ''})`);
    });
    const shutdown = () => {
      if (run.proc) run.proc.kill('SIGTERM');
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1000).unref();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return server;
  }

  return { server, listen, ctx, claude, busy };
}
