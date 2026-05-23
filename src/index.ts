import {
	type ExtensionAPI,
	isToolCallEventType,
} from "@earendil-works/pi-coding-agent";
import { loadConfig, type RewriterConfig } from "./config";
import { analyzeRewrite } from "./rewriter";

let currentConfig: RewriterConfig;
let widgetVisible = false;

const rewriteLog: string[] = [];
const MAX_LOG_ENTRIES = 20;

function renderWidget(cfg: RewriterConfig): string[] {
	const rtkStatus =
		(cfg.rtkMode ?? "disabled") === "after-rewrite"
			? "✅ after-rewrite"
			: "❌ disabled";
	const lines = (cfg.rewrites ?? []).map((r, i) => {
		const match = Array.isArray(r.match) ? r.match.join(" | ") : r.match;
		const status = r.enabled ? "✅ ON " : "❌ OFF";
		return `  [${i}] ${status} ${match} → ${r.replaceWith}`;
	});
	const logSection =
		rewriteLog.length > 0
			? ["", "Recent rewrites:", ...rewriteLog.map((e) => `  ${e}`)]
			: ["", "Recent rewrites: (none this session)"];

	return [
		`RTK: ${rtkStatus}`,
		"Active rules:",
		...lines,
		`  Total: ${(cfg.rewrites ?? []).length}`,
		...logSection,
	];
}

export default async function (pi: ExtensionAPI) {
	currentConfig = loadConfig(process.cwd());

	pi.registerCommand("rewriter-reload", {
		description: "Reload command-rewriter config",
		handler: async (_args, ctx) => {
			currentConfig = loadConfig(ctx.cwd);
			const activeCount = (currentConfig.rewrites ?? []).filter(
				(r) => r.enabled,
			).length;
			ctx.ui.notify(
				`command-rewriter reloaded: ${activeCount} rule(s) active`,
				"info",
			);
		},
	});

	pi.registerCommand("rewriter-status", {
		description: "Show active rewriter rules and recent rewrites",
		handler: async (_args, ctx) => {
			ctx.ui.setWidget("rewriter-status", renderWidget(currentConfig));
			widgetVisible = true;
		},
	});

	pi.registerCommand("rewriter-widget-toggle", {
		description: "Show or hide the rewriter widget",
		handler: async (_args, ctx) => {
			widgetVisible = !widgetVisible;
			if (widgetVisible) {
				ctx.ui.setWidget("rewriter-status", renderWidget(currentConfig));
				ctx.ui.notify("rewriter widget: shown", "info");
			} else {
				ctx.ui.setWidget("rewriter-status", undefined);
				ctx.ui.notify("rewriter widget: hidden", "info");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!currentConfig.enabled) {
			ctx.ui.notify("command-rewriter: disabled in config", "info");
			return;
		}
		const activeCount = (currentConfig.rewrites ?? []).filter(
			(r) => r.enabled,
		).length;
		ctx.ui.notify(`command-rewriter: ${activeCount} rule(s) active`, "info");
	});

	// Rewrite via mutable event.input — the SDK passes the mutated command
	// to the built-in bash tool, so no custom tool registration is needed.
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;
		if (!currentConfig.enabled) return;

		const command = event.input.command;
		if (!command) return;

		const { ctx: rewritten, notices } = await analyzeRewrite(
			{ command, cwd: process.cwd(), env: process.env },
			currentConfig,
		);

		if (rewritten.command !== command) {
			event.input.command = rewritten.command;
		}

		for (const notice of notices) {
			rewriteLog.push(notice.message);
			if (rewriteLog.length > MAX_LOG_ENTRIES) rewriteLog.shift();
			ctx.ui.notify(`✏️ ${notice.message}`, "info");
		}
		const last = notices[notices.length - 1];
		if (last) ctx.ui.setStatus("rewriter", `✏️ ${last.message}`);
		if (widgetVisible && notices.length > 0) {
			ctx.ui.setWidget("rewriter-status", renderWidget(currentConfig));
		}
	});
}
