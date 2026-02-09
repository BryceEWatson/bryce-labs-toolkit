---
name: spec-driven-dev
description: Spec-driven development workflow methodology and templates.
---

# Spec-Driven Development

## Workflow

The pipeline auto-continues between stages, pausing for user approval at each gate:

```
SPEC ──review──▶ User Gate ──approve──▶ PLAN ──review──▶ User Gate ──approve──▶ IMPLEMENT ──review──▶ PR Ready
  │                                      │                                       │
  ▼                                      ▼                                       ▼
Internal                               Internal                               Internal
Spec Review                            Plan Review                             PR Review
(mandatory)                            (mandatory)                             (mandatory)
```

### Commands

| Command | Purpose |
|---------|---------|
| `/spec-workflow:spec <desc>` | Run full pipeline (spec → plan → implement) |
| `/spec-workflow:plan <spec>` | Generate PLAN.md with review (standalone) |
| `/spec-workflow:implement <plan>` | Execute with PR review (standalone) |
| `/spec-workflow:review [spec]` | Manual review trigger |

## Information Asymmetry

| Agent | SPEC | PLAN | PR | Codebase | Reasoning |
|-------|------|------|----|---------:|----------:|
| SpecReviewer | ✅ | - | - | ❌ | ❌ |
| Planner | ✅ | Creates | - | ✅ | - |
| PlanReviewer | ✅ | ✅ | - | ❌ | ❌ |
| Implementer | ❌ | ✅ | Creates | ✅ | - |
| PRReviewer | ✅ | ❌ | ✅ | ❌ | ❌ |

### Why SpecReviewer cannot see codebase

Ensures spec is evaluated as a standalone document for completeness and testability.

### Why PRReviewer checks SPEC not PLAN

Catches plan drift - where plan misunderstood spec.

### Why Implementer cannot see SPEC

Forces plan adherence.

### Why reviewers cannot see reasoning

Prevents confirmation bias.

## Files

- Specs: `docs/specs/SPEC-{feature}.md`
- Plans: `docs/plans/PLAN-{feature}.md`
- Spec reviews: `docs/reviews/REVIEW-SPEC-{feature}.md`
- Plan reviews: `docs/reviews/REVIEW-PLAN-{feature}.md`
- PR reviews: `docs/reviews/REVIEW-PR-{feature}.md`
- Standalone PR reviews: `docs/reviews/REVIEW-{pr-number}.md`
