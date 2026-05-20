# Triage Labels

This repo uses the five canonical triage labels (defaults — no overrides configured).

| Role | Label string | Meaning |
|------|-------------|---------|
| Needs evaluation | `needs-triage` | Maintainer needs to evaluate this issue |
| Waiting on reporter | `needs-info` | Blocked waiting for more information from the reporter |
| Ready for agent | `ready-for-agent` | Fully specified, AFK-ready — an agent can pick this up |
| Ready for human | `ready-for-human` | Needs human implementation or judgment |
| Won't fix | `wontfix` | Will not be actioned |

## Setup

Run once to create labels in GitHub:

```bash
gh label create needs-triage --color 0075ca --description "Maintainer needs to evaluate"
gh label create needs-info --color e4e669 --description "Waiting on reporter"
gh label create ready-for-agent --color 0e8a16 --description "AFK-ready for an agent"
gh label create ready-for-human --color d93f0b --description "Needs human implementation"
gh label create wontfix --color ffffff --description "Will not be actioned"
```
