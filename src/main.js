import './styles.css';
import { renderApp } from './ui/template.js';
import { decodeFileTo16kMono, getMediaDuration } from './engine/audio.js';

const root = document.querySelector('#app');
renderApp(root);

const $ = (selector) => document.querySelector(selector);
const els = {
  ready: $('#readyView'), processing: $('#processingView'), result: $('#resultView'),
  dropzone: $('#dropzone'), fileInput: $('#fileInput'), filePreview: $('#filePreview'), fileName: $('#fileName'), fileMeta: $('#fileMeta'),
  recordButton: $('#recordButton'), recordingStopButton: $('#recordingStopButton'),
  retryButton: $('#retryButton'), recoveryNotice: $('#recoveryNotice'), recoveryNoticeText: $('#recoveryNoticeText'), recoveryDismissButton: $('#recoveryDismissButton'),
  processingTitle: $('#processingTitle'), statusBadge: $('#statusBadge'), progressLabel: $('#progressLabel'), progressPercent: $('#progressPercent'), progressFill: $('#progressFill'),
  liveTranscript: $('#liveTranscript'), cancelButton: $('#cancelButton'),
  resultMeta: $('#resultMeta'), resultTranscript: $('#resultTranscript'), searchInput: $('#searchInput'), searchCount: $('#searchCount'),
  copyButton: $('#copyButton'), downloadButton: $('#downloadButton'), newFileButton: $('#newFileButton'),
  settingsModal: $('#settingsModal'), settingsClose: $('#settingsClose'), languageSelect: $('#languageSelect'), modelSelect: $('#modelSelect'), backendSelect: $('#backendSelect'), clearCacheButton: $('#clearCacheButton'), storageText: $('#storageText'),
  toast: $('#toast'),
};

const state = {
  file: null,
  duration: null,
  startedAt: null,
  worker: null,
  recording: null,
  sourceKind: null,
  cancelled: false,
  operationStage: null,
  progress: 0,
  diagnostics: null,
  text: '',
  segments: [],
  language: localStorage.getItem('scribe.language') || 'spanish',
  model: localStorage.getItem('scribe.model') || 'onnx-community/whisper-tiny',
  backend: localStorage.getItem('scribe.backend') || 'auto',
};
const LIVE_CHUNK_SECONDS = 4;
const MIN_LIVE_CHUNK_SECONDS = .45;
const RECORDING_TARGET_RATE = 16000;
const RECOVERY_KEY = 'scribe.recovery.v1';
els.languageSelect.value = state.language;
els.modelSelect.value = state.model;
els.backendSelect.value = state.backend;

bindEvents();
restoreRecoverySnapshot();
refreshStorageEstimate();
registerServiceWorker();

