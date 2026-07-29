import { defineConfig } from 'vite';

export default defineConfig({
  root: './', // garante que o index.html seja carregado corretamente
  server: {
    port: 5173,
  },
});
