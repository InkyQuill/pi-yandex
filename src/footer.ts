import { isAbsolute, relative, resolve, sep } from "node:path";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PROVIDER_ID } from "./models.ts";

type Entries = ReturnType<ExtensionContext["sessionManager"]["getEntries"]>;

/** Structural subset of pi's Theme (method syntax keeps the real Theme assignable). */
export interface FooterTheme {
	fg(color: string, text: string): string;
}

/** Structural subset of pi's ReadonlyFooterDataProvider. */
export interface FooterData {
	getGitBranch(): string | null;
	getExtensionStatuses(): ReadonlyMap<string, string>;
	getAvailableProviderCount(): number;
	onBranchChange(callback: () => void): () => void;
}

export interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

/**
 * Sum the session usage attributable to the Yandex provider.
 *
 * Mirrors pi's native totals logic but only counts entries that carry the
 * Yandex provider, so the ₽ total excludes spend from other providers used
 * in the same session. Compaction/branch-summary entries record usage
 * without a provider and cannot be attributed, so they are not counted.
 */
export function sumYandexUsage(entries: Entries): UsageTotals {
	const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	for (const entry of entries) {
		if (entry.type === "message") {
			// Tool-result messages don't declare `provider` in pi's types; view
			// the stored message loosely — a missing provider just skips it.
			const message = entry.message as { role?: string; provider?: string; usage?: UsageSource };
			if (message.provider !== PROVIDER_ID) continue;
			if ((message.role === "assistant" || message.role === "toolResult") && message.usage) {
				addUsage(totals, message.usage);
			}
		}
		// entry.type "branch_summary" | "compaction": usage exists but no
		// provider marker — deliberately not attributed.
	}
	return totals;
}

function addUsage(totals: UsageTotals, usage: UsageSource): void {
	totals.input += usage.input;
	totals.output += usage.output;
	totals.cacheRead += usage.cacheRead;
	totals.cacheWrite += usage.cacheWrite;
	totals.cost += usage.cost.total;
}

interface UsageSource {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number };
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;
	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));
	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

/**
 * Render the footer for a Yandex model session: pi's native layout with the
 * session cost shown in rubles (₽) instead of dollars ($).
 */
export function buildYandexFooterLines(
	ctx: ExtensionContext,
	footerData: FooterData,
	theme: FooterTheme,
	width: number,
): string[] {
	const totals = sumYandexUsage(ctx.sessionManager.getEntries());

	// Cache hit rate of the latest Yandex assistant response (as in the native footer).
	let latestCacheHitRate: number | undefined;
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type === "message" && entry.message.role === "assistant" && "provider" in entry.message) {
			const { usage } = entry.message;
			if (entry.message.provider === PROVIDER_ID && usage) {
				const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
				latestCacheHitRate = promptTokens > 0 ? (usage.cacheRead / promptTokens) * 100 : undefined;
			}
		}
	}

	// First line: cwd, git branch, session name.
	let pwd = formatCwdForFooter(ctx.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);
	const branch = footerData.getGitBranch();
	if (branch) pwd += ` (${branch})`;
	const sessionName = ctx.sessionManager.getSessionName();
	if (sessionName) pwd += ` • ${sessionName}`;
	const pwdLine = truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."));

	// Second line: token stats with ₽ cost, context usage, model on the right.
	const statsParts: string[] = [];
	if (totals.input) statsParts.push(`↑${formatTokens(totals.input)}`);
	if (totals.output) statsParts.push(`↓${formatTokens(totals.output)}`);
	if (totals.cacheRead) statsParts.push(`R${formatTokens(totals.cacheRead)}`);
	if (totals.cacheWrite) statsParts.push(`W${formatTokens(totals.cacheWrite)}`);
	if ((totals.cacheRead > 0 || totals.cacheWrite > 0) && latestCacheHitRate !== undefined) {
		statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
	}
	// Rates are rubles, so this total is rubles.
	statsParts.push(`₽${totals.cost.toFixed(3)}`);

	const contextUsage = ctx.getContextUsage();
	const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	const percentValue = contextUsage?.percent ?? 0;
	const percent = contextUsage && contextUsage.percent !== null ? percentValue.toFixed(1) : "?";
	const contextDisplay = `${percent}%/${formatTokens(contextWindow)}`;
	statsParts.push(
		percentValue > 90 ? theme.fg("error", contextDisplay) : percentValue > 70 ? theme.fg("warning", contextDisplay) : contextDisplay,
	);

	const statsLeft = statsParts.join(" ");
	let modelName = ctx.model?.id ?? "no-model";
	if (ctx.model?.reasoning) {
		const thinkingLevel = ctx.thinkingLevel ?? "off";
		modelName = thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
	}
	let rightSide = modelName;
	if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
		rightSide = `(${ctx.model.provider}) ${modelName}`;
	}

	let left = statsLeft;
	if (visibleWidth(left) > width) left = truncateToWidth(left, width, "...");
	const leftWidth = visibleWidth(left);
	const minPadding = 2;
	let fittedRight = rightSide;
	if (leftWidth + minPadding + visibleWidth(fittedRight) > width) {
		const available = width - leftWidth - minPadding;
		fittedRight = available > 0 ? truncateToWidth(rightSide, available, "") : "";
	}
	const rightWidth = visibleWidth(fittedRight);
	const statsLine = left + " ".repeat(Math.max(0, width - leftWidth - rightWidth)) + fittedRight;

	// Dim stats and the padded right side separately: the colored context
	// part contains a reset that would end an outer dim span early.
	const dimLeft = theme.fg("dim", statsLeft);
	const dimRest = theme.fg("dim", statsLine.slice(statsLeft.length));
	const lines = [pwdLine, dimLeft + dimRest];

	const extensionStatuses = footerData.getExtensionStatuses();
	if (extensionStatuses.size > 0) {
		const statusLine = Array.from(extensionStatuses.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([, text]) => text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim())
			.join(" ");
		lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
	}
	return lines;
}

/**
 * Create a footer sync callback: installs the ₽ footer while the active
 * model belongs to the Yandex provider and restores pi's native footer
 * otherwise.
 */
export function createYandexFooterSync(): (ctx: ExtensionContext) => void {
	let installed = false;
	let latest: ExtensionContext | undefined;

	return (ctx: ExtensionContext) => {
		latest = ctx;
		const shouldBeInstalled = ctx.model?.provider === PROVIDER_ID;
		if (shouldBeInstalled === installed) return;
		installed = shouldBeInstalled;

		if (!shouldBeInstalled) {
			ctx.ui.setFooter(undefined);
			return;
		}
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
			return {
				dispose: unsubscribe,
				invalidate() {},
				render(width: number): string[] {
					return buildYandexFooterLines(latest ?? ctx, footerData, theme, width);
				},
			};
		});
	};
}
