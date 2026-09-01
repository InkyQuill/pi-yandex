import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface YandexConfig {
	folderId: string;
	apiKey: string;
}

/** Path of the extension's config file inside pi's agent directory. */
export function getConfigPath(): string {
	return join(homedir(), ".pi", "agent", "yandex.json");
}

export function loadConfig(): YandexConfig | undefined {
	try {
		const raw: unknown = JSON.parse(readFileSync(getConfigPath(), "utf8"));
		if (
			raw &&
			typeof raw === "object" &&
			typeof (raw as YandexConfig).folderId === "string" &&
			typeof (raw as YandexConfig).apiKey === "string" &&
			(raw as YandexConfig).folderId &&
			(raw as YandexConfig).apiKey
		) {
			return { folderId: (raw as YandexConfig).folderId, apiKey: (raw as YandexConfig).apiKey };
		}
	} catch {
		// Missing or malformed config: treat as unconfigured.
	}
	return undefined;
}

export function saveConfig(config: YandexConfig): void {
	const path = getConfigPath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}
