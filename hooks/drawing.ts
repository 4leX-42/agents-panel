import type { AgentRun } from '../types'

import { colorOf, ctxOf, fmtCost, fmtTime, fmtTokens, modelName, statsOf } from './format'
import type { Totals } from './format'

// The desktop pane: each row one SVG, with a pixel crab dressed for the agent's
// role. Sprites and layout adapted from savvy-progress (JohnnyVizz/claude-kit),
// whose crab is Pixel Clawd from DockCrab.

export type Role = 'crab' | 'pirate' | 'engineer' | 'designer'

// Words that mark a role in an agent's type or task description; the type wins.
const DESIGN = /\b(design\w*|figma|ui|ux|visual\w*|mock-?ups?|wireframe\w*|layouts?|typograph\w*|colou?rs?|css|styl\w*|themes?|icons?|brand\w*|accessib\w*|a11y|prototyp\w*)\b/i
const ENGINEER =
  /\b(implement\w*|engineer\w*|develop\w*|code|coding|build\w*|fix\w*|bugs?|debug\w*|refactor\w*|tests?|testing|tdd|features?|migrat\w*|deploy\w*|compil\w*|typecheck\w*|lint\w*|api|endpoints?|scripts?|ship\w*|merge\w*)\b/i

export const wordsRe = (extra: unknown): RegExp | null => {
  if (typeof extra !== 'string' || !extra.trim()) return null
  const words = extra
    .split(',')
    .map(w => w.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter(Boolean)
  return words.length ? new RegExp(`\\b(${words.join('|')})\\b`, 'i') : null
}

export type RoleWords = { design?: RegExp | null; engineer?: RegExp | null }

const matches = (text: string, base: RegExp, extra?: RegExp | null): boolean =>
  base.test(text) || (extra ? extra.test(text) : false)

export const roleOf = (type: string, description: string, words: RoleWords = {}): Role => {
  // `my-plugin:implementer` names the same agent as `implementer`.
  const bare = type.replace(/^.*:/, '').replace(/[-_]/g, ' ')
  if (/^explore$/i.test(bare.trim())) return 'pirate'
  if (matches(bare, DESIGN, words.design)) return 'designer'
  if (matches(bare, ENGINEER, words.engineer)) return 'engineer'
  if (matches(description, DESIGN, words.design)) return 'designer'
  if (matches(description, ENGINEER, words.engineer)) return 'engineer'
  return 'crab'
}

export const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"

export const xml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

// Rough advance of system UI text, in em; good enough to fit a line.
const charEm = (ch: string): number =>
  /[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-ZА-ЯЁmwшщжюМШЩЖЮ@%]/.test(ch) ? 0.72 : 0.56

const textWidth = (s: string, size: number): number => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)

// Cuts `s` to fit `maxW` pixels, with an ellipsis when it had to cut.
export const fitText = (s: string, size: number, maxW: number): string => {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > maxW) break
    out += ch
  }
  return out + '…'
}

const PANE_CSS = `<style>
.t{fill:#1f1f1f}.s{fill:#6b6b68}.m{fill:#9a9a96}.k{fill:#ecebe8}.ln{stroke:#e4e4e1}.tile{fill:#f4f3f0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.m{fill:#7d7d79}.k{fill:#2c2c2b}.ln{stroke:#333331}.tile{fill:#262625}}
.live{animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.3}}
@media (prefers-reduced-motion: reduce){.live{animation:none}}
</style>`

// A 24×18 crab on a 30×28 grid. The body keeps the brand clay; the model
// family's color lives in the costume's accent.
const CLAY = '#D97757'
const INK = '#1F1E1D'

// `cls` puts a pixel in a named group: `bd` (the default) is the body and its
// costume, `la`/`lb` the leg pairs, anything else a prop with its own motion.
type Fill = (x: number, y: number, w: number, h: number, c: string, cls?: string) => void

const stamp = (f: Fill, x: number, y: number, rows: string[], map: Record<string, string>, cls?: string): void =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => map[ch] && f(x + dx, y + dy, 1, 1, map[ch] ?? '', cls)))

// `armCls` lets a raised claw travel with the prop it holds.
const crabBody = (f: Fill, armFront = 0, armCls?: string): void => {
  f(7, 10, 16, 12, CLAY)
  f(3, 14, 4, 4, CLAY)
  f(23, 14 + armFront, 4, 4, CLAY, armCls)
  f(9, 12, 2, 2, INK)
  f(19, 12, 2, 2, INK)
  f(7, 22, 2, 4, CLAY, 'la')
  f(17, 22, 2, 4, CLAY, 'la')
  f(11, 22, 2, 4, CLAY, 'lb')
  f(21, 22, 2, 4, CLAY, 'lb')
}

