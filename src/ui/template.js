const icon = (name) => {
  const icons = {
    logo: '<svg viewBox="0 0 32 32" fill="none"><path d="M4 17c3 0 3-7 6-7s3 13 6 13 3-18 6-18 3 22 6 22" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none"><path d="M7 3h7l4 4v14H7z" stroke="currentColor" stroke-width="1.8"/><path d="M14 3v5h5" stroke="currentColor" stroke-width="1.8"/><path d="M10 13h5M10 16h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 16V5m0 0L8 9m4-4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 15v4h14v-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z" stroke="currentColor" stroke-width="1.8"/><path d="M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.4 1a7 7 0 00-2-1.1L14.2 3h-4.4l-.3 2.8a7 7 0 00-2 1.1l-2.4-1-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.4-1a7 7 0 002 1.1l.3 2.8h4.4l.3-2.8a7 7 0 002-1.1l2.4 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 11v6m0-10v.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6" stroke="currentColor" stroke-width="1.8"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    media: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M10 9l5 3-5 3V9z" fill="currentColor"/></svg>'
  };
  return icons[name] || '';
};

export function renderApp(root) {
  root.innerHTML = `
    <div class="aurora-wave"></div>
    <div class="app-frame">
      <div class="glass-shell">
        <nav class="dock" aria-label="Navegación principal">
          <div class="brand-mark" aria-hidden="true">${icon('logo')}</div>
          <button class="dock-button is-active" data-nav="home" aria-label="Transcribir">${icon('file')}</button>
          <button class="dock-button" data-nav="info" aria-label="Privacidad">${icon('info')}</button>
          <div class="dock-spacer"></div>
          <button class="dock-button" data-nav="settings" aria-label="Ajustes">${icon('settings')}</button>
        </nav>

        <main class="main">
          <header class="topbar">
            <div class="logo">Scribe<span>.</span></div>
            <div class="topbar-copy">voz a texto, sin subir tu archivo</div>
            <div class="privacy-pill"><i></i> Procesamiento local</div>
          </header>

          <section id="readyView" class="view ready-view is-active" aria-labelledby="heroTitle">
            <div class="hero">
              <h1 id="heroTitle">Convertí tu audio<br><em>en texto.</em></h1>
              <p class="hero-subtitle">Cuando termines, copiá la transcripción y guardala en un lugar seguro para no perderla.</p>
              <div id="dropzone" class="dropzone" role="button" tabindex="0" aria-label="Abrir archivo de audio o video">
                <div>
                  <div class="dropzone-icon">${icon('upload')}</div>
                  <strong>Abrir archivo</strong>
                  <small>o arrastralo hasta acá</small>
                  <div class="support-line">MP4 · MOV · WEBM · MP3 · WAV · M4A · OGG</div>
                </div>
              </div>
              <input id="fileInput" type="file" accept="audio/*,video/*,.m4a,.mkv" hidden />
            </div>
          </section>

          <section id="processingView" class="view processing-view" aria-live="polite">
            <div class="processing-grid">
              <aside class="card file-card">
                <div id="filePreview" class="file-preview">${icon('media')}</div>
                <div id="fileName" class="file-name">archivo</div>
                <div id="fileMeta" class="file-meta">Preparando información...</div>
                <div class="stage-list">
                  <div class="stage is-active" data-stage="prepare"><span class="stage-dot">1</span><span>Preparar audio</span></div>
                  <div class="stage" data-stage="model"><span class="stage-dot">2</span><span>Cargar motor</span></div>
                  <div class="stage" data-stage="transcribe"><span class="stage-dot">3</span><span>Transcribir</span></div>
                </div>
                <button id="cancelButton" class="cancel-button">Cancelar</button>
              </aside>

              <section class="card transcript-card">
                <header class="transcript-header">
                  <div class="transcript-header-row">
                    <h2 id="processingTitle">Preparando archivo</h2>
                    <span id="statusBadge" class="status-badge">LOCAL</span>
                  </div>
                  <div class="progress-copy"><span id="progressLabel">Leyendo archivo…</span><span id="progressPercent">0%</span></div>
                  <div class="progress-track"><div id="progressFill" class="progress-fill"></div></div>
                </header>
                <div id="liveTranscript" class="transcript-scroll">
                  <div class="transcript-empty">La transcripción irá apareciendo acá.</div>
                </div>
              </section>
            </div>
          </section>

          <section id="resultView" class="view result-view">
            <header class="result-head">
              <div>
                <p class="eyebrow">Transcripción completa</p>
                <h1>Ya podés usar el texto.</h1>
                <p id="resultMeta"></p>
              </div>
              <div class="result-actions">
                <button id="newFileButton" class="btn btn-secondary">Nuevo archivo</button>
                <button id="copyButton" class="btn btn-primary">Copiar todo</button>
                <button id="downloadButton" class="btn btn-secondary">Descargar TXT</button>
              </div>
            </header>
            <section class="card result-panel">
              <div class="searchbar">${icon('search')}<input id="searchInput" type="search" placeholder="Buscar dentro de la transcripción…" autocomplete="off"><span id="searchCount" class="search-count"></span></div>
              <div id="resultTranscript" class="result-transcript"></div>
            </section>
          </section>

          <footer class="scribe-footer" aria-label="Créditos de desarrollo">
            <div class="atry-signature" data-atry-signature>
              <a class="atry-signature__link" href="https://rodrigobrun.github.io/ATRYAGENCY/" target="_blank" rel="noopener noreferrer" aria-label="Sitio desarrollado por ATRY Agency. Visitar el sitio de ATRY Agency">
                <span class="atry-signature__foil" aria-hidden="true"></span>
                <span class="atry-signature__logo" aria-hidden="true"></span>
                <span class="atry-signature__copy"><span class="atry-signature__prefix">Desarrollado por</span><span class="atry-signature__brand">ATRY Agency</span></span>
                <svg class="atry-signature__arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16 16 8M10 8h6v6" /></svg>
              </a>
            </div>
          </footer>
        </main>
      </div>
    </div>

    <div id="settingsModal" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
      <div class="modal">
        <div class="modal-head"><h2 id="settingsTitle">Ajustes</h2><button id="settingsClose" class="modal-close" aria-label="Cerrar">×</button></div>
        <div class="settings-grid">
          <div class="setting">
            <label for="modelSelect">Calidad</label>
            <select id="modelSelect">
              <option value="onnx-community/whisper-tiny">Rápido · Whisper Tiny</option>
              <option value="onnx-community/whisper-base">Equilibrado · Whisper Base</option>
              <option value="onnx-community/whisper-small">Preciso · Whisper Small</option>
            </select>
            <p>La primera vez se descarga el modelo elegido. Luego el navegador puede reutilizarlo desde caché.</p>
          </div>
          <div class="setting">
            <label for="backendSelect">Aceleración</label>
            <select id="backendSelect">
              <option value="auto">Automática</option>
              <option value="wasm">Compatibilidad (WASM)</option>
              <option value="webgpu">WebGPU</option>
            </select>
            <p>Automática intenta WebGPU cuando está disponible y vuelve a WASM si no funciona.</p>
          </div>
          <div class="storage-row">
            <div><strong>Almacenamiento local</strong><span id="storageText">Calculando…</span></div>
            <button id="clearCacheButton" class="btn btn-secondary">Limpiar caché IA</button>
          </div>
        </div>
      </div>
    </div>
    <div id="toast" class="toast"></div>
  `;
}
