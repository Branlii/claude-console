#!/usr/bin/env python3
"""Synthèse vocale Piper pour l'interface (voix naturelles, hors ligne, sans clé).

Lancé une fois par server/tts.js (APP_TTS_PYTHON) et gardé ouvert : les voix restent chargées.
Entrée : une requête JSON par ligne {"id", "text", "voice", "rate"}.
Sortie : une réponse JSON par ligne {"id", "wav": base64} ou {"id", "error"} ; au démarrage {"voices": [...]}.
Voix : fichiers <nom>.onnx + <nom>.onnx.json de APP_TTS_VOICES (ex. fr_FR-siwis-medium).
"""
import base64
import io
import json
import os
import sys
import wave
from pathlib import Path

from piper import PiperVoice, SynthesisConfig

VOICES_DIR = Path(os.environ.get("APP_TTS_VOICES", "/opt/piper/voices"))
voices = {}
for onnx in sorted(VOICES_DIR.glob("*.onnx")):
    voices[onnx.stem] = PiperVoice.load(str(onnx))


def out(msg):
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


out({"voices": list(voices)})

for line in sys.stdin:
    try:
        req = json.loads(line)
    except ValueError:
        continue
    rid = req.get("id")
    try:
        voice = voices.get(req.get("voice")) or next(iter(voices.values()))
        rate = min(max(float(req.get("rate") or 1), 0.5), 2)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            voice.synthesize_wav(str(req.get("text", ""))[:600], w, syn_config=SynthesisConfig(length_scale=1 / rate))
        out({"id": rid, "wav": base64.b64encode(buf.getvalue()).decode()})
    except Exception as err:  # une phrase ratée ne doit pas tuer le worker
        out({"id": rid, "error": str(err)})
