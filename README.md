<p align="center">
  <a href="https://shadowkin.vercel.app"><img src="docs/media/banner.jpg" alt="Shadowkin: a hand's shadow with glowing eyes on a lantern-lit wall" width="100%"></a>
</p>

<h1 align="center">Shadowkin</h1>

<p align="center">
  <b>Make a hand shadow on your real wall. Hold it. It comes alive.</b><br>
  A seated, hands-only mixed reality game for Meta Quest 3 and 3S.
</p>

<p align="center">
  <a href="https://shadowkin.vercel.app"><img src="https://img.shields.io/badge/Play-shadowkin.vercel.app-ffb060?style=for-the-badge&labelColor=120b10" alt="Play Shadowkin"></a>
  <a href="https://youtu.be/MZuxKrEJJU8"><img src="https://img.shields.io/badge/Watch-2_min_demo-ffb060?style=for-the-badge&logo=youtube&logoColor=white&labelColor=120b10" alt="Watch the demo"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Meta_Quest-3_%2F_3S-120b10" alt="Meta Quest 3 and 3S">
  <img src="https://img.shields.io/badge/IWSDK-1.0-120b10" alt="IWSDK 1.0">
  <img src="https://img.shields.io/badge/WebXR-mixed_reality-120b10" alt="WebXR mixed reality">
  <img src="https://img.shields.io/badge/TypeScript-strict-120b10?logo=typescript" alt="TypeScript strict">
  <img src="https://img.shields.io/badge/input-hands_only-120b10" alt="Hands only">
  <img src="https://img.shields.io/badge/art_files-0-120b10" alt="Zero art files">
</p>

<p align="center">
  <a href="#play-it">Play</a> ·
  <a href="#how-a-session-goes">How it plays</a> ·
  <a href="#the-kin">The kin</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#run-it-locally">Run it locally</a> ·
  <a href="#code-map">Code map</a> ·
  <a href="#status">Status</a>
</p>

<p align="center">
  <img src="docs/media/demo.gif" alt="A hand's shadow on a lantern-lit wall changes through the Rabbit, Butterfly and Stag shapes while small kin gather beside it" width="800"><br>
  <sub>Recorded in the IWSDK XR emulator on an emulated Quest 3.</sub>
</p>

Every kid has made a shadow rabbit on a wall, and it always vanished when the light went out. Shadowkin gives the shadow what it never had: a life of its own, in your room, waiting for you tomorrow.

## Play it

