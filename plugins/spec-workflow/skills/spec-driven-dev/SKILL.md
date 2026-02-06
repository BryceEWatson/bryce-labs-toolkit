---
name: spec-driven-dev
description: Spec-driven development workflow methodology and templates.
---

# Spec-Driven Development

## Workflow

```
SPEC → PLAN → IMPLEMENT → REVIEW
  │       │        │          │
  ▼       ▼        ▼          ▼
User   Internal  Internal   Manual
Gate   Review    Review     Trigger
       Loop      Loop
```

### Commands

| Command | Purpose |
|---------|---------|
| `/spec-workflow:spec <desc>` | Generate SPEC.md |
| `/spec-workflow:plan <spec>` | Generate PLAN.md with review |
| `/spec-workflow:implement <plan>` | Execute with PR review |
| `/spec-workflow:review [spec]` | Manual review trigger |

## Information Asymmetry

| Agent | SPEC | PLAN | PR | Codebase | Reasoning |
|-------|------|------|----|---------:|----------:|
| Planner | ✅ | Creates | - | ✅ | - |
| PlanReviewer | ✅ | ✅ | - | ❌ | ❌ |
| Implementer | ❌ | ✅ | Creates | ✅ | - |
| PRReviewer | ✅ | ❌ | ✅ | ❌ | ❌ |

### Why PRReviewer checks SPEC not PLAN

Catches plan drift - where plan misunderstood spec.

### Why Implementer cannot see SPEC

Forces plan adherence.

### Why reviewers cannot see reasoning

Prevents confirmation bias.

## Files

- Specs: `docs/specs/SPEC-{feature}.md`
- Plans: `docs/plans/PLAN-{feature}.md`
- Reviews: `docs/reviews/REVIEW-{pr}.md`
