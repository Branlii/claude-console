// <claude-panel> : console Claude Code de l'app (light DOM, stylée par claude-panel.css).
// Flux SSE /api/run/events, cartes de permission et de question, barre d'activité, menu « / » des skills,
// modes Demander / Auto, voix (voice.js) et dictée (dictation.js).
//
// Attributs : lang (« fr-FR »), server-voice (motif de la voix Piper préférée), layout-buttons (boutons agrandir / replier).
// Points d'accroche (propriétés) : renderMarkdown(md) → Node, slashArgs(skill) → string[], toast(msg), messages.
// Événements (remontent jusqu'au document) : claude:state (detail = état), claude:refresh, claude:show,
// claude:close, claude:toggle-max.
import { renderMarkdown } from './markdown.js';
import { createVoice } from './voice.js';
import { createDictation } from './dictation.js';

export const MESSAGES = {
  title: 'Claude Code',
  modeAsk: 'Demander',
  modeAskTitle: 'Claude te demande avant toute action hors liste autorisée (commande shell, fichier protégé…)',
  modeAuto: 'Auto',
  modeAutoTitle: 'Claude enchaîne sans demander : le mode auto de Claude Code juge chaque action et refuse les risquées. Les questions te sont toujours posées.',
  modeLabel: 'Permissions de Claude',
  modeChanged: 'Mode changé : appliqué à partir de ton prochain message.',
  stopVoiceTitle: 'Faire taire Claude (Échap)',
  voiceMenuTitle: 'Voix de Claude',
  voiceOnLabel: 'Claude lit ses réponses à voix haute',
  voiceLoopLabel: 'Conversation continue : après un message dicté, le micro se rouvre quand Claude a fini de parler',
  voiceNameLabel: 'Voix',
  voiceRateLabel: 'Vitesse',
  voiceTestLabel: 'Tester',
  voiceHelp: 'Voix du navigateur ou du téléphone (plus de voix : réglages d\'accessibilité de l\'appareil). Échap ou ⏹ : silence. Activée d\'office dans l\'app installée. Un silence au micro arrête la conversation.',
  voiceOnTitle: 'Claude parle — réglages de la voix',
  voiceOffTitle: 'Claude ne parle pas — activer la voix',
  voiceAutoServer: 'Automatique (voix naturelle du serveur)',
  voiceAutoDevice: 'Automatique (meilleure voix de l’appareil)',
  voiceGroupServer: 'Naturelles (serveur)',
  voiceGroupDevice: 'De l’appareil',
  voiceEnabled: 'Je te lirai mes réponses.',
  voiceEnableFirst: 'Active d’abord « Claude lit ses réponses ».',
  voiceTest: 'Bonjour, je suis Claude.',
  serverVoiceDown: 'Voix du serveur indisponible : voix de l’appareil utilisée.',
  speech: { table: 'Tableau à l’écran.', link: 'lien à l’écran', approx: 'environ' },
  sayQuestion: (/** @type {any} */ q) => `Question. ${q.question} ${(q.options || []).length ? `Choix : ${q.options.map((/** @type {any} */ o) => o.label).join(', ')}.` : ''}`,
  sayPerm: (/** @type {string} */ tool) => `Claude demande l’autorisation d’utiliser ${tool}.`,
  sayFailed: 'Claude s’est arrêté sur une erreur.',
  sayError: 'Erreur.',
  maxTitle: 'Agrandir Claude (Alt+3)',
  unmaxTitle: 'Réduire Claude (Alt+3)',
  closeTitle: 'Replier Claude (Alt+2)',
  empty: 'Écris ou dicte 🎙 ci-dessous, ou / pour lancer un skill.',
  placeholderIdle: 'Écris ou dicte, ou / pour un skill…  (⌘↵ pour envoyer)',
  placeholderSession: 'Réponds à Claude, ou / pour lancer un autre skill…  (⌘↵ pour envoyer)',
  reset: 'Nouvelle session',
  stop: 'Arrêter',
  send: 'Envoyer',
  micIdle: 'Parler',
  micListening: 'J’écoute',
  micStartTitle: 'Parler à Claude : envoyé à la fin de ta phrase, le micro se rouvre après sa réponse',
  micStopTitle: 'Terminer et envoyer (Échap : annuler et arrêter la conversation)',
  micNeverStarted: 'Le micro ne démarre pas ici : utilise le micro du clavier.',
  dictationDownloading: 'Service de dictée en ligne injoignable : téléchargement de la dictée sur l’appareil, réessaie 🎙 dans une minute.',
  dictationReady: 'Dictée sur l’appareil prête : appuie sur 🎙.',
  /** @type {Record<string, string>} */
  dictationErrors: {
    'not-allowed': 'Micro refusé : autorise-le pour ce site dans les réglages du navigateur.',
    'service-not-allowed': 'Dictée indisponible ici : utilise le micro du clavier.',
    'audio-capture': 'Aucun micro détecté.',
    // `network` = service de transcription injoignable, souvent avec le réseau qui marche : Brave, Chromium, Opera… n'ont pas accès à celui de Google.
    network: 'Service de dictée du navigateur injoignable : passe par Chrome, Edge ou Safari, ou la dictée du système (Mac : touche 🌐 ou Fn deux fois).',
    'language-not-supported': 'Dictée dans cette langue indisponible dans ce navigateur.',
  },
  status: { idle: 'inactif', done: 'en attente de ta réponse', error: 'interrompu', running: 'répond', waiting: 'attend ta réponse' },
  skillRunning: (/** @type {string} */ skill) => `/${skill} en cours`,
  phases: { thinking: 'Réfléchit', writing: 'Écrit', tool: 'Travaille', waiting: 'Attend ta réponse ci-dessus' },
  allow: 'Autoriser', always: 'Toujours (session)', alwaysTitle: 'Ne plus demander pour cette action jusqu\'à la fin de la session',
  deny: 'Refuser', notePlaceholder: 'Remarque pour Claude (si refus)…',
  answer: 'Répondre', ignore: 'Ignorer', ignoreTitle: 'Claude continue sans ta réponse', other: 'Autre réponse…',
  answerAll: 'Réponds à chaque question, ou clique sur Ignorer.',
  thinking: 'Réflexion',
  denied: (/** @type {boolean} */ auto, /** @type {string} */ tool) => `⊘ ${auto ? 'Refusé par le mode auto' : 'Hors liste autorisée, non exécuté'}${tool ? ` : ${tool}` : ''} — Claude passe par un autre outil.`,
  deniedTitle: 'Outils permis sans validation : allowedTools du serveur. En mode Demander, le reste t’est soumis.',
  toolError: 'Outil en erreur : ',
  result: (/** @type {any} */ ev, /** @type {string} */ secs) => `${ev.ok ? 'Tour terminé' : `Terminé avec erreur (${ev.subtype})`} · ${secs}${ev.turns ? ` · ${ev.turns} étape${ev.turns > 1 ? 's' : ''}` : ''}`,
  unknownSkill: (/** @type {string} */ name) => `Skill inconnu : /${name} — tape / pour voir la liste.`,
  unknownSkillHint: (/** @type {string} */ name) => `skill inconnu : /${name}`,
  retrying: 'Serveur en redémarrage, nouvel essai…',
};

