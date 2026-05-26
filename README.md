# pi-command-rewriter

Pi extension. AST-based bash command rewriter. Configurable rules per project or global. Optionally integrates with [rtk](https://github.com/rtk-ai/rtk) to compress command output and reduce LLM token usage.

## Install

```bash
# Global install via pi
pi install git:github.com/w1zdun/pi-command-rewriter

# Project-local install
pi install git:github.com/w1zdun/pi-command-rewriter -l
```

Or manually:

```bash
# Symlink from a local clone
ln -s $(pwd)/pi-command-rewriter ~/.pi/agent/extensions/command-rewriter
```

## Config

Two locations (project overrides global):

| Scope | Path |
|---|---|
| Global | `~/.pi/agent/extensions/command-rewriter.json` |
| Project | `.pi/extensions/command-rewriter.json` |

### Schema

```json
{
  "enabled": true,
  "rtkMode": "disabled",
  "rewrites": [
    {
      "enabled": true,
      "match": ["python", "python3"],
      "replaceWith": "uv run $0"
    },
    {
      "enabled": false,
      "match": ["pip", "pip3"],
      "replaceWith": "uv pip"
    },
    {
      "enabled": true,
      "match": "npm",
      "replaceWith": "pnpm"
    },
    {
      "enabled": true,
      "match": "npx",
      "replaceWith": "pnpm dlx"
    },
    {
      "enabled": true,
      "match": "kubectl",
      "replaceWith": "kubectl-readonly",
      "exceptSubcommands": ["exec"]
    }
  ]
}
```

- `enabled` (top-level): master switch. `false` = no rewrites at all.
- `rtkMode`: `"after-rewrite"` runs `rtk rewrite` on the final command after local rules are applied. `"disabled"` (default) skips RTK entirely.
- `rewrites[].enabled`: per-rule toggle.
- `rewrites[].match`: single string or array of command names.
- `rewrites[].replaceWith`: replacement text. `$0` = matched command name.
- `rewrites[].exceptSubcommands` (optional): list of literal tokens that, if present anywhere in the argv after the command name, cause the rule to be skipped. Useful for carve-outs like `kubectl exec` while still rewriting `kubectl get`. Tolerates global flags before the subcommand (`kubectl -n ns exec …` is also skipped).

### How It Works

1. Parses command with `@aliou/sh` (AST, not regex).
2. Walks all `SimpleCommand` nodes, extracts first word.
3. Matches against enabled rules; if a rule defines `exceptSubcommands` and any listed token appears as a literal argument, the rule is skipped and the next eligible rule is tried. Otherwise replaces the command name in the source string (word-boundary aware).
4. If `rtkMode: "after-rewrite"`, runs `rtk rewrite` on the result — RTK rewrites known commands to their compact equivalents (e.g. `git status` → `rtk git status`). Unknown commands pass through unchanged.
5. Returns final command to bash tool.

Parse failure = pass through (RTK still applied if enabled). Missed rewrite is safe; false positive corrupts.

### RTK Integration

[rtk](https://github.com/rtk-ai/rtk) is a CLI proxy that compresses command output before it reaches the LLM context, saving 60–90% tokens on common commands like `git`, `cargo test`, `npm test`, etc.

To enable:

1. Install rtk: `brew install rtk`
2. Add `"rtkMode": "after-rewrite"` to your config

RTK runs after local rules, so your substitutions take effect first. For example, with `npm → pnpm` rule and RTK enabled:

```
npm test  →  pnpm test  →  rtk pnpm test  (if rtk knows pnpm test)
git status  →  git status  →  rtk git status
```

If `rtk` is not installed or doesn't know the command, it passes through unchanged.

### Commands

- `/rewriter-status` — show active rules in widget
- `/rewriter-widget-toggle` — show or hide the widget (auto-refreshes on each rewrite while visible)
- `/rewriter-reload` — reload config without restarting Pi

## Credits

- **[pi-toolchain](https://github.com/aliou/pi-toolchain)** — inspiration for the extension concept and AST-based command search approach.
