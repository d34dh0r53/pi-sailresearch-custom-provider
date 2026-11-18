# Sail Research provider for pi

A [pi package](https://pi.dev/docs/packages) that registers [Sail Research](https://sailresearch.com) chat models through the stable OpenAI Responses API.

- **ASAP** (`sailresearch`) for low-latency interactive use.
- **Balanced** (`sailresearch-balanced`) for lower-cost, latency-tolerant agent runs.
- Native `/login` support with credentials in pi's standard `auth.json`.
- Published per-tier input, output, and cache-read pricing.
- Text/image capabilities and per-request image limits from Sail's catalog.
- Reasoning levels from `minimal` through `max`; GLM-5.3 correctly disallows `off`.
- One-hour automatic prompt-cache metadata.
- No runtime dependencies or copied streaming implementation: requests use pi's built-in OpenAI Responses adapter.

## Install

```sh
pi install git:github.com/d34dh0r53/pi-sailresearch-custom-provider
```

For local development:

```sh
pi -e /path/to/pi-sailresearch-custom-provider
```

## Authenticate

Create a key in the [Sail dashboard](https://app.sailresearch.com/api-keys). Then, inside pi, run `/login` and select the Sail provider, or select it directly:

```text
/login sailresearch
/login sailresearch-balanced
```

Enter the key at the secret prompt. No environment variable is needed. ASAP and Balanced are separate provider IDs and therefore have separate credentials; log in only to the tier or tiers you use.

Pi stores the key in `~/.pi/agent/auth.json` using its standard API-key credential format and creates the file with owner-only permissions:

```json
{
  "sailresearch": {
    "type": "api_key",
    "key": "..."
  }
}
```

Use `/logout sailresearch` or `/logout sailresearch-balanced` to remove a stored credential. Keep `auth.json` private and out of source control.

For CI or other environments where an injected secret is preferable, `SAIL_API_KEY` remains an optional fallback:

```sh
export SAIL_API_KEY='your-key'
```

A stored credential takes precedence over the environment fallback. The extension never logs either value.

## Select a model

Open `/model` in pi and search for **Sail Research**, or select one directly:

```sh
# Low-latency ASAP
pi --model 'sailresearch/zai-org/GLM-5.3'

# Lower-cost Balanced
pi --model 'sailresearch-balanced/zai-org/GLM-5.3'
```

Select thinking with `/thinking` or the model suffix:

```sh
pi --model 'sailresearch/zai-org/GLM-5.3:high'
```

List the registered catalog:

```sh
pi --list-models sailresearch
```

## Included models

| Upstream model ID | Display name | Input | Context |
| --- | --- | --- | ---: |
| `moonshotai/Kimi-K3.1-Pro` | Kimi K3.1 Pro | Text, image | 1M |
| `zai-org/GLM-5.3` | GLM-5.3 | Text | 1M |
| `zai-org/GLM-5.3-Flash` | GLM-5.3 Flash | Text, image | 1M |
| `deepseek-ai/DeepSeek-V4.1-Flash-1017` | DeepSeek V4.1 Flash 1017 | Text, image | 1M |
| `deepseek-ai/DeepSeek-V4-Pro-0813` | DeepSeek V4 Pro 0813 | Text | 1M |
| `deepseek-ai/DeepSeek-V4-Flash-0731` | DeepSeek V4 Flash 0731 | Text | 1M |
| `google/gemma-4-31B-it` | Gemma 4 31B IT | Text, image | 262K |
| `nvidia/Gemma-4-31B-IT-NVFP4` | Gemma 4 31B IT (NVFP4) | Text, image | 262K |
| `google/gemma-4-12B-it` | Gemma 4 12B IT | Text | 16K |

The upstream ID is sent unchanged in either pi provider. `samplingParams.service_tier` carries `asap` or `balanced`; pi's `models.json` overrides can still customize endpoint or model metadata. Output ceilings are conservative pi-side defaults (128K for 1M-context models, 64K for 262K models, and 8K for the 16K model), intended to avoid over-reserving Sail's context window; adjust them through `modelOverrides` if needed.

### Why no Flex?

Sail's Flex tier only supports non-streaming background Responses requests (or the Batch API). pi's standard provider flow expects a foreground stream, so this package intentionally omits Flex and the Flex-only `Qwen/Qwen3.6-35B-A3B` model rather than exposing models that would fail when selected.

ASAP can reject Responses custom tools. Select Balanced for a workflow that needs those; ordinary function tools used by pi are supported on both registered tiers.

## Development

```sh
npm install
npm run check
```

The default tests do not make network requests and use a temporary `auth.json` for login, storage, precedence, permissions, and logout checks. To run two small live requests (ordinary text and forced function calling) against Sail using your stored credential or environment fallback:

```sh
SAIL_API_KEY='your-key' npm run test:live
```

The live test defaults to `deepseek-ai/DeepSeek-V4.1-Flash-1017`. Override it with `SAIL_LIVE_MODEL` and allow up to five minutes for the Balanced test. Live requests consume Sail credits.

## Updating the catalog

Model metadata lives in [`models.ts`](./models.ts). Check Sail's [models](https://docs.sailresearch.com/models), [pricing](https://docs.sailresearch.com/pricing), [service tiers](https://docs.sailresearch.com/service-tiers), and [API support matrix](https://docs.sailresearch.com/support) before changing it. In particular, update both ASAP and Balanced prices together and do not add Flex-only models to these foreground providers.

## License

MIT
