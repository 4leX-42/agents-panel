export type AgentStatus = 'running' | 'done' | 'failed'

export type AgentRun = {
  id: string
  agentId?: string
  /** The subagent that spawned this one, when it is nested. */
  parentAgentId?: string
  type: string
  description: string
  model: string
  effort?: string
  status: AgentStatus
  startedAt: number
  endedAt?: number
  /** What the last request carried: the context in use now. */
  contextTokens: number
  contextMax: number
  /** Every request's tokens, summed. */
  tokens: number
  costUsd: number
  steps: number
}

export type Panel = { isDoneCollapsed: boolean }

declare module 'claude-code' {
  interface PluginState {
    'agents-panel': { agents: AgentRun[]; panel: Panel; now: number }
  }
}
