import assert from "node:assert/strict";
import test from "node:test";
import type { Provider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import sailResearchExtension, {
	SAIL_BALANCED_PROVIDER_ID,
	SAIL_PROVIDER_ID,
} from "../index.ts";
import {
	createSailModels,
	createSailProvider,
	SAIL_BASE_URL,
	SAIL_MODELS,
} from "../models.ts";

function registerProviders(): Map<string, Provider> {
	const registrations = new Map<string, Provider>();
	const pi = {
		registerProvider(provider: Provider) {
			registrations.set(provider.id, provider);
		},
	} as unknown as ExtensionAPI;

	sailResearchExtension(pi);
	return registrations;
}

test("registers foreground ASAP and Balanced providers", () => {
	const providers = registerProviders();
	assert.deepEqual([...providers.keys()], [SAIL_PROVIDER_ID, SAIL_BALANCED_PROVIDER_ID]);

	const asap = providers.get(SAIL_PROVIDER_ID)!;
	const balanced = providers.get(SAIL_BALANCED_PROVIDER_ID)!;
	assert.equal(asap.name, "Sail Research (ASAP)");
	assert.equal(balanced.name, "Sail Research (Balanced)");

	for (const provider of [asap, balanced]) {
		const models = provider.getModels();
		assert.equal(provider.baseUrl, SAIL_BASE_URL);
		assert.equal(models.length, 9);
		assert.ok(models.every((model) => model.api === "openai-responses"));
		assert.ok(models.every((model) => model.provider === provider.id));
		assert.equal(provider.auth.apiKey?.name, "Sail Research API key");
		assert.equal(typeof provider.auth.apiKey?.login, "function");
	}
});

test("keeps upstream model IDs unchanged and applies the tier in each request", () => {
	const providers = registerProviders();
	const asap = [...providers.get(SAIL_PROVIDER_ID)!.getModels()];
	const balanced = [...providers.get(SAIL_BALANCED_PROVIDER_ID)!.getModels()];

	assert.deepEqual(asap.map((model) => model.id), SAIL_MODELS.map((model) => model.id));
	assert.deepEqual(balanced.map((model) => model.id), SAIL_MODELS.map((model) => model.id));
	assert.ok(asap.every((model) => model.samplingParams?.service_tier === "asap"));
	assert.ok(balanced.every((model) => model.samplingParams?.service_tier === "balanced"));
	assert.ok(asap.every((model) => model.reasoning));
	assert.notEqual(asap[0]!, balanced[0]!, "providers do not share mutable model objects");
	assert.ok(!asap.some((model) => model.id === "Qwen/Qwen3.6-35B-A3B"), "omits Flex-only models");
});

test("uses each tier's published prices, including cache reads", () => {
	const asap = createSailModels("asap");
	const balanced = createSailModels("balanced");
	const glm = asap.find((model) => model.id === "zai-org/GLM-5.3")!;
	const balancedGlm = balanced.find((model) => model.id === "zai-org/GLM-5.3")!;

	assert.deepEqual(glm.cost, { input: 0.98, output: 3.08, cacheRead: 0.18, cacheWrite: 0 });
	assert.deepEqual(balancedGlm.cost, { input: 0.5, output: 2.5, cacheRead: 0.12, cacheWrite: 0 });

	const deepseek = asap.find((model) => model.id === "deepseek-ai/DeepSeek-V4.1-Flash-1017")!;
	assert.equal(deepseek.cost.cacheRead, 0.006);
	assert.ok([...asap, ...balanced].every((model) => model.cost.cacheWrite === 0));
	assert.ok([...asap, ...balanced].every((model) => model.promptCache?.short === 3600));
});

test("declares model modalities and image limits from the Sail catalog", () => {
	const models = createSailModels("asap");
	const kimi = models.find((model) => model.id === "moonshotai/Kimi-K3.1-Pro")!;
	const glm = models.find((model) => model.id === "zai-org/GLM-5.3")!;
	const glmFlash = models.find((model) => model.id === "zai-org/GLM-5.3-Flash")!;
	const deepseek = models.find((model) => model.id === "deepseek-ai/DeepSeek-V4.1-Flash-1017")!;

	assert.deepEqual(kimi.input, ["text", "image"]);
	assert.equal(kimi.inputLimits?.images?.maxPerRequest, 20);
	assert.deepEqual(glm.input, ["text"]);
	assert.equal(glm.inputLimits?.images, undefined);
	assert.equal(glmFlash.inputLimits?.images?.maxPerRequest, 8);
	assert.equal(deepseek.inputLimits?.images?.maxPerRequest, 6);
	assert.ok(models.every((model) => model.inputLimits?.maxRequestBytes === 256 * 1024 * 1024));
});

test("declares all Sail reasoning levels and disables off only for GLM-5.3", () => {
	const models = createSailModels("asap");
	for (const model of models) {
		assert.equal(model.thinkingLevelMap?.minimal, "minimal");
		assert.equal(model.thinkingLevelMap?.low, "low");
		assert.equal(model.thinkingLevelMap?.medium, "medium");
		assert.equal(model.thinkingLevelMap?.high, "high");
		assert.equal(model.thinkingLevelMap?.xhigh, "xhigh");
		assert.equal(model.thinkingLevelMap?.max, "max");
		assert.equal(
			model.thinkingLevelMap?.off,
			model.id === "zai-org/GLM-5.3" ? null : "none",
		);
		assert.equal(model.compat?.supportsStrictMode, true);
		assert.equal(model.compat?.supportsLongCacheRetention, false);
	}
});

test("sets context and output ceilings without sharing nested metadata", () => {
	const first = createSailModels("asap");
	const second = createSailModels("asap");
	const gemma = first.find((model) => model.id === "google/gemma-4-12B-it")!;
	assert.equal(gemma.contextWindow, 16_384);
	assert.equal(gemma.maxTokens, 8_192);

	for (const model of first) {
		assert.ok(model.maxTokens > 0);
		assert.ok(model.maxTokens <= model.contextWindow);
	}
	assert.equal(first.find((model) => model.id === "moonshotai/Kimi-K3.1-Pro")!.maxTokens, 131_072);
	assert.equal(first.find((model) => model.id === "google/gemma-4-31B-it")!.maxTokens, 65_536);
	assert.notEqual(first[0]!, second[0]!);
	assert.notEqual(first[0]!.cost, second[0]!.cost);
	assert.notEqual(first[0]!.samplingParams, second[0]!.samplingParams);
});

test("provider catalogs are independent", () => {
	const first = createSailProvider("sailresearch", "Sail Research (ASAP)", "asap");
	const second = createSailProvider("sailresearch-balanced", "Sail Research (Balanced)", "balanced");
	assert.notEqual(first.getModels(), second.getModels());
	assert.equal(first.getModels()[0]!.samplingParams?.service_tier, "asap");
	assert.equal(second.getModels()[0]!.samplingParams?.service_tier, "balanced");
});
