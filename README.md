# Scribe — Aurora MVP

Web app local-first para convertir **audio o video en texto directamente en el navegador**. La interfaz usa la dirección **Aurora Flow UI** del Adaptive UI System: glass adaptativo, azul frío, movimiento silencioso y navegación mínima.

## Qué hace esta versión

- Arrastrar/seleccionar audio o video.
- Decodificación nativa de audio cuando el navegador lo soporta.
- Fallback a `ffmpeg.wasm` para video y codecs más difíciles.
- Transcripción local con Whisper vía `@huggingface/transformers`.
- WebGPU automático cuando está disponible; fallback a WASM.
- Transcripción por bloques de 28 s para mostrar progreso y texto durante el proceso.
- Timestamps por segmento.
- Buscar dentro de la transcripción.
- Copiar todo.
- Descargar TXT con timestamps.
- PWA básica.
- Sin backend, login ni base de datos.

## Ejecutar

Requisitos: Node.js moderno (recomendado Node 20+).

```bash
npm install
npm run dev
```

Abrí la URL que muestre Vite (normalmente `http://localhost:5173`).

Para una build de producción:

```bash
npm run build
npm run preview
```

## Privacidad

El **archivo seleccionado no se sube a un servidor de Scribe**. El audio/video se procesa en el navegador. La primera vez, el navegador sí necesita Internet para descargar código/modelos desde sus proveedores (Hugging Face para Whisper y jsDelivr para el core de FFmpeg). Esos recursos son software/modelos; no contienen el archivo del usuario.

## Modelos

En Ajustes:

- **Rápido**: `onnx-community/whisper-tiny` (predeterminado, multilingüe).
- **Equilibrado**: `onnx-community/whisper-base`.
- **Preciso**: `onnx-community/whisper-small`.

La descarga real depende de los archivos cuantizados que necesita Transformers.js; el repositorio completo del modelo contiene múltiples variantes y por eso su tamaño publicado no equivale necesariamente a lo que descarga una sesión.

## Aceleración

- `Automática`: intenta WebGPU y cae a WASM si WebGPU no está disponible o falla.
- `Compatibilidad (WASM)`: máxima cobertura.
- `WebGPU`: fuerza WebGPU.

## Limitación importante de este MVP

`ffmpeg.wasm` mantiene un sistema de archivos virtual en memoria. En esta primera versión, los videos muy grandes pueden requerir demasiada RAM porque el archivo se copia al entorno WASM antes de extraer la pista de audio. Para una versión pública a gran escala conviene implementar lectura/montaje de archivo por streaming/WORKERFS o un demuxer incremental basado en WebCodecs.

Como regla práctica para probar el MVP, empezá con archivos por debajo de **300–500 MB** y luego medí según navegador/dispositivo. Audio puro suele ser mucho más liviano.

## Estructura

```text
src/
  main.js                         UI + estado de producto
  styles.css                      Aurora Flow adaptada a Scribe
  ui/template.js                  estructura visual
  engine/audio.js                 audio nativo + ffmpeg.wasm
  engine/transcriber.worker.js    Whisper fuera del hilo principal
public/
  manifest.webmanifest
  sw.js
  icon.svg
docs/
  ARCHITECTURE.md
```

## Próximos pasos recomendados

1. Streaming real para archivos de varios GB sin copiarlos completos a RAM.
2. Exportar SRT/VTT/JSON.
3. Reproductor sincronizado: tocar un timestamp y saltar al momento exacto.
4. Detección de silencio/VAD para evitar procesar largos tramos vacíos.
5. Guardar el modelo de forma más explícita y administrable (por ejemplo OPFS) si se reemplaza la caché predeterminada de Transformers.js.
6. Benchmark automático de dispositivo para recomendar Tiny/Base/Small.

## Créditos técnicos

- Whisper / modelos compatibles mediante Transformers.js.
- `ffmpeg.wasm` para extracción local de audio desde contenedores multimedia.
- Diseño: Aurora Flow UI / Adaptive UI System.