function bindEvents() {
  els.dropzone.addEventListener('click', () => els.fileInput.click());
  els.dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') els.fileInput.click(); });
  els.fileInput.addEventListener('change', () => els.fileInput.files?.[0] && startFile(els.fileInput.files[0]));
  els.recordButton.addEventListener('click', startRecording);
  els.recordingStopButton.addEventListener('click', stopRecording);
  els.retryButton.addEventListener('click', resetApp);
  els.recoveryDismissButton.addEventListener('click', () => {
    clearRecoverySnapshot();
    els.recoveryNotice.hidden = true;
  });

  ['dragenter', 'dragover'].forEach((name) => els.dropzone.addEventListener(name, (e) => {
    e.preventDefault(); els.dropzone.classList.add('is-dragging');
  }));
  ['dragleave', 'drop'].forEach((name) => els.dropzone.addEventListener(name, (e) => {
    e.preventDefault(); els.dropzone.classList.remove('is-dragging');
  }));
  els.dropzone.addEventListener('drop', (e) => e.dataTransfer?.files?.[0] && startFile(e.dataTransfer.files[0]));

  els.cancelButton.addEventListener('click', cancelCurrent);
  els.newFileButton.addEventListener('click', resetApp);
  els.copyButton.addEventListener('click', copyTranscript);
  els.downloadButton.addEventListener('click', downloadText);
  els.searchInput.addEventListener('input', renderResults);

  document.querySelectorAll('[data-nav="settings"]').forEach((button) => button.addEventListener('click', openSettings));
  document.querySelectorAll('[data-nav="info"]').forEach((button) => button.addEventListener('click', () => toast('Tu archivo se procesa en el navegador. Scribe no lo sube a un servidor.')));
  document.querySelectorAll('[data-nav="home"]').forEach((button) => button.addEventListener('click', () => {
    if (state.recording) return toast('Detené la grabación para ver el resultado.');
    showView(state.segments.length ? 'result' : 'ready');
  }));
  els.settingsClose.addEventListener('click', closeSettings);
  els.settingsModal.addEventListener('click', (e) => { if (e.target === els.settingsModal) closeSettings(); });
  els.languageSelect.addEventListener('change', () => { state.language = els.languageSelect.value; localStorage.setItem('scribe.language', state.language); });
  els.modelSelect.addEventListener('change', () => { state.model = els.modelSelect.value; localStorage.setItem('scribe.model', state.model); restartWorker(); });
  els.backendSelect.addEventListener('change', () => { state.backend = els.backendSelect.value; localStorage.setItem('scribe.backend', state.backend); restartWorker(); });
  els.clearCacheButton.addEventListener('click', clearAICache);
}

async function startFile(file) {
  if (!isSupportedFile(file)) return toast('Elegí un archivo de audio o video.');
  resetTranscriptOnly();
  state.file = file;
  state.sourceKind = 'file';
  state.cancelled = false;
  state.startedAt = performance.now();
  state.operationStage = 'metadata';
  beginRecoverySnapshot('file', file.name);
  state.duration = await getMediaDuration(file);
  saveRecoverySnapshot('processing');

  els.fileName.textContent = file.name;
  els.fileMeta.textContent = `${formatBytes(file.size)}${state.duration ? ` · ${formatTime(state.duration)}` : ''}\n${friendlyType(file)}`;
  setupPreview(file);
  showView('processing');
  setStage('prepare');
  setProgress(.02, 'Preparando archivo…', { reset: true });
  state.operationStage = 'decode';
  saveRecoverySnapshot('processing');

  try {
    const audio = await decodeFileTo16kMono(file, ({ progress, label }) => {
      if (!state.cancelled) setProgress(progress * .18, label);
    });
    if (state.cancelled) return;

    setStage('model');
    state.operationStage = 'model';
    saveRecoverySnapshot('processing');
    els.processingTitle.textContent = 'Preparando motor de voz';
    setProgress(.24, 'Descargando y preparando el motor local…', { indeterminate: true });
    await transcribe(audio);
  } catch (error) {
    console.error(error);
    if (!state.cancelled) fail(error);
  }
}

