import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { defineConfig } from 'eslint/config';

const pure = 'alert-core is pure: time and randomness arrive as event fields';

export default defineConfig(
  { ignores: ['**/dist/**', '**/dist-lambda/**', '**/cdk.out/**', '**/node_modules/**', 'var/**', '**/test-results/**', '**/playwright-report/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  {
    files: ['packages/alert-core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error',
        { name: 'Date', message: pure }, { name: 'performance', message: pure }, { name: 'process', message: pure },
        { name: 'setTimeout', message: pure }, { name: 'setInterval', message: pure }],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: pure }],
      'no-restricted-imports': ['error', { patterns: [{ group: ['node:*', '@aws-sdk/*', 'fs', 'path', 'crypto'], message: pure }] }],
    },
  },
);
