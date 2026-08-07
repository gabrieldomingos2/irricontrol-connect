// assets/js/pwa-register.js
// Registra o service worker que habilita "Adicionar à tela inicial" (PWA).
// Falha silenciosa em navegadores sem suporte (ex.: Safari mais antigo) —
// o app continua funcionando normal como site, só não fica instalável.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((err) => {
      console.warn("Falha ao registrar service worker (PWA):", err);
    });
  });
}
