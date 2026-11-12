// Conversations Claude : un process `claude -p` par conversation, en entrée/sortie stream-json (protocole de contrôle
// du SDK). Il reste ouvert entre deux tours, et ses demandes de permission (`can_use_tool`) arrivent ici au lieu
// d'être refusées.
// Mode « ask » : ce qui sort de allowedTools est soumis à l'utilisateur dans la console.
// Mode « auto » : le classifieur de Claude Code (--permission-mode auto) décide ; ce qu'il ne tranche pas est refusé.
// Les questions (AskUserQuestion) remontent toujours à l'utilisateur.
import { spawn } from 'node:child_process';

export const MODES = { ask: 'acceptEdits', auto: 'auto' };
const IDLE_EXIT_MS = 30 * 60 * 1000;
const DENIED = /requires approval|permission for this tool use was denied|denied by the Claude Code auto mode classifier|^Mode auto :/i;

/**
 * @typedef {{ kind: string, t?: number, [k: string]: unknown }} RunEvent
 * @typedef {{ phase: string, since?: number, tokens?: number, tool?: string, summary?: string }} Activity
 * @typedef {import('node:child_process').ChildProcessWithoutNullStreams & { mode?: string }} ClaudeProc
 */

/**
 * @param {{
 *   root: string,
 *   claudeBin: string,
 *   allowedTools: string[],
 *   deniedTools: string[],
 *   systemPrompt: string,
 *   fastArgs: string[],
 *   secretEnv: string[],
 *   onResult?: () => void,
 *   onClose?: () => void,
 * }} opts
 */
