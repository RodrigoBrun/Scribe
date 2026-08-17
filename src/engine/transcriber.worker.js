import { pipeline } from '@huggingface/transformers';

let transcriber = null;
let loadedConfigKey = '';
let cancelled = false;

const isMobileDevice = Boolean(
  navigator.userAgentData?.mobile
  || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || ''),
);

self.onmessage = async (event) => {
  const { type, payload } = event.data || {};
  if (type === 'cancel') {
    cancelled = true;
    return;
  }
  if (type !== 'transcribe') return;

  cancelled = false;
  const { audio, model, backend } = payload;

  try {
    const pipe = await getPipeline(model, backend);
    if (cancelled) return;

    const sampleRate = 16000;
    const chunkSeconds = 28;
    const chunkSamples = chunkSeconds * sampleRate;
    const totalChunks = Math.max(1, Math.ceil(audio.length / chunkSamples));
    const allSegments = [];
    const allText = [];

    for (let i = 0; i < totalChunks; i++) {
      if (cancelled) return;
      const startSample = i * chunkSamples;
      const endSample = Math.min(audio.length, startSample + chunkSamples);
      const chunk = audio.slice(startSample, endSample);
      const offsetSeconds = startSample / sampleRate;

      self.postMessage({ type: 'chunk-start', payload: { index: i, total: totalChunks, offsetSeconds } });

      const result = await pipe(chunk, {
        return_timestamps: true,
        task: 'transcribe',
      });

      const text = (result?.text || '').trim();
      if (text) allText.push(text);

      const segments = normalizeSegments(result?.chunks, text, offsetSeconds, endSample / sampleRate);
      allSegments.push(...segments);

      self.postMessage({
        type: 'chunk-result',
        payload: {
          index: i,
          total: totalChunks,
          progress: (i + 1) / totalChunks,
          text,
          segments,
        },
      });
    }

    self.postMessage({ type: 'done', payload: { text: allText.join(' ').replace(/\s+/g, ' ').trim(), segments: allSegments } });
  } catch (error) {
    self.postMessage({ type: 'error', payload: serializeError(error) });
  }
};

async function getPipeline(model, backend) {
  const requestedBackend = backend || 'auto';
  const configKey = `${model}:${requestedBackend}`;
  if (transcriber && loadedConfigKey === configKey) return transcriber;

  if (transcriber?.dispose) await transcriber.dispose().catch(() => {});
  transcriber = null;

  const progress_callback = (progress) => {
    const value = Number(progress?.progress);
    self.postMessage({
      type: 'model-progress',
      payload: {
        status: progress?.status || 'loading',
        file: progress?.file || '',
        progress: Number.isFinite(value) ? value / 100 : null,
      },
    });
  };

  const load = async (device) => pipeline('automatic-speech-recognition', model, {
    ...(device ? { device } : {}),
    dtype: 'q8',
    progress_callback,
  });

  if (requestedBackend === 'webgpu') {
    transcriber = await load('webgpu');
  } else if (requestedBackend === 'wasm') {
    transcriber = await load();
  } else {
    // En móviles priorizamos estabilidad: WebGPU todavía puede anunciarse como
    // disponible y fallar o quedar bloqueado durante la carga del modelo.
    if (!isMobileDevice && 'gpu' in navigator) {
      try {
        transcriber = await load('webgpu');
        self.postMessage({ type: 'backend', payload: { backend: 'webgpu' } });
      } catch (error) {
        console.warn('[Scribe worker] WebGPU no disponible; usando WASM.', error);
        transcriber = await load();
        self.postMessage({ type: 'backend', payload: { backend: 'wasm' } });
      }
    } else {
      transcriber = await load();
      self.postMessage({ type: 'backend', payload: { backend: 'wasm' } });
    }
  }

  loadedConfigKey = configKey;
  return transcriber;
}

function normalizeSegments(chunks, fallbackText, offset, chunkEnd) {
  if (Array.isArray(chunks) && chunks.length) {
    return chunks.map((chunk) => {
      const ts = Array.isArray(chunk.timestamp) ? chunk.timestamp : [0, null];
      const start = offset + Math.max(0, Number(ts[0]) || 0);
      const endLocal = Number(ts[1]);
      const end = offset + (Number.isFinite(endLocal) ? endLocal : Math.max(0, chunkEnd - offset));
      return { start, end, text: String(chunk.text || '').trim() };
    }).filter((segment) => segment.text);
  }
  return fallbackText ? [{ start: offset, end: chunkEnd, text: fallbackText }] : [];
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    stack: error?.stack || '',
  };
}
