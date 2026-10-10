# Clayborn

**Draw a monster. It inflates into living clay. Its shape decides what it's good at.**

▶ **Play it in your browser: https://tbone94.github.io/clayborn/**

A modern take on Sega's *Amazing Island* (GameCube, 2004). That game's creature editor was brilliant, but the minigames around it were a grind. Clayborn keeps the editor and rebuilds the rest so the shape you draw *is* the gameplay.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ — drop it on itch.io / GitHub Pages / Netlify
```

## How to play

1. **Pick a body type** (7 of them, each with its own movement and perk):
   Stomper (all-rounder) · Prowler (fast + steady) · Bouncer (big jumps) · Slither (super swimmer) · Flapper (flaps again in mid-air) · Skitter (never falls over) · Roly (rolls and body-slams).
2. **Draw it step by step** in the Mold Lab, like Amazing Island: Body → Head → Legs → Arms → Tail → Wings → Horns. Close a loop and it fills in, or use the Oval stamp. Optional parts can be skipped.
3. Watch it **inflate into clay** on the turntable as you draw. Click it to poke it.
4. **Bring it to life.** Every monster you make keeps living on the island Chao-Garden-style. They wander, nap, play, gossip with each other and greet you. Pet them (E), and swap to play as any of them (F).
5. Three areas of the island are covered in the Gloom.
6. Win each area's event to wash its Gloom away:
   - **Ridge Run** (競走): race over hills, a river and a chasm.
   - **Bonk Bowl** (相撲): shove everyone off a shrinking drum.
   - **Sky Leap** (飛翔): sprint off a cliff and glide.
7. Lost? The results screen tells you *what to redraw* ("a big tail makes you swim faster"). Hit "Redraw my monster", change the shape and try again.

**Controls:** WASD / arrows to move · Space to jump (hold to glide) · Shift to dash · E to interact / pet · F to swap monsters · drag to look.
Touch screens get a joystick and buttons. In the Mold Lab, keys 1–7 switch parts, B/E/O pick brush/eraser/oval, Enter goes to the next step, Ctrl+Z undoes.

## How it works

No 3D models, no textures, no audio files. Everything is generated from your drawing.

| Stage | Technique |
|---|---|
| Drawing → shape | Each part is a 2D mask. A **Euclidean distance transform** gives the outline distance; a multigrid **Poisson solve** (ΔH = −2) gives the inflation height, and `√H` gives round cross-sections (the same idea as *Teddy* and Google's *Monster Mash*). |
| Shape → 3D | Parts become signed-distance fields. Mirrored limbs are placed at the body's depth, and everything is merged with **smooth-min**, so joints blend like pressed clay. |
| 3D → mesh | **Surface Nets** + Taubin smoothing. Rebuilds take ~40–80 ms while you draw. |
| Skeleton | Joints are found where each part overlaps the body (or a "bridge" is grown if you drew it floating). **Skin weights come free** from each part's distance field. |
| Animation | All procedural: gait from leg length, diagonal quadruped trot, hopping, spring tails, wing flaps, squash and stretch, plus physics-driven **googly eyes**. |
| Stats | Measured, not looked up: volume = mass, leg length = stride, foot spread ÷ belly height = balance, wing area ÷ mass = glide, tail area = swim. |
| UI | Shōwa-era kaiju toy-box packaging × fighting-game menus: Dela Gothic One + DotGothic16, newsprint/ink/red/yellow, skewed slabs, halftone, registration marks, diagonal wipe transitions. |
| Look | Custom clay shader: fingerprints and bumps, patterns painted in rest-pose space (spots, stripes, lava, stars…), clay / felt / vinyl / jelly finishes, tilt-shift "diorama" post-processing. |
| Sound | WebAudio synths: kalimba music, squishes, and Animal-Crossing-style babble voices pitched by body mass. |

Share a creature with the **Share** button (a compact code), or link to `…/#c=<code>`.

## Project layout

```
src/creature/  field.js (EDT + Poisson) · builder.js (SDF, joints, mesh, skinning) · mesher.js (surface nets)
               creature.js (rig, gait, googly eyes) · stats.js · generator.js (procedural doodler) · frames.js
src/ui/        creator.js (sketchbook) · input.js
src/scenes/    studio.js · island.js · common.js (water, sky, particles, props)
src/events/    base.js · race.js · bonk.js · leap.js
src/fx/        clay.js (material) · render.js (post) · audio.js
```

Built with [three.js](https://threejs.org) and [Vite](https://vite.dev). Fonts: Fredoka and Gochi Hand (Google Fonts, OFL).
Inspired by *Amazing Island* (Sega/Ancient/Hitmaker, 2004). No assets from it are used.

## Assets & credits

The monsters are generated from your drawing. The world uses free assets, downloaded by `node scripts/fetch-assets.mjs` into `public/assets`:

- **[Poly Haven](https://polyhaven.com)** (CC0): the `kloofendal_48d_partly_cloudy_puresky` HDRI sky, PBR textures (coast sand, rock face, forest ground, rocky trail, bark, wood planks, stone wall, stone tiles, aerial grass) and the `fern_02` model.
- **[ez-tree](https://github.com/dgreenheck/ez-tree)** by Daniel Greenheck (MIT): the procedural tree generator, plus grass, flower, rock and ground assets from its demo.
- **[three.js](https://threejs.org)** (MIT): the renderer and the water normal map.

## Trailer

`dev.trailer()` in the browser console (dev server only) renders the trailer frame-by-frame into `captures/trailer`. Then run:

```bash
node scripts/make-trailer.mjs   # synthesizes the soundtrack and writes clayborn-trailer.mp4
```

### The prestige cut

A second, very serious trailer (`src/trailer/cinema.js`): scope letterbox, teal/orange grade, gold serif cards, slow motion, and lowercase subtitles that undercut every card. It ends by collapsing into the toy-box logo. Run `dev.cinema()` in the console (poll `window.trailerProgress`), then:

```bash
node scripts/make-cinema.mjs    # synthesizes the score and writes clayborn-cinema-trailer.mp4
```

`dev.cinema({ dir: "cinema_check", pick: [12.5, 30] })` renders just those seconds for a quick look (reload the page before a full render).
