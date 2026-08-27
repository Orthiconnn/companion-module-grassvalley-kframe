import type ModuleInstance from './main.js'

export type VariablesSchema = Record<string, string>

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	self.setVariableDefinitions(
		Object.fromEntries(
			Array.from({ length: 4 }, (_, i) => {
				const suite = i + 1
				return [
					[`suite${suite}_connection_status`, { name: `Suite ${suite} connection status` }],
					[`suite${suite}_protocol`, { name: `Suite ${suite} active protocol` }],
					[`suite${suite}_frame_version`, { name: `Suite ${suite} frame version` }],
				]
			}).flat(),
		),
	)
}
