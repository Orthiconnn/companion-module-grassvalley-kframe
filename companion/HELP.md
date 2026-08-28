# Grass Valley K-Frame

Community-developed Companion module for controlling Grass Valley K-Frame switchers through the CPL protocol.

This development release ports the verified GV Macro Player Stream Deck v2026.3.0.0 protocol engine to Companion.

## Configuration

Enter only the K-Frame IP address. Ports are fixed in code and cannot be changed by the user: 6132/6133 for Suite 1, 6134/6135 for Suite 2, 6136/6137 for Suite 3, and 6138/6139 for Suite 4.

The module never connects automatically. Use the four Suite 1–4 connection buttons, or choose a suite in a manually configured connection action. Each suite is independent and its live button changes from red **Not Connected**, through amber **Connecting / Establishing Heartbeat**, to green **Connected**. It displays the live frame protocol/port, frame version, and heartbeat activity. Every operational action and feedback includes its own suite selection.

## Controls

The first iteration includes native actions for connection, macros, AUX routing, crosspoints, E-MEM, transitions, panel memory, Image Store, timeline RUN, GPI, PBUS recall/trigger, and panel button mapping. An advanced raw-CPL action is included for engineering and protocol testing.

Connection and macro-active feedbacks, connection variables, and Stream Deck-inspired defaults are included for Macro 1–8, AUX 1–4, E-MEM, Image Store, RUN, recall, trigger, and GPI workflows. This build has passed local byte-vector, TypeScript, lint, package, and Companion loading checks; live switcher or simulator behavior must still be validated before production use.

Macro presets show the selected suite as a circled number in the lower-left. When connected, Macro action dropdowns and automatic button labels use the frame's Macro catalog names. Changing the Macro or Suite field refreshes the button label. Disable **Automatically show frame Macro name** on that feedback when using custom button text.

All suite-targeted action presets use the same padded lower-left suite badge, which follows the Suite field on the button action. AUX defaults provide AUX 1–4 on Source 1. Crosspoint defaults provide A and B sides for M/E 1–4 and Program on Source 1, using brighter A-side and darker B-side family colors. Transition defaults use the matching family colors and provide M/E 1–4 plus Program CUT and AUTO targeting both primary and secondary. E-MEM defaults include a white Master E-MEM 0 button and color-coded Primary/Secondary E-MEM 0 buttons for M/E 1–4 plus red Program Primary/Secondary buttons. PBUS Recall and Trigger defaults cover PBUS devices 1–8 at Register/Trigger 0 in their own section. GPI defaults cover GPI 1–32 in a separate section. Image Store defaults cover Outputs 1–10 at Image 0001. Button Mapping defaults cover Buttons 1–3 on Shifts 1–4 for M/E 1–4 and Program, all mapped to Source 1. Panel Memory defaults cover Registers 1–8.

When a suite is connected, the module subscribes to the frame's source catalog. AUX and Crosspoint actions then offer searchable source dropdowns using the frame's source numbers and names. A numeric source may still be entered manually while offline or when a source is not present in the catalog. Source 1 labels in the preset browser refresh to use the discovered frame name when available; buttons already placed on a page remain user-editable copies. If connected suites disagree about a source name, the lowest-numbered connected suite supplies the dropdown label while the numeric source ID remains authoritative.

AUX presets automatically follow their action's AUX and Source fields. Their labels show the live source number/name, and they turn light purple while that source is online on the selected AUX bus. Disable **Automatically show frame Source name and number** on the AUX feedback to preserve custom button text.

Macro Stop All uses the K-Frame all-macros Stop event and also stops macros paused at a User Wait.

## Safety

Button Mapping changes the switcher panel mapping. PBUS Trigger sends a clear/select/fire/clear sequence. Confirm targets on a simulator or non-air system before using either action in production.

This project is not affiliated with or endorsed by Grass Valley.
