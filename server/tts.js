// Voix naturelles (Piper, tools/tts.py) : seulement si un Python avec piper-tts est fourni (APP_TTS_PYTHON, image
// Docker « voice »). Un seul worker, lancé à la première demande et gardé ouvert (voix chargées une fois).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'tts.py');

/** @param {string} python chemin du Python de Piper, vide = désactivé */
export function createTts(python) {
  const tts = {
    proc: /** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */ (null),
    ready: /** @type {Promise<import('node:child_process').ChildProcessWithoutNullStreams | null> | null} */ (null),
    voices: /** @type {string[]} */ ([]), next: 0,
    waiting: /** @type {Map<number, (msg: any) => void>} */ (new Map()), failedAt: 0,
  };

  function worker() {
    if (!python || Date.now() - tts.failedAt < 60000) return Promise.resolve(null);
    if (tts.ready) return tts.ready;
    tts.ready = new Promise((resolve) => {
      const proc = spawn(python, [SCRIPT], { stdio: ['pipe', 'pipe', 'inherit'] });
      tts.proc = /** @type {any} */ (proc);
      let buf = '';
      proc.stdout.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg.voices) { tts.voices = msg.voices; resolve(/** @type {any} */ (proc)); continue; }
          const cb = tts.waiting.get(msg.id);
          if (cb) { tts.waiting.delete(msg.id); cb(msg); }
        }
      });
      const fail = () => {
        for (const cb of tts.waiting.values()) cb({ error: 'synthèse arrêtée' });
        tts.waiting.clear();
        Object.assign(tts, { proc: null, ready: null, voices: [], failedAt: Date.now() });
        resolve(null);
      };
      proc.on('error', fail);
      proc.on('exit', fail);
      proc.stdin.on('error', () => {});
    });
    return tts.ready;
  }

  /**
   * @param {string} text @param {string} voice @param {number} rate
   * @returns {Promise<{ wav?: string, error?: string }>}
   */
  async function synthesize(text, voice, rate) {
    const proc = await worker();
    if (!proc) return { error: 'voix du serveur indisponibles' };
    const id = ++tts.next;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { tts.waiting.delete(id); resolve({ error: 'synthèse trop longue' }); }, 20000);
      tts.waiting.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
      proc.stdin.write(`${JSON.stringify({ id, text, voice, rate })}\n`);
    });
  }

  async function voices() {
    return (await worker()) ? tts.voices : [];
  }

  return { worker, synthesize, voices };
}
