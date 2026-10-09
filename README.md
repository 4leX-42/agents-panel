# agents-panel

A Claude Code mod: a pane showing every subagent in the session, whatever its type and whatever started it (the Agent tool, a skill, a workflow, a nested subagent). Adapted from the agents panel in [savvy-progress](https://github.com/JohnnyVizz/claude-kit/tree/main/plugins/savvy-progress), without the savvy-flow workflow.

Each row shows:

- what the agent is doing (its description) and its status: `●` running, `✓` done, `✗` failed
- agent type · **model** · **effort**
- **context**: a fill bar plus % of the model's window and tokens in use (yellow from 50%, red from 80%)
- **tokens** summed over all its requests · **≈cost** · **time**

On desktop each row is drawn as a card with a pixel crab dressed for the agent's role, walking while it runs:

- **pirate**: Explore agents
- **engineer** (a software developer in headphones and glasses, typing on a laptop): development work, i.e. an agent type or task mentioning implement, build, fix, test, refactor, code, debug, deploy and the like
- **designer** (beret, palette, brush): design work, i.e. design, Figma, UI/UX, mockup, layout, CSS, style, prototype and the like
- **plain crab**: everything else

The agent type is checked before the task description, so an `implementer` stays an engineer even when its task mentions a layout. The crab's accent and the model name take the model family's colour (Fable violet, Opus orange, Sonnet blue, Haiku green). The terminal draws the same data as text rows.

The header totals cost, tokens and wall time across all subagents. Nested subagents are marked `↳`. Finished agents collapse under **Finished**, and **Clear** removes them. While any agent runs, the status line shows `▣ N running · ≈$cost`.

## Using it

- `/agents-panel` shows or hides the pane.
- `designWords` and `engineerWords` (comma-separated) add words to the designer and engineer rules, e.g. `storyboard, motion` or `terraform`.
- The `autoOpen` option (on by default) opens the pane when a subagent starts while none were running. If you close it mid-batch, it stays closed.

Sprites and pane layout adapted from savvy-progress (its crab is Pixel Clawd from DockCrab). Cost is an estimate from token counts at list prices. Effort appears after the agent's first model request.

## Install

Locally, from this folder:

```bash
claude plugin marketplace add ~/Documents/GitHub/agents-panel
claude plugin install agents-panel@agents-panel --scope user
```

Once this repo is on GitHub, from any Claude Code terminal session:

```
/plugin install agents-panel --marketplace <owner>/agents-panel
```

Under development: `claude plugin validate .` and `claude plugin test .`