function transcribe(audio) {
  return new Promise((resolve, reject) => {
    const worker = ensureWorker();

    worker.onmessage = (event) => {
      const { type, payload } = event.data || {};
      if (type === 'model-progress') {
        setProgress(.24, 'Descargando y preparando el motor local…', { indeterminate: true });
      }
      if (type === 'diagnostic') {
        state.diagnostics = payload;
        saveRecoverySnapshot('processing');
      }
      if (type === 'backend') {
        els.statusBadge.textContent = payload.backend === 'webgpu' ? 'WEBGPU · LOCAL' : 'WASM · LOCAL';
      }
      if (type === 'chunk-start') {
        state.operationStage = 'transcribe';
        setStage('transcribe');
        els.processingTitle.textContent = 'Transcribiendo';
        const fraction = payload.index / payload.total;
        const seconds = state.duration ? state.duration * fraction : null;
        const label = seconds != null ? `${formatTime(seconds)} de ${formatTime(state.duration)} analizados` : `Bloque ${payload.index + 1} de ${payload.total}`;
        setProgress(.38 + fraction * .60, label);
      }
      if (type === 'chunk-result') {
        state.text = [state.text, payload.text].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        state.segments.push(...payload.segments);
        appendLiveSegments(payload.segments);
        saveRecoverySnapshot('processing');
        const fraction = payload.progress;
        setProgress(.38 + fraction * .60, state.duration ? `${formatTime(state.duration * fraction)} de ${formatTime(state.duration)} analizados` : `${Math.round(fraction * 100)}% del audio`);
      }
      if (type === 'done') {
        state.text = payload.text || state.text;
        state.segments = payload.segments?.length ? payload.segments : state.segments;
        setProgress(1, 'Listo');
        finish();
        resolve();
      }
      if (type === 'error') {
        const error = new Error(payload.message || 'Error al transcribir');
        reject(error);
      }
    };

    worker.onerror = (event) => reject(event.error || new Error(event.message || 'Error en el worker'));
    worker.postMessage({ type: 'transcribe', payload: { audio, model: state.model, backend: state.backend, language: state.language } }, [audio.buffer]);
  });
}

async function startRecording() {
  if (state.recording) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('Este navegador no permite usar el micrófono desde Scribe.', 5200);
    return;
  }

  els.recordButton.disabled = true;
  resetTranscriptOnly();
  state.cancelled = false;
  state.startedAt = performance.now();
  state.duration = 0;
  state.file = { name: 'Grabación en vivo', size: 0, type: 'audio/wav' };
  state.sourceKind = 'recording';
  state.operationStage = 'permission';
  beginRecoverySnapshot('recording', state.file.name);

  els.fileName.textContent = 'Grabación en vivo';
  els.fileMeta.textContent = 'Micrófono · procesamiento local';
  els.processingTitle.textContent = 'Activando micrófono';
  els.processing.classList.add('is-recording');
  els.recordingStopButton.hidden = false;
  els.cancelButton.textContent = 'Detener grabación';
  els.statusBadge.textContent = 'MICRÓFONO';
  showView('processing');
  setStage('model');
  setProgress(.2, 'Permití el acceso al micrófono para comenzar.');
  els.progressPercent.textContent = 'EN VIVO';

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('AudioContext no está disponible');

    const context = new AudioContextClass();
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const silentGain = context.createGain();
    silentGain.gain.value = 0;

    const session = {
      stream,
      context,
      source,
      processor: null,
      silentGain,
      buffers: [],
      availableSamples: 0,
      totalInputSamples: 0,
      transcriptionOffset: 0,
      nextChunkId: 1,
      pendingChunks: 0,
      queue: Promise.resolve(),
      engineReady: false,
      stopping: false,
      timer: null,
    };
    state.recording = session;
    ensureWorker();
    state.operationStage = 'model';
    saveRecoverySnapshot('processing');

    const receiveSamples = (samples) => handleRecordingSamples(session, samples);
    if (context.audioWorklet && window.AudioWorkletNode) {
      await context.audioWorklet.addModule(new URL('./engine/recorder.worklet.js?no-inline', import.meta.url));
      const processor = new AudioWorkletNode(context, 'scribe-recorder');
      processor.port.onmessage = (event) => receiveSamples(event.data);
      session.processor = processor;
    } else {
      const processor = context.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => receiveSamples(event.inputBuffer.getChannelData(0));
      session.processor = processor;
    }

    source.connect(session.processor);
    session.processor.connect(silentGain);
    silentGain.connect(context.destination);

    els.processingTitle.textContent = 'Grabando y transcribiendo';
    setProgress(.2, 'Grabando · preparando el modelo local…');
    els.progressPercent.textContent = 'EN VIVO';
    session.timer = setInterval(() => updateRecordingStatus(session), 500);
  } catch (error) {
    const session = state.recording;
    if (session) {
      clearInterval(session.timer);
      session.processor?.disconnect();
      session.source?.disconnect();
      session.silentGain?.disconnect();
      session.stream?.getTracks().forEach((track) => track.stop());
      await session.context?.close().catch(() => {});
    }
    state.recording = null;
    endRecordingUi();
    fail(error);
  } finally {
    if (!state.recording) els.recordButton.disabled = false;
  }
}

