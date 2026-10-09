import { describe, expect, mock, test } from 'claude-code/testing'

import { wordsRe } from '../hooks/drawing'
import { costOf, fmtCost, fmtTime, fmtTokens, modelName, roleOf } from '../hooks/register'

const PANE = {
  plugin: 'agents-panel',
  component: 'Pane',
  requestId: 'agents-panel',
  props: {
    title: 'Agents',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const USAGE = {
  model: 'claude-haiku-5-5',
  input_tokens: 1_000,
  output_tokens: 2_000,
  cache_read_input_tokens: 40_000,
  cache_creation_input_tokens: 7_000,
}

// The engine's side of one subagent: spawned, one request, then its answer.
// Typed loosely: the test hands the hooks only the fields they read.
async function runAgent($: any, on: any, opts: { reason?: string; isDone?: boolean } = {}) {
  const clock = mock.clock(on)
  const status: (string | undefined)[] = []
  const opened: string[] = []
  // The engine's side of the display: a status line and a pane host.
  on('ui.status', ($: unknown, e: { text?: string }) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', ($: unknown, e: { id: string }) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('session.start', ($: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', ($: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('turn.step', async function* () {
    return { turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE }
  })
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({
    tool_use_id: 'tu1',
    prompt: 'Find the parser',
    description: 'Find the parser',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  })
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-haiku-5-5', effort: 'high', messageCount: 1, agentId: 'a1' })
  for await (const _ of stream) {
    // drain
  }
  await clock.advance(65_000)
  if (opts.isDone) {
    await $.turn.complete({
      answer: '',
      durationMs: 1,
      isAborted: false,
      turnId: 't1',
      agentId: 'a1',
      reason: opts.reason ?? 'answer',
    })
  }
  return { status, opened }
}

async function paneTexts($: any, surface: 'terminal' | 'desktop'): Promise<string> {
  const ui = await $.ui.mount({ ...PANE, surface })
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return texts.map((t: { text: string }) => t.text).join('\n')
}

describe('formatting', () => {
  test('names models and formats numbers', () => {
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelName('claude-haiku-5-5[1m]')).toBe('Haiku 5.5')
    expect(fmtTokens(50_000)).toBe('50k')
    expect(fmtTokens(1_200_000)).toBe('1.2M')
    expect(fmtCost(0.0123)).toBe('$0.01')
    expect(fmtTime(65_000)).toBe('1:05')
  })

  test('prices cache reads below input', () => {
    const u = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 0 }
    expect(costOf('claude-haiku-5-5', u)).toBe(0.1)
  })
})

test('the empty pane says so', async $ => {
  expect(await paneTexts($, 'terminal')).toContain('No subagents yet')
})

describe('roles', () => {
  test('Explore is the pirate, by type alone', () => {
    expect(roleOf('Explore', 'Fix the build')).toBe('pirate')
    expect(roleOf('some-plugin:Explore', 'anything')).toBe('pirate')
  })

  test('the type decides before the description', () => {
    expect(roleOf('implementer', 'Review the figma layout')).toBe('engineer')
    expect(roleOf('ui-designer', 'Implement the button')).toBe('designer')
  })

  test('the description decides for generic types', () => {
    expect(roleOf('general-purpose', 'Implement the parser')).toBe('engineer')
    expect(roleOf('general-purpose', 'Fix failing tests')).toBe('engineer')
    expect(roleOf('general-purpose', 'Review the Figma mockups')).toBe('designer')
    expect(roleOf('general-purpose', 'Summarise the meeting notes')).toBe('crab')
    // No false hits inside words: "build" holds "ui", "latest" holds "test".
    expect(roleOf('general-purpose', 'Read the latest guide')).toBe('crab')
  })

  test('extra words come from options', () => {
    expect(roleOf('general-purpose', 'Polish the storyboard', { design: wordsRe('storyboard, motion') })).toBe('designer')
    expect(roleOf('general-purpose', 'Wire the terraform', { engineer: wordsRe('terraform') })).toBe('engineer')
  })
})

test('a running subagent shows model, effort, context and tokens', async ($, on) => {
  const { status, opened } = await runAgent($, on)
  expect(status.at(-1)).toContain('▣ 1 running')
  expect(opened).toEqual(['agents-panel'])

  const text = await paneTexts($, 'terminal')
  expect(text).toContain('Find the parser')
  expect(text).toContain('Explore · Haiku 5.5 · high')
  // 50k tokens of a 200k window.
  expect(text).toContain('ctx 25% (50k) · 50k tok · ≈$0.02 · 1:05')
  expect(text).toContain('Running · 1')

  // Desktop: header tiles plus one row, the Explore agent a walking pirate.
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs.length).toBe(2)
  const row = svgs[1]
  expect(String(row.props.alt)).toContain('Find the parser (pirate): Explore, Haiku 5.5 high, running')
  expect(String(row.props.source)).toContain('class="c-pirate run"')
  expect(String(row.props.source)).toContain('ctx 25% (50k) · 50k tok')
  expect(String(svgs[0]?.props.source)).toContain('Cost')
  await ui.unmount()
})

test('a finished subagent moves to Finished and can be cleared', async ($, on) => {
  await runAgent($, on, { isDone: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'ap-done', text: /Finished · 1/ })).toBeDefined()
  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const rows = await desktop.findAll({ type: 'Svg' })
  expect(String(rows[1]?.props.source)).toContain('class="c-pirate"')
  await desktop.unmount()
  await ui.press({ key: 'ap-clear' })
  expect(await ui.find({ type: 'Text', text: /No subagents yet/ })).toBeDefined()
  await ui.unmount()
})

test('an errored subagent is marked failed', async ($, on) => {
  await runAgent($, on, { isDone: true, reason: 'error' })
  expect(await paneTexts($, 'terminal')).toContain('✗')
})
