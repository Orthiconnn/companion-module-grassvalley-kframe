// Raw CPL command builders for GPI, PBUS and panel button mapping. Each call takes
// the next message ID, so repeated presses are distinct frames on the wire.
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

/**
 * The frame sends PBus triggers 0-15; the device decides what each one does and
 * Eng Setup names them per device. Names follow the Lance TDC-100B function table
 * in GVG mode (TDC-100B manual p.15), the documented lab device.
 */
export const PBUS_TRIGGERS: readonly { name: string; short: string }[] = [
	{ name: 'Normal Play', short: 'PLAY' },
	{ name: 'Recue', short: 'RECUE' },
	{ name: 'Variable Play (displayed speed)', short: 'VAR PLAY' },
	{ name: 'Reverse Play at 100%', short: 'REV PLAY' },
	{ name: 'Stop', short: 'STOP' },
	{ name: 'Loop Play', short: 'LOOP' },
	{ name: 'Record', short: 'RECORD' },
	{ name: 'Normal Play', short: 'PLAY' },
	{ name: 'Multi-Point Loop Start (loop inside points)', short: 'LOOP START' },
	{ name: 'Multi-Point Loop Exit (play out to outside outpoint)', short: 'LOOP EXIT' },
	{ name: 'Select Bank 0 (registers 000-099)', short: 'BANK 0' },
	{ name: 'Select Bank 1 (registers 100-199)', short: 'BANK 1' },
	{ name: 'Select Bank 2 (registers 200-299)', short: 'BANK 2' },
	{ name: 'Normal Play', short: 'PLAY' },
	{ name: 'Normal Play', short: 'PLAY' },
	{ name: 'Normal Play', short: 'PLAY' },
]

export function buildPbusTrigger(pbus: number, trigger: number): [string, string, string] {
	if (!Number.isInteger(trigger) || trigger < 0 || trigger >= PBUS_TRIGGERS.length)
		throw new Error(`Trigger must be 0–${PBUS_TRIGGERS.length - 1}`)
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