function handleRecordingSamples(session, samples) {
  if (session.stopping || state.recording !== session || !samples?.length) return;
  const copy = new Float32Array(samples);
  session.buffers.push(copy);
  session.availableSamples += copy.length;
  session.totalInputSamples += copy.length;
  state.duration = session.totalInputSamples / session.context.sampleRate;

  const chunkSize = Math.round(session.context.sampleRate * LIVE_CHUNK_SECONDS);
  while (session.availableSamples >= chunkSize) {
    queueRecordingChunk(session, takeRecordingSamples(session, chunkSize));
  }
}

function takeRecordingSamples(session, count) {
  const wanted = Math.min(count, session.availableSamples);
  const output = new Float32Array(wanted);
  let written = 0;

  while (written < wanted && session.buffers.length) {
    const current = session.buffers[0];
    const take = Math.min(current.length, wanted - written);
    output.set(current.subarray(0, take), written);
    written += take;
    if (take === current.length) session.buffers.shift();
    else session.buffers[0] = current.subarray(take);
  }

  session.availableSamples -= wanted;
  return output;
}

function queueRecordingChunk(session, inputSamples) {
  const audio = resampleRecording(inputSamples, session.context.sampleRate, RECORDING_TARGET_RATE);
  if (audio.length < RECORDING_TARGET_RATE * MIN_LIVE_CHUNK_SECONDS) return;

  const offsetSeconds = session.transcriptionOffset;
  session.transcriptionOffset += audio.length / RECORDING_TARGET_RATE;
  const id = session.nextChunkId++;
  session.pendingChunks++;
  session.queue = session.queue
    .then(() => transcribeRecordingChunk(session, audio, offsetSeconds, id))
    .finally(() => { session.pendingChunks = Math.max(0, session.pendingChunks - 1); });
  session.queue.catch(() => {
    if (state.recording === session && !session.stopping) stopRecording();
  });
}

function transcribeRecordingChunk(session, audio, offsetSeconds, id) {
  return new Promise((resolve, reject) => {
    const worker = state.worker;
    worker.onmessage = (event) => {
      const { type, payload } = event.data || {};
      if (type === 'model-progress') {
        setProgress(.2, 'Grabando · descargando el modelo local…');
        els.progressPercent.textContent = 'EN VIVO';
      }
      if (type === 'diagnostic') {
        state.diagnostics = payload;
        saveRecoverySnapshot('processing');
      }
      if (type === 'backend') {
        session.engineReady = true;
        els.statusBadge.textContent = payload.backend === 'webgpu' ? 'WEBGPU · EN VIVO' : 'WASM · EN VIVO';
      }
      if (type === 'live-result' && payload.id === id) {
        session.engineReady = true;
        state.operationStage = 'transcribe';
        state.text = [state.text, payload.text].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        state.segments.push(...(payload.segments || []));
        appendLiveSegments(payload.segments || []);
        saveRecoverySnapshot('processing');
        resolve();
      }
      if (type === 'error') reject(new Error(payload.message || 'Error al transcribir la grabación'));
    };
    worker.onerror = (event) => reject(event.error || new Error(event.message || 'Error en el worker'));
    worker.postMessage({
      type: 'transcribe-live',
      payload: { audio, model: state.model, backend: state.backend, language: state.language, offsetSeconds, id },
    }, [audio.buffer]);
  });
}

function updateRecordingStatus(session) {
  if (state.recording !== session || session.stopping) return;
  const elapsed = session.totalInputSamples / session.context.sampleRate;
  const pending = session.pendingChunks > 1 ? ` · ${session.pendingChunks} bloques pendientes` : '';
  const activity = session.engineReady ? 'transcribiendo en vivo' : 'preparando el modelo';
  els.progressLabel.textContent = `Grabando ${formatTime(elapsed)} · ${activity}${pending}`;
  els.progressPercent.textContent = 'EN VIVO';
}

