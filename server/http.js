// Petits outils HTTP et fichiers partagés par le serveur et les routes de l'app.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8', '.pdf': 'application/pdf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.heic': 'image/heic', '.mp4': 'video/mp4', '.mov': 'video/quicktime',
  '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.woff2': 'font/woff2',
};
export const ACTIVE_CONTENT = new Set(['.html', '.htm', '.svg', '.xml', '.xhtml']);
export const IGNORED = new Set(['.DS_Store', '.gitkeep']);

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body objet (JSON), chaîne ou Buffer
 */
export function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  res.end(data);
}

/** @param {import('node:http').IncomingMessage} req */
export async function readJson(req, max = 1e6) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > max) throw new Error('trop gros'); }
  return body ? JSON.parse(body) : {};
}

export async function exists(/** @type {string} */ p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

/**
 * Chemin absolu de `rel` sous `base`, ou null s'il en sort (ou touche à .git).
 * @param {string} base
 * @param {unknown} rel
 */
export function resolveInside(base, rel) {
  if (typeof rel !== 'string' || rel === '' || rel.includes('\0')) return null;
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  if (path.relative(base, abs).split(path.sep).includes('.git')) return null;
  return abs;
}

/**
 * Liste récursive des fichiers de `dir`, chemins relatifs à `root` (séparateur /).
 * @param {string} root
 * @param {string} dir
 * @param {(abs: string) => boolean} [filter]
 * @returns {Promise<{path: string, name: string, size: number, mtime: string}[]>}
 */
export async function walk(root, dir, filter = () => true) {
  /** @type {{path: string, name: string, size: number, mtime: string}[]} */
  const out = [];
  /** @type {import('node:fs').Dirent[]} */
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  for (const e of entries) {
    if (IGNORED.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(root, abs, filter)));
    else if (filter(abs)) {
      const st = await fsp.stat(abs);
      out.push({ path: path.relative(root, abs).split(path.sep).join('/'), name: e.name, size: st.size, mtime: st.mtime.toISOString() });
    }
  }
  return out;
}

/**
 * Envoie un fichier du disque (GET ou HEAD). Un HTML/SVG est servi en bac à sable : il ne peut pas appeler l'API
 * avec l'origine de l'app.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} abs
 * @param {{ download?: boolean }} [opts]
 */
export async function sendFile(req, res, abs, { download = false } = {}) {
  let st;
  try { st = await fsp.stat(abs); } catch { return send(res, 404, { error: 'introuvable' }); }
  if (!st.isFile()) return send(res, 400, { error: 'pas un fichier' });
  const ext = path.extname(abs).toLowerCase();
  /** @type {Record<string, string | number>} */
  const headers = {
    'Content-Type': MIME[/** @type {keyof typeof MIME} */ (ext)] || 'application/octet-stream', 'Content-Length': st.size,
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
  };
  if (ACTIVE_CONTENT.has(ext)) headers['Content-Security-Policy'] = 'sandbox';
  if (download) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(abs).pipe(res);
}

/**
 * Fichier statique de `dir` (« / » → index.html), sans sortir du dossier.
 * @param {import('node:http').ServerResponse} res
 * @param {string} dir
 * @param {string} pathname
 */
export async function serveStatic(res, dir, pathname) {
  const abs = resolveInside(dir, pathname === '/' ? 'index.html' : pathname.slice(1));
  if (!abs) return send(res, 404, 'not found', 'text/plain');
  try {
    const data = await fsp.readFile(abs);
    send(res, 200, data, MIME[/** @type {keyof typeof MIME} */ (path.extname(abs))] || 'application/octet-stream');
  } catch { send(res, 404, 'not found', 'text/plain'); }
}
