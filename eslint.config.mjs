import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const config = await generateEslintConfig({ enableTypescript: true })

export default [{ ignores: ['src/protocol/**', 'test/**'] }, ...config]
