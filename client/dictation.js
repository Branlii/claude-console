// Dictée : 🎙 dicte et envoie (reconnaissance vocale du navigateur).
// Chrome envoie l'audio à Google pour la transcription ; Safari le traite sur l'appareil ou chez Apple.
// Sans prise en charge (Firefox, certaines PWA iOS), le bouton reste caché : le micro du clavier fait l'affaire.
// Fin de la phrase (pause) ou 2ᵉ appui sur 🎙 : le texte part tout seul. Échap annule sans envoyer.
// Une seule instance pour toute la visite : le navigateur redemande moins souvent l'accès au micro.

/** @param {import('./claude-panel.js').ClaudePanel} panel */
export function createDictation(panel) {
  const w = /** @type {any} */ (window);
  const Recognition = w.SpeechRecognition || w.webkitSpeechRecognition;
  /** @type {any} */
  let recognizer = null;
  const dictation = {
    on: false, auto: false, sent: false, original: '', base: '', heard: '', cancelled: false, restore: false,
    started: false, retryLocal: false, timers: /** @type {ReturnType<typeof setTimeout>[]} */ ([]),
  };
  const m = () => panel.messages;
  const ref = (/** @type {string} */ n) => /** @type {any} */ (panel.ref(n));

  // Transcription sur l'appareil (Chrome 139+) : secours quand le service en ligne échoue (`network`).
  // 'available' : prête ; 'downloadable' / 'downloading' : modèle à télécharger ; sinon indisponible.
  const localOpts = () => ({ langs: [panel.lang], processLocally: true });
  let localSpeech = 'unavailable';
  if (Recognition?.available) Recognition.available(localOpts()).then((/** @type {string} */ s) => { localSpeech = s; }, () => {});

  function render() {
    const b = ref('mic');
    b.hidden = !Recognition;
    b.classList.toggle('rec', dictation.on);
    b.innerHTML = dictation.on ? `<span class="rec-dot"></span> ${panel.esc(m().micListening)}` : `🎙 <span>${panel.esc(m().micIdle)}</span>`;
    b.title = dictation.on ? m().micStopTitle : m().micStartTitle;
    b.setAttribute('aria-pressed', String(dictation.on));
  }

  function getRecognizer() {
    if (recognizer) return recognizer;
    recognizer = new Recognition();
    recognizer.lang = panel.lang;
    recognizer.interimResults = true;
    recognizer.onstart = () => { dictation.started = true; };
    recognizer.onresult = (/** @type {any} */ e) => {
      dictation.heard = [...e.results].map((r) => r[0].transcript).join('').trim();
      const ta = ref('reply-text');
      ta.value = dictation.base + dictation.heard;
      ta.dispatchEvent(new Event('input'));
    };
    recognizer.onerror = (/** @type {any} */ e) => {
      if (e.error === 'network' && !recognizer.processLocally && localSpeech !== 'unavailable') return fallBackToLocal();
      const msg = m().dictationErrors[e.error];
      if (msg) panel.toast(msg);
      if (e.error !== 'no-speech') dictation.cancelled = true;
    };
    recognizer.onend = () => {
      dictation.timers.forEach(clearTimeout);
      if (dictation.retryLocal) { dictation.retryLocal = false; return start({ auto: dictation.auto, keep: true }); }
      const send = dictation.on && !dictation.cancelled && dictation.heard;
      if (dictation.restore) { ref('reply-text').value = dictation.original; ref('reply-text').dispatchEvent(new Event('input')); }
      if (!send) panel.voice.state.loop = false; // silence ou annulation : fin de la conversation à la voix
      dictation.on = false;
      render();
      if (send) { dictation.sent = true; ref('reply').requestSubmit(); }
    };
    return recognizer;
  }

  // Service en ligne injoignable : la suite de la visite transcrit sur l'appareil.
  // Modèle prêt : la dictée repart aussitôt (dans onend) ; sinon il se télécharge et le prochain 🎙 l'utilise.
  function fallBackToLocal() {
    recognizer.processLocally = true;
    if (localSpeech === 'available') { dictation.retryLocal = true; return; }
    dictation.cancelled = true;
    panel.toast(m().dictationDownloading);
    Recognition.install(localOpts()).then((/** @type {boolean} */ ok) => {
      localSpeech = ok ? 'available' : 'unavailable';
      panel.toast(ok ? m().dictationReady : m().dictationErrors.network);
      if (!ok) recognizer.processLocally = false;
    }, () => { localSpeech = 'unavailable'; recognizer.processLocally = false; panel.toast(m().dictationErrors.network); });
  }

  // keep : relance après un échec du service en ligne, le champ d'avant et ce qui précède la dictée sont gardés.
  function start({ auto = false, keep = false } = {}) {
    panel.voice.stop(); // sinon le micro entend Claude
    panel.voice.state.awaitMic = false;
    const ta = ref('reply-text');
    if (!keep) Object.assign(dictation, { original: ta.value, base: ta.value.trim() ? `${ta.value.trimEnd()} ` : '' });
    Object.assign(dictation, { on: true, auto, heard: '', cancelled: false, restore: false, started: false });
    try { getRecognizer().start(); } catch (err) { dictation.on = false; render(); return panel.toast(/** @type {Error} */ (err).message); }
    dictation.timers = [
      // Jamais démarré (PWA iOS : l'API existe mais ne fait rien) : on le dit au lieu d'attendre en silence.
      setTimeout(() => {
        if (dictation.on && !dictation.started) { panel.toast(m().micNeverStarted); end({ cancel: true }); }
      }, 15000),
      setTimeout(() => end(), 90000), // filet : une dictée ne reste pas ouverte indéfiniment
    ];
    render();
  }

  // Termine (stop : le dernier résultat arrive puis envoi) ou annule (abort : rien n'est envoyé).
  function end({ cancel = false } = {}) {
    if (!dictation.on) return;
    dictation.cancelled ||= cancel;
    dictation.restore ||= cancel;
    if (cancel) recognizer.abort(); else recognizer.stop();
  }

  const toggle = () => (dictation.on ? end() : start());

  return { state: dictation, supported: !!Recognition, start, end, toggle, render };
}
