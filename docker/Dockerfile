# Image de base d'une app claude-console : Node, git, CLI Claude Code, entrypoint qui clone le repo de l'app dans
# le volume /data et la lance depuis ce clone (voir entrypoint.sh). Le code de l'app n'est pas copié dedans.
#   --target base  : sans voix du serveur (la voix de l'appareil reste disponible)
#   --target voice : + Piper et ses voix (PIPER_VOICES), ≈ 130 Mo de plus
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client ca-certificates curl tini \
 && rm -rf /var/lib/apt/lists/*

ARG CLAUDE_CODE_VERSION=latest
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force

COPY entrypoint.sh /usr/local/bin/claude-app-entrypoint
RUN chmod 755 /usr/local/bin/claude-app-entrypoint \
 && mkdir -p /data /home/node/.claude \
 && chown -R node:node /data /home/node/.claude

ENV HOME=/home/node \
    DISABLE_AUTOUPDATER=1 \
    APP_HOST=0.0.0.0 \
    APP_PORT=4173 \
    APP_GIT_SYNC=1 \
    APP_REPO_DIR=/data/app

USER node
WORKDIR /data
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s \
  CMD curl -fsS "http://127.0.0.1:${APP_PORT}/healthz" || exit 1
ENTRYPOINT ["tini", "--", "claude-app-entrypoint"]

# Voix naturelles hors ligne (Piper, tools/tts.py du package). Venv construit à part puis copié : ni pip ni cache
# dans l'image finale. Une voix tronquée fait échouer le build au lieu de casser la voix en production.
FROM node:${NODE_VERSION}-bookworm-slim AS piper
ARG PIPER_VOICES="fr/fr_FR/siwis/medium fr/fr_FR/tom/medium"
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/piper \
 && /opt/piper/bin/pip install --no-cache-dir piper-tts \
 && mkdir -p /opt/piper/voices \
 && for v in $PIPER_VOICES; do \
      quality="${v##*/}"; rest="${v%/*}"; speaker="${rest##*/}"; rest="${rest%/*}"; locale="${rest##*/}"; \
      n="${locale}-${speaker}-${quality}"; \
      url="https://huggingface.co/rhasspy/piper-voices/resolve/main/$v/$n"; \
      curl -fsSL --retry 5 --retry-all-errors -o "/opt/piper/voices/$n.onnx" "$url.onnx" \
      && curl -fsSL --retry 5 --retry-all-errors -o "/opt/piper/voices/$n.onnx.json" "$url.onnx.json" || exit 1; \
    done \
 && /opt/piper/bin/python -c "import pathlib; from piper import PiperVoice; [PiperVoice.load(str(p)) for p in pathlib.Path('/opt/piper/voices').glob('*.onnx')]"

FROM base AS voice
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=piper /opt/piper /opt/piper
ENV APP_TTS_PYTHON=/opt/piper/bin/python \
    APP_TTS_VOICES=/opt/piper/voices
USER node
