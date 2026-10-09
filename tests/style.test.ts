import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { added, answerLine, briefing, isChecked, parseConfig, scan, STARTER } from '../hooks/style'

const ROOT = '/repo'
const DASH = '—'
const RULES = {
  banned: [
    { text: DASH, why: 'No em dashes', fix: 'Use a comma.' },
    { text: 'Fly.io', why: 'Never name the hosting provider' },
    { text: '/\\bdelve\\b/i', why: 'Plain words only', fix: 'Say "dig into".' },
  ],
}
const CONFIG = JSON.stringify(RULES)

const config = () => {
  const parsed = parseConfig(CONFIG)

  if (typeof parsed === 'string') throw new Error(parsed)

  return parsed
}

describe('scanning', () => {
  test('each banned phrase is found with its line and the text around it', () => {
    const hits = scan(config().banned, `Fast setup.\nIt works ${DASH} mostly.\nHosted on fly.io today.`, 'README.md')

    expect(hits.map(hit => [hit.line, hit.why])).toEqual([
      [2, 'No em dashes'],
      [3, 'Never name the hosting provider'],
    ])
    expect(hits[0]?.excerpt).toBe(`It works ${DASH} mostly.`)
  })

  test('plain text ignores case and a pattern keeps its own flags', () => {
    expect(scan(config().banned, 'hosted on FLY.IO', 'x')).toHaveLength(1)
    expect(scan(config().banned, 'We Delve into it', 'x')).toHaveLength(1)
    expect(scan(config().banned, 'the delver delved', 'x')).toHaveLength(0)
  })

  test('plain text is not read as a pattern', () => {
    // The dot in "Fly.io" is a dot, not "any character".
    expect(scan(config().banned, 'see flyxio', 'x')).toHaveLength(0)
  })

  test('an edit is blamed only for what it adds', () => {
    const banned = config().banned
    const before = `Old line ${DASH} already here.`

    expect(added(banned, before, `Old line ${DASH} already here. And more.`, 'x')).toHaveLength(0)
    expect(added(banned, before, `Old line ${DASH} already here ${DASH} and a new one.`, 'x')).toHaveLength(1)
    expect(added(banned, 'clean', 'clean again', 'x')).toHaveLength(0)
    expect(added(banned, before, 'Old line, fixed.', 'x')).toHaveLength(0)
  })

  test('only the listed kinds of file are checked', () => {
    expect(isChecked(STARTER.files, 'README.md')).toBe(true)
    expect(isChecked(STARTER.files, 'web/app/page.tsx')).toBe(true)
    expect(isChecked(STARTER.files, 'src/main.rs')).toBe(false)
    expect(isChecked(['docs/**'], 'docs/guide/intro.rst')).toBe(true)
  })

  test('the briefing states each rule and its fix', () => {
    const text = briefing(config())

    expect(text).toMatch(new RegExp(`Never write "${DASH}" \\(No em dashes\\)\\. Use a comma\\.`))
    expect(text).toMatch(/- Plain words only\. Say "dig into"\./)
  })

  test('the line under a reply counts the slips and names the rules', () => {
    const hits = scan(config().banned, `One ${DASH} two ${DASH} and we delve.`, 'reply')

    expect(answerLine(hits)).toBe('style: 3 slips in this reply (No em dashes; Plain words only)')
  })

  test('a config that is wrong says how', () => {
    expect(parseConfig('{')).toBe('not valid JSON')
    expect(parseConfig('{"mode":"loud"}')).toBe('"mode" must be "block" or "warn"')
    expect(parseConfig('{"banned":[{"text":"/(/"}]}')).toBe('"/(/" is not a valid pattern')
    expect(parseConfig('{"banned":["TODO"]}')).toMatchObject({ banned: [{ text: 'TODO', why: 'No "TODO"' }] })
  })
})

// --------------------------------------------------------- through the engine

type World = { toasts: string[]; contexts: string[][] }

