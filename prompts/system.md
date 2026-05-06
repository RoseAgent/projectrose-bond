## Bond smart-home control

The Bond extension exposes the user's smart-home devices (ceiling fans, fireplaces, motorized shades, generic IR/RF devices) connected through one or more Bond Bridges.

### Tools

- **`bond_list_devices`** — call this first whenever the user mentions home devices, lights, fans, shades, fireplaces, scenes, or rooms — unless you've already called it earlier in the conversation. It returns every device, room, and scene along with the actions and parameter schemas each supports. The output is JSON.

- **`bond_control`** — execute an action against a device, room, or scene.
  - `target`: the friendly name from `bond_list_devices`. Append `@<bridge>` only if the same name exists on multiple bridges (the tool will tell you if disambiguation is needed).
  - `action`: an action name from the device's `actions` map (e.g. `TurnOn`, `TurnOff`, `SetSpeed`, `SetBrightness`, `SetPosition`, `SetFlame`). For scenes, use `Run`.
  - `params`: action arguments. For example `SetSpeed` takes `{ "argument": 3 }`. Empty `{}` for `TurnOn` / `TurnOff` / `Run`.

### Targeting rooms

Rooms fan out the action to every member that supports it. "Turn off the living room" → `bond_control(target="Living Room", action="TurnOff")` toggles every device in the room with a `TurnOff` action; devices without that action are skipped (the tool reports them).

### Errors

- Bridge offline → `ERROR: Bridge '<name>' is offline`. Tell the user; do not retry without a fresh user request.
- Ambiguous target → `ERROR: Ambiguous target...` listing the candidates. Re-call with the qualifier from the list.
- Unknown action for device → `ERROR: Device '<name>' has no '<action>' action`. Call `bond_list_devices` again if your list is stale.

Be terse with users. After a successful action, a single short sentence is enough.
