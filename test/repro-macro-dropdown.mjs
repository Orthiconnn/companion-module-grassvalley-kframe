// Run: npm run build && node --test test/repro-macro-dropdown.mjs
// Synthetic frame packets through the real parser, status handler, actions and presets.
// No sockets or live frame changes. Covers later renames, additions, deletions and duplicate dumps.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import Module from '../dist/main.js'
import { protocol } from '../dist/protocol.js'

const require = createRequire(import.meta.url)
const H = require('../dist/protocol/handshake-connection-class.cjs')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function catalogPacket(macro, name, transport = 'udp') {
	const text = Buffer.from(`${name}\0`)
	const dataLength = 2 + text.length
	const packet = Buffer.alloc(44 + dataLength)
	packet.writeUInt16BE(4, 0)
	packet.writeUInt16BE(2, 4)
	packet.writeUInt16BE(0x10, 6)
	packet.writeUInt32BE(packet.length - 16, 8)
	packet.writeUInt16BE(transport === 'udp' ? 0x020f : 0x0208, 16)
	if (transport === 'tcp') {
		packet.writeUInt16BE(0x0023, 24)
		packet.writeUInt32BE(0x1a8e + macro, 32)
	}
	packet.writeUInt16BE(dataLength, 42)
	packet.writeUInt16BE(macro, 44)
	text.copy(packet, 46)
	return packet
}

for (const transport of ['udp', 'tcp']) {
	test(`${transport}: later macro catalog changes refresh dropdown and preset names`, async (t) => {
		const module = new Module({ _isInstanceContext: true, id: 'catalog-review' })
		const id = module.connectionId('suite1a')
		const connection = new H(id, '127.0.0.1', 'suite1a', {}, null, 'Review', '0', 'test')
		connection.protocol = transport
		connection.macroCatalogSubscribed = true
		let statusSubscriptions = 0
		connection.subscribeMacroStatus = () => {
			statusSubscriptions++
			connection.macroStatusSubscribed = true
		}
		let notifications = 0
		connection.emitter.on('status', (type) => {
			if (type === 'MACRO_CATALOG_READY') notifications++
		})
		let definitions, presets
		module.setActionDefinitions = (value) => {
			definitions = value
		}
		module.setPresetDefinitions = (_sections, value) => {
			presets = value
		}
		module.checkFeedbacks = () => {}
		module.setVariableValues = () => {}
		module.updateStatus = () => {}
		const originalCatalog = protocol.getMacroCatalog
		const originalName = protocol.getMacroName
		protocol.getMacroCatalog = (connectionId) => (connectionId === id ? connection.getMacroCatalog() : null)
		protocol.getMacroName = (connectionId, macro) => (connectionId === id ? connection.getMacroName(macro) : null)
		connection.emitter.on('status', (type, message) => module.handleProtocolStatus(id, type, message))
		const dropdownName = (macro) =>
			definitions.macro_play.options
				.find((option) => option.id === 'value')
				.choices.find((choice) => choice.id === macro).label
		try {
			connection.handleSubscriptionData(catalogPacket(2, 'Original name', transport))
			await delay(2600) // Initial two-second catalog debounce plus the 250ms editor refresh.
			assert.equal(dropdownName(2), '2 — Original name')
			assert.equal(dropdownName(3), 'Macro 3')
			connection.handleSubscriptionData(catalogPacket(2, 'Renamed macro', transport))
			connection.handleSubscriptionData(catalogPacket(3, 'New macro', transport))
			await delay(2600)
			assert.equal(connection.getMacroName(2), 'Renamed macro')
			assert.equal(connection.getMacroName(3), 'New macro')
			const actual = {
				dropdown2: dropdownName(2),
				dropdown3: dropdownName(3),
				preset2: presets.macro2.name,
				preset3: presets.macro3.name,
			}
			t.diagnostic(`Cache: ${JSON.stringify(connection.getMacroCatalog())}`)
			t.diagnostic(`Published dropdowns/presets: ${JSON.stringify(actual)}`)
			assert.deepEqual(actual, {
				dropdown2: '2 — Renamed macro',
				dropdown3: '3 — New macro',
				preset2: 'Renamed macro',
				preset3: 'New macro',
			})
			assert.equal(notifications, 2, 'One notification per completed changed batch')
			connection.handleSubscriptionData(catalogPacket(2, '', transport))
			await delay(2600)
			assert.equal(connection.getMacroName(2), null)
			assert.equal(dropdownName(2), 'Macro 2')
			assert.equal(presets.macro2.name, 'Macro 2')
			assert.equal(notifications, 3)
			connection.handleSubscriptionData(catalogPacket(3, 'New macro', transport))
			await delay(2600)
			assert.equal(notifications, 3, 'An unchanged dump should not republish definitions')
			assert.equal(statusSubscriptions, transport === 'udp' ? 1 : 0)
		} finally {
			connection.emitter.removeAllListeners()
			connection.cleanup()
			clearTimeout(module.macroCatalogRefreshTimer)
			protocol.getMacroCatalog = originalCatalog
			protocol.getMacroName = originalName
		}
	})
}

