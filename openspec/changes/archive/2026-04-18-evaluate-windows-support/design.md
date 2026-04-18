## Context

The current README says Windows is unsupported, and that is a reasonable default. The problem is not that the project lacks a Windows code path today, but that there is no documented assessment of what would be required to add one responsibly. Since shell behavior, isolation, and rendering semantics are still evolving, the right next step is a documented evaluation and decision, not premature implementation.

## Goals / Non-Goals

**Goals:**
- Produce a concrete Windows feasibility assessment tied to this project's architecture.
- Publish a support decision with reasons and scope.
- Make the documentation match the decision.

**Non-Goals:**
- Implement Windows support in this change.
- Guarantee that support will be added later.
- Commit to a specific shell matrix before the evaluation is complete.

## Decisions

### Treat this as an investigation and decision change, not a platform implementation change
The primary output should be documentation and a clear support stance. Prototype validation may be used if needed, but it is not the main deliverable.

Alternative considered:
- Start implementing Windows-specific launch paths immediately. Rejected because the project has not yet stabilized the supporting abstractions.

### Evaluate Windows against the project's actual architecture
The assessment should be anchored in `node-pty`, terminal emulation behavior, shell abstraction plans, artifact expectations, and CI realities for this repo. Generic “Windows is hard” statements are not good enough.

Alternative considered:
- Use only upstream library claims. Rejected because the question is whether this project can support Windows, not whether its dependencies theoretically can.

## Risks / Trade-offs

- [The evaluation may delay implementation enthusiasts want immediately] → That delay is cheaper than building support on the wrong abstractions.
- [A written decision may go stale as the codebase changes] → Tie the assessment to the current roadmap and revisit it after shell abstraction stabilizes.
- [Prototype work could expand beyond evaluation] → Keep any validation experiments narrowly scoped and document them as evidence, not production support.

## Migration Plan

This change is documentation and planning first. No rollback concerns beyond reverting the published decision if it is later superseded by a fresh evaluation.

## Open Questions

- Should the evaluation include a small Windows CI experiment, or is code-and-doc analysis sufficient for the first pass?
- What level of evidence is required before a status of “experimental support” would be credible?
