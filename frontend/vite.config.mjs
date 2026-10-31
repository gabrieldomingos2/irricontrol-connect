import { defineConfig } from 'vite';

export default defineConfig({
  root: './', // garante que o index.html seja carregado corretamente
  server: {
    port: 5173,
  },
  build: {
    // O dist/ aqui NÃO é saída do Vite: é onde o build:js (esbuild) e o
    // build:css (tailwind) jogam o bundle/CSS servidos no dev. Com
    // emptyOutDir ligado (padrão), o Vite deixa de observar o dist/ e
    // continua servindo a versão antiga do app.bundle.js depois de um
    // rebuild (watch:js) — as mudanças em assets/js não apareciam no
    // navegador até reiniciar o `npm run dev`.
    emptyOutDir: false,
  },
});
