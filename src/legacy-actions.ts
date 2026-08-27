let messageId = Math.floor(Math.random() * 0x10000)

function nextMessageId(): string {
	messageId = (messageId + 1) & 0xffff
	return messageId.toString(16).padStart(4, '0')
}

function pbusCode(pbus: number): string {
	if (!Number.isInteger(pbus) || pbus < 1 || pbus > 24) throw new Error('PBUS must be 1–24')
	const index = pbus - 1
	return (((Math.floor(index / 16) * 0x10) << 8) | (index % 16)).toString(16).padStart(4, '0')
}

export function buildRun(target: string): string {
	if (target === 'MASTER') return `0004${nextMessageId()}00020005000000080000000f0002000035000001`
	const [engine, modeName] = target.split('-')
	const engineIndex: Record<string, number> = { ME1: 0, ME2: 1, ME3: 2, PGM: 3, ME4: 4, eDPM: 10 }
	const modeIndex: Record<string, number> = { PRI: 0, SEC: 1, BOTH: 2 }
	if (engineIndex[engine] === undefined || modeIndex[modeName] === undefined) throw new Error('Invalid RUN target')
	const suffix = ((engineIndex[engine] << 8) | modeIndex[modeName]).toString(16).padStart(8, '0')
	return `0004${nextMessageId()}0002000500000009000000100002000002${suffix}`
}

export function buildGpi(gpi: number): string {
	if (!Number.isInteger(gpi) || gpi < 1 || gpi > 40) throw new Error('GPI must be 1–40')
	return `0004${nextMessageId()}00020005000000080000000f00020000633d00${(gpi - 1).toString(16).padStart(2, '0')}`
}

export function buildPbusRecall(pbus: number, register: number): [string, string] {
	if (!Number.isInteger(register) || register < 0 || register > 299) throw new Error('Register must be 0–299')
	const code = pbusCode(pbus)
	return [
		`0004${nextMessageId()}000200060000000a00000012145301006000${code}${register.toString(16).padStart(4, '0')}`,
		`0004${nextMessageId()}00020005000000080000000f008e00006000${code}`,
	]
}

export function buildPbusTrigger(pbus: number, trigger: number): [string, string, string] {
	if (!Number.isInteger(trigger) || trigger < 0 || trigger > 12) throw new Error('Trigger must be 0–12')
	const index = pbus - 1
	pbusCode(pbus)
	const prefix = (Math.floor(index / 16) * 0x10).toString(16).padStart(2, '0')
	const selector = (trigger * 16 + (index % 16)).toString(16).padStart(2, '0')
	const select = (on: boolean) =>
		`0004${nextMessageId()}000200060000000900000011118805003c00${prefix}${selector}${on ? '01' : '00'}`
	const fire = `0004${nextMessageId()}00020005000000080000000f000200003c00${pbusCode(pbus)}`
	return [select(false), select(true), fire]
}

export function buildButtonMapping(bus: string, shift: number, button: number, source: number): string {
	const busFields: Record<string, number> = { program: 0x30, me1: 0x00, me2: 0x10, me3: 0x20, me4: 0x40, aux: 0x50 }
	if (busFields[bus] === undefined) throw new Error('Invalid bus')
	if (!Number.isInteger(shift) || shift < 1 || shift > 4) throw new Error('Shift must be 1–4')
	if (!Number.isInteger(button) || button < 1 || button > 35) throw new Error('Button must be 1–35')
	if (!Number.isInteger(source) || source < 1 || source > 809) throw new Error('Source must be 1–809')
	const address = 0x0010 + (button - 1) * 0x10 + (shift - 1) * 0x0230
	return `0004${nextMessageId()}000200060000000a000000121385010089${address.toString(16).padStart(4, '0')}${busFields[bus].toString(16).padStart(2, '0')}${source.toString(16).padStart(4, '0')}`
}