- **On a Quest 3 or 3S:** open **[shadowkin.vercel.app](https://shadowkin.vercel.app)** in the Quest Browser, tap *Light the lantern*, and put the controllers down.
- **On a computer:** open the same link and choose the desktop preview. The mouse moves a simulated hand.

## How a session goes

<table>
  <tr>
    <td width="50%"><img src="docs/media/rabbit.jpg" alt="A rabbit-shaped shadow on the wall with glowing eyes"></td>
    <td width="50%"><img src="docs/media/kin.jpg" alt="Several creature shadows gathered on the wall"></td>
  </tr>
  <tr>
    <td><b>1. Cast and match.</b> Raise a hand and its shadow lands on your wall. Bend your fingers until it fills the glowing shape, then hold it.</td>
    <td><b>2. It comes alive.</b> The shadow peels off the wall as a creature with glowing eyes.</td>
  </tr>
  <tr>
    <td><img src="docs/media/wolf.jpg" alt="A wolf-shaped shadow with kin running away"></td>
    <td><img src="docs/media/asleep.jpg" alt="Kin back on the wall after the game was reopened"></td>
  </tr>
  <tr>
    <td><b>3. Play with your hands.</b> Poke one and it spins. Sweep your shadow and they scatter. Hold still and they creep closer. Make a wolf and everyone panics, except your wolves.</td>
    <td><b>4. Come back.</b> Your kin are asleep where you left them, and they wake when they see your hands. Today's shadow keeps your ★ streak going.</td>
  </tr>
</table>

## The kin

<p align="center">
  <img src="docs/media/shapes.jpg" alt="The six shapes: Starfish, Rabbit, Crab, Stag, Wolf and Butterfly" width="100%">
</p>

Each kin is the real shadow of a hand pose, and each one unlocks the next. The Butterfly takes both hands.

| Gesture | What happens |
|---|---|
| Raise a hand between the lantern and a wall | Your joints cast a real shadow; distance sets its size and softness |
| Fill the glowing shape and hold | The shadow comes alive |
| Touch a creature with your index fingertip | It spins |
| Sweep your shadow, or hold it still | They scatter, or creep closer |
| Make a wolf shadow | Everyone panics; your wolves come and howl |
| Pinch the lantern | Move it |
| Turn a palm up | Opens *Skip*, *Easy* and *Sound*; poke them with your other index finger |

## How it works

```mermaid
flowchart LR
    A["25 hand joints<br/>WebXR hand tracking"] --> B["Cast from the lantern<br/>onto a detected surface"]
    B --> C["Draw the shadow"]
    B --> D["64 × 64 mask<br/>normalized by centre and area"]
    D --> E["Overlap with the target<br/>rotations and mirror"]
    E -->|"matched and held"| F["A creature is born"]
    F --> G["Saved to a spatial anchor"]
    G -->|"next session"| H["Asleep where you left it"]
```

<table>
  <tr>
    <td width="50%"><img src="docs/media/cast.jpg" alt="Diagram of the lantern casting hand joints onto a scanned wall"></td>
    <td width="50%"><img src="docs/media/score.jpg" alt="Diagram of a 64 by 64 shadow mask compared with a target shape"></td>
  </tr>
  <tr>
    <td><b>Real light logic.</b> Move your hand toward the lantern and the shadow grows and softens, because the joints are projected from a point light.</td>
    <td><b>Scored as a shape.</b> Normalizing what is actually drawn means hand size, distance and left or right hand don't matter.</td>
  </tr>
</table>

- **Passthrough matters:** shadows land on surfaces found by plane detection, so your room is the stage.
- **No art files:** creatures are drawn from hand poses, and all sound is synthesized live.
- **No external services:** no AI, no API and no backend. Saves live in local storage and spatial anchors.
- **Built for seated play:** everything stays within arm's reach, and you don't need to read anything.

## Run it locally

Requires Node.js (see `.nvmrc`).

```sh
npm install
npm run dev        # dev server and a browser with the IWER Quest 3 emulator
npm run typecheck
npm run build      # outputs to dist/
```

<details>
<summary><b>Desktop preview controls</b></summary>

Choose the desktop preview on the landing page.

| Input | Action |
|---|---|
| Mouse | Move the simulated hand |
| `1`–`6` | Starfish, Rabbit, Crab, Stag, Wolf, two-handed Butterfly |
| `0` | Open hand |
| `n` | Skip |
| `e` | Toggle Easy |
| `m` | Toggle sound |

</details>

<details>
<summary><b>Automated checks</b></summary>

Start the server with `npx @iwsdk/cli dev restart --allow-browser-automation`, then:

```sh
npx @iwsdk/cli browser run scripts/desktop-check.mjs --timeout 105000   # full loop, persistence, reactions
npx @iwsdk/cli xr enter && npx @iwsdk/cli xr set-input-mode --input-json '{"mode":"hand"}'
npx @iwsdk/cli browser run scripts/xr-state.mjs                         # app state in the emulated XR session
```

`window.__shadowkin` exposes `state()`, `selfTest()` (cross-scores between all targets), `save()`, `wipe()` and `reset()`.

</details>

<details>
<summary><b>Deploy</b></summary>

`vercel.json` builds with `npm run build` and serves `dist/`.

```sh
npx vercel@latest deploy --prod
```

</details>

## Code map

| File | What it does |
|---|---|
| [`src/shadow-system.ts`](src/shadow-system.ts) | Core loop: hands, surface pick, projection, scoring, birth; lantern, anchor, HUD, saving |
| [`src/creature-system.ts`](src/creature-system.ts) | Creature life: wander, pet, flee or follow, wolf panic, sleep and wake, voices |
| [`src/shadow-projector.ts`](src/shadow-projector.ts) | Surfaces from XR planes, point-light projection, shadow drawing |
| [`src/matcher.ts`](src/matcher.ts) | 64×64 raster, normalization, overlap over rotations and mirror |
| [`src/silhouettes.ts`](src/silhouettes.ts) | Target shapes as poses of a parametric hand |
| [`src/hand-skeleton.ts`](src/hand-skeleton.ts) | WebXR joint layout and the parametric hand model |
| [`src/save.ts`](src/save.ts) | Save data, daily shape, streak, unlocks |
| [`src/audio.ts`](src/audio.ts) | Synthesized lantern crackle, match hum, spatial creature voices |
| [`src/palm-menu.ts`](src/palm-menu.ts) | Palm-up, hands-only settings |
| [`src/lantern.ts`](src/lantern.ts), [`src/creature-art.ts`](src/creature-art.ts), [`src/fx.ts`](src/fx.ts) | Procedural art and particles |

## Status

Built for the [Meta VR Start Developer Competition 2026](https://start-developer-competition-26.devpost.com/) (Gaming, New Experience).

- [x] Full game loop, daily shadow, kin and persistence, tested in the IWSDK XR emulator
- [ ] Test on real Quest 3 and 3S headsets in several rooms
- [ ] Tune shapes against real hands
- [ ] Make tables a full stage alongside walls

Submission notes and the on-device checklist are in [SUBMISSION.md](SUBMISSION.md).

<p align="right"><a href="#shadowkin">Back to top ↑</a></p>
