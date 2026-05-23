import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface RewriteRule {
	enabled: boolean;
	/** Command name(s) to match (e.g. "python", "python3") */
	match: string | string[];
	/** Replacement text. "$0" = matched command name. E.g. "uv run $0" */
	replaceWith: string;
}

export interface RewriterConfig {
	enabled?: boolean;
	rewrites?: RewriteRule[];
	/**
	 * "after-rewrite": run `rtk rewrite` on the command after local rules are applied.
	 * "disabled": skip RTK entirely (default).
	 */
	rtkMode?: "after-rewrite" | "disabled";
}

const DEFAULT_CONFIG: RewriterConfig = {
	enabled: true,
	rewrites: [
		{
			enabled: false,
			match: ["python", "python3"],
			replaceWith: "uv run $0",
		},
		{
			enabled: false,
			match: ["pip", "pip3"],
			replaceWith: "uv pip",
		},
	],
};

/**
 * Dedup key. Including replaceWith prevents two rules with the same match
 * but different replacements from silently colliding.
 */
function ruleKey(rule: RewriteRule): string {
	const match = Array.isArray(rule.match) ? rule.match.join("|") : rule.match;
	return `${match}::${rule.replaceWith}`;
}

function loadJson(path: string): RewriterConfig | undefined {
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as RewriterConfig;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		console.error(`command-rewriter: failed to load ${path}: ${err}`);
		return undefined;
	}
}

function mergeConfigs(
	...configs: (RewriterConfig | undefined)[]
): RewriterConfig {
	const result: RewriterConfig = { ...DEFAULT_CONFIG };

	for (const cfg of configs) {
		if (!cfg) continue;
		if (cfg.enabled !== undefined) result.enabled = cfg.enabled;
		if (cfg.rtkMode !== undefined) result.rtkMode = cfg.rtkMode;
		if (cfg.rewrites) {
			const seen = new Set<string>();
			const merged: RewriteRule[] = [];
			for (const rule of cfg.rewrites) {
				const key = ruleKey(rule);
				if (!seen.has(key)) {
					seen.add(key);
					merged.push(rule);
				}
			}
			const ruleMap = new Map<string, RewriteRule>();
			for (const r of result.rewrites ?? []) ruleMap.set(ruleKey(r), r);
			for (const r of merged) ruleMap.set(ruleKey(r), r);
			result.rewrites = [...ruleMap.values()];
		}
	}
	return result;
}

export function loadConfig(cwd: string): RewriterConfig {
	const globalPath = join(
		homedir(),
		".pi",
		"agent",
		"extensions",
		"command-rewriter.json",
	);
	const projectPath = join(cwd, ".pi", "extensions", "command-rewriter.json");

	return mergeConfigs(loadJson(globalPath), loadJson(projectPath));
}
