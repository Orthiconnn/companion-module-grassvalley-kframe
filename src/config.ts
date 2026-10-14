import { Regex, type SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	host: string
	suite1: boolean
	suite2: boolean
	suite3: boolean
	suite4: boolean
	maxRetries: number
}

export const DEFAULT_MAX_RETRIES = 5

export function suiteEnabled(config: Partial<ModuleConfig>, suite: number): boolean {
	const value = config[`suite${suite}` as keyof ModuleConfig]
	return typeof value === 'boolean' ? value : suite === 1
}

export function maximumRetries(config: Partial<ModuleConfig>): number {
	const value = Number(config.maxRetries)
	return Number.isFinite(value) ? Math.max(0, Math.min(20, Math.trunc(value))) : DEFAULT_MAX_RETRIES
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'textinput',
			id: 'host',
			label: 'Frame IP Address',
			width: 12,
			regex: Regex.IP,
		},
		...([1, 2, 3, 4] as const).map((suite): SomeCompanionConfigField => ({
			type: 'checkbox',
			id: `suite${suite}`,
			label: `Suite ${suite}`,
			width: 3,
			default: suite === 1,
		})),
		{
			type: 'number',
			id: 'maxRetries',
			label: 'Max Reconnection Attempts',
			width: 4,
			default: DEFAULT_MAX_RETRIES,
			min: 0,
			max: 20,
		},
	]
}
