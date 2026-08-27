# Grass Valley K-Frame

Community-developed Companion module for controlling Grass Valley K-Frame switchers through the CPL protocol.

This development release ports the verified GV Macro Player Stream Deck v2026.3.0.0 protocol engine to Companion.

## Configuration

Enter the K-Frame IP address and select the suite. Ports are fixed in code and cannot be changed by the user: 6132/6133 for Suite 1, 6134/6135 for Suite 2, 6136/6137 for Suite 3, and 6138/6139 for Suite 4.

## Controls

The first iteration includes native actions for connection, macros, AUX routing, crosspoints, E-MEM, transitions, panel memory, Image Store, timeline RUN, GPI, PBUS recall/trigger, and panel button mapping. An advanced raw-CPL action is included for engineering and protocol testing.

Connection and macro-active feedbacks, connection variables, and starter presets are included. This build has passed local byte-vector, TypeScript, lint, package, and Companion loading checks; live switcher or simulator behavior must still be validated before production use.

## Safety

Button Mapping changes the switcher panel mapping. PBUS Trigger sends a clear/select/fire/clear sequence. Confirm targets on a simulator or non-air system before using either action in production.

This project is not affiliated with or endorsed by Grass Valley.
