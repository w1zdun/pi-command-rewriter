import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Single rewrite rule: source command -> replacement prefix/command */
export interface RewriteRule {
  /** Enabled toggle */
  enabled: boolean;
  /** Command name(s) to match (e.g. "python", "python3") */
  match: string | string[];
  /** Replacement text. "$0" = matched command name. E.g. "uv run $0" */
  replaceWith: string;
}

/** Full config shape */
export interface RewriterConfig {
  /** Global enable/disable */
  enabled?: boolean;
  /** Rewrite rules — order matters (first match wins per command position) */
  rewrites?: RewriteRule[];
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

/** Load JSON config, return undefined on any error */
function loadJson(path: string): RewriterConfig | undefined {
  try {
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, "utf-8")) as RewriterConfig;
  } catch {
    return undefined;
  }
}

/** Merge configs: later overrides earlier (shallow per key) */
function mergeConfigs(...configs: (RewriterConfig | undefined)[]): RewriterConfig {
  const result: RewriterConfig = { ...DEFAULT_CONFIG };

  for (const cfg of configs) {
    if (!cfg) continue;
    if (cfg.enabled !== undefined) result.enabled = cfg.enabled;
    if (cfg.rewrites) {
      // Build a map by replaceWith for dedup, preserve order
      const seen = new Set<string>();
      const merged: RewriteRule[] = [];
      for (const rule of cfg.rewrites) {
        const key = Array.isArray(rule.match) ? rule.match.join("|") : rule.match;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(rule);
        }
      }
      // Remove old rules not in new config, add new ones
      const oldRules = result.rewrites ?? [];
      const oldMap = new Map<string, RewriteRule>();
      for (const r of oldRules) {
        const key = Array.isArray(r.match) ? r.match.join("|") : r.match;
        oldMap.set(key, r);
      }
      for (const r of merged) {
        const key = Array.isArray(r.match) ? r.match.join("|") : r.match;
        oldMap.set(key, r);
      }
      result.rewrites = [...oldMap.values()];
    }
  }
  return result;
}

/** Load config from global + project, merge with defaults */
export function loadConfig(cwd: string): RewriterConfig {
  const globalPath = join(homedir(), ".pi", "agent", "extensions", "command-rewriter.json");
  const projectPath = join(cwd, ".pi", "extensions", "command-rewriter.json");

  return mergeConfigs(
    loadJson(globalPath),
    loadJson(projectPath),
  );
}
