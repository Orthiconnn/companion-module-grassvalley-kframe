import type {
	CompanionStaticUpgradeProps,
	CompanionStaticUpgradeResult,
	CompanionStaticUpgradeScript,
	CompanionUpgradeContext,
} from '@companion-module/base'
import type { ModuleConfig } from './config.js'

export const UpgradeScripts: CompanionStaticUpgradeScript<ModuleConfig>[] = [
	(
		_context: CompanionUpgradeContext<ModuleConfig>,
		props: CompanionStaticUpgradeProps<ModuleConfig, undefined>,
	): CompanionStaticUpgradeResult<ModuleConfig, undefined> => {
		const legacySuite = props.config && 'suite' in props.config ? String(props.config.suite) : ''
		const suite = /^suite[1-4]a$/.test(legacySuite) ? legacySuite : 'suite1a'
		const updatedActions = props.actions.filter((action) => action.options.suite === undefined)
		const updatedFeedbacks = props.feedbacks.filter((feedback) => feedback.options.suite === undefined)
		for (const action of updatedActions) action.options.suite = { value: suite, isExpression: false }
		for (const feedback of updatedFeedbacks) feedback.options.suite = { value: suite, isExpression: false }
		return {
			updatedConfig: props.config ? { host: props.config.host } : null,
			updatedActions,
			updatedFeedbacks,
		}
	},
	(
		_context: CompanionUpgradeContext<ModuleConfig>,
		props: CompanionStaticUpgradeProps<ModuleConfig, undefined>,
	): CompanionStaticUpgradeResult<ModuleConfig, undefined> => {
		const updatedActions = props.actions.filter((action) => action.options.textSize === undefined)
		for (const action of updatedActions) action.options.textSize = { value: 100, isExpression: false }
		return {
			updatedConfig: null,
			updatedActions,
			updatedFeedbacks: [],
		}
	},
	(
		_context: CompanionUpgradeContext<ModuleConfig>,
		props: CompanionStaticUpgradeProps<ModuleConfig, undefined>,
	): CompanionStaticUpgradeResult<ModuleConfig, undefined> => {
		const updatedActions = props.actions.filter((action) => action.options.textSize === undefined)
		for (const action of updatedActions) action.options.textSize = { value: 100, isExpression: false }
		return {
			updatedConfig: null,
			updatedActions,
			updatedFeedbacks: [],
		}
	},
]
