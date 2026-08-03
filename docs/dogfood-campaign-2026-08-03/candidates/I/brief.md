# Candidate I

## Issue

Dashboard progress dial plus shared task-table spacing

## Frozen brief

Implement the Evidence Gate dashboard progress and spacing polish in this repository.

The command-centre workflow dial must be driven by the task's actual completed-stage count across all ten workflow stages, show a complete ring at 10/10, and expose accurate accessible progress semantics. Improve the shared task-table column spacing without creating unnecessary horizontal overflow at approximately 1440px, while keeping the table usable at approximately 1024px and 768px. Refine Grill Me, Implement, repair-lineage, approval, and context typography and spacing. Keep ordinary body/control text at 14–16px and metadata no smaller than 12px. Preserve the approved warm-ink Evidence Gate direction and use cohesive extracted helpers where useful.

Acceptance criteria:
- The workflow ring derives its percentage and visible count from actual completed stages out of ten and reaches a complete 10/10 state.
- The ring has truthful progressbar semantics including minimum, maximum, current value, and a useful accessible value description.
- The shared task table has improved horizontal spacing without unnecessary 1440px page overflow and remains usable at 1024px and 768px.
- Grill Me, Implement, repair lineage, approval, and context surfaces use coherent Evidence Gate spacing with normal text at 14–16px and metadata at least 12px.
- Focused automated coverage protects the progress calculation and relevant rendering behavior.

Required verification commands:
- npm run lint
- npm run typecheck
- npm test
- npm run build
- npm run test:sites
- git diff --check

## Acceptance criteria

- The workflow ring derives its percentage and visible count from actual completed stages out of ten and reaches a complete 10/10 state.
- The ring has truthful progressbar semantics including minimum, maximum, current value, and a useful accessible value description.
- The shared task table has improved horizontal spacing without unnecessary 1440px page overflow and remains usable at 1024px and 768px.
- Grill Me, Implement, repair lineage, approval, and context surfaces use coherent Evidence Gate spacing with normal text at 14–16px and metadata at least 12px.
- Focused automated coverage protects the progress calculation and relevant rendering behavior.

## Verification commands

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:sites`
- `git diff --check`

Base: `4c9d56813ae1787f9099d24efd5a8f67ed90234f`

Brief hash: `124231b22f57d1404b1ca469b3d0c9f7b9435e88e6c9074679d3abdea7578720`
