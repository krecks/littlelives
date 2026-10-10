// Bug-catching rules only, no style rules: svelte-check already covers types and unused code.
import svelte from 'eslint-plugin-svelte';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

export default ts.config(
  { ignores: ['dist/', 'src/**/wasm-pkg/'] },
  ...svelte.configs.recommended,
  {
    files: ['src/**/*.ts', 'src/**/*.svelte'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { '@typescript-eslint': ts.plugin },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // Noise here: flags plain Maps/Sets/Dates built inside $derived or helpers, and house style.
      'svelte/prefer-svelte-reactivity': 'off',
      'svelte/prefer-writable-derived': 'off',
      'svelte/no-useless-mustaches': 'off',
    },
  },
  { files: ['src/**/*.ts'], languageOptions: { parser: ts.parser } },
  { files: ['src/**/*.svelte', 'src/**/*.svelte.ts'], languageOptions: { parserOptions: { parser: ts.parser, svelteConfig } } },
);
