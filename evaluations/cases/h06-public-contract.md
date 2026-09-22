# Pause and resume Linear from Frontier Settings

The Harness already has signed Linear intake, manual Grill replies and workflow publication. Give an operator one persisted **Enable Linear integration** switch in Frontier Settings → World & connection → Integrations. Use the existing companion/API boundary and the existing Linear configuration; do not create a second integration or require a new credential.

- A configured integration starts On. Saving Off survives a companion restart. A companion with no Linear configuration reports unavailable and cannot be enabled.
- Off lets an already-started receipt finish, then prevents new intake and pauses queued intake, Linear replies and outbound updates. Re-enable resumes work queued before Off. New mentions or replies received while Off may be declined; they must not silently create tasks or send messages.
- Normal local task creation/execution, manual Grill answers in Harness, and existing approval controls remain available while Linear is Off.
- Show the current On/Off/unavailable state and a working switch in Frontier Settings. The switch must read the actual companion state, persist changes through the API, handle loading/error states, and not imply that an unsaved local draft changed the integration.
- Preserve existing webhook signature/identity checks, API origin/CSRF rules and duplicate-delivery behavior. No real Linear API calls, external publication, deployment or production data are needed for verification; use synthetic fixtures.
- Run the repository's existing verification manifest and add focused regression coverage. Do not weaken checks to obtain a pass.

These decisions are the full task contract for all trial arms. If Grill asks about the pause boundary, answer from this contract: finish the current receipt and pause further Linear work. If a genuinely new consequential choice is needed, stop for an operator decision instead of inventing one.
