// Markdown des réponses de Claude : rendu nettoyé (sans script ni gestionnaire d'événement) et texte à lire à voix haute.
import { marked } from './vendor/marked.esm.js';

marked.setOptions({ gfm: true });
export { marked };

/** @param {string} html */
export function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  doc.querySelectorAll('script,iframe,object,embed,style,link,meta,form,base').forEach((n) => n.remove());
  for (const el of doc.querySelectorAll('*')) {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name)) el.removeAttribute(a.name);
      else if (/^(href|src|xlink:href|action|formaction)$/i.test(a.name) && /^\s*(javascript|data|vbscript):/i.test(a.value)) el.removeAttribute(a.name);
    }
  }
  return /** @type {Element} */ (doc.body.firstElementChild).innerHTML;
}

/**
 * Rendu par défaut : liens externes dans un nouvel onglet. Une app qui sait résoudre les chemins du repo
 * (liens vers ses pages, images servies par son API) remplace `panel.renderMarkdown`.
 * @param {string} md
 */
export function renderMarkdown(md) {
  const wrap = document.createElement('div');
  wrap.className = 'md';
  wrap.innerHTML = sanitize(/** @type {string} */ (marked.parse(md)));
  for (const a of wrap.querySelectorAll('a[href]')) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(a.getAttribute('href') || '')) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); }
  }
  return wrap;
}

/**
 * Markdown → texte à dire : sans code, diagrammes ni emojis ; un tableau est seulement signalé.
 * @param {string} md
 * @param {{ table: string, link: string, approx: string }} words
 */
export function speechText(md, words) {
  const doc = new DOMParser().parseFromString(/** @type {string} */ (marked.parse(md)), 'text/html'); // document inerte : aucune image chargée
  doc.querySelectorAll('pre').forEach((n) => n.remove());
  doc.querySelectorAll('table').forEach((n) => n.replaceWith(words.table));
  doc.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, tr, br').forEach((n) => n.append('\n'));
  return (doc.body.textContent || '')
    .replace(/\bhttps?:\/\/\S+/g, words.link)
    .replace(/\p{Extended_Pictographic}|️/gu, '')
    .replace(/\s*[→⇒]\s*/g, ', ').replace(/≈\s*/g, `${words.approx} `).replace(/[|*_#>]/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*/g, '\n').trim();
}
