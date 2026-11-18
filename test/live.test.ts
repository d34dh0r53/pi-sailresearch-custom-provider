import assert from "node:assert/strict";
import test from "node:test";
import type {
	AssistantMessage,
	Context,
	Model,
	OpenAIResponsesOptions,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { SAIL_BALANCED_PROVIDER_ID, SAIL_PROVIDER_ID } from "../index.ts";
import { createSailProvider, type SailServiceTier } from "../models.ts";

const LIVE = process.env.SAIL_LIVE_TEST === "1";
const MODEL_ID = process.env.SAIL_LIVE_MODEL ?? "deepseek-ai/DeepSeek-V4.1-Flash-1017";

async function liveRuntime(tier: SailServiceTier): Promise<{
	runtime: ModelRuntime;
	model: Model<"openai-responses">;
}> {
	const runtime = await ModelRuntime.create({
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const providerId = tier === "asap" ? SAIL_PROVIDER_ID : SAIL_BALANCED_PROVIDER_ID;
	const provider = createSailProvider(providerId, `Sail Research ${tier}`, tier);
	runtime.registerNativeProvider(provider);
	const model = provider.getModels().find((candidate) => candidate.id === MODEL_ID);
	assert.ok(model, `Unknown live-test model: ${MODEL_ID}`);
	return { runtime, model };
}

function assertSuccessful(message: AssistantMessage) {
	assert.notEqual(message.stopReason, "error", message.errorMessage);
	assert.notEqual(message.stopReason, "aborted", message.errorMessage);
	assert.ok(message.usage.input > 0);
	assert.ok(message.usage.output > 0);
	assert.ok(message.usage.totalTokens > 0);
	assert.ok(message.usage.cost.total > 0);
}

test("live ASAP response sends the expected payload and accounts for usage", {
	skip: LIVE ? false : "Set SAIL_LIVE_TEST=1 (or use npm run test:live)",
	timeout: 180_000,
}, async () => {
	const { runtime, model } = await liveRuntime("asap");
	let payload: Record<string, unknown> | undefined;
	const context: Context = {
		systemPrompt: "Answer briefly and do not use tools.",
		messages: [
			{ role: "user", content: "Reply with exactly: Sail is connected", timestamp: Date.now() },
		],
	};

	const result = await runtime.completeSimple(model, context, {
		maxTokens: 128,
		reasoning: "minimal",
		signal: AbortSignal.timeout(170_000),
		onPayload(request) {
			payload = request as Record<string, unknown>;
		},
	});
	assertSuccessful(result);
	assert.ok(result.content.some((block) => block.type === "text" && block.text.includes("Sail is connected")));
	assert.equal(payload?.model, MODEL_ID);
	assert.equal(payload?.service_tier, "asap");
	assert.equal(payload?.stream, true);
	assert.ok("max_output_tokens" in payload!);
});

test("live Balanced stream supports function calling and preserves the real model ID", {
	skip: LIVE ? false : "Set SAIL_LIVE_TEST=1 (or use npm run test:live)",
	timeout: 480_000,
}, async () => {
	const { runtime, model } = await liveRuntime("balanced");
	let payload: Record<string, unknown> | undefined;
	const context: Context = {
		systemPrompt: "Use the supplied weather tool to answer.",
		messages: [
			{ role: "user", content: "What is the weather in Paris?", timestamp: Date.now() },
		],
		tools: [
			{
				name: "get_weather",
				description: "Get current weather for a city",
				parameters: {
					type: "object",
					properties: { location: { type: "string", description: "City name" } },
					required: ["location"],
					additionalProperties: false,
				},
			},
		],
	};
	const options: OpenAIResponsesOptions = {
		maxTokens: 1024,
		reasoningEffort: "minimal",
		toolChoice: "required",
		signal: AbortSignal.timeout(470_000),
		onPayload(request) {
			payload = request as Record<string, unknown>;
		},
	};

	const result = await runtime.complete(model, context, options);
	assertSuccessful(result);
	const toolCall = result.content.find((block) => block.type === "toolCall");
	assert.ok(toolCall, "Expected a function call");
	assert.equal(toolCall.name, "get_weather");
	assert.match(String(toolCall.arguments.location), /Paris/i);
	assert.equal(result.stopReason, "toolUse");
	assert.equal(payload?.model, MODEL_ID);
	assert.equal(payload?.service_tier, "balanced");
	assert.equal(payload?.tool_choice, "required");
	assert.ok(Array.isArray(payload?.tools));
});
