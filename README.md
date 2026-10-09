# Style Lint

A mod for Claude Code that holds Claude to your writing rules.

Every team has a list. No em dashes. Never name the hosting provider. Don't say "leverage". You can put the list in a prompt, and Claude will follow it until the session gets long. Style Lint checks the text itself, every time Claude writes to a file, and refuses the edit when a rule is broken.

It asks no model anything of its own. Every check is a plain text or pattern match you can read in `hooks/style.ts`.

## How it works

It works in three layers, from cheapest to strictest:

1. **Tell.** Claude reads your rules beside each prompt, so most text is right the first time.
2. **Block.** When Claude writes text into a checked file and it breaks a rule, the edit is refused. Claude is shown the line, the rule and the fix, and rewrites it.
3. **Report.** A chat reply cannot be blocked, so a reply that breaks a rule gets a line under it saying how many slips it had.

`/style` opens a pane with each rule, how often it was broken this session, and where.

## Install

```
/plugin install house-style-lint --marketplace ramankrishna/house-style-lint
```

Answer `y` to add the marketplace, then pick a scope. Needs Claude Code v2.1.287 or later.

Nothing is checked until the project has a rules file.

## Write your rules

Run `/style init` for a starter, or write `.house-style.json` at the project root yourself:

```json
{
  "mode": "block",
  "files": ["*.md", "*.mdx", "*.txt", "*.html", "*.tsx"],
  "banned": [
    { "text": "—", "why": "No em dashes", "fix": "Use a comma, a colon or a period." },
    { "text": "Fly.io", "why": "Never name the hosting provider" },
    { "text": "/\\b(delve|leverage|utilize)\\b/i", "why": "Plain words only", "fix": "Say \"dig into\" or \"use\"." }
  ],
  "checkAnswers": true,
  "tellClaude": true
}
```

| Field | Meaning | Default |
| :- | :- | :- |
| `mode` | `block` refuses the edit; `warn` lets it through and reports it | `block` |
| `files` | Which files are checked, by pattern | Markdown, text, HTML and common component files |
| `banned` | Your rules. `text` is plain text matched without regard to case, or a pattern between slashes. `why` and `fix` are shown to Claude | none |
| `checkAnswers` | Report slips in chat replies | `true` |
| `tellClaude` | Add the rules to each prompt | `true` |

Two details worth knowing:

- **An edit is only blamed for what it adds.** If a file already has an em dash and Claude edits the sentence next to it, the edit goes through. Only a new offence is refused.
- **Claude must ask before changing `.house-style.json`.** It cannot quietly delete a rule that is in its way.

## What it runs, reads and stores

- **Reads** `.house-style.json` at the project root, and the text of each edit Claude makes to a checked file, at the moment Claude Code decides whether the edit may run.
- **Writes** `.house-style.json` once, only when you run `/style init` and the file does not exist.
- **Adds text to your prompts.** With `tellClaude` on, each prompt carries your rules to Claude as hidden context. That costs a few tokens per rule per turn.
- **Stores** nothing between sessions. The list of slips lives in the session and ends with it.
- **Sends nothing.** No network calls, no model calls of its own, no telemetry.

Like every mod, it runs with the same access to your machine as Claude Code itself. The full statement is in [PRIVACY.md](PRIVACY.md).

## Limits

- **It matches text, it does not understand it.** A rule against naming a provider will also fire on a sentence that says not to name it. Write patterns narrowly.
- **Replies are reported, not blocked.** By the time a reply can be checked, you have already read it.
- **Only the Edit and Write tools are checked.** Text written by a shell command, such as `echo` into a file, is not.
- **A whole-file rewrite is checked whole.** When Claude rewrites a file from scratch, old offences in it count, because the mod cannot see the old version.

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

## License

MIT
