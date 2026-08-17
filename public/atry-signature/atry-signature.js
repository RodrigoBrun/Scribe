/**
 * ATRY Agency — firma digital reutilizable.
 * Activa una única pasada holográfica cuando el badge entra claramente en pantalla.
 */
(function initAtrySignatures() {
  const selector = '[data-atry-signature]';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canObserve = !reducedMotion && 'IntersectionObserver' in window;
  const revealObserver = canObserve ? new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.62) return;
      entry.target.classList.add('atry-signature--revealed');
      revealObserver.unobserve(entry.target);
    });
  }, { threshold: [0.62] }) : null;

  function prepare(badge) {
    if (!(badge instanceof Element) || badge.dataset.atrySignatureReady === 'true') return;
    badge.dataset.atrySignatureReady = 'true';
    if (revealObserver) revealObserver.observe(badge);
    else badge.classList.add('atry-signature--ready');
  }

  function mount(root = document) {
    if (root instanceof Element && root.matches(selector)) prepare(root);
    root.querySelectorAll?.(selector).forEach(prepare);
  }

  function start() {
    mount();
    const dynamicObserver = new MutationObserver((records) => {
      records.forEach((record) => record.addedNodes.forEach((node) => {
        if (node instanceof Element) mount(node);
      }));
    });
    dynamicObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.ATRYSignature = Object.freeze({ mount });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
