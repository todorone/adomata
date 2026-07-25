import globals from 'globals'
import configPrettier from 'eslint-config-prettier'
import configStandard from 'eslint-config-standard'
import pluginN from 'eslint-plugin-n'
import pluginPromise from 'eslint-plugin-promise'
import pluginReact from 'eslint-plugin-react'
import pluginImport from 'eslint-plugin-import'
import pluginReactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

/** @type {import('eslint').Linter.FlatConfig[]} */
export default tseslint.config(
	...tseslint.configs.recommended,
	{
		files: ['apps/api/src/client/**/*.ts'],
		ignores: ['apps/api/src/client/app-type.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{ group: ['hono', 'hono/*'], message: '`@adomata/api/client` must not import Hono runtime.' },
						{ group: ['cloudflare:*'], message: 'No Worker-runtime imports allowed in client/.' },
						{
							group: ['../routes/*', '../logic/*', '../index'],
							message: 'client/ is a leaf; import only db/schema, scalars, zod, and drizzle-zod.',
						},
					],
				},
			],
		},
	},
	{
		files: ['**/*.js', '**/*.ts', '**/*.tsx'],
		linterOptions: { reportUnusedDisableDirectives: 'error' },
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.commonjs,
				...globals.jest,
				__DEV__: 'readonly',
			},
			parser: tseslint.parser,
			parserOptions: {
				ecmaFeatures: {
					jsx: true,
				},
			},
		},
		plugins: {
			import: pluginImport,
			n: pluginN,
			promise: pluginPromise,
			react: pluginReact,
			'@typescript-eslint': tseslint.plugin,
			'react-hooks': pluginReactHooks,
		},
		rules: {
			...configStandard.rules,
			...pluginReact.configs.recommended.rules,
			...pluginReactHooks.configs.recommended.rules,
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-require-imports': 'off',
			'no-undef': 'off',
			'no-unused-vars': 'off',
			'no-use-before-define': 'off',
			'no-redeclare': 'off',
			'react/prop-types': 'off',
			'react/react-in-jsx-scope': 'off',
		},
		settings: {
			react: {
				version: '19.2',
			},
		},
	},
	configPrettier,
)