async function stopRecording() {
  const session = state.recording;
  if (!session || session.stopping) return;
  session.stopping = true;
  clearInterval(session.timer);
  els.processingTitle.textContent = 'Terminando la transcripción';
  els.statusBadge.textContent = 'FINALIZANDO';
  els.progressLabel.textContent = 'Procesando los últimos segundos…';
  els.recordingStopButton.disabled = true;

  session.processor?.disconnect();
  session.source?.disconnect();
  session.silentGain?.disconnect();
  session.stream.getTracks().forEach((track) => track.stop());

  if (session.availableSamples) {
    queueRecordingChunk(session, takeRecordingSamples(session, session.availableSamples));
  }

  await session.context.close().catch(() => {});

  try {
    await session.queue;
    if (state.recording !== session) return;
    state.duration = session.totalInputSamples / session.context.sampleRate;
    state.recording = null;
    endRecordingUi();
    finish();
  } catch (error) {
    if (state.recording === session) state.recording = null;
    endRecordingUi();
    fail(error);
  }
}

function endRecordingUi() {
  els.processing.classList.remove('is-recording');
  els.recordingStopButton.hidden = true;
  els.recordingStopButton.disabled = false;
  els.cancelButton.textContent = 'Cancelar';
  els.recordButton.disabled = false;
}

function resampleRecording(input, fromRate, toRate) {
  if (fromRate === toRate) return new Float32Array(input);
  const ratio = fromRate / toRate;
  const output = new Float32Array(Math.max(1, Math.round(input.length / ratio)));

  for (let i = 0; i < output.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    output[i] = sum / (end - start);
  }
  return output;
}

function finish() {
  setStage('done');
  els.retryButton.hidden = true;
  const elapsed = (performance.now() - state.startedAt) / 1000;
  els.resultMeta.textContent = `${state.file?.name || 'Archivo'} · ${formatTime(state.duration || 0)} · procesado en ${formatElapsed(elapsed)}`;
  els.searchInput.value = '';
  renderResults();
  saveRecoverySnapshot('complete');
  setTimeout(() => showView('result'), 260);
}

function fail(error) {
  console.error('[Scribe]', error);
  els.processingTitle.textContent = 'No pudimos procesar este archivo';
  els.statusBadge.textContent = 'ERROR';
  setProgress(0, humanizeError(error), { reset: true });
  els.retryButton.hidden = false;
  saveRecoverySnapshot('error');
  toast(humanizeError(error), 5200);
}

function humanizeError(error) {
  const message = String(error?.message || error || 'Error desconocido');
  if (/NotAllowedError|permission|Permission denied|denied/i.test(message)) return 'Necesito permiso para usar el micrófono. Habilitalo en el navegador y volvé a intentar.';
  if (/NotFoundError|Requested device not found|micrófono/i.test(message)) return 'No encontré un micrófono disponible en este dispositivo.';
  if (/memory|allocation|out of memory/i.test(message)) return 'El archivo agotó la memoria disponible. Probá con un archivo más pequeño.';
  if (/webgpu/i.test(message)) return 'WebGPU falló. En Ajustes elegí “Automática” o “Compatibilidad (WASM)”.';
  if (/ffmpeg|decode|codec|wav/i.test(message)) return 'No pudimos leer el audio de este archivo. Probá convertirlo a MP4, MP3 o WAV.';
  return `Error: ${message.slice(0, 180)}`;
}

function cancelCurrent() {
  if (state.recording) {
    stopRecording();
    return;
  }
  state.cancelled = true;
  state.worker?.postMessage({ type: 'cancel' });
  restartWorker();
  resetApp();
  toast('Proceso cancelado.');
}

