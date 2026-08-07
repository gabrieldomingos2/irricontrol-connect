// frontend/service-worker.js
//
// Runtime cache mínimo — existe só pra habilitar "Adicionar à tela inicial"
// (PWA) e responder um pouco mais rápido em sinal ruim no campo, que é onde
// esse app é usado de verdade. NÃO cacheia nada do backend (API, tiles,
// simulações) nem de CDN externo — só os arquivos estáticos do próprio
// front (HTML/CSS/JS/imagens), e sempre com estratégia "network-first":
// tenta a rede primeiro (garante que uma versão nova de um bundle, com
// ?v=N diferente, é sempre buscada fresca) e só cai pro cache se a rede
// falhar de verdade. Isso evita reintroduzir via cache o mesmo problema de
// "JS desatualizado" que o cache-busting por query string já resolve.
const CACHE_NAME = "irricontrol-shell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // nunca intercepta backend/CDN/tiles

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || Response.error()))
  );
});
