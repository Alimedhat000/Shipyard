# Triage Labels

This repo uses the following label vocabulary for the triage workflow.

## Labels

| Label | Purpose |
|-------|---------|
| `needs-triage` | Maintainer needs to evaluate the issue |
| `needs-info` | Waiting on reporter for more information |
| `ready-for-agent` | Fully specified, AFK-ready — an agent can pick it up |
| `ready-for-human` | Needs human implementation |
| `wontfix` | Will not be actioned |

## Workflow

The `triage` skill moves issues through this state machine:
1. New issues start as `needs-triage`
2. If more info needed → `needs-info`
3. If fully specified → `ready-for-agent`
4. If needs human → `ready-for-human`
5. If rejected → `wontfix`

## Customization

No overrides configured — using default label strings.