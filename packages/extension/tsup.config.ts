import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/extension.ts'],
  format: ['cjs'],
  external: ['vscode'],
  noExternal: ['@agentic-bookmarks/core', '@agentic-bookmarks/licensing', 'nanoid'],
  clean: true,
  bundle: true,
  minify: false,
  sourcemap: false,
});