function restartWorker() {
  state.worker?.terminate();
  state.worker = new Worker(new URL('./engine/transcriber.worker.js', import.meta.url), { type: 'module' });
}

function ensureWorker() {
  if (!state.worker) restartWorker();
  return state.worker;
}

function resetApp() {
  state.cancelled = false;
  state.file = null;
  state.duration = null;
  state.sourceKind = null;
  state.operationStage = null;
  clearRecoverySnapshot();
  resetTranscriptOnly();
  els.fileInput.value = '';
  cleanupPreview();
  els.recoveryNotice.hidden = true;
  setProgress(0, 'Esperando archivo…', { reset: true });
  setStage('prepare', true);
  showView('ready');
}

function resetTranscriptOnly() {
  state.text = '';
  state.segments = [];
  state.progress = 0;
  els.progressFill.classList.remove('is-indeterminate');
  els.retryButton.hidden = true;
  els.liveTranscript.innerHTML = '<div class="transcript-empty">La transcripción irá apareciendo acá.</div>';
  els.resultTranscript.innerHTML = '';
  els.searchCount.textContent = '';
  els.statusBadge.textContent = 'LOCAL';
}

function beginRecoverySnapshot(kind, fileName) {
  state.sourceKind = kind;
  els.recoveryNotice.hidden = true;
  const snapshot = {
    version: 1,
    status: 'processing',
    kind,
    fileName,
    duration: 0,
    text: '',
    segments: [],
    savedAt: Date.now(),
    stage: state.operationStage,
    diagnostics: state.diagnostics,
  };
  try { localStorage.setItem(RECOVERY_KEY, JSON.stringify(snapshot)); } catch {}
}

function saveRecoverySnapshot(status) {
  if (!state.file) return;
  const snapshot = {
    version: 1,
    status,
    kind: state.sourceKind,
    fileName: state.file.name || 'Transcripción',
    duration: Number(state.duration) || 0,
    text: state.text || '',
    segments: state.segments || [],
    savedAt: Date.now(),
    stage: state.operationStage,
    diagnostics: state.diagnostics,
  };

  try {
    localStorage.setItem(RECOVERY_KEY, JSON.stringify(snapshot));
  } catch {
    try {
      localStorage.setItem(RECOVERY_KEY, JSON.stringify({ ...snapshot, segments: [] }));
    } catch {}
  }
}

function restoreRecoverySnapshot() {
  let snapshot;
  try { snapshot = JSON.parse(localStorage.getItem(RECOVERY_KEY) || 'null'); } catch { return; }
  if (!snapshot || snapshot.version !== 1) return;
  if (Date.now() - Number(snapshot.savedAt || 0) > 7 * 24 * 60 * 60 * 1000) {
    clearRecoverySnapshot();
    return;
  }

  const hasRecoveredText = Boolean(String(snapshot.text || '').trim()) || (Array.isArray(snapshot.segments) && snapshot.segments.length > 0);
  if (snapshot.status === 'complete' || hasRecoveredText) {
    state.file = { name: snapshot.fileName || 'Transcripción recuperada', size: 0, type: 'audio/wav' };
    state.sourceKind = snapshot.kind || 'file';
    state.duration = Number(snapshot.duration) || 0;
    state.text = String(snapshot.text || '');
    state.segments = Array.isArray(snapshot.segments) ? snapshot.segments : [];
    els.resultMeta.textContent = `${state.file.name} · ${formatTime(state.duration)} · texto recuperado${snapshot.status === 'complete' ? '' : ' (puede estar incompleto)'}`;
    els.searchInput.value = '';
    renderResults();
    showView('result');
    setTimeout(() => toast(snapshot.status === 'complete' ? 'Recuperamos tu última transcripción.' : 'Recuperamos el texto disponible antes del reinicio.', 5200), 250);
    return;
  }

  const interruptedAt = snapshot.stage === 'model'
    ? 'El navegador cerró el motor local mientras cargaba el modelo de voz.'
    : snapshot.stage === 'decode'
      ? 'El navegador cerró el proceso mientras preparaba el audio del archivo.'
      : snapshot.stage === 'transcribe'
        ? 'El navegador cerró el proceso durante la transcripción.'
        : 'El celular recargó la página antes de generar texto.';
  els.recoveryNoticeText.textContent = snapshot.status === 'error'
    ? 'El proceso anterior terminó con un error. Ya podés elegir el archivo o grabar otra vez.'
    : `${interruptedAt} Activamos el modo de memoria reducida para el próximo intento.`;
  els.recoveryNotice.hidden = false;
}

