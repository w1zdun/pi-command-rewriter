# pi-command-rewriter

Pi extension. AST-based bash command rewriter. Configurable rules per project or global.

## Install

```bash
# Copy into pi extensions dir
cp -r pi-rewrite ~/.pi/agent/extensions/command-rewriter

# Or symlink
ln -s $(pwd)/pi-rewrite ~/.pi/agent/extensions/command-rewriter
```

Then `npm install` in the extension dir (or `pi install git:github.com/<you>/pi-command-rewriter`).

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
- `rewrites[].enabled`: per-rule toggle.
- `rewrites[].match`: single string or array of command names.
- `rewrites[].replaceWith`: replacement text. `$0` = matched command name.

### How It Works

1. Parses command with `@aliou/sh` (AST, not regex).
2. Walks all `SimpleCommand` nodes, extracts first word.
3. Matches against enabled rules.
4. Replaces command name in source string (word-boundary aware).
5. Returns rewritten command to bash tool.

Parse failure = pass through unchanged. Missed rewrite safe; false positive corrupts.

### Commands

- `/rewriter-status` — show active rules in widget
- `/rewriter-reload` — reload config without `/reload`
