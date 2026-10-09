// The style rules, with no engine in them: every function here is pure, so
// the tests and the hooks read the same judgement.

import type { Hit } from '../types'

export const CONFIG = '.house-style.json'

export type Banned = {
  /** Plain text, matched without regard to case, or a pattern written `/like this/i`. */
  text: string
  why: string
  fix: string
}

export type Config = {
  /** `block` refuses the edit so Claude rewrites it; `warn` lets it through and reports. */
  mode: 'block' | 'warn'
  /** Which files are checked, by pattern. */
  files: string[]
  banned: Banned[]
  /** Whether replies in chat are checked and reported too. */
  checkAnswers: boolean
  /** Whether Claude is told the rules beside each prompt. */
  tellClaude: boolean
}

export const DEFAULT_FILES = ['*.md', '*.mdx', '*.txt', '*.html', '*.tsx', '*.jsx', '*.vue', '*.svelte']

export const STARTER: Config = {
  mode: 'block',
  files: DEFAULT_FILES,
  banned: [
    { text: '—', why: 'No em dashes', fix: 'Use a comma, a colon or a period.' },
    {
      text: '/\\b(delve|leverage|utilize)\\b/i',
      why: 'Plain words only',
      fix: 'Say "dig into" or "use".',
    },
  ],
  checkAnswers: true,
  tellClaude: true,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(one => typeof one === 'string')

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The pattern a banned entry stands for, always global; null when it is not valid. */
export function patternOf(text: string): RegExp | null {
  const found = /^\/(.+)\/([a-z]*)$/.exec(text)

  try {
    if (found === null) return new RegExp(escapeRegExp(text), 'gi')

    const flags = found[2] ?? ''

    return new RegExp(found[1] ?? '', flags.includes('g') ? flags : `${flags}g`)
  } catch {
    return null
  }
}

/** Reads `.house-style.json`; answers the config, or one line saying what is wrong. */
export function parseConfig(text: string): Config | string {
  let data: unknown

  try {
    data = JSON.parse(text)
  } catch {
    return 'not valid JSON'
  }

  if (!isRecord(data)) return 'expected an object with "banned"'

  const mode = data.mode ?? 'block'
  const files = data.files ?? DEFAULT_FILES
  const rawBanned = data.banned ?? []

  if (mode !== 'block' && mode !== 'warn') return '"mode" must be "block" or "warn"'
  if (!isStrings(files)) return '"files" must be a list of patterns'
  if (!Array.isArray(rawBanned)) return '"banned" must be a list'

  const banned: Banned[] = []

  for (const raw of rawBanned) {
    const entry = typeof raw === 'string' ? { text: raw } : raw

    if (!isRecord(entry) || typeof entry.text !== 'string' || entry.text === '') {
      return 'each banned entry needs a "text"'
    }
    if (patternOf(entry.text) === null) return `"${entry.text}" is not a valid pattern`

    banned.push({
      text: entry.text,
      why: typeof entry.why === 'string' && entry.why !== '' ? entry.why : `No "${entry.text}"`,
      fix: typeof entry.fix === 'string' ? entry.fix : '',
    })
  }

  return {
    mode,
    files,
    banned,
    checkAnswers: data.checkAnswers !== false,
    tellClaude: data.tellClaude !== false,
  }
}

// ------------------------------------------------------------------ files

function globOf(pattern: string): RegExp {
  const body = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')

  return new RegExp(`^${body}$`)
}

/** Whether a path, relative to the project, is one of the checked files. */
export function isChecked(files: readonly string[], path: string): boolean {
  const clean = path.replace(/^\.\//, '')
  const base = clean.split('/').pop() ?? clean

  return files.some(pattern =>
    pattern.includes('/') ? globOf(pattern).test(clean) : globOf(pattern).test(base),
  )
}

export function relative(root: string, path: string): string {
  const base = root.endsWith('/') ? root : `${root}/`

  return root !== '' && path.startsWith(base) ? path.slice(base.length) : path
}

// --------------------------------------------------------------- scanning

/** The line a match sits on, cut to a readable width around the match. */
function excerptOf(text: string, at: number, length: number): string {
  const start = text.lastIndexOf('\n', at - 1) + 1
  const endOfLine = text.indexOf('\n', at)
  const line = text.slice(start, endOfLine === -1 ? text.length : endOfLine)
  const column = at - start
  const from = Math.max(0, column - 30)
  const to = Math.min(line.length, column + length + 30)

  return `${from > 0 ? '...' : ''}${line.slice(from, to).trim()}${to < line.length ? '...' : ''}`
}

type Found = { rule: number; at: number; length: number }

function findAll(banned: readonly Banned[], text: string): Found[] {
  const found: Found[] = []

  banned.forEach((entry, rule) => {
    const pattern = patternOf(entry.text)

    if (pattern === null) return

    for (const match of text.matchAll(pattern)) {
      if (match[0] === '') continue

      found.push({ rule, at: match.index, length: match[0].length })
    }
  })

  return found.sort((a, b) => a.at - b.at)
}

function hitsOf(banned: readonly Banned[], text: string, found: readonly Found[], where: string): Hit[] {
  return found.map(one => ({
    where,
    why: banned[one.rule]?.why ?? '',
    fix: banned[one.rule]?.fix ?? '',
    line: text.slice(0, one.at).split('\n').length,
    excerpt: excerptOf(text, one.at, one.length),
  }))
}

/** Every banned phrase in a text. */
export function scan(banned: readonly Banned[], text: string, where: string): Hit[] {
  return hitsOf(banned, text, findAll(banned, text), where)
}

/**
 * The banned phrases an edit adds: for each rule, the matches in the new text
 * beyond how many the old text already held, so an edit near an old offence
 * is not blamed for it.
 */
export function added(banned: readonly Banned[], before: string, after: string, where: string): Hit[] {
  const old = findAll(banned, before)
  const now = findAll(banned, after)
  const fresh = now.filter((one, index) => {
    const earlier = now.slice(0, index).filter(other => other.rule === one.rule).length
    const allowance = old.filter(other => other.rule === one.rule).length

    return earlier >= allowance
  })

  return hitsOf(banned, after, fresh, where)
}

// ------------------------------------------------------------------ words

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

/** What Claude reads when an edit is refused: each offence and how to fix it. */
export function blockText(path: string, hits: readonly Hit[]): string {
  const lines = hits
    .slice(0, 8)
    .map(hit => `- line ${hit.line}: ${hit.why}. Found: "${hit.excerpt}"${hit.fix !== '' ? ` ${hit.fix}` : ''}`)
  const more = hits.length > 8 ? [`- and ${hits.length - 8} more`] : []

  return [
    `Style Lint: this edit to ${path} was not made. It breaks the project's style rules in ${plural(hits.length, 'place')}:`,
    ...lines,
    ...more,
    'Rewrite the text to follow the rules and make the edit again.',
  ].join('\n')
}

/** The line shown under a reply that broke the rules. */
export function answerLine(hits: readonly Hit[]): string {
  const reasons = [...new Set(hits.map(hit => hit.why))]

  return `style: ${plural(hits.length, 'slip')} in this reply (${reasons.slice(0, 3).join('; ')}${reasons.length > 3 ? '; ...' : ''})`
}

/** What Claude reads beside each prompt, so the rules are followed the first time. */
export function briefing(config: Config): string {
  return [
    'House style for this project. It applies to text you write into files and to your replies:',
    ...config.banned.map(entry => {
      const what = /^\/.+\/[a-z]*$/.test(entry.text) ? entry.why : `Never write "${entry.text}" (${entry.why})`

      return `- ${what}.${entry.fix !== '' ? ` ${entry.fix}` : ''}`
    }),
  ].join('\n')
}

export const clip = (text: string, width: number): string =>
  text.length > width ? `${text.slice(0, Math.max(1, width - 3))}...` : text