function clearRecoverySnapshot() {
  try { localStorage.removeItem(RECOVERY_KEY); } catch {}
}

function showView(name) {
  const views = { ready: els.ready, processing: els.processing, result: els.result };
  Object.values(views).forEach((view) => view.classList.remove('is-active'));
  views[name].classList.add('is-active');
  document.querySelectorAll('[data-nav]').forEach((button) => button.classList.toggle('is-active', button.dataset.nav === 'home'));
}

function setProgress(value, label, { reset = false, indeterminate = false } = {}) {
  if (reset) state.progress = 0;
  const requested = Math.max(0, Math.min(1, value || 0));
  const p = Math.max(state.progress, requested);
  state.progress = p;
  els.progressFill.classList.toggle('is-indeterminate', indeterminate);
  els.progressFill.style.width = `${Math.round(p * 100)}%`;
  els.progressPercent.textContent = indeterminate ? '…' : `${Math.round(p * 100)}%`;
  els.progressLabel.textContent = label;
}

function setStage(stage, reset = false) {
  const order = ['prepare', 'model', 'transcribe'];
  document.querySelectorAll('.stage').forEach((el) => {
    el.classList.remove('is-active', 'is-done');
    const current = order.indexOf(el.dataset.stage);
    const target = order.indexOf(stage);
    if (stage === 'done' || (!reset && current < target)) el.classList.add('is-done');
    if (el.dataset.stage === stage) el.classList.add('is-active');
    const dot = el.querySelector('.stage-dot');
    dot.textContent = el.classList.contains('is-done') ? '✓' : String(current + 1);
  });
}

function appendLiveSegments(segments) {
  if (!segments?.length) return;
  els.liveTranscript.querySelector('.transcript-empty')?.remove();
  const fragment = document.createDocumentFragment();
  segments.forEach((segment) => {
    const row = document.createElement('div');
    row.className = 'segment';
    row.innerHTML = `<div class="segment-time">${formatTime(segment.start)}</div><div class="segment-text"></div>`;
    row.querySelector('.segment-text').textContent = segment.text;
    fragment.appendChild(row);
  });
  els.liveTranscript.appendChild(fragment);
  els.liveTranscript.scrollTop = els.liveTranscript.scrollHeight;
}

function renderResults() {
  const query = els.searchInput.value.trim();
  const q = normalize(query);
  els.resultTranscript.innerHTML = '';

  if (!state.text.trim() && !state.segments.length) {
    els.resultTranscript.innerHTML = '<div class="result-empty"><strong>No se detectó voz en el archivo.</strong><span>Probá con un audio más claro, con volumen suficiente y poca música de fondo.</span></div>';
    els.searchCount.textContent = 'Sin voz detectada';
    return;
  }

  const fragment = document.createDocumentFragment();
  let matches = 0;

  const segments = state.segments.length ? state.segments : [{ start: 0, end: state.duration || 0, text: state.text }];
  segments.forEach((segment) => {
    const isMatch = q && normalize(segment.text).includes(q);
    if (isMatch) matches++;
    const row = document.createElement('div');
    row.className = `result-segment${isMatch ? ' is-match' : ''}`;
    const time = document.createElement('div');
    time.className = 'segment-time';
    time.textContent = formatTime(segment.start);
    const text = document.createElement('div');
    text.className = 'segment-text';
    if (query && isMatch) text.innerHTML = highlightSafe(segment.text, query);
    else text.textContent = segment.text;
    row.append(time, text);
    fragment.appendChild(row);
  });
  els.resultTranscript.appendChild(fragment);
  els.searchCount.textContent = query ? `${matches} coincidencia${matches === 1 ? '' : 's'}` : `${segments.length} segmentos`;
}

