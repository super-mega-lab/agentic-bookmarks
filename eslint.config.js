// Flat ESLint config (ESLint v9+).
// Targets TypeScript sources under packages/*/src/. Encodes the repo's
// existing conventions (2-space indent, single quotes, semis) and tolerates
// known pre-existing strictness issues (implicit any, etc.) so a fresh
// `pnpm lint` exits 0. Tightening these rules is follow-up work.

import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/server-bundle/**',
      '**/*.d.ts',
      '.worktrees/**',
      '.dev-state/**',
    ],
  },
  {
    files: ['packages/*/src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,

      // Encode existing repo conventions.
      quotes: ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],

      // Style rules with known false positives or with pre-existing
      // violations. Surfaced as warnings so contributors see them but a fresh
      // `pnpm lint` still exits 0. Tightening to error is follow-up work.
      indent: ['warn', 2, { SwitchCase: 1 }],
      semi: ['warn', 'always'],

      // Pre-existing issues — relax rather than block. See SML-1371 risk note.
      '@typescript-eslint/no-explicit-any': 'off',
      // The codebase uses `const x = require('fs')` deliberately in some
      // commands (lazy load, ESM/CJS interop with VS Code extension host).
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Vitest provides describe/it/expect at runtime; TypeScript already checks
    // undef. Disable the ESLint core no-undef rule for tests to avoid false
    // positives.
    files: ['packages/*/src/**/*.test.ts'],
    rules: {
      'no-undef': 'off',
    },
  },
];
