import './styles.css';
import { renderApp } from './ui/template.js';
import { decodeFileTo16kMono, getMediaDuration } from './engine/audio.js';

const root = document.querySelector('#app');
renderApp(root);

const $ = (selector) => document.querySelector(selector);
const els = {
  ready: $('#readyView'), processing: $('#processingView'), result: $('#resultView'),
  dropzone: $('#dropzone'), fileInput: $('#fileInput'), filePreview: $('#filePreview'), fileName: $('#fileName'), fileMeta: $('#fileMeta'),
  processingTitle: $('#processingTitle'), statusBadge: $('#statusBadge'), progressLabel: $('#progressLabel'), progressPercent: $('#progressPercent'), progressFill: $('#progressFill'),
  liveTranscript: $('#liveTranscript'), cancelButton: $('#cancelButton'),
  resultMeta: $('#resultMeta'), resultTranscript: $('#resultTranscript'), searchInput: $('#searchInput'), searchCount: $('#searchCount'),
  copyButton: $('#copyButton'), downloadButton: $('#downloadButton'), newFileButton: $('#newFileButton'),
  settingsModal: $('#settingsModal'), settingsClose: $('#settingsClose'), modelSelect: $('#modelSelect'), backendSelect: $('#backendSelect'), clearCacheButton: $('#clearCacheButton'), storageText: $('#storageText'),
  toast: $('#toast'),
};

const state = {
  file: null,
  duration: null,
  startedAt: null,
  worker: null,
  cancelled: false,
  text: '',
  segments: [],
  model: localStorage.getItem('scribe.model') || 'onnx-community/whisper-tiny',
  backend: localStorage.getItem('scribe.backend') || 'auto',
};
els.modelSelect.value = state.model;
els.backendSelect.value = state.backend;

bindEvents();
refreshStorageEstimate();
registerServiceWorker();

function bindEvents() {
  els.dropzone.addEventListener('click', () => els.fileInput.click());
  els.dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') els.fileInput.click(); });
  els.fileInput.addEventListener('change', () => els.fileInput.files?.[0] && startFile(els.fileInput.files[0]));

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
  document.querySelectorAll('[data-nav="home"]').forEach((button) => button.addEventListener('click', () => state.segments.length ? showView('result') : showView('ready')));
  els.settingsClose.addEventListener('click', closeSettings);
  els.settingsModal.addEventListener('click', (e) => { if (e.target === els.settingsModal) closeSettings(); });
  els.modelSelect.addEventListener('change', () => { state.model = els.modelSelect.value; localStorage.setItem('scribe.model', state.model); restartWorker(); });
  els.backendSelect.addEventListener('change', () => { state.backend = els.backendSelect.value; localStorage.setItem('scribe.backend', state.backend); restartWorker(); });
  els.clearCacheButton.addEventListener('click', clearAICache);
}

async function startFile(file) {
  if (!isSupportedFile(file)) return toast('Elegí un archivo de audio o video.');
  resetTranscriptOnly();
  state.file = file;
  state.cancelled = false;
  state.startedAt = performance.now();
  state.duration = await getMediaDuration(file);

  els.fileName.textContent = file.name;
  els.fileMeta.textContent = `${formatBytes(file.size)}${state.duration ? ` · ${formatTime(state.duration)}` : ''}\n${friendlyType(file)}`;
  setupPreview(file);
  showView('processing');
  setStage('prepare');
  setProgress(.02, 'Preparando archivo…');

  try {
    const audio = await decodeFileTo16kMono(file, ({ progress, label }) => {
      if (!state.cancelled) setProgress(progress * .18, label);
    });
    if (state.cancelled) return;

    setStage('model');
    els.processingTitle.textContent = 'Preparando motor de voz';
    setProgress(.20, 'Cargando modelo…');
    await transcribe(audio);
  } catch (error) {
    console.error(error);
    if (!state.cancelled) fail(error);
  }
}

function transcribe(audio) {
  return new Promise((resolve, reject) => {
    restartWorker();
    const worker = state.worker;

    worker.onmessage = (event) => {
      const { type, payload } = event.data || {};
      if (type === 'model-progress') {
        const p = Number(payload.progress);
        if (Number.isFinite(p)) setProgress(.20 + p * .18, `Descargando/cargando modelo…`);
      }
      if (type === 'backend') {
        els.statusBadge.textContent = payload.backend === 'webgpu' ? 'WEBGPU · LOCAL' : 'WASM · LOCAL';
      }
      if (type === 'chunk-start') {
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
    worker.postMessage({ type: 'transcribe', payload: { audio, model: state.model, backend: state.backend } }, [audio.buffer]);
  });
}

function finish() {
  setStage('done');
  const elapsed = (performance.now() - state.startedAt) / 1000;
  els.resultMeta.textContent = `${state.file?.name || 'Archivo'} · ${formatTime(state.duration || 0)} · procesado en ${formatElapsed(elapsed)}`;
  els.searchInput.value = '';
  renderResults();
  setTimeout(() => showView('result'), 260);
}

function fail(error) {
  console.error('[Scribe]', error);
  els.processingTitle.textContent = 'No pudimos procesar este archivo';
  els.statusBadge.textContent = 'ERROR';
  setProgress(0, humanizeError(error));
  toast(humanizeError(error), 5200);
}

function humanizeError(error) {
  const message = String(error?.message || error || 'Error desconocido');
  if (/memory|allocation|out of memory/i.test(message)) return 'El archivo agotó la memoria disponible. Probá con un archivo más pequeño.';
  if (/webgpu/i.test(message)) return 'WebGPU falló. En Ajustes elegí “Automática” o “Compatibilidad (WASM)”.';
  if (/ffmpeg|decode|codec|wav/i.test(message)) return 'No pudimos leer el audio de este archivo. Probá convertirlo a MP4, MP3 o WAV.';
  return `Error: ${message.slice(0, 180)}`;
}

function cancelCurrent() {
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

function resetApp() {
  state.cancelled = false;
  state.file = null;
  state.duration = null;
  resetTranscriptOnly();
  els.fileInput.value = '';
  cleanupPreview();
  setProgress(0, 'Esperando archivo…');
  setStage('prepare', true);
  showView('ready');
}

function resetTranscriptOnly() {
  state.text = '';
  state.segments = [];
  els.liveTranscript.innerHTML = '<div class="transcript-empty">La transcripción irá apareciendo acá.</div>';
  els.resultTranscript.innerHTML = '';
  els.searchCount.textContent = '';
  els.statusBadge.textContent = 'LOCAL';
}

function showView(name) {
  const views = { ready: els.ready, processing: els.processing, result: els.result };
  Object.values(views).forEach((view) => view.classList.remove('is-active'));
  views[name].classList.add('is-active');
  document.querySelectorAll('[data-nav]').forEach((button) => button.classList.toggle('is-active', button.dataset.nav === 'home'));
}

function setProgress(value, label) {
  const p = Math.max(0, Math.min(1, value || 0));
  els.progressFill.style.width = `${Math.round(p * 100)}%`;
  els.progressPercent.textContent = `${Math.round(p * 100)}%`;
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

function openSettings() { els.settingsModal.classList.add('is-open'); refreshStorageEstimate(); }
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
