# PerfSim Platform

> Frontend performance simulation tool: Chrome Extension + local Node.js Server.

## Agent skills

### Rule writer

Use the `rule-writer` skill (`.claude/skills/rule-writer/`) when adding a new optimization rule.
It guides through a Q&A to clarify the optimization intent, then generates a compliant rule file in `server/rules/`.

Rule contract: every rule must export `id, name, description, confidence, analyze(), calculateTheoretical(), buildScript(), buildHtml()`.
See `.claude/skills/rule-writer/REFERENCE.md` for inject-script templates and request object field docs.

Currently registered rules:
- `rule-serial-chain` — 串行请求链并行化
- `rule-dedup-requests` — 重复请求去重

### Issue tracker

Issues live in GitHub Issues (`taytayAndrew/PerfSim-`). See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at repo root (glossary) + `docs/adr/` (architectural decisions). See `docs/agents/domain.md`.

---

## Project Overview

PerfSim Platform predicts frontend performance improvements through a two-phase record+replay mechanism:

1. **Recording Phase**: Puppeteer + CDP records all network requests and identifies serial request chains. Baseline Lighthouse runs here.
2. **Simulation Phase**: An optimization script is injected via `evaluateOnNewDocument`, serial-chain requests return from cache (near-zero latency), Lighthouse measures the result.

## Key Design Decisions

See `docs/adr/` for ADRs. Quick summary of major decisions:

- **Browser automation**: Puppeteer (CDP support, Lighthouse compatible)
- **Lighthouse integration**: CDP port bridging (shared Chrome instance)
- **Script injection**: `evaluateOnNewDocument` with inline closure parameters
- **Cache key**: `URL + method + hash(requestBody)`
- **SW handling**: Not disabled; injection script only intercepts network-sourced serial-chain requests
- **Lighthouse variance**: 3 runs each (baseline + simulation), take median
- **Extension SW keepalive**: `chrome.runtime.connect()` Port from Content Script
- **Task model**: Single task — one simulation at a time
- **Report format**: New tab + HTML export (inline styles)
- **History**: IndexedDB, grouped by URL, 1 record per URL

## Tech Stack

| Layer | Tech |
|-------|------|
| Extension UI | Vite + React + TailwindCSS + Zustand |
| Extension logic | Chrome MV3, Content Script, SSE client |
| Server | Node.js + Express |
| Browser automation | Puppeteer |
| Performance measurement | Lighthouse (CDP port bridge) |
| Rule engine | json-rules-engine |
| Storage | IndexedDB (Extension), temp files (Server) |

## Development Notes

- Windows environment: use `path.join` for all paths, `taskkill` for process termination
- Server default port: 3000
- All design decisions tracked in `PerfSim 概设待讨论清单.md` (Chinese)
