# Selected-task dock reference comparison — 15 September 2026

Shaun supplied the original dock design (download.png), the current selected Grill dock and the misaligned project-panel/minimap crop. The requested step is to identify the dock differences and implement the explicit panel alignment correction.

## Dock changes identified

1. Use the structured horizontal anatomy of the first image: portrait and task identity on the left, controls in their own middle column, artifacts grouped on the right, and a distinct full-width usage footer. The current sparse flex layout leaves a large blank area and puts optional artifacts on a separate bottom line.
2. Make the portrait more substantial, keeping it inside the identity block. Show the task/stage and a concise recorded task subtitle/state with clear hierarchy.
3. Restore explicit Skill and Model/reasoning fields rather than blending model and tokens into one small inline row.
4. Provide direct agent configuration alongside inspection. Preserve the primary eligible action for the actual task (for example Answer question) and the current safeguarded configuration boundary.
5. Present existing artifacts as recognisable compact items with recorded type/name/version where available. The reference's Plan, Diff and Tests examples are not permission to invent artifacts or render empty future-stage placeholders.
6. Separate usage into a bottom strip: recorded task tokens, elapsed time and a correctly labelled approximate API-rate estimate only where supported. Reference numbers are design examples, not data authority.
7. The reference action panel places Agent roster, Skills and Settings below New task; the current one uses Tasks and World settings. This is a further visible difference to resolve while retaining current navigation access.

The full dock restructuring is identified here; this follow-up changes only the explicitly requested alignment. Waiting/repair reasons remain available through selection and inspection, and the dock remains conditional and dismissible.

## Alignment delivered

At widths above the existing 1050px compact fallback, the HQ project panel and minimap share a 235px outer width and 12px left edge. The project panel sits approximately 12px above the minimap, keeping the existing readable panel width. This leaves the established narrow-screen fallback unchanged and does not affect camera code.

Actual browser bounds at 1280×720 and 1488×1058: both panels x=12, width=235, vertical gap=12.5. Captures: alignment-before-1280.png, alignment-after-1280.png and alignment-after-1488.png. All were visually inspected in the browser.

84 Frontier tests, typecheck, lint, formatting and Frontier build passed for this CSS-only follow-up. Existing bundle-size warning remains. Root build and API/Sites tests retain the preceding HUD checkpoint; they were not rerun for alignment. No dock redesign, asset work, game publication or Goal 6 was performed in this follow-up.
