# Grass Valley Kayenne Companion v2026.0.9.2

Major-version Bitfocus Companion implementation based on the Grass Valley Stream Deck application.

## Versioning

- Internal project version: `2026.0.9.2`
- Companion prerelease package version: `2026.0.9-beta.2` (SemVer)

## Source baseline

- Stream Deck baseline: `2026.3.0.0`
- Companion implementation will live entirely in this sibling project.
- The original Stream Deck repository remains the protocol-reference source and will not contain the Companion module.

## Status

This module is substantially complete and is being released initially as a beta while live-system testing continues. It has been exercised against Grass Valley V14 and V18 frame simulators across Suites 1–4.

The release is prepared as the upgrade successor to `grassvalley-kframe` 1.0.0. Its permanent upgrade script converts the former Macro/AUX action schemas, send-pulse feedbacks, configuration, and variable/expression values. `grassvalley-kframe` is retained in the manifest as a legacy module ID so Companion can carry existing installations into the renamed Kayenne module.

Upgrade testing with an imported K-Frame page confirms that Companion automatically preserves the existing page and button locations while translating supported Macro/AUX actions and their options to Kayenne. Companion's upgrade API does not redesign existing layered button artwork, so legacy buttons retain their existing visual layout; users can apply a Kayenne preset when they want the new suite badge, dynamic frame-name label, and tally presentation.

Kayenne automatically connects the suites selected in its configuration, one at a time in suite order, with a configurable maximum number of reconnection attempts. Existing Suite Connect / Disconnect button actions remain available for live manual control. Turning off Companion's master connection switch immediately clears all suite connections and their status feedback.

New Kayenne preset buttons default to Companion's **Border when pressed** decoration. Status icons follow Companion's global button setting because the current module preset API does not expose a per-preset status-icon default.

## Required UDP ports

Maintainer decision, 2026-10-14: the following local UDP port assignments are required and must remain fixed.

| Suite | Main port | Listener port |
| ----- | --------: | ------------: |
| 1     |      6132 |          6133 |
| 2     |      6134 |          6135 |
| 3     |      6136 |          6137 |
| 4     |      6138 |          6139 |

Another process holding either required port on the Companion host causes a bind conflict. This constraint is expected, understood, and accepted by the maintainer. Do not change the port assignments or introduce automatic alternate-port selection to avoid it. Required ports must be available before connecting.

Connection lifecycle update, 2026-10-14: cancelled setup now stops before proceeding to another transport or handshake stage, pending startup settles on cancellation or a socket error, and cleanup safely closes sockets even during detection or binding. A cancelled older attempt cannot remove its replacement from the connection manager. The required port assignments above are unchanged; an occupied port still prevents that connection, but its bind error no longer leaves startup pending.

`npm test` includes 16 connection lifecycle regression tests in `test/repro-connection-lifecycle.cjs`, covering port conflicts, cancellation during TCP detection/authentication/registration and UDP binding, and replacement connections.

Live validation on 2026-10-14 passed on Suite 1 against V14.7.1 (UDP) and V18.1.0 (TCP): normal connection, cancellation during detection and transport setup, socket release, and reconnect after cancellation. Macro catalogs loaded on both frames. No macro execution, routing, or playout commands were sent. This validates the protocol lifecycle directly, not every Companion UI workflow or multi-suite scenario.

## Keyer source feedback

K1–K6 source-selection buttons now use frame-reported keyer state, stored separately from A–D bus state. Selecting a keyer source does not overwrite bus tally. Disconnect clears both caches.

Crosspoint source commands require whole numbers from 1–809. Malformed, missing, fractional, and out-of-range values are rejected before sending or changing cached feedback. Numeric dropdown strings remain supported. Regression tests cover bus and keyer commands, invalid inputs, and valid range boundaries.

Validation on 2026-10-14: V14.7.1 UDP and V18.1.0 TCP each returned all 30 keyer selections and 20 bus selections on Suite 1. Matching and nonmatching button feedback passed against those live values using read-only subscriptions. Synthetic frame-response tests cover source changes and disconnect cleanup across all keyer targets. The tests are included in `npm test`.

## Buttons with multiple actions

Action subscriptions are tracked by control ID and action-instance ID. Removing one Macro, AUX, Crosspoint, E-MEM, Transition, Panel Memory, Image Store, or GPI action preserves the remaining assignments and their feedback settings. Each feedback type displays its most recently subscribed remaining action, matching the prior selection behavior while allowing removal to restore an earlier assignment. The generic suite badge considers every action instance and clears when visible assignments span multiple suites.

The 2026-10-14 reproduction failed all 17 original cases before the fix. Those cases and three additional checks for resubscription, button isolation, and mixed suites now pass in `test/repro-multi-action-feedback.mjs`, included in `npm test`. No frame commands are needed for these tests.

## Macro catalog refresh

Macro dropdowns and presets refresh when received catalog data changes, after a two-second quiet period. This includes new names, renames, and cleared names. Identical catalog dumps do not trigger another refresh, and later updates preserve the existing UDP macro-status subscription.

Manual and frame-initiated disconnects also refresh dropdowns and presets after a short cleanup delay. Macro dropdowns use names from remaining suites, or numbered fallback labels when no catalog remains. Four regression cases cover both disconnect paths with and without another suite's catalog.

Disconnect cleanup also clears cached source names before announcing disconnection. AUX and crosspoint dropdowns then use remaining suites' source names or numbered fallback labels. The same four regression cases verify both source dropdowns and the cleared source-name getters.

Validation on 2026-10-14: synthetic UDP and TCP packets reproduce the original stale-dropdown failure and pass after the fix. Tests cover dropdowns, presets, cleared names, unchanged batches, and disconnect cleanup in `test/repro-macro-dropdown.mjs`, included in `npm test`. Live frame names were not changed for this test.

## Development baseline

- Companion: 5.0.4
- `@companion-module/base`: 2.0.4
- Node runtime: 22
- Package manager: Yarn 4

## Author and maintainer

Copyright © 2024–2026 Brad Shaffer.

- GitHub: [@Orthiconnn](https://github.com/Orthiconnn)
- Instagram: [@orthicon](https://www.instagram.com/orthicon/)

This project is released under the MIT License. Contributions are welcome through the official repository. To preserve compatibility and quality, please coordinate substantial changes with the maintainer before proposing or distributing modified versions.

Forks and modified versions must not be represented as official or endorsed releases without the maintainer's written approval.

See [NOTICE.md](NOTICE.md) for authorship and project-governance information.
