import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const config = await generateEslintConfig({ enableTypescript: true })

export default [
	...config,
	{
		// Tests import the built module from dist/ and are never published.
		files: ['test/**'],
		rules: {
			'n/no-missing-import': 'off',
			'n/no-missing-require': 'off',
			'n/no-unpublished-import': 'off',
			'n/no-unpublished-require': 'off',
			'n/no-process-exit': 'off',
		},
	},
	{
		files: ['**/*.cjs'],
		rules: { '@typescript-eslint/no-require-imports': 'off' },
	},
	{
		// CommonJS TypeScript (.cts): with verbatimModuleSyntax, `import x = require()` is the
		// typed import form, and it compiles to a plain require().
		files: ['**/*.cts'],
		rules: { '@typescript-eslint/no-require-imports': ['error', { allowAsImport: true }] },
	},
]
