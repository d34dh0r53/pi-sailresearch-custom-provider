import {
	createProvider,
	envApiKeyAuth,
	type Model,
	openAIResponsesApi,
	type Provider,
} from "@earendil-works/pi-ai/compat";

export const SAIL_BASE_URL = "https://api.sailresearch.com/v1";
export const SAIL_API_KEY_ENV = "SAIL_API_KEY";

export type SailServiceTier = "asap" | "balanced";

interface SailPricing {
	input: number;
	output: number;
	cacheRead: number;
}

interface SailModelDefinition {
	id: string;
	name: string;
	contextWindow: number;
	imageInput?: boolean;
	maxImagesPerRequest?: number;
	/** GLM-5.3 rejects reasoning effort "none". */
	reasoningOff?: false;
	pricing: Record<SailServiceTier, SailPricing>;
}

export type SailChatModelConfig = Omit<
	Model<"openai-responses">,
	"api" | "provider" | "baseUrl"
>;

/**
 * Sail's foreground catalog, current as of 2026-11-18.
 * Sources: https://docs.sailresearch.com/models and /pricing.
 *
 * maxTokens uses conservative pi-side generation ceilings because Sail does
 * not document lower model-specific limits. This also avoids reserving nearly
 * the whole 1M window for output on an ordinary request. pi still clamps each
 * request to leave room for its input.
 * Flex-only models are deliberately absent: Flex requires background,
 * non-streaming Responses requests rather than pi's foreground stream.
 */
export const SAIL_MODELS: readonly SailModelDefinition[] = [
	{
		id: "moonshotai/Kimi-K3.1-Pro",
		name: "Kimi K3.1 Pro",
		contextWindow: 1_048_576,
		imageInput: true,
		pricing: {
			asap: { input: 1.5, cacheRead: 0.2, output: 10 },
			balanced: { input: 1.2, cacheRead: 0.15, output: 8 },
		},
	},
	{
		id: "zai-org/GLM-5.3",
		name: "GLM-5.3",
		contextWindow: 1_048_576,
		reasoningOff: false,
		pricing: {
			asap: { input: 0.98, cacheRead: 0.18, output: 3.08 },
			balanced: { input: 0.5, cacheRead: 0.12, output: 2.5 },
		},
	},
	{
		id: "zai-org/GLM-5.3-Flash",
		name: "GLM-5.3 Flash",
		contextWindow: 1_048_576,
		imageInput: true,
		maxImagesPerRequest: 8,
		pricing: {
			asap: { input: 0.11, cacheRead: 0.02, output: 0.35 },
			balanced: { input: 0.08, cacheRead: 0.02, output: 0.28 },
		},
	},
	{
		id: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
		name: "DeepSeek V4.1 Flash 1017",
		contextWindow: 1_048_576,
		imageInput: true,
		maxImagesPerRequest: 6,
		pricing: {
			asap: { input: 0.09, cacheRead: 0.006, output: 0.3 },
			balanced: { input: 0.07, cacheRead: 0.005, output: 0.22 },
		},
	},
	{
		id: "deepseek-ai/DeepSeek-V4-Pro-0813",
		name: "DeepSeek V4 Pro 0813",
		contextWindow: 1_048_576,
		pricing: {
			asap: { input: 0.92, cacheRead: 0.04, output: 2.77 },
			balanced: { input: 0.74, cacheRead: 0.03, output: 2.22 },
		},
	},
	{
		id: "deepseek-ai/DeepSeek-V4-Flash-0731",
		name: "DeepSeek V4 Flash 0731",
		contextWindow: 1_048_576,
		pricing: {
			asap: { input: 0.09, cacheRead: 0.02, output: 0.18 },
			balanced: { input: 0.07, cacheRead: 0.02, output: 0.14 },
		},
	},
	{
		id: "google/gemma-4-31B-it",
		name: "Gemma 4 31B IT",
		contextWindow: 262_144,
		imageInput: true,
		pricing: {
			asap: { input: 0.4, cacheRead: 0.2, output: 0.6 },
			balanced: { input: 0.12, cacheRead: 0.08, output: 0.6 },
		},
	},
	{
		id: "nvidia/Gemma-4-31B-IT-NVFP4",
		name: "Gemma 4 31B IT (NVFP4)",
		contextWindow: 262_144,
		imageInput: true,
		pricing: {
			asap: { input: 0.14, cacheRead: 0.07, output: 0.4 },
			balanced: { input: 0.11, cacheRead: 0.06, output: 0.32 },
		},
	},
	{
		id: "google/gemma-4-12B-it",
		name: "Gemma 4 12B IT",
		contextWindow: 16_384,
		pricing: {
			asap: { input: 0.3, cacheRead: 0.15, output: 2 },
			balanced: { input: 0.1, cacheRead: 0.07, output: 2 },
		},
	},
] as const;

function outputLimit(contextWindow: number): number {
	if (contextWindow <= 16_384) return 8_192;
	if (contextWindow <= 262_144) return 65_536;
	return 131_072;
}

export function createSailModels(tier: SailServiceTier): SailChatModelConfig[] {
	return SAIL_MODELS.map((model) => {
		const pricing = model.pricing[tier];
		return {
			type: "chat",
			id: model.id,
			name: model.name,
			reasoning: true,
			thinkingLevelMap: {
				off: model.reasoningOff === false ? null : "none",
				minimal: "minimal",
				low: "low",
				medium: "medium",
				high: "high",
				xhigh: "xhigh",
				max: "max",
			},
			input: model.imageInput ? ["text", "image"] : ["text"],
			inputLimits: {
				maxRequestBytes: 256 * 1024 * 1024,
				...(model.imageInput
					? { images: { maxPerRequest: model.maxImagesPerRequest ?? 20 } }
					: {}),
			},
			cost: { ...pricing, cacheWrite: 0 },
			// Sail guarantees automatic prefix-cache writes for one hour.
			promptCache: { short: 3600 },
			contextWindow: model.contextWindow,
			maxTokens: outputLimit(model.contextWindow),
			samplingParams: { service_tier: tier },
			compat: {
				supportsStrictMode: true,
				// Sail's optional 24-hour Supercache is not prompt_cache_retention.
				supportsLongCacheRetention: false,
			},
		};
	});
}

export function createSailProvider(
	id: string,
	name: string,
	tier: SailServiceTier,
): Provider<"openai-responses"> {
	const models: Model<"openai-responses">[] = createSailModels(tier).map((model) => ({
		...model,
		api: "openai-responses",
		provider: id,
		baseUrl: SAIL_BASE_URL,
	}));

	return createProvider({
		id,
		name,
		baseUrl: SAIL_BASE_URL,
		auth: { apiKey: envApiKeyAuth("Sail Research API key", [SAIL_API_KEY_ENV]) },
		models,
		api: openAIResponsesApi(),
	});
}
