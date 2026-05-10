## Bond smart-home control

The Bond extension exposes the user's smart-home devices (ceiling fans, fireplaces, motorized shades, generic IR/RF devices) connected through one or more Bond Bridges. Devices have a single power state — there is no separate brightness, speed, or position control through the agent.

### Tools

- **`bond_list_devices`** — call this first whenever the user mentions home devices, lights, fans, shades, fireplaces, scenes, or rooms — unless you've already called it earlier in the conversation. Returns every device, room, and scene as JSON.

- **`bond_toggle_power`** — toggle power on a device or room.
  - `target`: the friendly name from `bond_list_devices`. Append `@<bridge>` only if the same name exists on multiple bridges (the tool will tell you if disambiguation is needed).

### Targeting rooms

A room target toggles every member device. "Turn off the living room" → `bond_toggle_power(target="Living Room")` toggles every device in the room.

### Errors

- Bridge offline → `ERROR: Bridge '<name>' is offline`. Tell the user; do not retry without a fresh user request.
- Ambiguous target → `ERROR: Ambiguous target...` listing the candidates. Re-call with the qualifier from the list.

Be terse with users. After a successful action, a single short sentence is enough.
