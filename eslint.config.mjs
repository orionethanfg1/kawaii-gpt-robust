/**
 * Minimal ESLint flat config — type-aware rules left to tsc.
 * Run: npx eslint "src/**/*.{ts,tsx}" (after npm i)
 */
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**', 'resources/**', '**/*.js']
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      'no-empty': 'off',
      'prefer-const': 'warn'
    }
  }
)
