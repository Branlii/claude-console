// Synchro git (déploiement) : pull avant chaque conversation et toutes les 5 min, push après chaque réponse.
// Un pull qui change un fichier de `restartOn` (code du serveur, package-lock.json) : le serveur quitte dès qu'aucune
// conversation n'est ouverte, Docker le relance (restart: unless-stopped) et l'entrypoint repart du repo à jour.
import { execFile } from 'node:child_process';

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<string>} sortie standard, vide en cas d'échec
 */
export function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, maxBuffer: 4 << 20 }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<{ ok: boolean, out: string, err: string }>}
 */
export function gitRun(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, maxBuffer: 4 << 20 }, (err, stdout, stderr) => resolve({ ok: !err, out: stdout, err: stderr || err?.message || '' }));
  });
}

/**
 * @param {{ root: string, enabled: boolean, restartOn: RegExp[], busy: () => boolean, running: () => boolean,
 *   onPushError: (msg: string) => void, onPulled: () => void }} o
 */
export function createGitSync(o) {
  let syncing = false;
  let syncError = ''; // dernier échec de synchro, à afficher par l'app
  let restartPending = false;

  function restartIfPending() {
    if (!restartPending || o.busy()) return false;
    console.log('Code du serveur mis à jour par git pull : redémarrage');
    setTimeout(() => process.exit(0), 300);
    return true;
  }

  /**
   * @param {'pull' | 'push'} dir
   * @returns {Promise<string | undefined>} message d'erreur
   */
  async function sync(dir) {
    if (!o.enabled || syncing) return;
    syncing = true;
    try {
      const head = async () => (await git(o.root, ['rev-parse', 'HEAD'])).trim();
      const before = dir === 'pull' ? await head() : '';
      const r = await gitRun(o.root, dir === 'pull' ? ['pull', '--ff-only', '--quiet'] : ['push', '--quiet']);
      if (!r.ok) {
        const msg = `git ${dir} : ${r.err.trim().slice(-400)}`;
        console.error(msg);
        syncError = msg;
        if (dir === 'push') o.onPushError(msg);
        return msg;
      }
      syncError = '';
      if (dir === 'pull' && before !== await head()) {
        const changed = (await git(o.root, ['diff', '--name-only', before, 'HEAD'])).split('\n');
        if (changed.some((f) => o.restartOn.some((re) => re.test(f)))) restartPending = true;
        o.onPulled();
      }
    } finally { syncing = false; }
  }

  if (o.enabled) {
    setInterval(async () => { if (!o.running()) { await sync('pull'); restartIfPending(); } }, 5 * 60 * 1000).unref();
  }

  return {
    sync, restartIfPending,
    get restartPending() { return restartPending; },
    get error() { return syncError; },
  };
}