function world(on: On, text: string | null = CONFIG): World {
  const state: World = { toasts: [], contexts: [] }

  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.exists', ($, e) => ({ value: text !== null && e.path === `${ROOT}/.house-style.json` }))
  on('fs.read', () => ({ value: text ?? '' }))
  on('ui.toast', ($, e) => {
    state.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  on('prompt.submit', ($, e) => {
    state.contexts.push([...(e.context ?? [])])

    return { text: e.text, context: e.context }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.check', () => ({ decision: 'allow' }))

  return state
}

const START = { cwd: ROOT, surface: 'terminal', isInteractive: true } as const
const PROMPT = { text: 'write the readme', wait: false, origin: { kind: 'composer' } } as const
const answer = (text: string) =>
  ({ answer: text, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' }) as const
const write = (path: string, content: string) => ({ tool: 'Write', input: { file_path: `${ROOT}/${path}`, content } })

describe('writing files', () => {
  test('an edit that breaks a rule is refused, with the line and the fix', async ($, on) => {
    world(on)
    await $.session.start(START)

    const refused = await $.tool.check(write('README.md', `# Title\n\nFast ${DASH} and simple.\n`))

    expect(refused.decision).toBe('deny')
    expect(refused.reason).toMatch(/README\.md was not made/)
    expect(refused.reason).toMatch(new RegExp(`line 3: No em dashes\\. Found: "Fast ${DASH} and simple\\." Use a comma\\.`))
    expect(refused.reason).toMatch(/Rewrite the text to follow the rules and make the edit again\./)
  })

  test('clean text, and files that are not prose, go through', async ($, on) => {
    world(on)
    await $.session.start(START)

    expect((await $.tool.check(write('README.md', 'Fast, and simple.'))).decision).toBe('allow')
    expect((await $.tool.check(write('src/main.rs', `// a ${DASH} b`))).decision).toBe('allow')
  })

  test('an edit beside an old offence is not blamed for it', async ($, on) => {
    world(on)
    await $.session.start(START)

    const check = await $.tool.check({
      tool: 'Edit',
      input: {
        file_path: `${ROOT}/docs/guide.md`,
        old_string: `Setup ${DASH} five minutes.`,
        new_string: `Setup ${DASH} five minutes. Then run the tests.`,
      },
    })

    expect(check.decision).toBe('allow')
  })

  test('in warn mode the edit goes through and is reported', async ($, on) => {
    const state = world(on, JSON.stringify({ ...RULES, mode: 'warn' }))

    await $.session.start(START)

    expect((await $.tool.check(write('README.md', `a ${DASH} b`))).decision).toBe('allow')
    expect(state.toasts).toEqual(['1 style slip written to README.md'])
  })

  test('Claude must ask before it changes the rules', async ($, on) => {
    world(on)
    await $.session.start(START)

    const check = await $.tool.check(write('.house-style.json', '{"banned":[]}'))

    expect(check.decision).toBe('ask')
    expect(check.reason).toMatch(/the style rules themselves/)
  })

  test('with no config nothing is checked and nothing is added', async ($, on) => {
    const state = world(on, null)

    await $.session.start(START)
    await $.prompt.submit(PROMPT)

    expect((await $.tool.check(write('README.md', `a ${DASH} b`))).decision).toBe('allow')
    expect(state.contexts).toEqual([[]])
  })
})

describe('telling and reporting', () => {
  test('Claude is told the rules beside each prompt', async ($, on) => {
    const state = world(on)

    await $.session.start(START)
    await $.prompt.submit(PROMPT)

    expect(state.contexts[0]?.[0]).toMatch(/House style for this project/)
    expect(state.contexts[0]?.[0]).toMatch(/Never name the hosting provider/)
  })

  test('a reply that slips gets a line under it, a clean one is left alone', async ($, on) => {
    world(on)
    await $.session.start(START)

    const slipped = await $.turn.complete(answer(`Done ${DASH} it is deployed on Fly.io.`))
    const clean = await $.turn.complete(answer('Done. It is deployed.'))

    expect(slipped.text).toBe('style: 2 slips in this reply (No em dashes; Never name the hosting provider)')
    expect(clean.text).toBe('Done. It is deployed.')
  })

  test('the pane counts slips per rule and lists where they were', async ($, on) => {
    world(on)
    await $.session.start(START)
    await $.tool.check(write('README.md', `Fast ${DASH} simple ${DASH} done.`))
    await $.turn.complete(answer('We delve into it.'))

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({
        plugin: 'house-style-lint',
        surface,
        component: 'Pane',
        requestId: 'style',
        props: { title: 'Style Lint', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
      })

      expect(await pane.find({ type: 'Text', text: 'No em dashes' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: 'BLOCKED' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: 'IN A REPLY' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: 'README.md:1' })).toBeDefined()
      await pane.unmount()
    }
  })
})