const PREFS_KEY = 'claude-panel';

/** @param {unknown} s */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** @param {number} ms */
const fmtSecs = (ms) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`;
};

/** @param {Element} c */
const nearBottom = (c) => c.scrollHeight - c.scrollTop - c.clientHeight < 80;

/** @param {string} text */
const isCommand = (text) => /^\/[\w-]+(?: [^\n]*)?$/.test(text.trim());

export class ClaudePanel extends HTMLElement {
  constructor() {
    super();
    this.esc = esc;
    /** @type {typeof MESSAGES} */
    this._messages = MESSAGES;
    /** @type {any} état de la conversation (publicState du serveur) */
    this.state = { status: 'idle' };
    /** @type {{ name: string, description: string, argumentHint: string }[]} */
    this.skills = [];
    /** @type {(md: string) => Node} */
    this.renderMarkdown = renderMarkdown;
    /** @type {(skill: string) => string[]} valeurs d'argument proposées après « /skill » */
    this.slashArgs = () => [];
    /** @type {{ voice?: boolean, voiceName?: string, voiceRate?: number, handsFree?: boolean }} */
    this.prefs = {};
    try { Object.assign(this.prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch {}
    this.slash = { items: /** @type {{ value: string, label: string, hint?: string, desc?: string }[]} */ ([]), sel: 0, closed: false };
    /** @type {HTMLElement | null} */
    this.liveNode = null;
    this.liveFrame = 0;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this.toastTimer = undefined;
    /** @type {ReturnType<typeof createVoice>} */
    this.voice = /** @type {any} */ (null);
    /** @type {ReturnType<typeof createDictation>} */
    this.dictation = /** @type {any} */ (null);
  }

  get lang() { return this.getAttribute('lang') || 'fr-FR'; }
  get messages() { return this._messages; }
  set messages(m) {
    this._messages = { ...MESSAGES, ...m };
    if (this.isConnected && this.ref('console')) { this.ref('console').dataset.empty = this._messages.empty; this.renderRunState(); }
  }

  /** @param {Partial<ClaudePanel['prefs']>} patch */
  setPrefs(patch) {
    Object.assign(this.prefs, patch);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs)); } catch {}
  }

  /** @param {string} name @returns {any} */
  ref(name) { return this.querySelector(`[data-ref="${name}"]`); }

  /** @param {string} msg */
  toast(msg) {
    let t = this.ref('toast');
    if (!t) { t = document.createElement('div'); t.className = 'cc-toast'; t.dataset.ref = 'toast'; t.setAttribute('role', 'status'); this.append(t); }
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
  }

  /** @param {string} url @param {RequestInit} [opts] @returns {Promise<any>} */
  async api(url, opts = {}) {
    const res = await fetch(url, opts);
    // Déploiement protégé par mot de passe : session expirée → page de connexion.
    if (res.status === 401) { location.href = '/login'; throw new Error('connexion requise'); }
    const isJson = (res.headers.get('content-type') || '').includes('json');
    const body = isJson ? await res.json() : await res.text();
    if (!res.ok) {
      const err = /** @type {Error & { status?: number }} */ (new Error((isJson && body.error) || res.statusText));
      err.status = res.status;
      throw err;
    }
    return body;
  }

  /** @param {string} url @param {object} [data] */
  postJson(url, data) {
    return this.api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) });
  }

  /** @param {string} type @param {unknown} [detail] */
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true })); }

  connectedCallback() {
    if (this.voice) return;
    const m = this.messages;
    const layoutButtons = this.hasAttribute('layout-buttons') ? `
          <button type="button" class="icon-btn sm" data-ref="toggle-max" title="${esc(m.maxTitle)}">⤢</button>
          <button type="button" class="icon-btn sm" data-ref="close" title="${esc(m.closeTitle)}">⟩</button>` : '';
    this.innerHTML = `
      <div class="claude-head">
        <h2>${esc(m.title)}</h2>
        <span class="run-status" data-ref="run-status">${esc(m.status.idle)}</span>
        <span class="mode-switch" data-ref="mode-switch" role="radiogroup" aria-label="${esc(m.modeLabel)}">
          <button type="button" role="radio" data-mode="ask" title="${esc(m.modeAskTitle)}">${esc(m.modeAsk)}</button>
          <button type="button" role="radio" data-mode="auto" title="${esc(m.modeAutoTitle)}">${esc(m.modeAuto)}</button>
        </span>
        <span class="head-actions">
          <button type="button" class="icon-btn sm" data-ref="voice-stop" title="${esc(m.stopVoiceTitle)}" hidden>⏹</button>
          <details class="voice-menu" data-ref="voice-menu">
            <summary class="icon-btn sm" data-ref="voice-btn" title="${esc(m.voiceMenuTitle)}">🔇</summary>
            <div class="voice-panel">
              <label class="voice-check"><input type="checkbox" data-ref="voice-on"> ${esc(m.voiceOnLabel)}</label>
              <label class="voice-check"><input type="checkbox" data-ref="voice-loop"> ${esc(m.voiceLoopLabel)}</label>
              <label>${esc(m.voiceNameLabel)} <select data-ref="voice-name"></select></label>
              <label>${esc(m.voiceRateLabel)} <input type="range" data-ref="voice-rate" min="0.7" max="1.6" step="0.05"> <output data-ref="voice-rate-out"></output></label>
              <button type="button" class="btn btn-sm" data-ref="voice-test">${esc(m.voiceTestLabel)}</button>
              <small>${esc(m.voiceHelp)}</small>
            </div>
          </details>${layoutButtons}
        </span>
      </div>
      <div class="console" data-ref="console" aria-live="polite" data-empty="${esc(m.empty)}"></div>
      <div class="activity" data-ref="activity" hidden></div>
      <form class="reply" data-ref="reply">
        <div class="slash-menu" data-ref="slash-menu" role="listbox" hidden></div>
        <textarea data-ref="reply-text" rows="2" placeholder="${esc(m.placeholderIdle)}" aria-autocomplete="list"></textarea>
        <div class="slash-hint" data-ref="slash-hint"></div>
        <div class="reply-actions">
          <button type="button" class="btn btn-ghost mic" data-ref="mic" aria-pressed="false" hidden>🎙</button>
          <button type="button" class="btn btn-ghost" data-ref="reset">${esc(m.reset)}</button>
          <button type="button" class="btn btn-danger" data-ref="stop" hidden>${esc(m.stop)}</button>
          <button type="submit" class="btn btn-primary" data-ref="send">${esc(m.send)}</button>
        </div>
      </form>`;
    this.voice = createVoice(this);
    this.dictation = createDictation(this);
    this.wire();
    this.voice.setup();
    this.dictation.render();
    setInterval(() => { if (this.state.status === 'running') this.renderActivity(); }, 1000);
    // Après le script de l'app (points d'accroche posés) : historique et skills.
    setTimeout(() => { this.connectEvents(); this.loadSkills(); });
  }

  async loadSkills() {
    try { this.skills = await this.api('/api/skills'); } catch {}
  }

  // ---------- actions publiques ----------

  /** Lance un skill (nouvelle session). @param {string} skill @param {string} [arg] */
  async run(skill, arg = '') {
    this.voice.state.sending = true;
    try {
      await this.postJson('/api/run', { skill, arg });
      this.emit('claude:show');
      return true;
    } catch (err) { this.voice.state.sending = false; this.toast(/** @type {Error} */ (err).message); return false; }
  }

  // Pas de session : le message ouvre une conversation (Claude choisit le skill).
  // Serveur en redémarrage (mise à jour) : quelques nouveaux essais ; session perdue au redémarrage : nouvelle conversation.
  // Message dicté sans session : directement le skill vocal du serveur, en mode rapide (`voice: true`).
  /** @param {string} text @param {{ spoken?: boolean }} [o] */
  async send(text, { spoken = false } = {}) {
    for (let attempt = 0; ; attempt++) {
      const url = this.state.sessionId ? '/api/run/reply' : '/api/run';
      const body = url === '/api/run' && spoken ? { text, voice: true } : { text };
      try { return await this.postJson(url, body); } catch (err) {
        const e = /** @type {Error & { status?: number }} */ (err);
        if (url === '/api/run/reply' && e.status === 400) { this.state.sessionId = null; continue; }
        if (!(e.status === 503 || e.status === undefined) || attempt >= 5) throw err;
        this.toast(this.messages.retrying);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  // ---------- menu « / » ----------

  /** @param {string} name */
  skillNamed(name) { return this.skills.find((s) => s.name === name); }

  // Suggestions : noms de skills après « / », puis valeurs d'argument (slashArgs de l'app).
  /** @param {string} text */
  slashItems(text) {
    let m = text.match(/^\/([\w-]*)$/);
    if (m) {
      const start = m[1].toLowerCase();
      return this.skills.filter((s) => s.name.startsWith(start))
        .map((s) => ({ value: `/${s.name} `, label: `/${s.name}`, hint: s.argumentHint, desc: s.description.split(/ — |\. /)[0] }));
    }
    m = text.match(/^\/([\w-]+) +([^\s]*)$/);
    if (!m || !this.skillNamed(m[1])) return [];
    const [, skill, typed] = m;
    return (this.slashArgs(skill) || []).filter((v) => v.toLowerCase().startsWith(typed.toLowerCase()) && v !== typed)
      .map((v) => ({ value: `/${skill} ${v}`, label: v }));
  }

  renderSlash() {
    const text = this.ref('reply-text').value;
    const slash = this.slash;
    slash.items = slash.closed ? [] : this.slashItems(text);
    slash.sel = Math.min(slash.sel, Math.max(slash.items.length - 1, 0));
    const menu = this.ref('slash-menu');
    menu.hidden = !slash.items.length;
    menu.innerHTML = slash.items.map((it, i) => `
      <button type="button" class="slash-item ${i === slash.sel ? 'sel' : ''}" role="option" data-i="${i}">
        <b>${esc(it.label)}</b>${it.hint ? `<span class="hint">${esc(it.hint)}</span>` : ''}
        ${it.desc ? `<span class="desc">${esc(it.desc)}</span>` : ''}
      </button>`).join('');
    menu.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });

    // Rappel de l'argument attendu une fois le skill choisi.
    const m = text.match(/^\/([\w-]+)(\s|$)/);
    const s = m && this.skillNamed(m[1]);
    let hint = '';
    if (m && !s && !slash.items.length) hint = this.messages.unknownSkillHint(m[1]);
    else if (s && m?.[2]) hint = `/${s.name} ${s.argumentHint || ''}`;
    this.ref('slash-hint').textContent = hint;
  }

  /** @param {number} i */
  pickSlash(i) {
    const ta = this.ref('reply-text');
    ta.value = this.slash.items[i].value;
    this.slash.sel = 0;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    this.renderSlash();
  }

  // ---------- console ----------

  // Carte « Autoriser ? » : une action hors liste autorisée attend ta décision (mode Demander).
  /** @param {any} ev */
  permCard(ev) {
    const m = this.messages;
    const div = document.createElement('div');
    div.className = 'ev-card perm';
    div.dataset.id = ev.id;
    div.innerHTML = `
      <div class="card-head">${esc(m.allow)} <b>${esc(ev.tool)}</b> ?${ev.reason ? ` <span class="card-reason">${esc(ev.reason)}</span>` : ''}</div>
      <pre class="card-detail">${esc(ev.detail)}</pre>
      <div class="card-actions">
        <button type="button" class="btn btn-primary btn-sm" data-answer="allow">${esc(m.allow)}</button>
        <button type="button" class="btn btn-sm" data-answer="always" title="${esc(m.alwaysTitle)}">${esc(m.always)}</button>
        <input type="text" class="card-note" placeholder="${esc(m.notePlaceholder)}" aria-label="${esc(m.notePlaceholder)}">
        <button type="button" class="btn btn-danger btn-sm" data-answer="deny">${esc(m.deny)}</button>
      </div>
      <div class="card-done" hidden></div>`;
    return div;
  }

  // Carte question (AskUserQuestion) : options cliquables + réponse libre.
  /** @param {any} ev */
  askCard(ev) {
    const m = this.messages;
    const div = /** @type {HTMLElement & { questions?: any[] }} */ (document.createElement('div'));
    div.className = 'ev-card ask';
    div.dataset.id = ev.id;
    div.questions = ev.questions;
    div.innerHTML = ev.questions.map((/** @type {any} */ q, /** @type {number} */ qi) => `
      <fieldset class="ask-q" data-q="${qi}">
        <legend>${q.header ? `<span class="chip accent">${esc(q.header)}</span> ` : ''}${esc(q.question)}</legend>
        ${(q.options || []).map((/** @type {any} */ o) => `
          <label class="ask-opt">
            <input type="${q.multiSelect ? 'checkbox' : 'radio'}" name="q-${esc(ev.id)}-${qi}" value="${esc(o.label)}">
            <span><b>${esc(o.label)}</b>${o.description ? `<small>${esc(o.description)}</small>` : ''}</span>
          </label>`).join('')}
        <input type="text" class="ask-other" placeholder="${esc(m.other)}" aria-label="${esc(m.other)}">
      </fieldset>`).join('') + `
      <div class="card-actions">
        <button type="button" class="btn btn-primary btn-sm" data-answer="allow">${esc(m.answer)}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-answer="deny" title="${esc(m.ignoreTitle)}">${esc(m.ignore)}</button>
      </div>
      <div class="card-done" hidden></div>`;
    return div;
  }

  /** @param {string} id @param {string} text */
  markAnswered(id, text) {
    const card = /** @type {HTMLElement | undefined} */ ([...this.ref('console').querySelectorAll('.ev-card')].find((c) => c.dataset.id === id));
    if (!card) return;
    card.classList.add('done');
    for (const el of card.querySelectorAll('button, input')) /** @type {HTMLInputElement} */ (el).disabled = true;
    /** @type {HTMLElement} */ (card.querySelector('.card-actions')).hidden = true;
    const done = /** @type {HTMLElement} */ (card.querySelector('.card-done'));
    done.textContent = text;
    done.hidden = false;
  }

  /** @param {any} ev @returns {HTMLElement | null} */
  eventNode(ev) {
    const m = this.messages;
    const div = document.createElement('div');
    switch (ev.kind) {
      case 'user': div.className = 'ev-user'; div.textContent = ev.text; break;
      case 'text': div.className = 'ev-text'; div.append(this.renderMarkdown(ev.text)); break;
      case 'thinking': {
        div.className = 'ev-think';
        const label = `✻ ${m.thinking}${ev.ms ? ` · ${fmtSecs(ev.ms)}` : ''}${ev.tokens ? ` · ≈${ev.tokens} tokens` : ''}`;
        if (!ev.text) { div.textContent = label; break; }
        const d = document.createElement('details');
        d.innerHTML = `<summary>${esc(label)}</summary>`;
        const body = document.createElement('div');
        body.className = 'think-text';
        body.textContent = ev.text;
        d.append(body);
        div.append(d);
        break;
      }
      case 'tool': div.className = 'ev-tool'; div.innerHTML = `▸ <b>${esc(ev.name)}</b> ${esc(ev.summary)}`; break;
      case 'perm': return this.permCard(ev);
      case 'ask': return this.askCard(ev);
      case 'tool_denied':
        div.className = 'ev-deny';
        div.textContent = m.denied(ev.auto, ev.tool);
        div.title = m.deniedTitle;
        break;
      case 'tool_error': div.className = 'ev-err'; div.textContent = `${m.toolError}${ev.text}`; break;
      case 'error': div.className = 'ev-err'; div.textContent = ev.text; break;
      case 'result': div.className = 'ev-result'; div.textContent = m.result(ev, ev.durationMs ? fmtSecs(ev.durationMs) : ''); break;
      default: return null;
    }
    return div;
  }

  /** @param {any} ev */
  appendEvent(ev) {
    const c = this.ref('console');
    const stick = nearBottom(c);
    if (ev.kind === 'answered') this.markAnswered(ev.id, ev.text);
    else {
      if (ev.kind === 'text') this.state.live = '';
      const node = this.eventNode(ev);
      if (node) c.append(node);
      this.renderLive();
    }
    if (stick || ev.kind === 'perm' || ev.kind === 'ask') c.scrollTop = c.scrollHeight;
  }

  // Texte de Claude en cours d'écriture, remplacé par le message complet à la fin du bloc.
  renderLive() {
    cancelAnimationFrame(this.liveFrame);
    this.liveFrame = 0;
    const c = this.ref('console');
    const text = this.state.live;
    if (!text) { this.liveNode?.remove(); this.liveNode = null; return; }
    const stick = nearBottom(c);
    if (!this.liveNode) { this.liveNode = document.createElement('div'); this.liveNode.className = 'ev-text live'; }
    this.liveNode.replaceChildren(this.renderMarkdown(text));
    c.append(this.liveNode); // toujours en dernier
    if (stick) c.scrollTop = c.scrollHeight;
  }

  scheduleLive() { if (!this.liveFrame) this.liveFrame = requestAnimationFrame(() => this.renderLive()); }

  renderActivity() {
    const r = this.state;
    const el = this.ref('activity');
    el.hidden = r.status !== 'running';
    if (el.hidden) return;
    const a = r.activity || {};
    const phase = r.waiting ? 'waiting' : a.phase || 'thinking';
    const phases = /** @type {Record<string, string>} */ (this.messages.phases);
    let label = phases[phase] || phase;
    if (phase === 'thinking' && a.tokens) label += ` · ≈${a.tokens} tokens`;
    if (phase === 'tool' && a.tool) label = `${a.tool}${a.summary ? ` · ${a.summary}` : ''}`;
    const ms = a.since && !r.waiting ? Date.now() - a.since : 0;
    el.className = `activity ${phase}`;
    el.innerHTML = `<span class="dot"></span><span class="act-label">${esc(label)}${phase === 'thinking' || phase === 'writing' ? '…' : ''}</span>`
      + (ms >= 2000 ? `<span class="act-time">${fmtSecs(ms)}</span>` : '');
  }

  renderRunState() {
    const r = this.state;
    const m = this.messages;
    const running = r.status === 'running';
    const status = /** @type {Record<string, string>} */ (m.status);
    const label = running
      ? (r.waiting ? m.status.waiting : r.skill ? m.skillRunning(r.skill) : m.status.running)
      : status[r.status] || r.status;
    const st = this.ref('run-status');
    st.textContent = label;
    st.className = `run-status ${running ? 'running' : ''} ${r.waiting ? 'waiting' : ''}`;
    for (const b of this.ref('mode-switch').querySelectorAll('[data-mode]')) {
      const on = b.dataset.mode === (r.mode || 'ask');
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    this.ref('stop').hidden = !running;
    this.ref('send').disabled = running;
    this.ref('reply-text').disabled = running;
    this.ref('mic').disabled = running;
    this.ref('reply-text').placeholder = r.sessionId ? m.placeholderSession : m.placeholderIdle;
    this.ref('reset').disabled = running;
    this.renderActivity();
    this.emit('claude:state', r);
  }

  connectEvents() {
    const es = new EventSource('/api/run/events');
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'snapshot') {
        this.state = msg.state;
        this.ref('console').innerHTML = '';
        this.liveNode = null;
        // Historique rejoué (connexion, nouvelle session) : rien à dire.
        this.voice.stop();
        this.voice.state.said = '';
        for (const ev of msg.events) this.appendEvent(ev);
        this.renderLive();
        this.renderRunState();
      } else if (msg.type === 'event') { this.appendEvent(msg.event); this.voice.speakEvent(msg.event); }
      else if (msg.type === 'delta') { this.state.live = (this.state.live || '') + msg.text; this.scheduleLive(); this.voice.speakLive(); }
      else if (msg.type === 'state') { this.state = msg.state; this.scheduleLive(); this.renderRunState(); }
      else if (msg.type === 'refresh') { this.loadSkills(); this.emit('claude:refresh'); }
    };
  }

  // Réponses aux cartes (permission ou question).
  /** @param {HTMLElement & { questions?: any[] }} card @param {string} decision */
  async answerCard(card, decision) {
    /** @type {{ id?: string, decision: string, note?: string, answers?: Record<string, string> }} */
    const body = { id: card.dataset.id, decision };
    if (card.classList.contains('perm')) body.note = /** @type {HTMLInputElement} */ (card.querySelector('.card-note')).value;
    else if (decision === 'allow') {
      const answers = /** @type {Record<string, string>} */ ({});
      (card.questions || []).forEach((q, qi) => {
        const fs = /** @type {HTMLElement} */ (card.querySelector(`[data-q="${qi}"]`));
        const other = /** @type {HTMLInputElement} */ (fs.querySelector('.ask-other')).value.trim();
        let picked = [...fs.querySelectorAll('input:checked')].map((i) => /** @type {HTMLInputElement} */ (i).value);
        if (other) picked = q.multiSelect ? [...picked, other] : [other];
        answers[q.question] = picked.join(', ');
      });
      body.answers = answers;
      if (Object.values(answers).some((a) => !a)) return this.toast(this.messages.answerAll);
    }
    const buttons = card.querySelectorAll('button');
    for (const b of buttons) b.disabled = true;
    try { await this.postJson('/api/run/answer', body); } catch (err) {
      this.toast(/** @type {Error} */ (err).message);
      for (const b of buttons) b.disabled = false;
    }
  }

  // ---------- câblage ----------

  wire() {
    const ta = this.ref('reply-text');
    const form = this.ref('reply');
    // « /skill argument » lance un skill (nouvelle session) ; tout autre texte répond à la session en cours.
    form.addEventListener('submit', async (/** @type {SubmitEvent} */ e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) return;
      this.voice.stop(); // tu reprends la parole
      this.dictation.end({ cancel: true }); // envoi à la main : la dictée en cours n'ajoute plus rien
      const done = () => { ta.value = ''; this.slash.closed = false; this.renderSlash(); };
      if (isCommand(text)) {
        const [, name, arg = ''] = /** @type {RegExpMatchArray} */ (text.match(/^\/([\w-]+)\s*(.*)$/));
        if (!this.skillNamed(name)) return this.toast(this.messages.unknownSkill(name));
        if (await this.run(name, arg.trim())) done();
        return;
      }
      this.voice.state.sending = true; // la réponse sera dite sur cet appareil
      const spoken = this.dictation.state.sent;
      this.voice.state.loop = spoken; // message dicté : le micro se rouvrira après la réponse
      this.dictation.state.sent = false;
      try { await this.send(text, { spoken }); done(); this.emit('claude:show'); } catch (err) { this.voice.state.sending = false; this.toast(/** @type {Error} */ (err).message); }
    });
    ta.addEventListener('input', () => { this.slash.closed = false; this.renderSlash(); });
    ta.addEventListener('blur', () => setTimeout(() => { this.ref('slash-menu').hidden = true; }, 150));
    ta.addEventListener('focus', () => this.renderSlash());
    ta.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
      const slash = this.slash;
      const open = !this.ref('slash-menu').hidden && slash.items.length;
      if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        slash.sel = (slash.sel + (e.key === 'ArrowDown' ? 1 : -1) + slash.items.length) % slash.items.length;
        this.renderSlash();
      } else if (open && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey))) {
        e.preventDefault();
        this.pickSlash(slash.sel);
      } else if (open && e.key === 'Escape') {
        slash.closed = true;
        this.renderSlash();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || (!e.shiftKey && isCommand(ta.value)))) {
        // ⌘↵ envoie ; ↵ seul suffit pour une commande /skill d'une ligne.
        e.preventDefault();
        form.requestSubmit();
      }
    });
    // mousedown plutôt que click : garde le focus dans le champ.
    this.ref('slash-menu').addEventListener('mousedown', (/** @type {MouseEvent} */ e) => {
      const item = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('[data-i]'));
      if (item) { e.preventDefault(); this.pickSlash(Number(item.dataset.i)); }
    });
    const consoleEl = this.ref('console');
    consoleEl.addEventListener('click', (/** @type {MouseEvent} */ e) => {
      const btn = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('[data-answer]'));
      if (btn) this.answerCard(/** @type {HTMLElement} */ (btn.closest('.ev-card')), /** @type {string} */ (btn.dataset.answer));
    });
    consoleEl.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
      const t = /** @type {Element} */ (e.target);
      if (e.key !== 'Enter' || !t.matches('.ask-other, .card-note')) return;
      e.preventDefault();
      const card = /** @type {HTMLElement} */ (t.closest('.ev-card'));
      this.answerCard(card, card.classList.contains('perm') ? 'deny' : 'allow');
    });
    this.ref('mode-switch').addEventListener('click', async (/** @type {MouseEvent} */ e) => {
      const b = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('[data-mode]'));
      if (!b || b.dataset.mode === this.state.mode) return;
      try {
        await this.postJson('/api/run/mode', { mode: b.dataset.mode });
        if (this.state.status === 'running') this.toast(this.messages.modeChanged);
      } catch (err) { this.toast(/** @type {Error} */ (err).message); }
    });
    this.ref('mic').addEventListener('click', () => this.dictation.toggle());
    this.ref('stop').addEventListener('click', () => this.postJson('/api/run/stop').catch((err) => this.toast(err.message)));
    this.ref('reset').addEventListener('click', () => this.postJson('/api/run/reset').catch((err) => this.toast(err.message)));
    this.ref('toggle-max')?.addEventListener('click', () => this.emit('claude:toggle-max'));
    this.ref('close')?.addEventListener('click', () => this.emit('claude:close'));
  }

  /** L'app indique si Claude est agrandi (libellé du bouton ⤢ / ⤡). @param {boolean} max */
  setMaximized(max) {
    const b = this.ref('toggle-max');
    if (!b) return;
    b.textContent = max ? '⤡' : '⤢';
    b.title = max ? this.messages.unmaxTitle : this.messages.maxTitle;
  }
}

customElements.define('claude-panel', ClaudePanel);
