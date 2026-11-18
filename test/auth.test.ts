import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AuthInteraction } from "@earendil-works/pi-ai";
import { ModelRuntime, readStoredCredential } from "@earendil-works/pi-coding-agent";
import { SAIL_PROVIDER_ID } from "../index.ts";
import { createSailProvider, SAIL_API_KEY_ENV } from "../models.ts";

test("native auth resolves SAIL_API_KEY as a fallback and stored keys first", async () => {
	const provider = createSailProvider(SAIL_PROVIDER_ID, "Sail Research (ASAP)", "asap");
	const auth = provider.auth.apiKey!;
	const signal = new AbortController().signal;
	const ctx = {
		env: async (name: string) => name === SAIL_API_KEY_ENV ? "environment-test-key" : undefined,
		fileExists: async () => false,
	};

	const environment = await auth.resolve({ ctx, signal });
	assert.equal(environment?.auth.apiKey, "environment-test-key");
	assert.equal(environment?.source, SAIL_API_KEY_ENV);

	const stored = await auth.resolve({
		ctx,
		credential: { type: "api_key", key: "stored-test-key" },
		signal,
	});
	assert.equal(stored?.auth.apiKey, "stored-test-key");
	assert.equal(stored?.source, "stored credential");
});

test("login persists an API key in auth.json without using the real credential store", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "pi-sail-auth-"));
	t.after(async () => rm(directory, { recursive: true, force: true }));
	const authPath = join(directory, "auth.json");
	const runtime = await ModelRuntime.create({
		authPath,
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	runtime.registerNativeProvider(
		createSailProvider(SAIL_PROVIDER_ID, "Sail Research (ASAP)", "asap"),
	);

	let secretPromptSeen = false;
	const interaction: AuthInteraction = {
		prompt: async (prompt) => {
			assert.equal(prompt.type, "secret");
			secretPromptSeen = true;
			return "stored-test-key";
		},
		notify: () => assert.fail("API-key login should not emit notifications"),
	};
	const credential = await runtime.login(SAIL_PROVIDER_ID, "api_key", interaction);
	assert.deepEqual(credential, { type: "api_key", key: "stored-test-key" });
	assert.equal(secretPromptSeen, true);

	const stored = readStoredCredential(SAIL_PROVIDER_ID, authPath);
	assert.deepEqual(stored, { type: "api_key", key: "stored-test-key" });
	const file = JSON.parse(await readFile(authPath, "utf8")) as Record<string, unknown>;
	assert.deepEqual(file[SAIL_PROVIDER_ID], { type: "api_key", key: "stored-test-key" });
	assert.equal((await stat(authPath)).mode & 0o777, 0o600);

	const resolved = await runtime.getAuth(SAIL_PROVIDER_ID);
	assert.equal(resolved?.auth.apiKey, "stored-test-key");
	assert.equal(resolved?.source, "stored credential");

	await runtime.logout(SAIL_PROVIDER_ID);
	assert.equal(readStoredCredential(SAIL_PROVIDER_ID, authPath), undefined);
});
