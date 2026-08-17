import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const TARGET_RATE = 16000;
let ffmpeg = null;
let ffmpegLoaded = false;

export async function getMediaDuration(file) {
  return new Promise((resolve) => {
    const element = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio');
    const url = URL.createObjectURL(file);
    element.preload = 'metadata';
    element.onloadedmetadata = () => {
      const duration = Number.isFinite(element.duration) ? element.duration : null;
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    element.src = url;
  });
}

export async function decodeFileTo16kMono(file, onProgress = () => {}) {
  onProgress({ stage: 'prepare', progress: 0.04, label: 'Leyendo archivo…' });

  // Camino rápido: muchos navegadores móviles pueden extraer directamente la
  // pista de audio de MP4/MOV. Evitar FFmpeg reduce mucho el uso de memoria.
  try {
    const audio = await decodeNative(file);
    onProgress({ stage: 'prepare', progress: 1, label: 'Audio preparado' });
    return audio;
  } catch (error) {
    console.warn('[Scribe] Decodificación nativa falló; usando FFmpeg.', error);
  }

  // Fallback universal para contenedores de video y codecs no soportados por AudioContext.
  try {
    const wavBytes = await extractWithFFmpeg(file, (ratio) => {
      onProgress({ stage: 'prepare', progress: Math.max(.08, Math.min(.96, ratio)), label: 'Extrayendo pista de audio…' });
    });
    const audio = parsePCM16Wav(wavBytes);
    onProgress({ stage: 'prepare', progress: 1, label: 'Audio preparado' });
    return audio;
  } finally {
    releaseFFmpeg();
  }
}

async function decodeNative(file) {
  const input = await file.arrayBuffer();
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(input.slice(0));
    const mono = mixToMono(decoded);
    if (decoded.sampleRate === TARGET_RATE) return mono;
    return await resample(mono, decoded.sampleRate, TARGET_RATE);
  } finally {
    await context.close().catch(() => {});
  }
}

function mixToMono(buffer) {
  const length = buffer.length;
  const channels = buffer.numberOfChannels;
  const mono = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
  }
  return mono;
}

async function resample(samples, fromRate, toRate) {
  const duration = samples.length / fromRate;
  const offline = new OfflineAudioContext(1, Math.ceil(duration * toRate), toRate);
  const sourceBuffer = offline.createBuffer(1, samples.length, fromRate);
  sourceBuffer.copyToChannel(samples, 0);
  const source = offline.createBufferSource();
  source.buffer = sourceBuffer;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  return new Float32Array(rendered.getChannelData(0));
}

async function ensureFFmpeg() {
  if (ffmpegLoaded && ffmpeg) return ffmpeg;
  ffmpeg = new FFmpeg();
  const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  ffmpegLoaded = true;
  return ffmpeg;
}

function releaseFFmpeg() {
  ffmpeg?.terminate();
  ffmpeg = null;
  ffmpegLoaded = false;
}

async function extractWithFFmpeg(file, onProgress) {
  const engine = await ensureFFmpeg();
  const safeExt = extensionFor(file.name || '') || extensionFromMime(file.type) || 'bin';
  const token = Math.random().toString(36).slice(2, 9);
  const inputName = `input-${token}.${safeExt}`;
  const outputName = `audio-${token}.wav`;

  const progressHandler = ({ progress }) => onProgress(Number.isFinite(progress) ? progress : 0.1);
  engine.on('progress', progressHandler);

  try {
    await engine.writeFile(inputName, await fetchFile(file));
    const code = await engine.exec([
      '-i', inputName,
      '-vn',
      '-ac', '1',
      '-ar', String(TARGET_RATE),
      '-c:a', 'pcm_s16le',
      outputName,
    ]);
    if (code !== 0) throw new Error(`FFmpeg terminó con código ${code}`);
    const output = await engine.readFile(outputName);
    return output instanceof Uint8Array ? output : new Uint8Array(output);
  } finally {
    engine.off('progress', progressHandler);
    await engine.deleteFile(inputName).catch(() => {});
    await engine.deleteFile(outputName).catch(() => {});
  }
}

function parsePCM16Wav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let channels = 1;
  let sampleRate = TARGET_RATE;
  let bits = 16;
  let dataOffset = -1;
  let dataLength = 0;

  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bits = view.getUint16(offset + 22, true);
    } else if (id === 'data') {
      dataOffset = offset + 8;
      dataLength = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }

  if (dataOffset < 0 || bits !== 16) throw new Error('WAV PCM16 inválido');
  const frames = Math.floor(dataLength / 2 / channels);
  const mono = new Float32Array(frames);
  let pos = dataOffset;
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      sum += view.getInt16(pos, true) / 32768;
      pos += 2;
    }
    mono[i] = sum / channels;
  }

  if (sampleRate !== TARGET_RATE) {
    throw new Error(`FFmpeg devolvió ${sampleRate} Hz en vez de ${TARGET_RATE} Hz`);
  }
  return mono;
}

function extensionFor(name) {
  const match = name.toLowerCase().match(/\.([a-z0-9]{1,6})$/);
  return match?.[1] || '';
}
function extensionFromMime(mime) {
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('quicktime')) return 'mov';
  if (mime.includes('mpeg')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('ogg')) return 'ogg';
  return '';
}
