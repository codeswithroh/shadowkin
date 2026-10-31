# Shadowkin

Make a hand shadow on your real wall or table. Hold the shape. It comes alive.

## Desktop testing (no headset)

`npm run dev`, then in the browser view (click it first so it gets key presses):

- Move the mouse: moves a simulated right hand in front of a virtual desk and wall.
- `1`-`4`: put the hand in the Starfish, Rabbit, Stag, Crab pose. `0`: open hand.
- `n`: skip to the next target.

`npx @iwsdk/cli browser run scripts/desktop-check.mjs` runs the scripted smoke
test (screenshots land in `scripts/out/`).

In XR, pinch the lantern to move it.

---

# IWSDK App

This project uses `iwsdk.config.json` for declarative scene, asset, component,
XR, and emulator configuration. Application systems remain explicit in
`src/index.ts`.

```sh
npm install
npm run dev
```

Use the Runtime and Editor controls in the managed browser to switch between
the running experience and its authored scene.

## Starter content

The robot and welcome panel are small examples of authored scene content plus
runtime systems. The robot turns toward the player's head and plays a sound
when pressed. To remove the robot, delete its scene node, its `RobotSystem`
registration from `src/index.ts` or `src/index.js`, and its `Robot` registration
from `src/components.ts` or `src/components.js`; you can then delete the unused
robot component and system files. To remove the welcome panel, delete its scene
node and its `PanelSystem` registration from the application entry point.

- Minimal scene walkthrough: https://iwsdk.dev/guides/01b-minimal-scene.html
- XR-enabled projects — IWER emulator controls: https://iwsdk.dev/guides/02-testing-experience.html#iwer-controls
