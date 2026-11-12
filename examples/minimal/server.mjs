// Exemple minimal : une app avec la console Claude Code.
// Lancer depuis n'importe quel repo git : APP_ROOT = le repo dans lequel Claude travaille (défaut : dossier courant).
//   node examples/minimal/server.mjs
// Puis ouvrir http://127.0.0.1:4173. Dans une vraie app, l'import est `@branli/claude-console/server`.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaudeServer } from '../../server/index.js';
const here = path.dirname(fileURLToPath(import.meta.url));
createClaudeServer({ name: 'Exemple', root: process.env.APP_ROOT || process.cwd(), publicDir: path.join(here, 'public'),
  publicPaths: ['/manifest.webmanifest', '/sw.js'] }).listen();
