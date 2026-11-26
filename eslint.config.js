export default [
  {
    files: ['src/**/*.js', 'tests/**/*.js', 'tools/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      globals: { File: 'readonly', URL: 'readonly', TextDecoder: 'readonly' },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'error',
      'no-unreachable': 'error',
      'no-unused-expressions': 'error',
      'no-dupe-keys': 'error',
      'eqeqeq': 'error',
    },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: { globals: { document: 'readonly', HTMLInputElement: 'readonly' } },
  },
];
