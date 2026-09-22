# Keep discovered models selectable when settings reference them

A discovered Claude model disappears from stage-policy choices after Settings references it. Correct the model-catalog projection so a runtime-discovered entry stays selectable and retains its discovery metadata when referenced by the default model, allowlist or a stage policy.

- Preserve the existing behavior for discovered Codex models.
- Keep configured models the runtime cannot confirm visible and non-editable; do not make unsupported models eligible for new selections or invent their reasoning levels.
- Preserve unique entries, catalog metadata and the input catalog/settings objects.
- Prove the behavior with focused regression tests and keep the complete repository verification manifest passing. The real Settings model choices must reflect the corrected catalog.
- Scope is model-catalog projection and its UI effects. Provider onboarding dispatch is a separate change and is outside this task. No dependency upgrades, new model IDs, production settings changes or default-policy changes are required.

The discovered availability field is authoritative; how an entry was registered in the catalog does not itself mean it is unavailable. Preserve the existing Settings/API/component contracts. No other product decision is needed. If Grill asks about compatibility, preserve these contracts and the unsupported-model restriction. Stop for an unanswered material question outside this brief rather than inventing a requirement.
