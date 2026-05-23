import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import { loadConfig, type RewriterConfig } from "./config";
import { analyzeRewrite, createSpawnHook } from "./rewriter";

// Mutable config holder — always assigned before any handler runs.
let currentConfig: RewriterConfig;

// Rolling log of rewrites for the current session (most recent last).
const rewriteLog: string[] = [];
const MAX_LOG_ENTRIES = 20;

export default async function (pi: ExtensionAPI) {
	currentConfig = loadConfig(process.cwd());

	// Always register commands (even when disabled) so reload works.
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
			const cfg = currentConfig;
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

			const text = [
				`RTK: ${rtkStatus}`,
				"Active rules:",
				...lines,
				`  Total: ${(cfg.rewrites ?? []).length}`,
				...logSection,
			].join("\n");
			ctx.ui.setWidget("rewriter-status", text.split("\n"));
		},
	});

	if (!currentConfig.enabled) {
		pi.on("session_start", async (_event, ctx) => {
			ctx.ui.notify("command-rewriter: disabled in config", "info");
		});
		return;
	}

	pi.on("session_start", async (_event, ctx) => {
		const activeCount = (currentConfig.rewrites ?? []).filter(
			(r) => r.enabled,
		).length;
		ctx.ui.notify(`command-rewriter: ${activeCount} rule(s) active`, "info");
	});

	// Intercept bash tool calls — analyze the rewrite and surface notices in the TUI.
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return;

		const command = String(event.input.command ?? "");
		if (!command) return;

		const { notices } = analyzeRewrite(
			{ command, cwd: process.cwd(), env: process.env },
			currentConfig,
		);

		for (const notice of notices) {
			rewriteLog.push(notice.message);
			if (rewriteLog.length > MAX_LOG_ENTRIES) rewriteLog.shift();

			ctx.ui.notify(`✏️ ${notice.message}`, "info");
			ctx.ui.setStatus("rewriter", `✏️ ${notice.message}`);
		}
	});

	// Spawn hook reads currentConfig each invocation — reload updates take effect immediately.
	const bashTool = createBashTool(process.cwd(), {
		spawnHook: (ctx) => createSpawnHook(currentConfig)(ctx),
	});
	pi.registerTool({ ...bashTool });
}
