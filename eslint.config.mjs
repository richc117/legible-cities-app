import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'release/**',
      'node_modules/**',
      '.claude/**',
      '.specify/**',
      'vendor/**',
      'docs/**',
      'specs/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // An error since issue 433 cleared its 29 places: a state that follows
      // a prop is adjusted in render, a store is read through
      // useSyncExternalStore, and what follows a press is done in the press.
      // The few that sync with something outside React say why beside the
      // line they disable it on.
      'react-hooks/set-state-in-effect': 'error',
    },
  },
  // CommonJS scripts a bare Electron runs for the tests: the capture
  // harness and the crash fixture. Node's globals, and `require`, which is
  // what an Electron main script has.
  {
    files: ['tests/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        __dirname: 'readonly',
        process: 'readonly',
        console: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        globalThis: 'readonly',
      },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
)
