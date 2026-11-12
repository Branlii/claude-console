// Voix : Claude lit ses réponses (Web Speech API, ou voix Piper du serveur).
// Lecture phrase par phrase pendant l'écriture, pas d'attente de la fin du message. Réglages mémorisés par appareil
// (`panel.prefs`) ; activée d'office dans l'app installée (PWA), sinon via 🔇 dans l'en-tête. Seul l'appareil qui a
// envoyé le dernier message parle : la console ouverte sur l'ordinateur reste muette quand tu parles au téléphone.
import { speechText } from './markdown.js';

const SERVER_VOICE = 'piper:';

/** @param {string} id */
const piperLabel = (id) => {
  const [, name = id, quality = ''] = id.match(/^[a-z]{2}_[A-Z]{2}-([^-]+)-?(.*)$/) || [];
  return `${name[0].toUpperCase()}${name.slice(1)}${quality === 'high' ? ' (HD)' : ''}`;
};

/** @param {import('./claude-panel.js').ClaudePanel} panel */
export function createVoice(panel) {
  const synth = window.speechSynthesis;
  const standalone = matchMedia('(display-mode: standalone)').matches || /** @type {any} */ (navigator).standalone === true;
  const prefs = panel.prefs;
  const m = () => panel.messages;
  const lang = () => panel.lang;
  const voiceOn = () => !!synth && (prefs.voice ?? standalone);
  const voice = {
    said: '', utterances: /** @type {Set<object>} */ (new Set()), unlocked: false, mine: false, sending: false, loop: false, awaitMic: false,
  };
  // Voix naturelles du serveur (Piper) : WAV par phrase, joués à la suite avec Web Audio.
  // Absentes (machine sans Piper) ou en panne : voix de l'appareil.
  const tts = {
    voices: /** @type {string[]} */ ([]), ctx: /** @type {AudioContext | null} */ (null), chain: Promise.resolve(), gen: 0,
    source: /** @type {AudioBufferSourceNode | null} */ (null), pending: 0, warned: false,
  };
  const ref = (/** @type {string} */ n) => /** @type {any} */ (panel.ref(n));
  const langPrefix = () => lang().split('-')[0];

  // Voix de l'appareil la plus naturelle : dans la langue, puis « Premium / Natural / Online… » d'abord.
  function bestVoice() {
    const all = synth.getVoices();
    if (prefs.voiceName && !prefs.voiceName.startsWith(SERVER_VOICE)) { const v = all.find((x) => x.name === prefs.voiceName); if (v) return v; }
    const full = new RegExp(`^${lang()}`, 'i');
    const short = new RegExp(`^${langPrefix()}`, 'i');
    const score = (/** @type {SpeechSynthesisVoice} */ v) => (full.test(v.lang) ? 4 : short.test(v.lang) ? 3 : 0)
      + (/premium|natural|neural|online/i.test(v.name) ? 2 : /enhanced|améliorée|google|siri/i.test(v.name) ? 1 : 0);
    return all.filter((v) => score(v) >= 3).sort((a, b) => score(b) - score(a))[0] || null;
  }

  // Voix du serveur retenue : choisie dans la liste, ou d'office (Automatique) quand le serveur en a.
  function serverVoice() {
    if (prefs.voiceName?.startsWith(SERVER_VOICE)) {
      const id = prefs.voiceName.slice(SERVER_VOICE.length);
      if (tts.voices.includes(id)) return id;
    }
    if (prefs.voiceName && !prefs.voiceName.startsWith(SERVER_VOICE)) return null;
    const preferred = panel.getAttribute('server-voice');
    return (preferred && tts.voices.find((v) => v.includes(preferred))) || tts.voices[0] || null;
  }

  const audioCtx = () => (tts.ctx ||= new (window.AudioContext || /** @type {any} */ (window).webkitAudioContext)());

  /** @param {string} text @param {() => void} done */
  function speakDevice(text, done) {
    const v = bestVoice();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = v?.lang || lang();
    if (v) u.voice = v;
    u.rate = prefs.voiceRate || 1.05;
    u.onend = u.onerror = done;
    voice.utterances.add(u); // garde une référence : sinon Chrome peut perdre `onend`
    synth.speak(u);
    return u;
  }

  // Phrase lue par le serveur : la synthèse part tout de suite (en parallèle des précédentes), la lecture attend son tour.
  /** @param {string} text @param {string} id */
  function speakServer(text, id) {
    const gen = tts.gen;
    const item = { text };
    voice.utterances.add(item);
    tts.pending++;
    const audio = fetch('/api/tts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: id, rate: prefs.voiceRate || 1.05 }),
    }).then((r) => { if (!r.ok) throw new Error(`voix du serveur : ${r.status}`); return r.arrayBuffer(); });
    audio.catch(() => {});
    const finish = () => { // après « silence » (stop), les phrases en file s'éteignent sans rien toucher
      if (gen !== tts.gen) return;
      tts.pending--;
      voice.utterances.delete(item);
      render();
      listenAgain();
    };
    tts.chain = tts.chain.then(async () => {
      if (gen !== tts.gen) return finish();
      try {
        const ctx = audioCtx();
        if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
        const buf = await ctx.decodeAudioData(await audio);
        if (gen !== tts.gen) return finish();
        await new Promise((resolve) => {
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(ctx.destination);
          src.onended = resolve;
          tts.source = src;
          src.start();
        });
        finish();
      } catch {
        if (gen !== tts.gen) return finish();
        if (!tts.warned) { tts.warned = true; panel.toast(m().serverVoiceDown); }
        await new Promise((resolve) => speakDevice(text, () => resolve(undefined)));
        finish();
      }
    });
  }

  /** @param {string} text */
  function speak(text) {
    if (!voiceOn() || !text) return;
    const server = serverVoice();
    // Une phrase par énoncé : Chrome coupe les énoncés longs (≈ 15 s), et le serveur synthétise plus vite par petits bouts.
    for (const line of text.split('\n')) {
      for (const part of line.split(/(?<=[.!?…])\s+/)) {
        if (!/[\p{L}\p{N}]/u.test(part)) continue;
        if (server) speakServer(part.trim(), server);
        else { const u = speakDevice(part.trim(), () => { voice.utterances.delete(u); render(); listenAgain(); }); }
      }
    }
    render();
  }

  function stop() {
    voice.awaitMic = false; // faire taire Claude arrête aussi la conversation à la voix
    voice.loop = false;
    tts.gen++;
    try { tts.source?.stop(); } catch {}
    tts.chain = Promise.resolve();
    tts.pending = 0;
    if (!synth) return;
    voice.utterances.clear();
    synth.cancel();
    render();
  }

  /** @param {string} md */
  const toSpeech = (md) => speechText(md, m().speech);

  // Pendant l'écriture : dit chaque phrase terminée dès qu'elle arrive (comme une conversation) ; dans un tableau
  // ou un bloc de code, attend la fin du paragraphe pour ne pas lire un morceau de Markdown.
  function speakLive() {
    if (!voiceOn() || !voice.mine) return;
    const text = panel.state.live || '';
    if (!text.startsWith(voice.said)) voice.said = '';
    const rest = text.slice(voice.said.length);
    let cut = -1;
    for (const x of rest.matchAll(/[.!?…](?=\s)|\n\n/g)) cut = /** @type {number} */ (x.index) + x[0].length;
    if (cut < 0) return;
    if (/^\s*\||```/m.test(rest.slice(0, cut))) { // tableau ou code : seulement à une fin de paragraphe
      cut = rest.lastIndexOf('\n\n');
      if (cut < 0) return;
      cut += 2;
    }
    const upto = voice.said.length + cut;
    if ((text.slice(0, upto).match(/^\s*```/gm) || []).length % 2) return;
    speak(toSpeech(rest.slice(0, cut)));
    voice.said = text.slice(0, upto);
  }

  // Message complet : dit le reste.
  /** @param {string} text */
  function speakFinal(text) {
    const rest = text.startsWith(voice.said) ? text.slice(voice.said.length) : text;
    voice.said = '';
    speak(toSpeech(rest));
  }

  /** @param {any} ev */
  function speakEvent(ev) {
    if (ev.kind === 'user') { voice.mine = voice.sending; voice.sending = false; voice.said = ''; return; }
    if (!voice.mine) return;
    if (ev.kind === 'text') speakFinal(ev.text);
    else if (ev.kind === 'ask') speak(ev.questions.map((/** @type {any} */ q) => m().sayQuestion(q)).join('\n'));
    else if (ev.kind === 'perm') speak(m().sayPerm(ev.tool));
    else if (ev.kind === 'result' && !ev.ok) { voice.loop = false; speak(m().sayFailed); }
    else if (ev.kind === 'result') { voice.awaitMic = voice.loop && prefs.handsFree !== false; listenAgain(); }
    else if (ev.kind === 'error') speak(m().sayError);
  }

  // iOS / Safari : la synthèse ne parle qu'après un premier énoncé lancé par un geste (toucher, touche).
  function unlock() {
    if (voice.unlocked || !voiceOn()) return;
    voice.unlocked = true;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.speak(u);
    // Web Audio aussi (voix du serveur) : son muet joué pendant le geste.
    try {
      const ctx = audioCtx();
      ctx.resume();
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start();
    } catch {}
  }

  function fillVoices() {
    const sel = ref('voice-name');
    const all = synth.getVoices();
    const own = all.filter((v) => new RegExp(`^${langPrefix()}`, 'i').test(v.lang));
    const esc = panel.esc;
    const opt = (/** @type {string} */ value, /** @type {string} */ label) => `<option value="${esc(value)}">${esc(label)}</option>`;
    sel.innerHTML = opt('', tts.voices.length ? m().voiceAutoServer : m().voiceAutoDevice)
      + (tts.voices.length ? `<optgroup label="${esc(m().voiceGroupServer)}">${tts.voices.map((id) => opt(SERVER_VOICE + id, piperLabel(id))).join('')}</optgroup>` : '')
      + `<optgroup label="${esc(m().voiceGroupDevice)}">${(own.length ? own : all).map((v) => opt(v.name, `${v.name} · ${v.lang}`)).join('')}</optgroup>`;
    const known = all.some((v) => v.name === prefs.voiceName) || tts.voices.some((id) => SERVER_VOICE + id === prefs.voiceName);
    sel.value = known ? prefs.voiceName : '';
  }

  function render() {
    const btn = ref('voice-btn');
    if (!synth) { ref('voice-menu').hidden = true; return; }
    const on = voiceOn();
    btn.textContent = on ? '🔊' : '🔇';
    btn.classList.toggle('on', on);
    btn.title = on ? m().voiceOnTitle : m().voiceOffTitle;
    ref('voice-on').checked = on;
    ref('voice-loop').checked = prefs.handsFree !== false;
    ref('voice-rate').value = prefs.voiceRate || 1.05;
    ref('voice-rate-out').textContent = `×${Number(ref('voice-rate').value).toFixed(2)}`;
    ref('voice-stop').hidden = !voice.utterances.size;
  }

  // Énoncé perdu (iOS en arrière-plan, onend jamais reçu) : ⏹ ne reste pas affiché pour rien.
  function checkSpeech() {
    if (synth.paused) synth.resume();
    if (voice.utterances.size && !tts.pending && !synth.speaking && !synth.pending) { voice.utterances.clear(); render(); listenAgain(); }
  }

  // Conversation à la voix (comme l'app Claude) : tu as parlé → Claude répond à voix haute → le micro se rouvre.
  // Silence, Échap, clavier ou carte à valider : la boucle s'arrête.
  function listenAgain() {
    const d = panel.dictation;
    if (!voice.awaitMic || voice.utterances.size || d.state.on || document.hidden) return;
    if (panel.state.status === 'running' || panel.state.waiting || !d.supported) return;
    voice.awaitMic = false;
    setTimeout(() => { if (!d.state.on && panel.state.status !== 'running') d.start({ auto: true }); }, 300);
  }

  // Écran allumé pendant une conversation à la voix (dictée, réponse attendue, Claude qui parle) et 1 min après :
  // sinon le téléphone se met en veille pendant que tu écoutes. Le navigateur relâche le verrou quand la page
  // passe en arrière-plan : repris au retour. Sans Wake Lock (iOS < 16.4, PWA iOS < 18.4) : rien.
  const wake = { lock: /** @type {WakeLockSentinel | null} */ (null), asking: false, until: 0 };
  function syncWakeLock() {
    if (!navigator.wakeLock) return;
    const talking = panel.dictation.state.on || voice.loop || voice.awaitMic || voice.utterances.size || tts.pending
      || (voice.mine && panel.state.status === 'running');
    if (talking) wake.until = Date.now() + 60000;
    const want = Date.now() < wake.until && !document.hidden;
    if (want && !wake.lock && !wake.asking) {
      wake.asking = true;
      navigator.wakeLock.request('screen').then((l) => {
        wake.lock = l;
        l.addEventListener('release', () => { if (wake.lock === l) wake.lock = null; });
      }, () => {}).finally(() => { wake.asking = false; });
    } else if (!want && wake.lock) { wake.lock.release().catch(() => {}); wake.lock = null; }
  }

  function setup() {
    render();
    setInterval(syncWakeLock, 1000);
    document.addEventListener('visibilitychange', syncWakeLock);
    if (!synth) return;
    setInterval(checkSpeech, 2000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkSpeech(); });
    fillVoices();
    synth.addEventListener?.('voiceschanged', fillVoices);
    panel.api('/api/tts/voices').then((r) => { tts.voices = r.voices || []; fillVoices(); }).catch(() => {});
    synth.cancel(); // file d'attente bloquée laissée par une page précédente (Chrome)
    ref('voice-on').addEventListener('change', (/** @type {any} */ e) => {
      panel.setPrefs({ voice: e.target.checked });
      if (e.target.checked) { unlock(); speak(m().voiceEnabled); } else stop();
      render();
    });
    ref('voice-loop').addEventListener('change', (/** @type {any} */ e) => { panel.setPrefs({ handsFree: e.target.checked }); if (!e.target.checked) voice.awaitMic = false; });
    ref('voice-name').addEventListener('change', (/** @type {any} */ e) => { panel.setPrefs({ voiceName: e.target.value }); });
    ref('voice-rate').addEventListener('input', (/** @type {any} */ e) => { panel.setPrefs({ voiceRate: Number(e.target.value) }); render(); });
    ref('voice-test').addEventListener('click', () => {
      stop();
      if (!voiceOn()) return panel.toast(m().voiceEnableFirst);
      speak(m().voiceTest);
    });
    ref('voice-stop').addEventListener('click', stop);
    document.addEventListener('pointerdown', unlock, { capture: true });
    document.addEventListener('keydown', (e) => {
      unlock();
      if (e.key === 'Escape' && voice.utterances.size) stop();
      if (e.key === 'Escape') panel.dictation.end({ cancel: true });
    }, { capture: true });
    // Clic hors du panneau de réglages : le referme.
    document.addEventListener('click', (e) => { if (!/** @type {Element} */ (e.target).closest?.('[data-ref="voice-menu"]')) ref('voice-menu').open = false; });
  }

  return { state: voice, speak, stop, speakLive, speakEvent, listenAgain, setup, render };
}
