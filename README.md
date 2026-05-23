# pi-command-rewriter

Pi extension. AST-based bash command rewriter. Configurable rules per project or global. Optionally integrates with [rtk](https://github.com/rtk-ai/rtk) to compress command output and reduce LLM token usage.

## Install

```bash
# Global install via pi
pi install git:github.com/<you>/pi-rewrite

# Project-local install
pi install git:github.com/<you>/pi-rewrite -l
```

Or manually:

```bash
# Symlink from a local clone
ln -s $(pwd)/pi-rewrite ~/.pi/agent/extensions/command-rewriter
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
    }
  ]
}
```

- `enabled` (top-level): master switch. `false` = no rewrites at all.
- `rtkMode`: `"after-rewrite"` runs `rtk rewrite` on the final command after local rules are applied. `"disabled"` (default) skips RTK entirely.
- `rewrites[].enabled`: per-rule toggle.
- `rewrites[].match`: single string or array of command names.
- `rewrites[].replaceWith`: replacement text. `$0` = matched command name.

### How It Works

1. Parses command with `@aliou/sh` (AST, not regex).
2. Walks all `SimpleCommand` nodes, extracts first word.
3. Matches against enabled rules, replaces command name in source string (word-boundary aware).
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
- `/rewriter-reload` — reload config without restarting Pi
