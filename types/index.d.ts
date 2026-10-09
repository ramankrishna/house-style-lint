/** One banned phrase found in a text. */
export type Hit = {
  /** The file's path, or `reply` for a chat answer. */
  where: string
  /** The rule's reason. */
  why: string
  fix: string
  line: number
  /** The text around the match. */
  excerpt: string
}

/** One found phrase and what became of it. */
export type Entry = Hit & {
  outcome: 'blocked' | 'warned' | 'reply'
}

/** What `.house-style.json` says, as the session last read it. */
export type Setup = {
  hasFile: boolean
  mode: 'block' | 'warn'
  rules: { text: string; why: string }[]
  /** What is wrong with the file, or null. */
  problem: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'house-style-lint': { log: Entry[]; setup: Setup }
  }
}
