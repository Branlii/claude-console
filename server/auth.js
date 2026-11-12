// Connexion par mot de passe (déploiement). Cookie signé « expiration.signature » : sans état, survit aux
// redémarrages ; changer le mot de passe ou le secret déconnecte tout.
import crypto from 'node:crypto';
import { send } from './http.js';

const SESSION_MS = 90 * 864e5;

/** @param {string} s */
const escHtml = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * @param {{ password: string, secret: string, salt: string, cookie: string, secure: boolean,
 *   name: string, themeColor: string, icon: string, lang: string }} o
 */
export function createAuth(o) {
  const key = crypto.createHash('sha256').update(`${o.salt}\0${o.secret}\0${o.password}`).digest();
  /** @param {string} v */
  const sign = (v) => crypto.createHmac('sha256', key).update(v).digest('base64url');
  /** @param {Buffer} a @param {Buffer} b */
  const sameBytes = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);
  /** @type {number[]} */
  const fails = [];
  const cookieRe = new RegExp(`(?:^|;\\s*)${o.cookie}=([^;]+)`);

  /** @param {import('node:http').IncomingMessage} req */
  function authed(req) {
    if (!o.password) return true;
    const m = (req.headers.cookie || '').match(cookieRe);
    const [exp, sig] = m ? m[1].split('.') : [];
    if (!exp || !sig || !(Number(exp) > Date.now())) return false;
    return sameBytes(Buffer.from(sig), Buffer.from(sign(exp)));
  }

  const name = escHtml(o.name);
  const page = (error = '') => `<!doctype html>
<html lang="${escHtml(o.lang.slice(0, 2))}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}</title><meta name="theme-color" content="${escHtml(o.themeColor)}"><link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">
<link rel="icon" href="${escHtml(o.icon)}"><style>
:root { color-scheme: light dark; font: 16px system-ui, sans-serif; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; color: CanvasText; }
form { display: grid; gap: 12px; width: min(320px, calc(100vw - 32px)); }
h1 { margin: 0 0 8px; font-size: 22px; color: ${escHtml(o.themeColor)}; }
input, button { font: inherit; padding: 10px 12px; border-radius: 9px; border: 1px solid #8886; }
button { background: ${escHtml(o.themeColor)}; color: #fff; border: 0; cursor: pointer; }
p { margin: 0; color: #c0392b; }
</style></head><body><form method="post" action="/login">
<h1>${name}</h1>${error ? `<p>${error}</p>` : ''}
<input type="password" name="password" placeholder="Mot de passe" autocomplete="current-password" autofocus required>
<button>Entrer</button></form></body></html>`;

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  async function login(req, res) {
    const html = 'text/html; charset=utf-8';
    if (req.method !== 'POST') return send(res, 200, page(), html);
    const now = Date.now();
    while (fails.length && fails[0] < now - 15 * 60 * 1000) fails.shift();
    if (fails.length >= 10) return send(res, 429, page('Trop d’essais, réessaie dans 15 min.'), html);
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 4096) break; }
    const given = new URLSearchParams(body).get('password') || '';
    /** @param {string} v */
    const hash = (v) => crypto.createHash('sha256').update(v).digest();
    if (!sameBytes(hash(given), hash(o.password))) {
      fails.push(now);
      await new Promise((r) => setTimeout(r, 1000));
      return send(res, 401, page('Mot de passe incorrect.'), html);
    }
    const exp = String(now + SESSION_MS);
    res.writeHead(303, {
      Location: '/', 'Cache-Control': 'no-store',
      'Set-Cookie': `${o.cookie}=${exp}.${sign(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${o.secure ? '; Secure' : ''}`,
    });
    res.end();
  }

  return { authed, login };
}
