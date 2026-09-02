# Cranes Game

A browser game about operating heavy machinery on ground you can actually dig.

The dirt is real: scrape it and it piles up on the blade, dump it and the pile
slumps like a real pile of sand. Nothing vanishes — every cubic metre you move
has to end up somewhere.

No install, no account, no server. It's a web page.

## Play

Pick a site with **N**. Each site starts you in the machine that belongs there.

| Site | Machine | Job |
|---|---|---|
| Sandbox Yard | Bulldozer | Push dirt around. Level the pad if you feel like it. |
| Lift Yard | Crawler crane | Hoist beams, pipes and a crate onto their foundation pads. |
| Pipeline Cut | Excavator | Dig the trench along the marked route, keep the spoil clear. |

### Driving

Every machine drives the same way: **W/S** forward and back, **A/D** to turn.
They're tracked, so they turn on the spot.

### Bulldozer

| Key | |
|---|---|
| **R / F** | Blade up / down |
| **T / Y** | Tilt the blade back / forward |
| **H** | Hold the blade at grade |

### Excavator

| Key | |
|---|---|
| **Q / E** | Swing the cab left / right |
| **R / F** | Boom up / down |
| **T / Y** | Stick in / out |
| **Z / X** | Curl the bucket in / out |

### Crawler crane

| Key | |
|---|---|
| **Q / E** | Slew left / right |
| **R / F** | Boom up (closer, stronger) / down (further, weaker) |
| **T / Y** | Hoist up / down |
| **Z / X** | Turn the hanging load |
| **Space** | Grab / release the load |

### Everything else

| Key | |
|---|---|
| **C** | Recentre the camera |
| **V** | Change camera |
| **G** | Show the job markers |
| **P** | Toggle the pretty lighting |
| **N** | Next site |
| **J** | Next job on this site |

Mouse drags orbit the camera, scroll zooms.

## Run it yourself

```
npm install
npm run dev
```

Then open the address it prints.

## Under the hood

TypeScript, Three.js, Vite. The simulation is plain code that never touches the
renderer — terrain is a height grid plus a material per cell, and the machines
edit it. `PLAN.md` has the full design and the reasoning behind it.
