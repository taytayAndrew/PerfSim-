# ADR 0001: Puppeteer over Playwright for browser automation

**Date**: 2026-05-20  
**Status**: Accepted

## Context

PerfSim needs a browser automation library to:
1. Load the target page with CDP interception active (recording phase)
2. Inject scripts via `evaluateOnNewDocument`
3. Share a Chrome instance with Lighthouse via CDP port

Two candidates: Puppeteer and Playwright.

## Decision

Use **Puppeteer**.

## Rationale

- Lighthouse is built by the same team as Puppeteer and explicitly documents CDP port sharing with Puppeteer
- Puppeteer exposes raw CDP (`page.createCDPSession()`) without abstraction layers — needed for fine-grained request interception
- `evaluateOnNewDocument` is a first-class Puppeteer API
- `page.setBypassCSP(true)` is supported directly
- Playwright wraps CDP in its own protocol layer, making Lighthouse integration more brittle

## Consequences

- Locked to Chromium (no Firefox/WebKit support) — acceptable since the tool targets Chrome performance
- Must handle Windows-specific Chrome executable paths and process termination (`taskkill`)
