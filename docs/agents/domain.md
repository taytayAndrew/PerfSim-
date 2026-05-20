# Domain Docs

This repo uses a **single-context** layout.

```
/
├── CONTEXT.md          ← domain glossary (terminology only, no implementation details)
├── docs/
│   └── adr/            ← architectural decision records
└── src/                ← source code (to be created)
```

## Reading Rules

- **CONTEXT.md**: Read this first when entering any unfamiliar module. It is a pure glossary — no specs, no implementation notes.
- **docs/adr/**: Read relevant ADRs when you see a surprising design choice. ADRs explain the "why", not the "what".
- When a term you encounter conflicts with `CONTEXT.md`, raise it immediately before proceeding.

## Writing Rules

- Update `CONTEXT.md` in-place whenever a new domain term is resolved in discussion.
- Create a new ADR in `docs/adr/` only when a decision is: (1) hard to reverse, (2) surprising without context, and (3) the result of a real trade-off.
- ADR filename format: `NNNN-short-title.md` (e.g. `0001-puppeteer-over-playwright.md`)
