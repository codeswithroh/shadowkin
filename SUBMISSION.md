# Shadowkin: Devpost submission kit

Meta VR Start Developer Competition 2026 · deadline **Nov 18, 2026, 12:00 PM PT**

- **Track:** Gaming · **Division:** New Experience
- **Build:** https://shadowkin.vercel.app (IWSDK / WebXR; open it in the Meta Quest Browser)
- **Platform:** Meta Quest 3 / 3S, hands only, seated, mixed reality

---

## Tagline (140 characters max)

> Make a hand shadow on your real wall. Hold it. It comes alive, and it's still in your room tomorrow.

(103 characters)

## Description (under 500 words)

Shadow puppetry is centuries old and needs nothing but a light and your hands. Shadowkin adds the one thing it never had: **your shadow can come alive.**

Tap *Light the lantern* in the Quest Browser and a small paper lantern lights up in front of you. Raise a hand and its shadow falls on your **real wall or desk**, soft-edged and inside a warm pool of lantern light. A faint glowing shape appears under it. Bend your fingers until your shadow fills the glow, hold it, and the shadow peels off the wall as a creature with glowing eyes. It hops around **on your actual surfaces**, keeps to their real edges, and is still there next time.

**It only works in mixed reality.** Shadows are cast from a virtual flame through your tracked hand joints onto surfaces from Scene Understanding. Move your hand toward the lantern and the shadow grows. Move it toward the wall and the edge sharpens, just like a real one. A table, a wall or a window each becomes a different stage. In a room with no scan, a paper screen appears so the game still works.

**A reason to come back every day.**
- **Today's shadow:** one silhouette per date, the same for everyone, Wordle-style. Make it to keep your ★ streak.
- **Kin live in your room:** creatures are saved against a persistent spatial anchor. Tomorrow they're asleep where you left them, and they wake when they see your hands.
- **Unlocks:** each new kin reveals the next shape, from Starfish to Rabbit, Crab, Stag, Wolf, and the two-handed Butterfly.

**Your hands are also how you play with them.**
- Poke a creature with a fingertip and it spins happily.
- Sweep your shadow at them and they scatter. Hold it still and they creep closer.
- Make a **wolf** and everyone panics, except your wolves, who come running and howl.

**Built for seated, hands-only, narrow-FoV play.** Everything is within arm's reach, and the target card sits about 19° below your eye line. No controllers, and no text you need to read. There's no AI wrapper either: remove every API and the whole game remains.

**How it works.** IWSDK 1.0 with WebXR hand tracking, plane detection and anchors.
- **Scoring:** the 25 joints of each hand are projected onto the hit surface and rasterized. The result is normalized by centroid and area, so hand size and distance don't matter, and scored by IoU against the target with small rotations and mirroring, so either hand works.
- **Tables:** stretched shadows on tables are scored from the lantern's point of view instead.
- **Sound:** all synthesized live. A rising hum gives the feedback controller haptics would, and creature voices are positioned in the room.
- **Assets:** none. Everything is procedural.

**Accessibility.** Turn a hand palm-up for a small menu: Easy matching, Skip, Sound. Every shape except the optional Butterfly needs only one hand.

## Hand interactions (form field)

| Action | Gesture | Notes |
|---|---|---|
| Cast a shadow | Raise either hand between the lantern and a wall or desk | Real joint positions → real projected shadow; distance sets size and softness |
| Make a shape | Form the silhouette shown as the glow; hold about 0.8 s | Works with left or right hand and with palm toward or away from the wall |
| Two-hand shape | Hook thumbs, spread fingers (Butterfly) | Both hands' shadows are scored as one shape |
| Move the lantern | Pinch the lantern and drag it, then let go | Saved relative to the room anchor |
| Pet a creature | Touch it with an index fingertip | Happy spin, sparkles, voice |
| Scare / attract | Sweep the shadow fast / hold it still near them | They flee or come closer |
| Wolf | Make a wolf shadow | Others panic; wolves come and howl |
| Settings | Turn a hand palm-up; poke a button with the other index finger | Skip · Easy · Sound. Palm-up never casts a useful shadow, so it can't fire by accident |
| Controllers | (not needed) | If you're holding controllers, the card asks you to put them down |

## Launch date

Playable now at https://shadowkin.vercel.app. Planned Horizon Store launch as a PWA after the competition (IWSDK PWA packaging).

---

## Video plan (under 3 min, real footage only)

Record on the headset (*Meta Quest → Camera → Record video*, passthrough on). No AI-generated footage. Lead with the magic moment.

| Time | Shot | Voice / text |
|---|---|---|
| 0:00–0:12 | Close shot: a real hand rises, its shadow appears on a real wall, a Rabbit forms, holds, peels off, blinks | none; just the hum rising and the birth chime |
| 0:12–0:25 | The lantern lights up; title card | "Shadowkin. Make a hand shadow. Hold it. It comes alive." |
| 0:25–0:55 | First five minutes: the Starfish tutorial (no text), then today's shadow with its gold eyes and ★ streak | "No controllers, no menus. Fill the glow." |
| 0:55–1:25 | Playing with kin: poke one (spin), sweep the shadow (they scatter), wolf shadow (panic plus a howl) | "Your hands are how you play with them." |
| 1:25–1:50 | Take the headset off, come back: the kin are asleep where you left them and wake when you wave | "They live in your room." |
| 1:50–2:10 | Butterfly with two hands; the desk and window as alternate stages | "Every room is a different stage." |
| 2:10–2:35 | Tech montage: wireframe planes, the shadow-to-mask IoU, the palm-up menu, Easy mode | "Real hand joints, real surfaces, scored as shapes." |
| 2:35–2:50 | Seated, arm's-reach framing; end card with the URL | "Seated. Hands only. Built with IWSDK." |

Upload to YouTube as **Public** and paste the link into Devpost.

---

## Before you submit: on-device checklist

The emulator can't verify these. Do them on a real Quest 3/3S, in at least three rooms you haven't tried before.

- [ ] Quest Browser → https://shadowkin.vercel.app → *Light the lantern* → allow permissions; the room scan prompt appears if needed
- [ ] Hand shadows land on a wall and on a desk; the shadow lines up with your real hand's direction
- [ ] All six shapes can be made by a real hand on Normal; if any can't, note which and lower that shape's difficulty (`src/silhouettes.ts`) or rely on Easy
- [ ] Rabbit vs Stag aren't confused in practice
- [ ] Creatures stay on the table instead of walking into the air
- [ ] Exit and re-enter (and reboot the headset): the lantern and kin come back in the same real place
- [ ] Taking the headset off pauses; putting it back on resumes
- [ ] Palm-up menu opens on both hands; Easy and Skip respond to a poke
- [ ] With no room scan, the paper screen appears and the game still works
- [ ] Frame rate stays at 72 fps or better with 10 kin out (enable the Quest performance overlay via Meta Quest Developer Hub)
- [ ] Sound plays after *Light the lantern*

## Submission steps

1. Devpost → *Enter a submission* → Gaming / New Experience.
2. Paste the tagline, description and hand-interaction table above.
3. Build URL: https://shadowkin.vercel.app
4. YouTube link (public, under 3:00).
5. Screenshots: take them in the headset (see the video plan); `scripts/out/` has desktop-preview captures for reference.
6. Submit before **Nov 18, 12:00 PM PT**. Don't deploy changes after the deadline: the build has to stay frozen and online until about Dec 11.
