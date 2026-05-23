import { spawnSync } from "node:child_process";
import { parse, type Program } from "@aliou/sh";
import type { BashSpawnContext } from "@earendil-works/pi-coding-agent";
import type { RewriterConfig } from "./config";

// ---------------------------------------------------------------------------
// Types (aligned with pi-toolchain's Rewriter / RewriteNotice pattern)
// ---------------------------------------------------------------------------

export interface RewriteNotice {
	message: string;
}

export interface RewriteResult {
	ctx: BashSpawnContext;
	notices: RewriteNotice[];
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

interface SimpleCommandNode {
	type: "SimpleCommand";
	words?: WordNode[];
}

interface WordNode {
	parts: PartNode[];
}

interface PartNode {
	type: string;
	value?: string;
}

interface Replacement {
	start: number;
	end: number;
	text: string;
}

/** Walk AST, collect all SimpleCommand nodes */
function walkSimpleCommands(node: unknown, depth: number): SimpleCommandNode[] {
	if (!node || typeof node !== "object") return [];
	const n = node as Record<string, unknown>;
	const results: SimpleCommandNode[] = [];

	if (n.type === "SimpleCommand") {
		results.push(n as unknown as SimpleCommandNode);
	}

	for (const val of Object.values(n)) {
		if (Array.isArray(val)) {
			for (const item of val) {
				results.push(...walkSimpleCommands(item, depth + 1));
			}
		} else if (val && typeof val === "object") {
			results.push(...walkSimpleCommands(val, depth + 1));
		}
	}
	return results;
}

/** Get first word as plain string (only if single Literal part) */
function getCommandName(cmd: SimpleCommandNode): string | undefined {
	const first = cmd.words?.[0];
	if (!first || first.parts.length !== 1) return undefined;
	const part = first.parts[0];
	if (part.type !== "Literal" || typeof part.value !== "string")
		return undefined;
	return part.value;
}

/** Find command name position in source with word boundary check */
function findCommandPosition(
	source: string,
	name: string,
	searchFrom: number,
): number {
	let pos = searchFrom;
	while (pos < source.length) {
		const idx = source.indexOf(name, pos);
		if (idx === -1) return -1;

		const before = idx > 0 ? source[idx - 1] : undefined;
		const after =
			idx + name.length < source.length ? source[idx + name.length] : undefined;

		// Word boundary: reject if adjacent char is alphanumeric or underscore.
		const validBefore = before === undefined || !/[a-zA-Z0-9_]/.test(before);
		const validAfter = after === undefined || !/[a-zA-Z0-9_]/.test(after);

		if (validBefore && validAfter) return idx;
		pos = idx + 1;
	}
	return -1;
}

// ---------------------------------------------------------------------------
// RTK integration
// ---------------------------------------------------------------------------

/** Run `rtk rewrite` on a command if rtkMode is enabled. */
function applyRtk(config: RewriterConfig, command: string): string {
	if (config.rtkMode !== "after-rewrite") return command;
	if (command.includes("\0") || command.length > 10_000) return command;
	try {
		const result = spawnSync("rtk", ["rewrite", command], {
			encoding: "utf-8",
			timeout: 5_000,
		});
		// exit 0 = rewritten + auto-allow, exit 3 = rewritten + ask
		if ((result.status === 0 || result.status === 3) && result.stdout) {
			return result.stdout.trim();
		}
	} catch {
		// rtk not installed or failed — pass through unchanged
	}
	return command;
}

// ---------------------------------------------------------------------------
// Core: analyzeRewrite
// ---------------------------------------------------------------------------

/**
 * Apply local rewrite rules (and optionally RTK) to a BashSpawnContext.
 * Returns the (possibly rewritten) context and any notices for UI display.
 * Pure function — no side effects.
 */
export function analyzeRewrite(
	ctx: BashSpawnContext,
	config: RewriterConfig,
): RewriteResult {
	if (!config.enabled) return { ctx, notices: [] };

	const activeRules = (config.rewrites ?? []).filter((r) => r.enabled);

	// Apply local rules first
	let command = ctx.command;

	if (activeRules.length > 0) {
		let ast: Program;
		try {
			({ ast } = parse(command));
		} catch {
			// Parse fail — skip local rules, still try RTK below
			const rtkCommand = applyRtk(config, command);
			const notices: RewriteNotice[] =
				rtkCommand !== command
					? [{ message: `${command}  →  ${rtkCommand}` }]
					: [];
			return { ctx: { ...ctx, command: rtkCommand }, notices };
		}

		const commands = walkSimpleCommands(ast, 0);
		const replacements: Replacement[] = [];

		for (const cmd of commands) {
			const name = getCommandName(cmd);
			if (!name) continue;

			const rule = activeRules.find((r) => {
				const matches = Array.isArray(r.match) ? r.match : [r.match];
				return matches.includes(name);
			});
			if (!rule) continue;

			const idx = findCommandPosition(command, name, 0);
			if (idx === -1) continue;

			if (replacements.some((r) => idx >= r.start && idx < r.end)) continue;

			const replacement = rule.replaceWith.replace("$0", name);
			replacements.push({ start: idx, end: idx + name.length, text: replacement });
		}

		if (replacements.length > 0) {
			replacements.sort((a, b) => a.start - b.start);
			for (let i = replacements.length - 1; i >= 0; i--) {
				const r = replacements[i];
				command =
					command.slice(0, r.start) + r.text + command.slice(r.end);
			}
		}
	}

	// Apply RTK on top of local rewrites
	const rtkCommand = applyRtk(config, command);
	const finalCommand = rtkCommand;

	const notices: RewriteNotice[] =
		finalCommand !== ctx.command
			? [{ message: `${ctx.command}  →  ${finalCommand}` }]
			: [];

	return { ctx: { ...ctx, command: finalCommand }, notices };
}

// ---------------------------------------------------------------------------
// Spawn hook factory
// ---------------------------------------------------------------------------

/** Build a BashSpawnHook from config. */
export function createSpawnHook(config: RewriterConfig) {
	return (ctx: BashSpawnContext): BashSpawnContext =>
		analyzeRewrite(ctx, config).ctx;
}