async function copyTranscript() {
  try {
    await navigator.clipboard.writeText(state.text || state.segments.map(s => s.text).join(' '));
    toast('Transcripción copiada.');
  } catch {
    toast('No pude usar el portapapeles. Descargá el TXT.');
  }
}

function downloadText() {
  const content = state.segments.map((s) => `[${formatTime(s.start)}] ${s.text}`).join('\n\n') || state.text;
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${stripExtension(state.file?.name || 'transcripcion')}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function setupPreview(file) {
  cleanupPreview();
  if (!file.type.startsWith('video/')) return;
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'metadata';
  video.src = URL.createObjectURL(file);
  video.dataset.localUrl = video.src;
  els.filePreview.innerHTML = '';
  els.filePreview.appendChild(video);
}
function cleanupPreview() {
  const video = els.filePreview.querySelector('video');
  if (video?.dataset.localUrl) URL.revokeObjectURL(video.dataset.localUrl);
  els.filePreview.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M10 9l5 3-5 3V9z" fill="currentColor"/></svg>';
}

function openSettings() {
  if (state.recording) return toast('Detené la grabación antes de cambiar los ajustes.');
  els.settingsModal.classList.add('is-open');
  refreshStorageEstimate();
}
function closeSettings() { els.settingsModal.classList.remove('is-open'); }
async function clearAICache() {
  try {
    const keys = await caches.keys();
    const aiKeys = keys.filter((key) => !key.startsWith('scribe-shell-'));
    await Promise.all(aiKeys.map((key) => caches.delete(key)));
    restartWorker();
    await refreshStorageEstimate();
    toast(aiKeys.length ? 'Caché de modelos eliminada.' : 'No había caché de modelos para borrar.');
  } catch (error) {
    toast(`No se pudo limpiar la caché: ${error.message}`);
  }
}
async function refreshStorageEstimate() {
  if (!navigator.storage?.estimate) { els.storageText.textContent = 'El navegador no informa el uso.'; return; }
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  els.storageText.textContent = `${formatBytes(usage)} usados${quota ? ` de ${formatBytes(quota)} disponibles para este origen` : ''}`;
}

function toast(message, duration = 2600) {
  els.toast.textContent = message;
  els.toast.classList.add('is-visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove('is-visible'), duration);
}

function isSupportedFile(file) { return file.type.startsWith('audio/') || file.type.startsWith('video/') || /\.(m4a|mkv|mp3|wav|ogg|flac|aac|mp4|mov|webm)$/i.test(file.name); }
function friendlyType(file) { return file.type.startsWith('video/') ? 'Video' : file.type.startsWith('audio/') ? 'Audio' : 'Multimedia'; }
function formatBytes(bytes) { if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'; const units = ['B','KB','MB','GB']; const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024))); return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`; }
function formatTime(seconds) { seconds = Math.max(0, Number(seconds) || 0); const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = Math.floor(seconds % 60); return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }
function formatElapsed(seconds) { if (seconds < 60) return `${Math.round(seconds)} s`; return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`; }
function stripExtension(name) { return name.replace(/\.[^.]+$/, '') || 'transcripcion'; }
function normalize(text) { return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function escapeHtml(text) { return String(text).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function highlightSafe(text, query) {
  const safe = escapeHtml(text);
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try { return safe.replace(new RegExp(`(${escapedQuery})`, 'ig'), '<mark>$1</mark>'); } catch { return safe; }
}
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  try {
    const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' });
    registration.update().catch(() => {});
  } catch {
    // La aplicación sigue funcionando aunque el navegador no permita PWA.
  }
}
