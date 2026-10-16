# Grass Valley KFrame

Companion module by Brad Shaffer / Orthicon for controlling Grass Valley K-Frame production switchers (Kayenne, Karrera, Korona) through the CPL protocol.

This beta release ports the verified GV Macro Player Stream Deck v2026.3.0.0 protocol engine to Companion.

## Configuration

Enter only the frame IP address. Ports are fixed in code and cannot be changed by the user: 6132/6133 for Suite 1, 6134/6135 for Suite 2, 6136/6137 for Suite 3, and 6138/6139 for Suite 4.

Enter the frame IP, select any combination of Suites 1–4, and set the number of quick reconnection attempts. Selected suites connect automatically, one at a time, because the frame accepts one connection handshake from a computer at a time. If a suite cannot connect it waits its turn behind the other suites, retries 2 s apart for the configured number of quick attempts, then keeps retrying every 30 s until the frame answers. The protocol keepalive timing is fixed internally. Each suite's optional Connect / Disconnect button changes from red **Disconnected**, through amber **Connecting** (Establishing, then Handshake), to green **Connected**, and displays live heartbeat activity. Every operational action and feedback includes its own suite selection.

### Upgrading from Grass Valley K-Frame 1.0.0

This module is the next version of the Grass Valley K-Frame module, so existing connections update in place. Existing Macro Recall and AUX Route actions are migrated to the new action format, including their selected suite, numeric values, and Companion expressions/variables. Their former send-pulse feedbacks are replaced with live frame-name and button-tally feedbacks. The connection's IP address is preserved, and the `last_macro`, `last_aux` and `last_aux_source` variables are still published.

K-Frame 1.0.0's configured suite is preserved as the initially selected suite. Additional suites can be enabled with the Suite 1–4 checkboxes. The optional **Suite Connect / Disconnect** presets provide manual control without changing the configured startup selection.

The upgrade runs automatically when Companion loads the new version; users do not run a separate migration command. Existing page positions and supported Macro/AUX action values are preserved. Companion upgrade scripts cannot replace an existing button's layered artwork, so upgraded buttons keep their former look. Add a new preset when the full suite badge, automatic frame-name label, and tally styling are desired.

## Controls

Native actions cover connection, macros, AUX routing, crosspoints, E-MEM, transitions, panel memory, Image Store, timeline RUN, GPI, PBUS recall/trigger, and panel button mapping. An advanced raw-CPL action is included for engineering and protocol testing.

Connection and macro-active feedbacks, connection variables, and Stream Deck-inspired defaults are included for Macro 1–8, AUX 1–4, E-MEM, Image Store, RUN, recall, trigger, and GPI workflows. This build has been tested against V14 and V18 frame simulators. Continue testing on a non-air system before production use.

New preset buttons use **Border when pressed**. Their status icons follow Companion's global button-appearance setting; set that global option to **Show all** when all button status icons should always be visible.

Macro presets show the selected suite as a circled number in the lower-left. When connected, Macro action dropdowns and automatic button labels use the frame's Macro catalog names. Changing the Macro or Suite field refreshes the button label. Disable **Automatically show frame Macro name** on that feedback when using custom button text.

All suite-targeted action presets use the same padded lower-left suite badge, which follows the Suite field on the button action. AUX defaults provide AUX 1–4 on Source 1. Crosspoint defaults provide A and B sides for M/E 1–4 and Program on Source 1, using brighter A-side and darker B-side family colors. Transition defaults use the matching family colors and provide M/E 1–4 plus Program CUT and AUTO targeting both primary and secondary. E-MEM defaults include a white Master E-MEM 0 button and color-coded Primary/Secondary E-MEM 0 buttons for M/E 1–4 plus red Program Primary/Secondary buttons. PBUS Recall and Trigger defaults cover PBUS devices 1–8 at Register/Trigger 0 in their own section. GPI defaults cover GPI 1–32 in a separate section. Image Store defaults cover Outputs 1–10 at Image 0001. Button Mapping defaults cover Buttons 1–3 on Shifts 1–4 for M/E 1–4 and Program, all mapped to Source 1. Panel Memory defaults cover Registers 1–8.

When a suite is connected, the module subscribes to the frame's source catalog. AUX and Crosspoint actions then offer searchable source dropdowns using the frame's source numbers and names. A numeric source may still be entered manually while offline or when a source is not present in the catalog. Source 1 labels in the preset browser refresh to use the discovered frame name when available; buttons already placed on a page remain user-editable copies. If connected suites disagree about a source name, the lowest-numbered connected suite supplies the dropdown label while the numeric source ID remains authoritative.

AUX presets automatically follow their action's AUX and Source fields. Their labels show the live source number/name, and they turn light purple while that source is online on the selected AUX bus. Disable **Automatically show frame Source name and number** on the AUX feedback to preserve custom button text.

Macro Stop All uses the K-Frame all-macros Stop event and also stops macros paused at a User Wait.

## Safety

Button Mapping changes the switcher panel mapping. PBUS Trigger sends a clear/select/fire/clear sequence. Confirm targets on a simulator or non-air system before using either action in production.

## Authorship and legal notice

This Companion module is the substantially expanded successor to Brad Shaffer's original Grass Valley Stream Deck integration, first published by Orthicon in 2025. The connection and protocol implementation was originally developed by Brad Shaffer for interoperability with Grass Valley production-switching systems. No Grass Valley source code, firmware, binaries, or proprietary documentation are distributed with this module.

This software is not affiliated with or endorsed by Grass Valley®. Grass Valley® is a registered trademark of its respective owner. The User agrees to indemnify and hold harmless the Developer from all claims, damages, or liabilities arising from use of this Software with any Grass Valley® hardware or systems.

Thanks to: Seth Madway (testing)
