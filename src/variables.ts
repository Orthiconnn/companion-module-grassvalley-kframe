import type ModuleInstance from './main.js'

export type VariablesSchema = Record<string, string | number>

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
			})
				.flat()
				.concat([
					// Published by grassvalley-kframe 1.0.0; upgraded buttons and expressions read them.
					['last_macro', { name: 'Last macro sent' }],
					['last_aux', { name: 'Last AUX routed' }],
					['last_aux_source', { name: 'Last AUX source' }],
				]),
		),
	)
}
