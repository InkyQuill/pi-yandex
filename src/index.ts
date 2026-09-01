import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getConfigPath, loadConfig, saveConfig, type YandexConfig } from "./config.ts";
import { createYandexFooterSync } from "./footer.ts";
import { buildProviderConfig, PROVIDER_ID, PROVIDER_NAME } from "./models.ts";

const FOLDER_ENV_VAR = "YANDEX_CLOUD_FOLDER";
const API_KEY_ENV_VAR = "YANDEX_CLOUD_API_KEY";

interface Setup {
	folderId: string;
	/**
	 * What gets passed to pi as the provider API key: a literal key, or a
	 * `$ENV_VAR` reference that pi resolves per request.
	 */
	apiKey: string;
}

/**
 * Credentials come from the config file first (written by /yandex:setup),
 * falling back to environment variables.
 */
function resolveSetup(): Setup | undefined {
	const config = loadConfig();
	if (config) return config;

	const folderId = process.env[FOLDER_ENV_VAR];
	const apiKey = process.env[API_KEY_ENV_VAR];
	if (folderId && apiKey) return { folderId, apiKey: `$${API_KEY_ENV_VAR}` };
	return undefined;
}

function register(pi: ExtensionAPI, setup: Setup): void {
	// Takes effect immediately, even after startup — the models show up in
	// /model without a restart.
	pi.registerProvider(PROVIDER_ID, buildProviderConfig(setup.folderId, setup.apiKey));
}

export default function (pi: ExtensionAPI) {
	const setup = resolveSetup();
	if (setup) {
		register(pi, setup);
	}

	// Show session spend in ₽ while a Yandex model is active; native $ footer
	// otherwise.
	const syncFooter = createYandexFooterSync();
	pi.on("model_select", (_event, ctx) => syncFooter(ctx));

	pi.registerCommand("yandex:setup", {
		description: `Configure the ${PROVIDER_NAME} provider (folder ID and API key)`,
		handler: async (_args, ctx) => {
			const existing = loadConfig();
			if (existing) {
				ctx.ui.notify(
					`Current config: folder ${existing.folderId}, API key saved in ${getConfigPath()}`,
					"info",
				);
			} else if (process.env[FOLDER_ENV_VAR] && process.env[API_KEY_ENV_VAR]) {
				ctx.ui.notify(
					`Currently using ${FOLDER_ENV_VAR} and ${API_KEY_ENV_VAR} from the environment.`,
					"info",
				);
			}

			const folderId = (await ctx.ui.input("Yandex Cloud folder ID", existing?.folderId ?? "b1g..."))?.trim();
			if (!folderId) {
				if (!existing) ctx.ui.notify("Setup cancelled: folder ID is required.", "warning");
				return;
			}

			const apiKeyInput = await ctx.ui.input(
				"Yandex AI Studio API key",
				existing ? "Press Enter to keep the saved key" : "AQVN...",
			);
			// Empty input keeps an already-saved key so the folder can be
			// changed without re-entering the secret.
			const apiKey = apiKeyInput?.trim() || existing?.apiKey;
			if (!apiKey) {
				ctx.ui.notify("Setup cancelled: API key is required.", "warning");
				return;
			}

			const config: YandexConfig = { folderId, apiKey };
			saveConfig(config);
			register(pi, config);
			ctx.ui.notify(
				`${PROVIDER_NAME} configured. Pick "Alice AI LLM" via /model — ${PROVIDER_ID} models are ready.`,
				"info",
			);
		},
	});

	if (!setup) {
		pi.on("session_start", (event, ctx) => {
			syncFooter(ctx);
			if (event.reason !== "startup") return;
			ctx.ui.notify(
				`${PROVIDER_NAME} is not configured. Run /yandex:setup, or set ${FOLDER_ENV_VAR} and ${API_KEY_ENV_VAR}.`,
				"warning",
			);
		});
	} else {
		// Configured via env/config file: still sync the footer at startup,
		// e.g. when pi was launched directly on a Yandex model.
		pi.on("session_start", (_event, ctx) => syncFooter(ctx));
	}
}
