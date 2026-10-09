# Privacy

Last updated: October 9, 2026

Style Lint is a mod that runs inside Claude Code on your own machine. It has no server and no account.

## What it collects

Nothing. Style Lint does not collect, transmit or share any data. It makes no network requests, makes no model calls of its own, and sends no telemetry or analytics. The author receives no information about you or your use of it.

## What it handles on your machine

To do its job, Style Lint works with the following, all of which stay on your computer:

- **During a session, in memory:** the text of each edit Claude makes to a checked file, the text of Claude's replies when reply checking is on, and a short list of the places a rule was broken, each with a line number and the few words around it. This is held by Claude Code for the length of the session and is gone when the session ends.
- **In your project:** it reads `.house-style.json`, and writes that file once if you run `/style init` and it does not exist yet.

Nothing is kept between sessions.

## What it adds to your conversation

Unless you turn `tellClaude` off, it adds your style rules to each prompt you send, as context Claude reads. That text goes to the model along with the rest of your conversation, under the same terms as everything else you send through Claude Code. It contains only what you wrote in `.house-style.json`.

## Removing its data

Uninstalling the plugin stops all of the above. `.house-style.json` is a file in your project and is yours to keep or delete.

## What Style Lint does not cover

Style Lint runs inside Claude Code. How Claude Code and Anthropic handle your prompts, code and usage is governed by Anthropic's own policies, not this one.

## Changes

Any change to this policy will be made in this file, and the history is visible in the repository.

## Contact

Questions or concerns: open an issue at https://github.com/ramankrishna/house-style-lint/issues