// Pure CSS, run by the compositor: no redraws. Periods divide one second, so the
// once-a-second redraw of a running row restarts them in phase. Every crab walks;
// each costume adds its prop's own motion on top.
const CRAB_CSS = `<style>
.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}
.run .bd{animation:bob .5s steps(1) infinite -.125s}
.run g{transform-box:fill-box}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}
.c-engineer.run .typ{transform-origin:0 50%;animation:type 1s steps(1) infinite}
.c-engineer.run .cur{animation:blink .5s steps(1) infinite}
.c-engineer.run .tap{animation:st .25s steps(1) infinite}
@keyframes type{0%{transform:scaleX(.17)}25%{transform:scaleX(.5)}50%{transform:scaleX(.83)}75%{transform:scaleX(1)}}
@keyframes blink{50%{opacity:0}}
.c-pirate.run .it{transform-origin:50% 100%;animation:fence .5s ease-in-out infinite}
@keyframes fence{50%{transform:rotate(25deg)}}
.c-designer.run .it{transform-origin:50% 100%;animation:dab .5s ease-in-out infinite}
.c-designer.run .tip{animation:hue 2s steps(1) infinite}
@keyframes dab{50%{transform:rotate(-22deg) translateY(1px)}}
@keyframes hue{25%{fill:#378ADD}50%{fill:#1D9E75}75%{fill:#F5C542}}
@media (prefers-reduced-motion: reduce){.run,.run g,.run rect{animation:none!important}}
</style>`

const COSTUMES: Record<Role, (f: Fill, accent: string) => void> = {
  crab: f => crabBody(f),
  // Pirate scouting the code; the cutlass fences.
  pirate: f => {
    crabBody(f)
    stamp(f, 5, 3, ['.kk..............kk.', '.kkk....kkkk....kkk.', '..kkkkkkkwwkkkkkkk..', '..kkkkkkkkkkkkkkkk..', '.gggggggggggggggggg.'], { k: '#55514C', w: '#F8F6F1', g: '#F5C542' })
    f(7, 11, 11, 1, INK); f(18, 11, 4, 3, INK)
    f(27, 6, 1, 9, '#C9CCD2', 'it'); f(26, 15, 3, 1, '#7A4A26', 'it')
  },
  // Software developer in headphones and glasses, at an open laptop; the code
  // line types out, the cursor blinks and a claw taps the keys.
  engineer: (f, accent) => {
    crabBody(f, 0, 'tap')
    stamp(f, 6, 6, ['...hhhhhhhhhhhh...', '.hh............hh.', 'h................h'], { h: '#3A3A3C' })
    stamp(f, 5, 9, ['cc', 'ca', 'ca', 'cc'], { c: '#3A3A3C', a: accent })
    stamp(f, 23, 9, ['cc', 'ac', 'ac', 'cc'], { c: '#3A3A3C', a: accent })
    stamp(f, 8, 11, ['kkkk......kkkk', 'k..kkkkkkkk..k', 'k..k......k..k', 'kkkk......kkkk'], { k: '#2B2B2E' })
    stamp(
      f,
      9,
      15,
      ['fffffffffffff', 'fdgggdbbddddf', 'fdddddddddddf', 'fdbbbdgggdddf', 'fdddddddddddf', 'fffffffffffff'],
      { f: '#8E929A', d: '#1F2430', g: '#5FBF8F', b: '#6FA8DC' },
    )
    f(11, 17, 6, 1, accent, 'typ')
    f(11, 19, 2, 1, '#F8F6F1', 'cur')
    f(7, 21, 17, 1, '#C9CCD2')
  },
  // Designer in a beret, palette in one claw; the brush dabs and changes color.
  designer: (f, accent) => {
    crabBody(f, -4, 'it')
    stamp(f, 6, 4, ['........s.........', '....bbbbbbbbbb....', '..bbbbbbbbbbbbbb..', '.bbbbbbbbbbbbbbbbb', '..aaaaaaaaaaaaaa..'], { b: '#3A3550', s: '#3A3550', a: accent })
    stamp(f, 0, 12, ['.ppp.', 'prpgp', 'ppbpp', '.pp..'], { p: '#E8D3A8', r: '#D0453F', g: '#1D9E75', b: '#378ADD' })
    f(25, 4, 1, 6, '#A0703F', 'it'); f(25, 3, 1, 1, '#C9CCD2', 'it')
    f(24, 1, 3, 2, '#D0453F', 'tip')
  },
}

const CRAB_SCALE = 1.1

