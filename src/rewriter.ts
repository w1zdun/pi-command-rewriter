import { spawn } from "node:child_process";
import { parse, type Literal, type SimpleCommand } from "@aliou/sh";
import type { BashSpawnContext } from "@earendil-works/pi-coding-agent";
import type { RewriterConfig } from "./config";

export interface RewriteNotice {
	message: string;
}

export interface RewriteResult {
	ctx: BashSpawnContext;
	notices: RewriteNotice[];
}

interface Replacement {
	start: number;
	end: number;
	text: string;
}

function walkSimpleCommands(node: unknown): SimpleCommand[] {
	if (!node || typeof node !== "object") return [];
	const n = node as Record<string, unknown>;
	const results: SimpleCommand[] = [];

	if (n.type === "SimpleCommand") {
		results.push(n as unknown as SimpleCommand);
	}

	for (const val of Object.values(n)) {
		if (Array.isArray(val)) {
			for (const item of val) results.push(...walkSimpleCommands(item));
		} else if (val && typeof val === "object") {
			results.push(...walkSimpleCommands(val));
		}
	}
	return results;
}

function getCommandName(cmd: SimpleCommand): string | undefined {
	const first = cmd.words?.[0];
	if (!first || first.parts.length !== 1) return undefined;
	const part = first.parts[0];
	if (part.type !== "Literal") return undefined;
	return (part as Literal).value;
}

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

		const validBefore = before === undefined || !/[a-zA-Z0-9_]/.test(before);
		const validAfter = after === undefined || !/[a-zA-Z0-9_]/.test(after);

		if (validBefore && validAfter) return idx;
		pos = idx + 1;
	}
	return -1;
}

async function applyRtk(
	config: RewriterConfig,
	command: string,
): Promise<string> {
	if (config.rtkMode !== "after-rewrite") return command;
	if (command.includes("\0") || command.length > 10_000) return command;

	return new Promise((resolve) => {
		const proc = spawn("rtk", ["rewrite", command], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let settled = false;
		const finish = (value: string) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(value);
		};
		const timer = setTimeout(() => {
			proc.kill("SIGKILL");
			finish(command);
		}, 5_000);
		proc.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf-8");
		});
		proc.on("close", (code) => {
			// exit 0 = rewritten + auto-allow, exit 3 = rewritten + ask
			if ((code === 0 || code === 3) && stdout) {
				finish(stdout.trim());
			} else {
				finish(command);
			}
		});
		// rtk not installed or spawn failed — pass through unchanged
		proc.on("error", () => finish(command));
	});
}

/**
 * Apply local rewrite rules and optionally RTK to a BashSpawnContext.
 * Returns the rewritten context and notices for UI display.
 */
export async function analyzeRewrite(
	ctx: BashSpawnContext,
	config: RewriterConfig,
): Promise<RewriteResult> {
	if (!config.enabled) return { ctx, notices: [] };

	const activeRules = (config.rewrites ?? []).filter((r) => r.enabled);
	let command = ctx.command;

	if (activeRules.length > 0) {
		try {
			const { ast } = parse(command);
			const commands = walkSimpleCommands(ast);
			const replacements: Replacement[] = [];
			let searchFrom = 0;

			for (const cmd of commands) {
				const name = getCommandName(cmd);
				if (!name) continue;

				const rule = activeRules.find((r) => {
					const matches = Array.isArray(r.match) ? r.match : [r.match];
					return matches.includes(name);
				});
				if (!rule) continue;

				const idx = findCommandPosition(command, name, searchFrom);
				if (idx === -1) continue;

				const replacement = rule.replaceWith.replace("$0", name);
				replacements.push({
					start: idx,
					end: idx + name.length,
					text: replacement,
				});
				searchFrom = idx + name.length;
			}

			for (let i = replacements.length - 1; i >= 0; i--) {
				const r = replacements[i];
				command = command.slice(0, r.start) + r.text + command.slice(r.end);
			}
		} catch {
			// Parse failure — skip local rules, fall through to RTK.
		}
	}

	const finalCommand = await applyRtk(config, command);
	const notices: RewriteNotice[] =
		finalCommand !== ctx.command
			? [{ message: `${ctx.command}  →  ${finalCommand}` }]
			: [];
	return { ctx: { ...ctx, command: finalCommand }, notices };
}
