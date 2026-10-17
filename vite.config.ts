import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages (https://<user>.github.io/<repo>/) でも動くよう相対パスで出力
  base: './',
  build: {
    rollupOptions: {
      // 本体と、母音入力の実験ページ（パスはプロジェクトのルートから）
      input: { main: 'index.html', lab: 'lab.html' },
    },
  },
});