// Body and props nest inside `bd` so a prop rides the bob and adds its own motion;
// legs stay outside it and step on their own. The brush tip rides with the brush.
export const crab = (x: number, y: number, role: Role, accent: string, isWalking = false, scale = CRAB_SCALE): string => {
  const groups = new Map<string, string[]>([['bd', []]])
  const f: Fill = (cx, cy, w, h, c, cls = 'bd') => {
    if (!groups.has(cls)) groups.set(cls, [])
    groups.get(cls)?.push(`<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`)
  }
  COSTUMES[role](f, accent)
  const group = (cls: string) => `<g class="${cls}">${(groups.get(cls) ?? []).join('')}</g>`
  const tip = groups.get('tip') ?? []
  const props = [...groups.keys()].filter(k => !['bd', 'la', 'lb', 'tip'].includes(k))
  const prop = (cls: string) =>
    cls === 'it' && tip.length
      ? `<g class="it">${(groups.get('it') ?? []).join('')}${tip.map(r => r.replace('<rect', '<rect class="tip"')).join('')}</g>`
      : group(cls)
  const body = `<g class="bd">${(groups.get('bd') ?? []).join('')}${props.map(prop).join('')}</g>`
  return `<g transform="translate(${x},${y}) scale(${scale})" shape-rendering="crispEdges"><g class="c-${role}${isWalking ? ' run' : ''}">${body}${group('la')}${group('lb')}</g></g>`
}

const statusMark = (x: number, y: number, status: string, color: string): string => {
  if (status === 'running') return `<circle class="live" cx="${x}" cy="${y}" r="3.5" fill="${color}"/>`
  if (status === 'done')
    return `<path d="M${x - 5} ${y}l3.5 3.5 6.5-7" fill="none" stroke="#3B9C5F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
  return `<path d="M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8" stroke="#D0453F" stroke-width="1.8" stroke-linecap="round"/>`
}

const svg = (W: number, H: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${PANE_CSS}${CRAB_CSS}${body}</svg>`

export const paneWidth = (bodyColumns: number | undefined): number =>
  Math.max(240, Math.min(900, (bodyColumns || 40) * 8 - 8))

export const HEADER_H = 44
export const ROW_H = 66

export const headerSvg = (W: number, t: Totals): string => {
  const gap = 6
  const tw = (W - gap * 2) / 3
  const tile = (i: number, k: string, v: string) =>
    `<rect class="tile" x="${i * (tw + gap)}" y="0" width="${tw}" height="40" rx="8"/>
<text class="s" x="${i * (tw + gap) + 9}" y="16" font-family="${FONT}" font-size="11">${k}</text>
<text class="t" x="${i * (tw + gap) + 9}" y="33" font-family="${FONT}" font-size="15" font-weight="600" font-variant-numeric="tabular-nums">${xml(fitText(v, 15, tw - 18))}</text>`
  return svg(W, HEADER_H, `${tile(0, 'Cost', '≈' + fmtCost(t.cost))}${tile(1, 'Tokens', fmtTokens(t.tokens))}${tile(2, 'Time', fmtTime(t.time))}`)
}

export const agentSvg = (W: number, a: AgentRun, at: number, role: Role): string => {
  const color = colorOf(a.model)
  const ctx = ctxOf(a)
  const indent = a.parentAgentId !== undefined ? 14 : 0
  const x = indent + 42
  const textW = W - x - 22
  const barColor = ctx >= 80 ? '#D0453F' : ctx >= 50 ? '#BA7517' : color
  const model = modelName(a.model)
  const after = `${a.effort ? `  ·  ${a.effort}` : ''}${a.status === 'failed' ? '  ·  error' : ''}`
  const typeText = fitText(a.type, 11, Math.max(40, textW * 0.45))
  return svg(
    W,
    ROW_H,
    `${indent ? `<text class="m" x="0" y="30" font-family="${FONT}" font-size="12">↳</text>` : ''}
${crab(indent, 14, role, color, a.status === 'running')}
<text class="t" x="${x}" y="18" font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(a.description || a.type, 13, textW))}</text>
<text x="${x}" y="34" font-family="${FONT}" font-size="11"><tspan class="s">${xml(typeText)}  ·  </tspan><tspan fill="${color}" font-weight="600">${xml(model)}</tspan><tspan class="s">${xml(after)}</tspan></text>
<text class="s" x="${x}" y="49" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(fitText(statsOf(a, at), 11, textW))}</text>
<rect class="k" x="${x}" y="55" width="${textW}" height="4" rx="2"/><rect x="${x}" y="55" width="${Math.round((textW * ctx) / 100)}" height="4" rx="2" fill="${barColor}"/>
${statusMark(W - 8, 16, a.status, color)}
<line class="ln" x1="0" y1="65.5" x2="${W}" y2="65.5"/>`,
  )
}

export const agentAlt = (a: AgentRun, at: number, role: Role): string =>
  `${a.description || a.type} (${role}): ${a.type}, ${modelName(a.model)}${a.effort ? ` ${a.effort}` : ''}, ${a.status}, ${statsOf(a, at)}`