test('Disconnect suppresses a pending catalog refresh', async () => {
	const connection = new H('cancel-review', '127.0.0.1', 'suite1a', {}, null, 'Review', '0', 'test')
	connection.macroCatalogSubscribed = true
	let notifications = 0
	connection.emitter.on('status', (type) => {
		if (type === 'MACRO_CATALOG_READY') notifications++
	})
	connection.handleSubscriptionData(catalogPacket(2, 'Pending'))
	connection.cleanup()
	await delay(2100)
	assert.equal(notifications, 0)
	assert.equal(connection.lastPublishedMacroCatalog, null)
})

for (const mode of ['manual', 'frame']) {
	for (const remainingSuite of [false, true]) {
		test(`${mode} disconnect refreshes dropdowns and presets (${remainingSuite ? 'another suite remains' : 'last suite'})`, async () => {
			const module = new Module({ _isInstanceContext: true, id: 'disconnect-review' })
			module.config = { host: '127.0.0.1', suite1: false } // Disable automatic reconnect in this socket-free test.
			const id = module.connectionId('suite1a')
			const connection = new H(id, '127.0.0.1', 'suite1a', {}, null, 'Review', '0', 'test')
			connection.macroCatalog.set(2, { oled: 'Frame A macro' })
			connection.sourceNames.set(42, { menu: 'Frame A camera' })
			let definitions, presets
			module.setActionDefinitions = (value) => {
				definitions = value
			}
			module.setPresetDefinitions = (_sections, value) => {
				presets = value
			}
			module.checkFeedbacks = () => {}
			module.setVariableValues = () => {}
			module.updateStatus = () => {}
			module.log = () => {}
			const originals = {
				getMacroCatalog: protocol.getMacroCatalog,
				getMacroName: protocol.getMacroName,
				getSourceNames: protocol.getSourceNames,
				disconnectConnection: protocol.disconnectConnection,
			}
			protocol.getMacroCatalog = (connectionId) =>
				connectionId === id
					? connection.getMacroCatalog()
					: remainingSuite && connectionId === module.connectionId('suite2a')
						? { 2: { oled: 'Frame B macro' } }
						: null
			protocol.getMacroName = (connectionId, macro) => protocol.getMacroCatalog(connectionId)?.[macro]?.oled ?? null
			protocol.getSourceNames = (connectionId) =>
				connectionId === id
					? connection.getSourceNames()
					: remainingSuite && connectionId === module.connectionId('suite2a')
						? [{ id: 42, menu: 'Frame B camera' }]
						: []
			protocol.disconnectConnection = async () => {
				connection.cleanup()
			}
			connection.emitter.on('status', (type, message) => module.handleProtocolStatus(id, type, message))
			const label = () =>
				definitions.macro_play.options.find((option) => option.id === 'value').choices.find((choice) => choice.id === 2)
					.label
			const sourceLabel = (action) =>
				definitions[action].options.find((option) => option.id === 'source').choices.find((choice) => choice.id === 42)
					.label
			try {
				module.updateActions()
				module.updatePresets()
				assert.equal(label(), '2 — Frame A macro')
				assert.equal(presets.macro2.name, 'Frame A macro')
				for (const action of ['aux_route', 'crosspoint']) assert.equal(sourceLabel(action), '42 — Frame A camera')
				if (mode === 'manual') await module.disconnectSuite('suite1a')
				else {
					// TCP close can announce disconnect before cleanup clears the catalog.
					module.handleProtocolStatus(id, 'DISCONNECTED', 'Frame closed connection')
					connection.cleanup()
				}
				await delay(150)
				assert.equal(label(), remainingSuite ? '2 — Frame B macro' : 'Macro 2')
				assert.equal(presets.macro2.name, 'Macro 2')
				for (const action of ['aux_route', 'crosspoint'])
					assert.equal(sourceLabel(action), remainingSuite ? '42 — Frame B camera' : 'Source 42')
				assert.deepEqual(connection.getSourceNames(), [])
				assert.equal(connection.getSourceName(42), null)
				assert.equal(connection.resolveSourceDisplayName(42), null)
			} finally {
				connection.emitter.removeAllListeners()
				connection.cleanup()
				clearTimeout(module.sourceRefreshTimer)
				Object.assign(protocol, originals)
			}
		})
	}
}
