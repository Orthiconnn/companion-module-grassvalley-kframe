import {
	FixupNumericOrVariablesValueToExpressions,
	type CompanionMigrationOptionValues,
	type CompanionStaticUpgradeProps,
	type CompanionStaticUpgradeResult,
	type CompanionStaticUpgradeScript,
	type CompanionUpgradeContext,
} from '@companion-module/base'
import { maximumRetries, type ModuleConfig } from './config.js'

type LegacyConfig = ModuleConfig & {
	suite?: string
	_legacySuite?: string
	keepaliveInterval?: number
	maxRetries?: number
}

const literal = (value: string | number | boolean) => ({ value, isExpression: false as const })

function legacySuite(config: LegacyConfig | null): string {
	const match = /^suite([1-4])[ab]$/.exec(String(config?.suite ?? config?._legacySuite ?? ''))
	return match ? `suite${match[1]}a` : 'suite1a'
}

function numericOption(options: CompanionMigrationOptionValues, key: string, fallback: number) {
	return FixupNumericOrVariablesValueToExpressions(options[key]) ?? literal(fallback)
}

/**
 * Upgrade the published grassvalley-kframe 1.0.0 action/configuration shape.
 *
 * Keep this script permanently and keep it first in the array. Companion tracks
 * upgrade scripts by their array position, including across a legacyIds rename.
 */
export const UpgradeScripts: CompanionStaticUpgradeScript<ModuleConfig>[] = [
	(
		context: CompanionUpgradeContext<ModuleConfig>,
		props: CompanionStaticUpgradeProps<ModuleConfig, undefined>,
	): CompanionStaticUpgradeResult<ModuleConfig, undefined> => {
		// Companion can run the config and control portions in separate passes. Keep
		// the legacy suite available through currentConfig so later action passes do
		// not silently fall back to Suite 1.
		const oldConfig: LegacyConfig | null = props.config ?? context.currentConfig
		const suite = legacySuite(oldConfig)
		const updatedActions = []
		const updatedFeedbacks = []

		for (const action of props.actions) {
			if (action.actionId === 'macro_recall') {
				action.actionId = 'macro_play'
				action.options = {
					suite: literal(suite),
					value: numericOption(action.options, 'macroNum', 1),
					labelOverride: literal(''),
					textSize: literal(100),
					showSuite: literal(true),
				}
				updatedActions.push(action)
			} else if (action.actionId === 'aux_route' && action.options.aux === undefined) {
				const sourceMode = action.options.sourceMode
				const useVariableSource = !sourceMode?.isExpression && sourceMode?.value === 'variable'
				action.options = {
					suite: literal(suite),
					aux: numericOption(action.options, 'auxNum', 1),
					source: numericOption(action.options, useVariableSource ? 'sourceVar' : 'sourceNum', 1),
					transition: literal('cut'),
					labelOverride: literal(''),
					textSize: literal(100),
					showSuite: literal(true),
				}
				updatedActions.push(action)
			}
		}

		for (const feedback of props.feedbacks) {
			if (feedback.feedbackId === 'macro_sent') {
				feedback.feedbackId = 'macro_button_state'
				feedback.options = { automaticLabel: literal(true) }
				updatedFeedbacks.push(feedback)
			} else if (feedback.feedbackId === 'aux_sent') {
				feedback.feedbackId = 'aux_button_state'
				feedback.options = { automaticLabel: literal(true) }
				updatedFeedbacks.push(feedback)
			}
		}

		const configNeedsUpgrade =
			oldConfig !== null && ('suite' in oldConfig || 'keepaliveInterval' in oldConfig || !('suite1' in oldConfig))

		return {
			updatedConfig: configNeedsUpgrade
				? ({
						host: String(oldConfig.host ?? ''),
						suite1: suite === 'suite1a',
						suite2: suite === 'suite2a',
						suite3: suite === 'suite3a',
						suite4: suite === 'suite4a',
						maxRetries: maximumRetries(oldConfig),
						_legacySuite: oldConfig.suite,
					} as ModuleConfig)
				: null,
			updatedActions,
			updatedFeedbacks,
		}
	},
	(
		_context: CompanionUpgradeContext<ModuleConfig>,
		props: CompanionStaticUpgradeProps<ModuleConfig, undefined>,
	): CompanionStaticUpgradeResult<ModuleConfig, undefined> => {
		const updatedActions = props.actions.filter((action) => action.options.showSuite === undefined)
		for (const action of updatedActions) action.options.showSuite = literal(true)
		return {
			updatedConfig: null,
			updatedActions,
			updatedFeedbacks: [],
		}
	},
	// Index 2 was the last script of grassvalley-kframe 0.9.1 (suite fill, textSize,
	// textSize), so those connections resume at index 3. Intentionally empty.
	(): CompanionStaticUpgradeResult<ModuleConfig, undefined> => ({
		updatedConfig: null,
		updatedActions: [],
		updatedFeedbacks: [],
	}),
	// Idempotent catch-up for every earlier layout: fill only missing config keys
	// and action options. Append new scripts after this one; never reorder.
	(
		_context: CompanionUpgradeContext<ModuleConfig>,
		props: CompanionStaticUpgradeProps<ModuleConfig, undefined>,
	): CompanionStaticUpgradeResult<ModuleConfig, undefined> => {
		const config = props.config as Partial<ModuleConfig> | null
		let updatedConfig: ModuleConfig | null = null
		const suiteKeys = ['suite1', 'suite2', 'suite3', 'suite4'] as const
		if (config && (suiteKeys.some((key) => typeof config[key] !== 'boolean') || config.maxRetries === undefined)) {
			const referenced = new Set(
				props.actions.map((action) => {
					const suite = action.options.suite?.value
					return typeof suite === 'string' ? /^suite([1-4])a$/.exec(suite)?.[1] : undefined
				}),
			)
			const anyReferenced = suiteKeys.some((_key, index) => referenced.has(String(index + 1)))
			const suiteValue = (index: number): boolean => {
				const current = config[suiteKeys[index]]
				if (typeof current === 'boolean') return current
				return anyReferenced ? referenced.has(String(index + 1)) : index === 0
			}
			updatedConfig = {
				...(config as ModuleConfig),
				host: String(config.host ?? ''),
				suite1: suiteValue(0),
				suite2: suiteValue(1),
				suite3: suiteValue(2),
				suite4: suiteValue(3),
				maxRetries: maximumRetries(config),
			}
		}
		const updatedActions = props.actions.filter(
			(action) => action.options.showSuite === undefined || action.options.textSize === undefined,
		)
		for (const action of updatedActions) {
			action.options.showSuite ??= literal(true)
			action.options.textSize ??= literal(100)
		}
		return {
			updatedConfig,
			updatedActions,
			updatedFeedbacks: [],
		}
	},
]
