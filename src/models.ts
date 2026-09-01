import type { ProviderConfig } from "@earendil-works/pi-coding-agent";

export const PROVIDER_ID = "yandex-ai-studio";
export const PROVIDER_NAME = "Yandex AI Studio";

/**
 * Yandex AI Studio's OpenAI-compatible endpoint. Pi appends
 * `/chat/completions` for the `openai-completions` API, which matches
 * https://ai.api.cloud.yandex.net/v1/chat/completions.
 */
export const BASE_URL = "https://ai.api.cloud.yandex.net/v1";

interface AliceModelDef {
	/** Model name as used in the `gpt://<folder>/<model>` URI. */
	id: string;
	/** Display name in pi's model picker. */
	name: string;
	/** Context window (input tokens) per AI Studio docs. */
	contextWindow: number;
	/** Max output tokens pi requests per response. */
	maxTokens: number;
	/**
	 * Official AI Studio pricing, sync mode incl. VAT, ₽ per 1M tokens
	 * (https://aistudio.yandex.ru/ru/docs/ai-studio/pricing).
	 */
	cost: { input: number; output: number; cacheRead: number };
}

const ALICE_MODELS: AliceModelDef[] = [
	// 131,072-token context; output cap not documented — kept at Yandex's
	// default max_tokens of 8,192.
	// 0.50 ₽/1K input, 0.50 ₽/1K cached input, 1.20 ₽/1K output
	{
		id: "aliceai-llm/latest",
		name: "Alice AI LLM",
		contextWindow: 131072,
		maxTokens: 8192,
		cost: { input: 500, output: 1200, cacheRead: 500 },
	},
	// 65,536-token input context; output up to 16,384 tokens.
	// 0.10 ₽/1K input, 0.025 ₽/1K cached input, 0.20 ₽/1K output
	{
		id: "aliceai-llm-flash/latest",
		name: "Alice AI LLM Flash",
		contextWindow: 65536,
		maxTokens: 16384,
		cost: { input: 100, output: 200, cacheRead: 25 },
	},
];

/**
 * Build the provider config for a Yandex Cloud folder.
 *
 * `apiKey` may be a literal key, a `$ENV_VAR` reference, or a `!command`
 * (pi resolves all three forms itself).
 */
export function buildProviderConfig(folderId: string, apiKey: string): ProviderConfig {
	return {
		name: PROVIDER_NAME,
		baseUrl: BASE_URL,
		apiKey,
		api: "openai-completions",
		headers: {
			// Same header the official OpenAI-SDK examples set via `project=`.
			// The folder is also embedded in each model URI below.
			"OpenAI-Project": folderId,
		},
		models: ALICE_MODELS.map((model) => ({
			id: `gpt://${folderId}/${model.id}`,
			name: model.name,
			reasoning: false,
			input: ["text"],
			// Rates are in rubles per million tokens; the extension's footer
			// renders session spend with a ₽ prefix while a Yandex model is
			// active. (Yandex bills per 1K tokens; "tool tokens" aren't
			// representable in pi's cost model and are ignored.)
			cost: { input: model.cost.input, output: model.cost.output, cacheRead: model.cost.cacheRead, cacheWrite: 0 },
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			compat: {
				// Yandex's OpenAI-compatible endpoint is close to the classic
				// (2023-era) OpenAI surface: no `store`, no `developer` role,
				// `max_tokens` instead of `max_completion_tokens`, no `strict`
				// tool calls, and reasoning is exposed outside the standard
				// `reasoning_effort` parameter. Keep these flags in sync with
				// Yandex's API reference if requests start failing.
				supportsStore: false,
				supportsDeveloperRole: false,
				supportsReasoningEffort: false,
				supportsStrictMode: false,
				maxTokensField: "max_tokens",
			},
		})),
	};
}
