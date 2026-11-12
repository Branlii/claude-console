import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createClaude } from '../server/claude.js';
import { parseFrontmatter } from '../server/skills.js';
import { resolveInside } from '../server/http.js';

// Faux process `claude` : capte ce que le serveur lui écrit.
function fakeProc(mode = 'ask') {
  const written = /** @type {any[]} */ ([]);
  const proc = Object.assign(new EventEmitter(), {
    mode,
    stdin: { writable: true, write: (/** @type {string} */ s) => written.push(JSON.parse(s)), end() {}, on() {} },
    kill() {},
  });
  return { proc, written };
}

function setup(mode = 'ask') {
  const c = createClaude({
    root: '/repo', claudeBin: 'claude', allowedTools: [], deniedTools: [], systemPrompt: '', fastArgs: [], secretEnv: [],
  });
  const { proc, written } = fakeProc(mode);
  c.run.proc = /** @type {any} */ (proc);
  c.run.mode = mode;
  c.run.status = 'running';
  const line = (/** @type {object} */ o) => c.handleLine(/** @type {any} */ (proc), JSON.stringify(o));
  return { c, written, line };
}

test('texte en flux puis message complet', () => {
  const { c, line } = setup();
  line({ type: 'system', subtype: 'init', session_id: 's1' });
  line({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } });
  line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Bon' } } });
  assert.equal(c.run.live, 'Bon');
  assert.equal(c.run.activity?.phase, 'writing');
  line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Bonjour' }] } });
  assert.equal(c.run.live, '');
  assert.equal(c.run.sessionId, 's1');
  assert.deepEqual(c.run.events.map((e) => e.kind), ['text']);
});

test('carte de permission chemin relatif, puis autorisation « toujours »', () => {
  const { c, written, line } = setup();
  line({
    type: 'control_request', request_id: 'r1',
    request: {
      subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'rm /repo/a.txt' }, tool_use_id: 't1',
      permission_suggestions: [{ type: 'addRules', behavior: 'allow', rules: [{ toolName: 'Bash' }] }],
    },
  });
  const perm = c.run.events.at(-1);
  assert.equal(perm?.kind, 'perm');
  assert.equal(perm?.summary, 'rm a.txt');
  assert.equal(c.pending.size, 1);
  assert.equal(c.answer({ id: 'r1', decision: 'always' }), true);
  const res = written.at(-1).response.response;
  assert.equal(res.behavior, 'allow');
  assert.equal(res.updatedPermissions[0].destination, 'session');
  assert.equal(c.pending.size, 0);
  assert.equal(c.answer({ id: 'r1', decision: 'allow' }), false, 'demande déjà tranchée');
});

test('mode auto : action à valider refusée sans carte', () => {
  const { c, written, line } = setup('auto');
  line({ type: 'control_request', request_id: 'r2', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' } } });
  assert.equal(c.pending.size, 0);
  assert.equal(written.at(-1).response.response.behavior, 'deny');
});

test('AskUserQuestion : réponses nettoyées et renvoyées', () => {
  const { c, written, line } = setup('auto');
  const questions = [{ question: 'Couleur ?', options: [{ label: 'Bleu' }] }];
  line({ type: 'control_request', request_id: 'r3', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: { questions } } });
  assert.equal(c.run.events.at(-1)?.kind, 'ask');
  c.answer({ id: 'r3', decision: 'allow', answers: { 'Couleur ?': ' Bleu ', 'Inconnue ?': 'x' } });
  assert.deepEqual(written.at(-1).response.response.updatedInput.answers, { 'Couleur ?': 'Bleu' });
});

test('outil refusé signalé, sauf si la carte a déjà été tranchée', () => {
  const { c, line } = setup();
  line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'u1', name: 'Bash', input: { command: 'make' } }] } });
  line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'u1', is_error: true, content: 'This command requires approval' }] } });
  assert.equal(c.run.events.at(-1)?.kind, 'tool_denied');
});

test('résultat : tour terminé, onResult appelé', () => {
  let pushed = 0;
  const c = createClaude({
    root: '/repo', claudeBin: 'claude', allowedTools: [], deniedTools: [], systemPrompt: '', fastArgs: [], secretEnv: [],
    onResult: () => { pushed++; },
  });
  const { proc } = fakeProc();
  c.run.proc = /** @type {any} */ (proc);
  c.handleLine(/** @type {any} */ (proc), JSON.stringify({ type: 'result', subtype: 'success', duration_ms: 1200, num_turns: 2 }));
  assert.equal(c.run.status, 'done');
  assert.equal(pushed, 1);
  c.endClaude();
});

test('frontmatter des skills', () => {
  assert.deepEqual(parseFrontmatter('---\nname: ingest\ndescription: "Intègre l\'inbox"\nargument-hint: [dossier]\n---\n# x'),
    { name: 'ingest', description: "Intègre l'inbox", 'argument-hint': '[dossier]' });
});

test('resolveInside refuse de sortir du dossier et .git', () => {
  assert.equal(resolveInside('/repo', '../etc/passwd'), null);
  assert.equal(resolveInside('/repo', '.git/config'), null);
  assert.equal(resolveInside('/repo', 'docs/a.md'), '/repo/docs/a.md');
});
