import { parse, type Program } from "@aliou/sh";
import type { BashSpawnContext } from "@earendil-works/pi-coding-agent";
import type { RewriterConfig } from "./config";

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

/** Get first word as plain string (only if single Literal part) */
function getCommandName(cmd: SimpleCommandNode): string | undefined {
  const first = cmd.words?.[0];
  if (!first || first.parts.length !== 1) return undefined;
  const part = first.parts[0];
  if (part.type !== "Literal" || typeof part.value !== "string") return undefined;
  return part.value;
}

/** Find command name position in source with word boundary check */
function findCommandPosition(source: string, name: string, searchFrom: number): number {
  let pos = searchFrom;
  while (pos < source.length) {
    const idx = source.indexOf(name, pos);
    if (idx === -1) return -1;

    const before = idx > 0 ? source[idx - 1] : undefined;
    const after = idx + name.length < source.length ? source[idx + name.length] : undefined;

    const validBefore = before === undefined || /[\s;|&(]/.test(before) || before === "\n";
    const validAfter = after === undefined || /[\s;|&)]/.test(after) || after === "\n";

    if (validBefore && validAfter) return idx;

    pos = idx + 1;
  }
  return -1;
}

interface Replacement {
  start: number;
  end: number;
  text: string;
}

/** Build spawn hook from config */
export function createSpawnHook(config: RewriterConfig) {
  return (ctx: BashSpawnContext): BashSpawnContext => {
    if (!config.enabled) return ctx;

    const activeRules = (config.rewrites ?? []).filter(r => r.enabled);
    if (activeRules.length === 0) return ctx;

    let ast: Program;
    try {
      ({ ast } = parse(ctx.command));
    } catch {
      // Parse fail = pass through unchanged
      return ctx;
    }

    const commands = walkSimpleCommands(ast, 0);
    const replacements: Replacement[] = [];

    for (const cmd of commands) {
      const name = getCommandName(cmd);
      if (!name) continue;

      // Find matching rule
      const rule = activeRules.find(r => {
        const matches = Array.isArray(r.match) ? r.match : [r.match];
        return matches.includes(name);
      });
      if (!rule) continue;

      // Find position in source
      const searchFrom = replacements.length > 0
        ? replacements[replacements.length - 1].end
        : 0;
      const idx = findCommandPosition(ctx.command, name, searchFrom);
      if (idx === -1) continue;

      // Build replacement text
      const replacement = rule.replaceWith.replace("$0", name);
      replacements.push({
        start: idx,
        end: idx + name.length,
        text: replacement,
      });
    }

    if (replacements.length === 0) return ctx;

    // Apply right-to-left to keep offsets valid
    let result = ctx.command;
    for (let i = replacements.length - 1; i >= 0; i--) {
      const r = replacements[i];
      result = result.slice(0, r.start) + r.text + result.slice(r.end);
    }

    return { ...ctx, command: result };
  };
}
