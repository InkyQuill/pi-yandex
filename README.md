# pi-yandex

A [pi](https://pi.dev) extension that adds **Yandex AI Studio** as a model provider, giving pi
access to the **Alice AI LLM** models through Yandex's OpenAI-compatible API:

| Model              | URI                                          | Context  | Max output |
| ------------------ | -------------------------------------------- | -------- | ---------- |
| Alice AI LLM       | `gpt://<folder-id>/aliceai-llm/latest`       | 131,072  | 8,192      |
| Alice AI LLM Flash | `gpt://<folder-id>/aliceai-llm-flash/latest` | 65,536   | 16,384     |

## How it works

The extension registers a `yandex-ai-studio` provider via `pi.registerProvider()` pointing at
`https://ai.api.cloud.yandex.net/v1` using the `openai-completions` API. The models appear in
pi's `/model` picker (and `pi --provider yandex-ai-studio`) as soon as the extension is
configured — no restart needed.

## Install

```sh
# from the git repo
pi install git:github.com/InkyQuill/pi-yandex

# or from a local checkout
pi install /path/to/pi-yandex
```

For development, load it without installing:

```sh
pi -e /path/to/pi-yandex
```

## Setup

Start `pi` and run:

```
/yandex:setup
```

You will be prompted for:

1. **Yandex Cloud folder ID** — e.g. `b1gtsl8kn68ki8d927tt`
2. **Yandex AI Studio API key** — e.g. `AQVN...` (create one in the Yandex Cloud console under
   AI Studio → Service accounts/API keys; the service account needs the `ai.languageModels.user`
   role)

The config is saved to `~/.pi/agent/yandex.json` (permissions `0600`). Re-running
`/yandex:setup` lets you change the folder while keeping the saved key (press Enter at the key
prompt).

### Environment variables (alternative)

Instead of the config file you can set both variables — the config file wins if both are
present, and with env vars the key is never written to disk:

```sh
export YANDEX_CLOUD_FOLDER=b1gtsl8kn68ki8d927tt
export YANDEX_CLOUD_API_KEY=AQVN...
pi --provider yandex-ai-studio
```

## Usage

- Pick a model with `/model` → *Yandex AI Studio* → *Alice AI LLM* / *Alice AI LLM Flash*.
- From the CLI: `pi --provider yandex-ai-studio` (add `--model flash` to pick the Flash model).

## Implementation notes

- Uses the **Chat Completions** flavor of Yandex's OpenAI-compatible API (`/v1` +
  `/chat/completions`). The Responses API exists too, but Chat Completions is what pi's
  `openai-completions` streaming implementation targets.
- Auth uses the standard `Authorization: Bearer <api-key>` header — the same scheme as
  Yandex's own OpenAI-SDK examples. The folder ID is also sent as the `OpenAI-Project` header,
  matching the official examples.
- `compat` flags (in `src/models.ts`) disable OpenAI-specific extensions Yandex's endpoint
  doesn't document: `store`, the `developer` role, `reasoning_effort`, and `strict` tool calls;
  output limits are sent as `max_tokens`.
- Context windows per AI Studio: 131,072 tokens for Alice AI LLM, 65,536 for Flash. pi
  requests `max_tokens` = 16,384 for Flash (its documented output ceiling) and 8,192 for
  Alice AI LLM (output cap not documented; Yandex's default). Tweak these in
  `src/models.ts` if requests are ever rejected.
- Reasoning mode is **not wired up**: AI Studio exposes reasoning outside the standard
  OpenAI-compat parameters, so the models register with `reasoning: false`. Text, tools, and
  streaming usage stats work as usual.

## Spend in rubles (₽ footer)

Model `cost` rates are the official AI Studio prices (sync mode, incl. VAT), so pi's cost
math is in rubles for these models:

| Model              | Input         | Cached input   | Output        |
| ------------------ | ------------- | -------------- | ------------- |
| Alice AI LLM       | 500 ₽ / Mtok  | 500 ₽ / Mtok   | 1,200 ₽ / Mtok |
| Alice AI LLM Flash | 100 ₽ / Mtok  | 25 ₽ / Mtok    | 200 ₽ / Mtok  |

Because pi's native footer hardcodes a `$` prefix, the extension installs its own footer
(with the same layout: tokens, cache hit rate, context usage, model name) rendering the
session spend as `₽X.XXX`:

- It is active **only while the current model is a Yandex one**; switching to any other
  model (or starting pi on one) restores pi's native footer.
- The ₽ total counts only Yandex-attributed usage — messages from other providers used in
  the same session are excluded. Compaction/branch-summary calls record usage without a
  provider and can't be attributed, so they aren't counted (the total is slightly
  conservative).
- Other surfaces that display cost (e.g. HTML session export) are unaffected: they will
  show the ruble amount with pi's built-in `$` formatting.

## Development

```sh
npm install
npm run check   # tsc --noEmit
npm test        # footer render tests (requires bun)
```

Smoke-test registration without a real key:

```sh
YANDEX_CLOUD_FOLDER=<folder> YANDEX_CLOUD_API_KEY=dummy pi -e . --offline --list-models yandex
```

## References

- [Pi extensions documentation](https://pi.dev/docs/latest/extensions)
- [Pi custom providers guide](https://pi.dev/docs/latest/custom-provider)
- [Yandex AI Studio: models](https://aistudio.yandex.ru/docs/en/ai-studio/concepts/generation/)
- [Yandex AI Studio: Chat Completions API](https://aistudio.yandex.ru/docs/en/ai-studio/api/Chat-Completions/createChatCompletion)
- [Yandex AI Studio: basic completions request](https://aistudio.yandex.ru/docs/en/ai-studio/operations/generation/completions-basic)
- [Yandex AI Studio: pricing](https://aistudio.yandex.ru/ru/docs/ai-studio/pricing)
