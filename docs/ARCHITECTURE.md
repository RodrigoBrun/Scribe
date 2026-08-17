# Arquitectura de Scribe v0.1

## Objetivo

Mantener una experiencia de producto extremadamente simple:

**Abrir → Transcribir → Buscar/Copiar → Cerrar**

sin que la complejidad técnica aparezca en la interfaz.

## Flujo de datos

```text
File (usuario)
  │
  ├─ audio compatible ──> AudioContext ──> PCM mono 16 kHz
  │
  └─ video/codec raro ──> ffmpeg.wasm ──> WAV PCM16 ──> PCM mono 16 kHz
                                              │
                                              ▼
                                  Transcriber Web Worker
                                              │
                                  Whisper / Transformers.js
                                              │
                         segmentos + timestamps + texto
                                              │
                                              ▼
                                   interfaz Aurora Flow
```

El worker separa la inferencia de la UI para que animaciones, scroll y controles sigan respondiendo durante el trabajo pesado.

## Estados de producto

### READY
Una sola CTA: abrir archivo.

### PREPARE
Obtención de metadata y conversión a PCM mono 16 kHz.

### MODEL
Carga/descarga del modelo Whisper. Se intenta WebGPU cuando el modo es Automático.

### TRANSCRIBE
Se divide el PCM en ventanas de 28 s. Cada ventana produce texto y segmentos que aparecen inmediatamente.

### DONE
Búsqueda, copia y descarga del resultado.

## Decisiones de V0.1

### Transformers.js en lugar del build WASM directo de whisper.cpp

Para un MVP portable, Transformers.js simplifica la selección de WebGPU/WASM, la descarga/caché de modelos ONNX y la API ASR. El producto sigue siendo local-first: la inferencia sucede en el navegador.

La arquitectura deja el motor aislado en `engine/transcriber.worker.js`, por lo que más adelante se puede sustituir por un build propio de `whisper.cpp` WASM sin rediseñar la UI.

### FFmpeg se carga solo cuando hace falta

Audio soportado por `AudioContext` evita cargar el core de FFmpeg. Video y codecs no soportados utilizan `ffmpeg.wasm` como fallback.

### Chunking manual

Whisper puede procesar audio largo mediante chunking interno, pero Scribe lo divide explícitamente para poder mostrar progreso real y resultados parciales. V0.1 usa ventanas contiguas de 28 s: prioriza simplicidad y estabilidad. Una versión futura puede sumar overlap + reconciliación para mejorar cortes de palabra.

## Seguridad / privacidad

No hay endpoints de upload en este proyecto. No existe backend. El archivo entra mediante `File` del navegador y solo se entrega a APIs locales/WebAssembly.

Los modelos y motores sí se descargan desde Internet en el primer uso. Para un despliegue completamente autocontenido se pueden hostear esos assets en el mismo dominio.

## Performance

- Inferencia: Worker.
- Decodificación FFmpeg: `ffmpeg.wasm` usa su worker interno.
- UI: hilo principal.
- Reduced motion respetado.
- FFmpeg se carga bajo demanda.
- Tiny es el modelo inicial para evitar castigar dispositivos modestos.

## Deuda técnica consciente

El mayor cuello de botella actual es video grande con ffmpeg.wasm: `writeFile()` copia el archivo al FS virtual. Antes de publicarlo como herramienta para archivos de varios GB hay que reemplazar ese camino por una estrategia incremental/montada.