export function createClaude(opts) {
  const { root } = opts;
  const run = {
    id: 0, skill: /** @type {string | null} */ (null), arg: '', sessionId: /** @type {string | null} */ (null),
    status: 'idle', events: /** @type {RunEvent[]} */ ([]), proc: /** @type {ClaudeProc | null} */ (null),
    startedAt: /** @type {number | null} */ (null), mode: 'ask', activity: /** @type {Activity | null} */ (null), live: '',
    fast: false, thinkTokens: 0, thinkStart: 0,
  };
  /** @type {Map<string, { tool: string, input: any, suggestions: any[], toolUseId?: string }>} */
  const pending = new Map();
  const userAnswered = new Set(); // tool_use_id déjà tranchés dans une carte : pas de second message au résultat
  /** @type {Map<string, string>} */
  const toolUses = new Map(); // tool_use_id → « Nom résumé », pour nommer l'outil refusé
  /** @type {Set<import('node:http').ServerResponse>} */
  const clients = new Set();
  /** @type {NodeJS.Timeout | undefined} */
  let idleTimer;

  /** @param {object} msg */
  function broadcast(msg) {
    const line = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of clients) res.write(line);
  }

  /** @param {RunEvent} ev */
  function pushEvent(ev) {
    ev.t = Date.now();
    run.events.push(ev);
    broadcast({ type: 'event', event: ev });
  }

  const publicState = () => ({
    id: run.id, skill: run.skill, arg: run.arg, sessionId: run.sessionId, status: run.status, startedAt: run.startedAt,
    mode: run.mode, waiting: pending.size, activity: run.activity, live: run.live,
  });

  const sendState = () => broadcast({ type: 'state', state: publicState() });

  /** @param {string} status */
  function setStatus(status) {
    run.status = status;
    if (status !== 'running') { run.activity = null; run.live = ''; }
    sendState();
  }

  /** @param {Activity | null} a */
  function setActivity(a) {
    run.activity = a && { since: run.activity?.phase === a.phase && run.activity?.tool === a.tool ? run.activity.since : Date.now(), ...a };
    sendState();
  }

  /** @param {string} name @param {any} input */
  function toolSummary(name, input = {}) {
    const v = input.file_path || input.command || input.pattern || input.query || input.url || input.skill || input.path || input.description || '';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.replace(root + '/', '').slice(0, 300);
  }

  // Ce que l'utilisateur doit voir pour décider.
  /** @param {string} name @param {any} input */
  function toolDetail(name, input = {}) {
    /** @param {string} s @param {number} n */
    const cut = (s, n) => (s.length > n ? s.slice(0, n) + '\n…' : s);
    const file = (input.file_path || '').replace(root + '/', '');
    if (name === 'Bash') return cut(input.command || '', 2000);
    if (name === 'Edit') return cut(`${file}\n\n− ${input.old_string || ''}\n\n+ ${input.new_string || ''}`, 2000);
    if (name === 'Write') return cut(`${file}\n\n${input.content || ''}`, 1500);
    return cut(JSON.stringify(input, null, 2), 1500);
  }

  /** @param {ClaudeProc | null} proc @param {object} obj */
  function toClaude(proc, obj) {
    if (proc && proc.stdin.writable) proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  /** @param {ClaudeProc | null} proc @param {string} requestId @param {object} response */
  function respond(proc, requestId, response) {
    toClaude(proc, { type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
  }

  /** @param {string} text */
  function userMessage(text) {
    clearTimeout(idleTimer);
    toClaude(run.proc, { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: run.sessionId || '' });
    setStatus('running');
    setActivity({ phase: 'thinking' });
  }

  /** @param {ClaudeProc} proc @param {any} msg */
  function onControlRequest(proc, msg) {
    const r = msg.request || {};
    if (r.subtype !== 'can_use_tool') {
      toClaude(proc, { type: 'control_response', response: { subtype: 'error', request_id: msg.request_id, error: `non géré : ${r.subtype}` } });
      return;
    }
    const tool = r.tool_name;
    const input = r.input || {};
    if (tool !== 'AskUserQuestion' && proc.mode === 'auto') {
      respond(proc, msg.request_id, {
        behavior: 'deny',
        message: "Mode auto : cette action demande une validation et l'interface est en mode auto, elle est refusée. " +
          "Passe par un autre outil, ou dis à l'utilisateur de basculer en mode Demander.",
      });
      return;
    }
    pending.set(msg.request_id, { tool, input, suggestions: r.permission_suggestions || [], toolUseId: r.tool_use_id });
    if (tool === 'AskUserQuestion') pushEvent({ kind: 'ask', id: msg.request_id, questions: input.questions || [] });
    else pushEvent({ kind: 'perm', id: msg.request_id, tool, summary: toolSummary(tool, input), detail: toolDetail(tool, input), reason: r.description || input.description || '' });
    setActivity({ phase: 'waiting' });
  }

  /** @param {string} id @param {string} text */
  function resolvePending(id, text) {
    pending.delete(id);
    pushEvent({ kind: 'answered', id, text });
    if (run.status === 'running') setActivity(pending.size ? { phase: 'waiting' } : { phase: 'tool' });
    else sendState();
  }

  /** @param {ClaudeProc} proc @param {string} line */
  function handleLine(proc, line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (proc !== run.proc) return; // process remplacé (nouvelle session) : sortie ignorée
    if (msg.session_id && !run.sessionId) run.sessionId = msg.session_id;

    if (msg.type === 'control_request') return onControlRequest(proc, msg);
    if (msg.type === 'control_cancel_request') {
      if (pending.has(msg.request_id)) resolvePending(msg.request_id, 'Annulé par Claude.');
      return;
    }

    if (msg.type === 'stream_event') {
      const e = msg.event || {};
      if (e.type === 'content_block_start') {
        const t = e.content_block?.type;
        if (t === 'thinking' || t === 'redacted_thinking') { run.thinkTokens = 0; run.thinkStart = Date.now(); setActivity({ phase: 'thinking' }); }
        else if (t === 'text') { run.live = ''; setActivity({ phase: 'writing' }); }
        else if (t === 'tool_use') setActivity({ phase: 'tool', tool: e.content_block.name });
      } else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
        run.live += e.delta.text;
        broadcast({ type: 'delta', text: e.delta.text });
      }
      return;
    }

    if (msg.type === 'system') {
      if (msg.subtype === 'init') { run.sessionId = msg.session_id; sendState(); }
      else if (msg.subtype === 'thinking_tokens') {
        run.thinkTokens = msg.estimated_tokens;
        if (run.activity?.phase === 'thinking') setActivity({ phase: 'thinking', tokens: msg.estimated_tokens });
      } else if (msg.subtype === 'status' && msg.status === 'requesting' && run.activity?.phase !== 'waiting') {
        setActivity({ phase: 'thinking' });
      }
      return;
    }

    if (msg.type === 'assistant') {
      if (msg.parent_tool_use_id) return; // sous-agent : son activité reste dans l'outil Task
      for (const b of msg.message?.content || []) {
        if (b.type === 'thinking' || b.type === 'redacted_thinking') {
          pushEvent({ kind: 'thinking', text: b.thinking || '', tokens: run.thinkTokens || 0, ms: run.thinkStart ? Date.now() - run.thinkStart : 0 });
        } else if (b.type === 'text' && b.text.trim()) {
          run.live = '';
          pushEvent({ kind: 'text', text: b.text });
        } else if (b.type === 'tool_use') {
          const summary = toolSummary(b.name, b.input);
          toolUses.set(b.id, `${b.name} ${summary}`.slice(0, 160));
          pushEvent({ kind: 'tool', name: b.name, summary });
          setActivity({ phase: 'tool', tool: b.name, summary: summary.slice(0, 80) });
        }
      }
    } else if (msg.type === 'user') {
      if (msg.parent_tool_use_id) return;
      for (const b of msg.message?.content || []) {
        if (b.type !== 'tool_result') continue;
        if (b.is_error && !userAnswered.has(b.tool_use_id)) {
          const c = Array.isArray(b.content) ? b.content.map((/** @type {any} */ x) => x.text || '').join(' ') : String(b.content || '');
          const tool = toolUses.get(b.tool_use_id) || '';
          if (DENIED.test(c)) pushEvent({ kind: 'tool_denied', tool, auto: /classifier|^Mode auto/i.test(c) });
          else pushEvent({ kind: 'tool_error', tool, text: c.slice(0, 400) });
        }
      }
      setActivity({ phase: 'thinking' });
    } else if (msg.type === 'result') {
      pushEvent({
        kind: 'result', ok: !msg.is_error, subtype: msg.subtype,
        cost: msg.total_cost_usd, durationMs: msg.duration_ms, turns: msg.num_turns,
      });
      setStatus('done');
      broadcast({ type: 'refresh' });
      opts.onResult?.();
      // Le process attend la suite ; fermé après une longue pause (reprise ensuite par --resume).
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => endClaude(), IDLE_EXIT_MS);
    }
  }

  // Ferme proprement le process en attente (fin de l'entrée → il quitte).
  function endClaude() {
    clearTimeout(idleTimer);
    const proc = run.proc;
    if (!proc) return;
    run.proc = null;
    proc.stdin.end();
    setTimeout(() => proc.kill('SIGTERM'), 5000).unref();
  }

  /** @param {string} prompt @param {{ resume?: string | null }} [o] */
  function startClaude(prompt, { resume } = {}) {
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages', '--permission-prompt-tool', 'stdio', '--permission-mode', MODES[/** @type {keyof typeof MODES} */ (run.mode)],
      '--append-system-prompt', opts.systemPrompt,
      // Réglages du repo seulement : les plugins et hooks perso de la machine (~/.claude) ne s'invitent pas dans l'app.
      '--setting-sources', 'project,local'];
    if (resume) args.push('--resume', resume);
    // Conversation rapide (voix) : modèle rapide et peu de réflexion, pour répondre en quelques secondes.
    if (run.fast) args.push(...opts.fastArgs);
    if (opts.allowedTools.length) args.push('--allowedTools', opts.allowedTools.join(','));
    if (opts.deniedTools.length) args.push('--disallowedTools', opts.deniedTools.join(','));

    const env = { ...process.env };
    for (const k of opts.secretEnv) delete env[k];
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    const proc = /** @type {ClaudeProc} */ (spawn(opts.claudeBin, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] }));
    proc.mode = run.mode;
    proc.stdin.on('error', () => {});
    run.proc = proc;
    toolUses.clear();
    userAnswered.clear();
    toClaude(proc, { type: 'control_request', request_id: `init_${run.id}`, request: { subtype: 'initialize' } });
    userMessage(prompt);

    let buf = '';
    proc.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { handleLine(proc, buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    let errBuf = '';
    proc.stderr.on('data', (d) => { errBuf = (errBuf + d).slice(-4000); });
    proc.on('error', (err) => {
      if (run.proc === proc) pushEvent({ kind: 'error', text: `Impossible de lancer « ${opts.claudeBin} » : ${err.message}` });
    });
    proc.on('close', (code, signal) => {
      if (buf.trim()) handleLine(proc, buf);
      if (run.proc !== proc) return; // fermé volontairement (pause, nouvelle session, changement de mode)
      run.proc = null;
      clearTimeout(idleTimer);
      for (const id of [...pending.keys()]) resolvePending(id, 'Abandonné : Claude s’est arrêté.');
      setTimeout(() => opts.onClose?.(), 1000); // conversation fermée : mise à jour du serveur en attente appliquée
      if (run.status !== 'running') return sendState();
      if (signal) pushEvent({ kind: 'error', text: 'Arrêté.' });
      else if (code !== 0) pushEvent({ kind: 'error', text: errBuf.trim().slice(-800) || `claude a quitté avec le code ${code}` });
      setStatus(signal || code !== 0 ? 'error' : 'done');
      broadcast({ type: 'refresh' });
    });
    return proc;
  }

  // Réponse à une carte de la console (permission ou question).
  /** @param {{ id: string, decision: string, note?: string, answers?: Record<string, string> }} a */
  function answer({ id, decision, note = '', answers = {} }) {
    const p = pending.get(id);
    if (!p || !run.proc) return false;
    const cleanNote = String(note).trim().slice(0, 500);
    if (p.toolUseId) userAnswered.add(p.toolUseId);
    if (p.tool === 'AskUserQuestion') {
      if (decision === 'deny') {
        respond(run.proc, id, { behavior: 'deny', message: "L'utilisateur a ignoré la question. Continue sans, ou repose-la en texte à la fin de ton message." });
        resolvePending(id, 'Question ignorée.');
      } else {
        /** @type {Record<string, string>} */
        const clean = {};
        for (const q of p.input.questions || []) {
          const a = String(answers[q.question] ?? '').trim().slice(0, 1000);
          if (a) clean[q.question] = a;
        }
        respond(run.proc, id, { behavior: 'allow', updatedInput: { ...p.input, answers: clean } });
        resolvePending(id, Object.values(clean).join(' · ') || 'Sans réponse.');
      }
      return true;
    }
    if (decision === 'deny') {
      respond(run.proc, id, { behavior: 'deny', message: `Refusé par l'utilisateur.${cleanNote ? ` Sa remarque : ${cleanNote}` : ''}` });
      resolvePending(id, `Refusé${cleanNote ? ` : ${cleanNote}` : ''}.`);
      return true;
    }
    /** @type {{ behavior: string, updatedInput: any, updatedPermissions?: any[] }} */
    const res = { behavior: 'allow', updatedInput: p.input };
    if (decision === 'always') {
      res.updatedPermissions = p.suggestions
        .filter((s) => s.type === 'addRules' && s.behavior === 'allow')
        .map((s) => ({ ...s, destination: 'session' }));
    }
    respond(run.proc, id, res);
    resolvePending(id, decision === 'always' ? 'Autorisé pour toute la session.' : 'Autorisé.');
    return true;
  }

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  function subscribe(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`data: ${JSON.stringify({ type: 'snapshot', state: publicState(), events: run.events })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clients.delete(res); clearInterval(ping); });
  }

  return {
    run, pending, broadcast, pushEvent, publicState, sendState, startClaude, endClaude, userMessage, answer, subscribe,
    /** @internal pour les tests */ handleLine,
  };
}
