import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '../src': new URL('./src', import.meta.url).pathname,
    },
  },
});
