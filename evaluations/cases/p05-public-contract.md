Implement a PlanCheck Review improvement for construction pricing matches.

The pricing matcher can identify scenario candidates, but the worker loses those IDs when saving its result. Review therefore cannot explain an ambiguous match or a scenario that was considered and rejected as incompatible.

- Add a dbmate migration that stores the candidate scenario IDs for every pricing result. Persist and return them through the existing read model. Keep old rows safe to read.
- An ambiguous claim must visibly say that it needs review, show how many scenarios fit, and list the candidates by title. A reviewer can choose an eligible candidate in one action using the existing revisioned selection API. That choice must recalculate from the catalogue with user origin.
- An incompatible claim must visibly explain that a scenario was refused and show the candidate and its applicable limits. Do not treat this state as no match.
- Until a reviewer selects a scenario, ambiguous and incompatible automatic results must contribute no amount to any subtotal. Preserve the current matched totals, shared-event treatment, stale-result safeguards, and account isolation.
- Add relevant unit, PostgreSQL integration, and UI tests. Use synthetic data only. Do not run detection, REMEDY, adjudication, model jobs, or real customer workflows.
