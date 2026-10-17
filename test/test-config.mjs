import assert from 'node:assert/strict'
import { DEFAULT_MAX_RETRIES, GetConfigFields, maximumRetries, suiteEnabled } from '../dist/config.js'

const fields = GetConfigFields()
assert.deepEqual(
	fields.map((field) => field.id),
	['host', 'suite1', 'suite2', 'suite3', 'suite4', 'maxRetries'],
)
assert.equal(suiteEnabled({}, 1), true)
assert.equal(suiteEnabled({}, 2), false)
assert.equal(suiteEnabled({ suite2: true }, 2), true)
assert.equal(maximumRetries({}), DEFAULT_MAX_RETRIES)
assert.equal(maximumRetries({ maxRetries: -4 }), 0)
assert.equal(maximumRetries({ maxRetries: 99 }), 20)

console.log('Connection configuration fields and defaults passed')
