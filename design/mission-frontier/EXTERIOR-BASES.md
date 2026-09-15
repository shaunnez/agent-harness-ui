# Exterior bases — 16 September 2026

User accepts the 3D proof foundation and requests larger robots/crates, illuminated station details, a project-coloured roof and three structurally distinct bases. Clarification: **one base per project across the same map**, not three alternatives shown only in isolation. Users can pick their project's building or accept a stable random assignment.

Authority: current request and `reference/exterior-base-details-annotated.jpg`, then original World study, then the accepted 3D proof. Continue the isolated `mission-frontier-3d-proof` worktree. Preserve the uncommitted original proof and its dated evidence. This is the explicit expansion of the earlier one-base restriction; a full live renderer migration, placements/upgrades and Goal 6 remain separate.

## Delivery

- Three related structural kits, each with stepped rounded silhouette and useful recesses: Command (existing twin bays), Relay (asymmetric communications tower/service wing), Foundry (broader service/hangar roof silhouette). Shared ground footprint, courtyard, worker sockets and cutaway contract permit interchangeable project assignment.
- Larger robots (target about 3.1m versus original 1.8m) and cargo (about 2m high, visually proportionate to robots), grounded at the same floor contact. Keep paths and work sockets clear.
- Recessed warm windows/entry strips, small sensors, wall computer panels, marker lights and a coloured roof inset/ring. Neutral station materials retain their colour; identity accents support blue/red/orange/purple independently of task attention.
- Slow, low-amplitude ambient emissions, no flashing. Existing motion-off, reduced-motion, disconnected and hidden-page gates stop animation. Station life is scenery, never evidence of task progress.
- One 3D base per non-archived fixture project in the shared world, with stable layout, matching project/task labels and ray picking, minimap, focus/headquarters/Watch and current project scopes.
- A compact accessible project appearance panel. Building and palette choices persist locally by project/repository identity. Unchosen projects receive stable assignments; reroll happens only through a visible action. This preview must not imply settings have been saved to the backend.
- Default Pixi/live runtime remains unchanged. Existing Inspect/Watch, usage, model policies, task creation and management controls retain their semantics. No backend writes, task execution, PR/push/game publication.

## Build and check plan

1. Record reference and measured asset contract; preserve original proof. Astra owns new kit source/exports; builder owns integration.
2. Split reusable environment from base geometry and add three authored base GLBs with the same sockets/groups. Integrate enlarged runtime workers and identity/ambient material roles.
3. Generalize the small 3D adapter to project instances and stable world framing, preserving state truth and same-building cutaway. Add local appearance choices through current project context.
4. Run adapter/persistence/asset tests, Frontier suite, types, lint, formatting; main build → Sites tests → Frontier build sequentially. Browser-test three visible bases, all choices/colours, reload stability, task identity, motion-off and desktop/laptop layout.
5. Compare actual browser captures with original/annotated details at comparable base scale. Fix material proportion/lighting/selection defects, document remaining artistic limits, update independent journal and leave local review ready.

Evidence: `build-evidence/EXTERIOR-BASES/`. No new goal needed; user requested implementation directly.
