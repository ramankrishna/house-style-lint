// Style Lint: your house style, checked on every piece of text Claude writes.
//
// Claude is told the rules beside each prompt, an edit that breaks one is
// refused with the offending lines so it can rewrite, and a reply that breaks
// one is reported under the answer. Nothing here asks a model anything of its
// own or leaves the machine.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Entry, Hit } from '../types'
import {
  added,
  answerLine,
  blockText,
  briefing,
  clip,
  CONFIG,
  isChecked,
  parseConfig,
  relative,
  scan,
  STARTER,
} from './style'
import type { Config } from './style'

const PANE = 'style'

const log = atom({ plugin: 'house-style-lint', key: 'log' } as const, [])
const setup = atom({ plugin: 'house-style-lint', key: 'setup' } as const, {
  hasFile: false,
  mode: 'block',
  rules: [],
  problem: null,
})

// What the hooks read without a call on `$` on every tool call.
let root = ''
let config: Config | null = null

const field = (input: unknown, name: string): string => {
  const value = (input as Record<string, unknown> | null)?.[name]

  return typeof value === 'string' ? value : ''
}

/** Reads `.house-style.json` at the project root; with none, nothing is checked. */
async function load($: EngineInterface): Promise<void> {
  root = await $.session.root()

  const path = `${root}/${CONFIG}`
  const hasFile = await $.fs.exists(path)
  let text = ''

  if (hasFile) {
    try {
      text = await $.fs.read(path)
    } catch {
      text = ''
    }
  }

  const parsed = hasFile ? parseConfig(text) : null

  config = parsed === null || typeof parsed === 'string' ? null : parsed
  await update($, setup, () => ({
    hasFile,
    mode: config?.mode ?? 'block',
    rules: (config?.banned ?? []).map(entry => ({ text: entry.text, why: entry.why })),
    problem: typeof parsed === 'string' ? parsed : null,
  }))
}

async function init($: EngineInterface): Promise<string> {
  root = await $.session.root()

  const path = `${root}/${CONFIG}`

  if (await $.fs.exists(path)) return `${CONFIG} already exists. Edit it, then run /style.`

  await $.fs.write(path, `${JSON.stringify(STARTER, null, 2)}\n`)
  await load($)

  return `Wrote ${CONFIG} with two example rules. Replace them with your own.`
}

const note = ($: EngineInterface, hits: readonly Hit[], outcome: Entry['outcome']) =>
  update($, log, was => [...was, ...hits.map(hit => ({ ...hit, outcome }))].slice(-60))

/** The banned phrases a file edit would add, or none when the file is not checked. */
function findInEdit(tool: string, input: unknown): { path: string; hits: Hit[] } {
  const path = relative(root, field(input, 'file_path'))

  if (config === null || path === '' || !isChecked(config.files, path)) return { path, hits: [] }

  return {
    path,
    hits:
      tool === 'Write'
        ? scan(config.banned, field(input, 'content'), path)
        : added(config.banned, field(input, 'old_string'), field(input, 'new_string'), path),
  }
}

const openPane = ($: EngineInterface) =>
  $.ui.open({ id: PANE, title: 'Style Lint', focus: true, closeOnEscape: true })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'style',
      description: 'Show the style rules Claude writes under here, and where it slipped',
      argumentHint: '[init]',
    })
    await load($)

    return next(e)
  })

  // /clear, /resume and /branch reset the session's state and raise no session.start.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await load($)

    return next(e)
  })

  on('command.run', { command: 'style' }, async ($, e) => {
    if (e.args.trim() === 'init') return { text: await init($) }

    await load($)
    await openPane($)

    return {}
  })

  // Tell Claude the rules up front: following them the first time costs less
  // than a refused edit and a rewrite.
  on('prompt.submit', async ($, e, next) => {
    // An edit you make by hand between turns takes hold on the next one.
    await load($)

    if (config === null || !config.tellClaude || config.banned.length === 0) return next(e)

    return next({ ...e, context: [...(e.context ?? []), briefing(config)] })
  })

  on('tool.check', { tool: ['Edit', 'Write'] }, async ($, e, next) => {
    const decided = await next(e)
    const path = relative(root, field(e.input, 'file_path'))

    // The rules are yours: Claude asks before it changes them.
    if (config !== null && path === CONFIG && decided.decision === 'allow') {
      return { decision: 'ask', reason: `Style Lint: this changes ${CONFIG}, the style rules themselves.` }
    }

    const { hits } = findInEdit(e.tool, e.input)

    if (hits.length === 0) return decided

    if (config?.mode === 'warn') {
      await note($, hits, 'warned')
      $.ui.toast(`${hits.length} style ${hits.length === 1 ? 'slip' : 'slips'} written to ${path}`)

      return decided
    }

    await note($, hits, 'blocked')

    return { decision: 'deny', reason: blockText(path, hits) }
  }).catch(($, e, next) => {
    const { path, hits } = findInEdit(e.tool, e.input)

    return hits.length > 0 && config?.mode === 'block'
      ? { decision: 'deny', reason: blockText(path, hits) }
      : next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)

    if (config === null || !config.checkAnswers || e.agentId !== undefined || e.reason !== 'answer') {
      return done
    }

    const hits = scan(config.banned, e.answer, 'reply')

    if (hits.length === 0) return done

    await note($, hits, 'reply')

    const line = answerLine(hits)

    return { ...done, text: done.text === e.answer ? line : `${done.text}\n${line}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const now = await read($, setup)
    const entries = await read($, log)
    const width = Math.max(24, e.props.bodyColumns - 10)
    const count = (why: string): number => entries.filter(entry => entry.why === why).length

    return (
      <Box flexDirection="column" rowGap={1}>
        {now.problem !== null && (
          <Text color="error">
            {CONFIG} is not usable: {now.problem}
          </Text>
        )}
        {!now.hasFile && (
          <Box flexDirection="column">
            <Text>No style rules yet.</Text>
            <Text dimColor>/style init writes a starter {CONFIG}.</Text>
          </Box>
        )}
        {now.rules.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>
              {now.mode === 'block'
                ? 'An edit that breaks a rule is refused, and Claude rewrites it.'
                : 'An edit that breaks a rule goes through and is reported here.'}
            </Text>
            {now.rules.map(rule => (
              <Box flexDirection="row" columnGap={2}>
                <Box width={4} flexShrink={0}>
                  {count(rule.why) > 0 ? (
                    <Text color="warning">{count(rule.why)}</Text>
                  ) : (
                    <Text dimColor>0</Text>
                  )}
                </Box>
                <Text>{clip(rule.why, width)}</Text>
              </Box>
            ))}
          </Box>
        )}
        {now.hasFile && (
          <Box flexDirection="column">
            {entries.length === 0 && <Text dimColor>No slips this session.</Text>}
            {entries
              .slice(-8)
              .reverse()
              .map(entry => (
                <Box flexDirection="column">
                  <Box flexDirection="row" columnGap={2}>
                    {entry.outcome === 'blocked' ? (
                      <Text color="success">BLOCKED</Text>
                    ) : entry.outcome === 'warned' ? (
                      <Text color="warning">WRITTEN</Text>
                    ) : (
                      <Text color="warning">IN A REPLY</Text>
                    )}
                    <Text>
                      {clip(entry.where, 30)}
                      {entry.outcome === 'reply' ? '' : `:${entry.line}`}
                    </Text>
                  </Box>
                  <Text dimColor>{clip(entry.excerpt, width + 8)}</Text>
                </Box>
              ))}
          </Box>
        )}
      </Box>
    )
  })
}
