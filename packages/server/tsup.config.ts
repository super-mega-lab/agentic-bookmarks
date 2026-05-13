import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  shims: true,
  clean: true,
  sourcemap: false,
  // Bundle all dependencies so the output can run standalone when copied
  noExternal: [/.*/],
});
