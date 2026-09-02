import base from '@kampi/config/eslint/base.js';

export default [
  ...base,
  {
    ignores: ['dist/**', 'playwright-report/**', 'test-results/**'],
  },
];
