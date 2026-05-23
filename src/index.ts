import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import { loadConfig, type RewriterConfig } from "./config";
import { createSpawnHook } from "./rewriter";

let config: RewriterConfig;

export default async function (pi: ExtensionAPI) {
	config = loadConfig(process.cwd());

	if (!config.enabled) {
		pi.on("session_start", async (_event, ctx) => {
			ctx.ui.notify("command-rewriter: disabled in config", "info");
		});
		return;
	}

	pi.on("session_start", async (_event, ctx) => {
		const activeCount = (config.rewrites ?? []).filter((r) => r.enabled).length;
		ctx.ui.notify(`command-rewriter: ${activeCount} rule(s) active`, "info");
	});

	// Register bash tool with spawn hook
	const spawnHook = createSpawnHook(config);
	const bashTool = createBashTool(process.cwd(), { spawnHook });
	pi.registerTool({ ...bashTool });

	// Reload command
	pi.registerCommand("rewriter-reload", {
		description: "Reload command-rewriter config",
		handler: async (_args, ctx) => {
			config = loadConfig(ctx.cwd);
			const activeCount = (config.rewrites ?? []).filter(
				(r) => r.enabled,
			).length;
			ctx.ui.notify(
				`command-rewriter reloaded: ${activeCount} rule(s) active`,
				"info",
			);
		},
	});

	// Settings command
	pi.registerCommand("rewriter-status", {
		description: "Show active rewriter rules",
		handler: async (_args, ctx) => {
			const lines = (config.rewrites ?? []).map((r, i) => {
				const match = Array.isArray(r.match) ? r.match.join(" | ") : r.match;
				const status = r.enabled ? "✅ ON " : "❌ OFF";
				return `  [${i}] ${status} ${match} → ${r.replaceWith}`;
			});
			const text = [
				"Active rules:",
				...lines,
				`  Total: ${(config.rewrites ?? []).length}`,
			].join("\n");
			ctx.ui.setWidget("rewriter-status", text.split("\n"));
		},
	});
}
