/**
 * Render tests for the ₽ footer. Run with bun (no typechecking, runtime only):
 *
 *   bun test/footer.ts
 */
import { buildYandexFooterLines, createYandexFooterSync, sumYandexUsage } from "../src/footer.ts";

const PROVIDER = "yandex-ai-studio";
const YANDEX_MODEL_ID = `gpt://b1gtsl8kn68ki8d927tt/aliceai-llm/latest`;

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
	if (condition) {
		console.log(`  ok: ${name}`);
	} else {
		failures++;
		console.error(`FAIL: ${name}`, detail ?? "");
	}
}

// So formatCwdForFooter shortens the stub cwd to ~/proj.
process.env.HOME = "/home/u";

const theme = { fg: (_color: string, text: string) => text };
const footerData = {
	getGitBranch: () => "main",
	getExtensionStatuses: () => new Map([["b", "status-b"], ["a", "status-a"]]),
	getAvailableProviderCount: () => 2,
	onBranchChange: () => () => {},
};

// Usage: 10k input + 5k cached in, 2k out on aliceai-llm:
// 500/1M*10k + 500/1M*5k + 1200/1M*2k = 5 + 2.5 + 2.4 = 9.9 ₽
const yandexUsage = {
	input: 10000,
	output: 2000,
	cacheRead: 5000,
	cacheWrite: 0,
	cost: { input: 5, output: 2.4, cacheRead: 2.5, cacheWrite: 0, total: 9.9 },
};
const foreignUsage = {
	input: 1000,
	output: 100,
	cacheRead: 0,
	cacheWrite: 0,
	cost: { input: 0.003, output: 0.045, cacheRead: 0, cacheWrite: 0, total: 0.048 },
};

const entries = [
	{ type: "message", message: { role: "assistant", provider: PROVIDER, model: YANDEX_MODEL_ID, usage: yandexUsage } },
	{ type: "message", message: { role: "assistant", provider: "anthropic", model: "claude-x", usage: foreignUsage } },
	{
		type: "message",
		message: { role: "toolResult", provider: PROVIDER, usage: { ...yandexUsage, cost: { ...yandexUsage.cost, total: 0 } } },
	},
	{ type: "compaction", usage: foreignUsage },
];

function makeCtx(modelProvider: string | undefined) {
	return {
		model: modelProvider ? { id: YANDEX_MODEL_ID, provider: modelProvider, contextWindow: 32768, reasoning: false } : undefined,
		sessionManager: {
			getCwd: () => "/home/u/proj",
			getSessionName: () => "demo",
			getEntries: () => entries,
		},
		getContextUsage: () => ({ tokens: 14000, contextWindow: 32768, percent: 42.7 }),
		getThinkingLevel: () => "off",
	};
}

// --- sumYandexUsage ---
const totals = sumYandexUsage(entries);
check("only Yandex entries counted: input", totals.input === 20000, totals.input);
check("only Yandex entries counted: output", totals.output === 4000, totals.output);
check("foreign + summary cost excluded", Math.abs(totals.cost - 9.9) < 1e-9, totals.cost);

// --- buildYandexFooterLines ---
const ctx = makeCtx(PROVIDER);
const lines = buildYandexFooterLines(ctx, footerData, theme, 120);
console.log("  rendered:", JSON.stringify(lines));
check("pwd line has ~, branch, session name", lines[0].includes("~/proj (main) • demo"), lines[0]);
check("cost shown in ₽", lines[1].includes("₽9.900"), lines[1]);
check("no $ cost", !lines[1].includes("$"), lines[1]);
check("context percent", lines[1].includes("42.7%/33k"), lines[1]);
check("provider prefix with multiple providers", lines[1].includes(`(${PROVIDER})`), lines[1]);
check("model id on the right", lines[1].includes(YANDEX_MODEL_ID), lines[1]);
check("extension statuses line sorted", lines[2] === "status-a status-b", lines[2]);

// Null percent renders as "?"
const ctxUnknown = makeCtx(PROVIDER);
ctxUnknown.getContextUsage = () => ({ tokens: null, contextWindow: 32768, percent: null });
const linesUnknown = buildYandexFooterLines(ctxUnknown, footerData, theme, 120);
check("unknown context renders ?", linesUnknown[1].includes("?%/33k"), linesUnknown[1]);

// --- createYandexFooterSync ---
const sync = createYandexFooterSync();
let installed: unknown = "never-called";
const fakeUi = { setFooter: (factory: unknown) => (installed = factory) };
for (const model of [PROVIDER, "anthropic", PROVIDER, PROVIDER]) {
	sync({ ...makeCtx(model), ui: fakeUi });
}
check("footer installed for Yandex model", typeof installed === "function", installed);
check("footer restored for non-Yandex model (last call wins is Yandex)", typeof installed === "function");

const calls: unknown[] = [];
const recordingSync = createYandexFooterSync();
for (const model of [PROVIDER, PROVIDER, "anthropic", "anthropic", PROVIDER]) {
	recordingSync({ ...makeCtx(model), ui: { setFooter: (f: unknown) => calls.push(f) } });
}
// Only transitions call setFooter: install, (dedup), restore, (dedup), install.
check("transitions produce 3 setFooter calls", calls.length === 3, calls.length);
check("first call installs the custom footer", typeof calls[0] === "function", calls[0]);
check("second call restores the native footer", calls[1] === undefined, calls[1]);
check("third call re-installs the custom footer", typeof calls[2] === "function", calls[2]);

if (failures > 0) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log("\nall footer checks passed");
