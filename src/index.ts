import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import { loadConfig, type RewriterConfig } from "./config";
import { createSpawnHook } from "./rewriter";

// Mutable config holder — spawn hook reads current value each invocation.
let currentConfig: RewriterConfig | undefined;

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
		description: "Show active rewriter rules",
		handler: async (_args, ctx) => {
			const cfg = currentConfig;
			const lines = (cfg.rewrites ?? []).map((r, i) => {
				const match = Array.isArray(r.match) ? r.match.join(" | ") : r.match;
				const status = r.enabled ? "✅ ON " : "❌ OFF";
				return `  [${i}] ${status} ${match} → ${r.replaceWith}`;
			});
			const text = [
				"Active rules:",
				...lines,
				`  Total: ${(cfg.rewrites ?? []).length}`,
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
		const cfg = currentConfig;
		const activeCount = (cfg.rewrites ?? []).filter((r) => r.enabled).length;
		ctx.ui.notify(`command-rewriter: ${activeCount} rule(s) active`, "info");
	});

	// Spawn hook reads currentConfig each invocation — reload updates take effect immediately.
	const bashTool = createBashTool(process.cwd(), {
		spawnHook: (ctx) => createSpawnHook(currentConfig)(ctx),
	});
	pi.registerTool({ ...bashTool });
}
