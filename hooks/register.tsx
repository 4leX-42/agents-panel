import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRun, Panel } from '../types'

import { HEADER_H, ROW_H, agentAlt, agentSvg, headerSvg, paneWidth, roleOf, wordsRe } from './drawing'
import { colorOf, costOf, ctxOf, fmtCost, fmtTime, fmtTokens, modelName, statsOf, tokensOf, totals, windowOf } from './format'

export { roleOf } from './drawing'
export { costOf, fmtCost, fmtTime, fmtTokens, modelName } from './format'

// Every subagent of the session, whatever its type or the workflow that started
// it: model, effort, context, tokens, estimated cost and time.

const agents = atom({ plugin: 'agents-panel', key: 'agents' } as const, [])
const panel = atom({ plugin: 'agents-panel', key: 'panel' } as const, { isDoneCollapsed: false })
const now = atom({ plugin: 'agents-panel', key: 'now' } as const, 0)

const PANE = 'agents-panel'
const COMMAND = 'agents-panel'

const bar = (pct: number, width: number): string => {
  const filled = Math.round((width * Math.max(0, Math.min(100, pct))) / 100)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

const STATUS_GLYPH: Record<string, string> = { running: '●', done: '✓', failed: '✗' }

async function openPane($: EngineInterface): Promise<void> {
  const at = await $.clock.now()
  await update($, now, () => at)
  await $.ui.open({ id: PANE, title: 'Agents' })
}

async function togglePane($: EngineInterface): Promise<boolean> {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await openPane($)
  return true
}

// While anything runs: `▣ 2 running · ≈$0.31` in the status line.
async function showStatus($: EngineInterface): Promise<void> {
  const list = await read($, agents)
  const running = list.filter(a => a.status === 'running')
  if (!running.length) return $.ui.status(undefined)
  const cost = list.reduce((s, a) => s + a.costUsd, 0)
  $.ui.status(`▣ ${running.length} running · ≈${fmtCost(cost)}`)
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: COMMAND,
      description: 'Show or hide the subagents pane: model, effort, context, tokens, cost and time',
    })
    // Ticks running agents' clocks; quiet when nothing runs.
    $.clock.every(1000, () => {
      void (async () => {
        const list = await read($, agents)
        if (!list.some(a => a.status === 'running')) return
        const at = await $.clock.now()
        await update($, now, () => at)
      })()
    })
    return started
  })

  on('command.run', { command: COMMAND }, async $ => {
    const isOpen = await togglePane($)
    return { text: isOpen ? 'Agents pane opened.' : 'Agents pane closed.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined) return started

    const at = await $.clock.now()
    const before = await read($, agents)
    const run: AgentRun = {
      id: started.agentId ?? e.tool_use_id,
      agentId: started.agentId,
      parentAgentId: e.parentAgentId,
      type: e.subagentType,
      description: e.description,
      model: started.model,
      status: 'running',
      startedAt: at,
      contextTokens: 0,
      contextMax: windowOf(started.model),
      tokens: 0,
      costUsd: 0,
      steps: 0,
    }
    await update($, agents, list => [...list.filter(a => a.id !== run.id), run].slice(-200))
    await update($, now, () => at)
    await showStatus($)

    // Opens with the first of a batch; closed mid-batch, it stays closed.
    if (options.autoOpen !== false && !before.some(a => a.status === 'running')) {
      if (!(await $.ui.panes()).some(p => p.id === PANE)) void openPane($)
    }
    return started
  }).catch(($, e, next) => next(e))

  // Each model request of a subagent: live context, effort, tokens and cost.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const agentId = e.agentId
    const usage = result.usage
    if (!agentId || !usage) return result

    const model = usage.model || e.model
    await update($, agents, list =>
      list.map(a =>
        a.agentId !== agentId
          ? a
          : {
              ...a,
              model,
              effort: typeof e.effort === 'string' ? e.effort : typeof e.effort === 'number' ? String(e.effort) : a.effort,
              contextTokens: tokensOf(usage),
              contextMax: windowOf(model),
              tokens: a.tokens + tokensOf(usage),
              costUsd: a.costUsd + costOf(model, usage),
              steps: a.steps + 1,
            },
      ),
    )
    await showStatus($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId === undefined) return next(e)
    const at = await $.clock.now()
    await update($, agents, list =>
      list.map(a => {
        if (a.agentId !== agentId) return a
        // A run whose steps went unseen still gets the turn's own sum.
        const fallback = a.steps === 0 ? e.usage : undefined
        return {
          ...a,
          status: (e.reason === 'answer' ? 'done' : 'failed') as AgentRun['status'],
          endedAt: at,
          ...(fallback
            ? {
                model: fallback.model || a.model,
                tokens: tokensOf(fallback),
                costUsd: costOf(fallback.model || a.model, fallback),
              }
            : {}),
        }
      }),
    )
    await update($, now, () => at)
    await showStatus($)
    return next(e)
  })

  const words = { design: wordsRe(options.designWords), engineer: wordsRe(options.engineerWords) }

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const list = await read($, agents)
    const p: Panel = await read($, panel)
    const at = Math.max(await read($, now), ...list.map(a => a.startedAt), 0)

    const running = list.filter(a => a.status === 'running').reverse()
    const finished = list.filter(a => a.status !== 'running').reverse()
    const t = totals(list, at)
    const cols = Math.max(24, e.props.bodyColumns || 40)
    const barW = Math.max(6, Math.min(20, cols - 34))
    const isNested = (a: AgentRun) => a.parentAgentId !== undefined

    const row = (a: AgentRun) => {
      const color = colorOf(a.model)
      const ctx = ctxOf(a)
      const pad = isNested(a) ? '    ' : '  '
      return (
        <Box key={a.id} flexDirection="column" marginBottom={1}>
          <Text wrap="truncate-end">
            {isNested(a) ? <Text dimColor>↳ </Text> : ''}
            <Text color={color}>▣ </Text>
            <Text bold>{a.description || a.type}</Text>{' '}
            <Text color={a.status === 'failed' ? 'red' : a.status === 'done' ? 'green' : color}>
              {STATUS_GLYPH[a.status]}
            </Text>
          </Text>
          <Text dimColor wrap="truncate-end">
            {pad}
            {a.type} · <Text color={color}>{modelName(a.model)}</Text>
            {a.effort ? ` · ${a.effort}` : ''}
          </Text>
          <Text wrap="truncate-end">
            {pad}
            <Text color={ctx >= 80 ? 'red' : ctx >= 50 ? 'yellow' : color}>{bar(ctx, barW)}</Text>
            <Text dimColor> {statsOf(a, at)}</Text>
          </Text>
        </Box>
      )
    }

    if (list.length === 0) {
      return <Text dimColor>No subagents yet this session.</Text>
    }

    const finishedToggle = finished.length > 0 && (
      <Box flexDirection="row" gap={2}>
        <Button
          key="ap-done"
          label={`${p.isDoneCollapsed ? '▸' : '▾'} Finished · ${finished.length}`}
          plain
          onPress={() => update($, panel, prev => ({ ...prev, isDoneCollapsed: !prev.isDoneCollapsed }))}
        />
        <Button
          key="ap-clear"
          label="Clear"
          plain
          onPress={() => update($, agents, prev => prev.filter(a => a.status === 'running'))}
        />
      </Box>
    )

    // Desktop: each row one SVG, the crab dressed for the agent's role.
    if (e.surface === 'desktop' && 'Svg' in ui) {
      const { Svg } = ui
      const W = paneWidth(e.props.bodyColumns)
      const svgRow = (a: AgentRun) => {
        const role = roleOf(a.type, a.description, words)
        return <Svg key={a.id} source={agentSvg(W, a, at, role)} alt={agentAlt(a, at, role)} width={W} height={ROW_H} />
      }
      return (
        <Box flexDirection="column" gap={1}>
          <Svg
            key="ap-header"
            source={headerSvg(W, t)}
            alt={`≈${fmtCost(t.cost)}, ${fmtTokens(t.tokens)} tokens, ${running.length} running, ${finished.length} finished`}
            width={W}
            height={HEADER_H}
          />
          <Box flexDirection="column">
            {running.length > 0 && <Text dimColor>Running · {running.length}</Text>}
            {running.map(svgRow)}
          </Box>
          {finishedToggle}
          {!p.isDoneCollapsed && finished.length > 0 && <Box flexDirection="column">{finished.map(svgRow)}</Box>}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold>
          ≈{fmtCost(t.cost)} · {fmtTokens(t.tokens)} tokens · {fmtTime(t.time)}
        </Text>
        <Text dimColor>
          {running.length} running · {finished.length} finished
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {running.length > 0 && <Text dimColor>Running · {running.length}</Text>}
          {running.map(row)}
          {finishedToggle}
          {!p.isDoneCollapsed && finished.map(row)}
        </Box>
      </Box>
    )
  })
}
