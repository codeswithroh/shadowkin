# Shadowkin

Make a hand shadow on your real wall. Hold it. It comes alive, and it's still in your room tomorrow.

**Play:** open https://shadowkin.vercel.app in the Meta Quest Browser (Quest 3 / 3S), tap *Light the lantern*, and put the controllers down.

Hands-only mixed reality, seated, about 5 minutes a day. Built with [IWSDK](https://iwsdk.dev) 1.0 for the Meta VR Start Developer Competition 2026. Submission text, video plan and the on-device checklist are in [SUBMISSION.md](SUBMISSION.md).

## How to play

- **Cast:** raise a hand between the lantern and a wall or desk. Its shadow lands on the real surface.
- **Match:** shape your shadow to fill the glowing silhouette and hold it. It comes alive.
- **Today's shadow:** one shape per day, the same for everyone. Make it to keep your ★ streak.
- **Play with your kin:** poke one with a fingertip, sweep your shadow to scatter them, hold it still to call them over, or make a wolf to send them running.
- **Come back:** your kin sleep where you left them and wake up when they see your hands.
- **Menu:** turn a hand palm-up, then poke *Skip*, *Easy* or *Sound* with your other index finger.
- **Lantern:** pinch it to move it.

## Develop

```sh
npm install
npm run dev        # managed dev server + browser with the IWER Quest 3 emulator
npm run typecheck
npm run build      # → dist/
```

**Desktop preview (no headset):** click *Preview without a headset*.
- The mouse moves a simulated hand in front of a virtual desk and wall.
- Keys `1`–`6` set the hand shape (Starfish, Rabbit, Crab, Stag, Wolf, Butterfly with two hands) and `0` gives an open hand.
- `n` skips, `e` toggles Easy, `m` toggles sound.

**Automated checks** (start the server with `npx @iwsdk/cli dev restart --allow-browser-automation`):

```sh
npx @iwsdk/cli browser run scripts/desktop-check.mjs --timeout 105000   # full loop, persistence, reactions
npx @iwsdk/cli xr enter && npx @iwsdk/cli xr set-input-mode --input-json '{"mode":"hand"}'
npx @iwsdk/cli browser run scripts/xr-state.mjs                         # app state inside the emulated XR session
```

`window.__shadowkin` exposes `state()`, `selfTest()` (cross-scores between all targets), `save()`, `wipe()` and `reset()`.

## Code map

| File | What it does |
|---|---|
| `src/shadow-system.ts` | Core loop: hands → surface pick → projection → scoring → birth; lantern, nest anchor, HUD, guide glow, light pools, saving |
| `src/creature-system.ts` | Creature life: wander within the real surface's bounds, pet, flee/follow your shadow, wolf panic, sleep/wake, blink, voices |
| `src/shadow-projector.ts` | Surfaces from XR planes, point-light projection of hand joints, shadow drawing |
| `src/matcher.ts` | 64×64 raster, centroid/area normalization, IoU over rotations and mirror |
| `src/silhouettes.ts` | Target shapes as poses of a parametric hand (one- and two-hand) |
| `src/hand-skeleton.ts` | WebXR joint layout and the parametric hand model |
| `src/save.ts` | localStorage save, daily shape, streak, unlocks |
| `src/audio.ts` | Synthesized sound: lantern crackle, match hum, spatial creature voices |
| `src/palm-menu.ts` | Palm-up hands-only settings |
| `src/lantern.ts`, `src/creature-art.ts`, `src/fx.ts` | Procedural art and particles |

## Deploy

`vercel.json` builds with `npm run build` and serves `dist/`. Run `npx vercel@latest deploy --prod`.
