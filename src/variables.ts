import type ModuleInstance from './main.js'

export type VariablesSchema = {
	connection_status: string
	protocol: string
	frame_version: string
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	self.setVariableDefinitions({
		connection_status: { name: 'Connection status' },
		protocol: { name: 'Active protocol' },
		frame_version: { name: 'Frame version' },
	})
}
