import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  shims: true,
  clean: true,
  sourcemap: false,
  minify: true,
  // Bundle all dependencies so the output can run standalone when copied
  noExternal: [/.*/],
  esbuildOptions(options) {
    options.drop = ['console'];
  },
});
