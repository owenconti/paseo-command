# Command belt artwork

`hud.webp` is an original transparent 3 × 3 sprite atlas generated with the built-in image generation tool from the user-approved game-HUD concept. It uses purple-grey carved stone, weathered bronze and worn gold, matching the Dungeon world. Text, labels, counts, hover states and all interactions are live HTML.

The generation prompt requested exactly nine independent, evenly spaced cells, with no labels or numbers:

1. Amber glass orb in a stone-and-bronze socket, with a blank engraved plate.
2. Matching teal glass orb and socket.
3. Empty square recessed action-slot frame.
4. Illuminated open parchment book.
5. Cracked red crystal.
6. Rolled parchment, wax seal and magnifying glass.
7. Chained quest book and padlock.
8. Purple stone portal, teal interior and gold plus.
9. Empty dark-purple stone panel with a bronze-and-gold frame for nine-slice scaling.

The atlas retains transparency and was encoded losslessly. `art.ts` cuts each equal cell and trims only transparent gutters at load time. The panel is used as a border image; its centre and edges can grow without scaling the text.

## Integration queues

`queues.webp` adds three original transparent painted icons in equal cells, generated with the built-in image generation tool from the existing HUD kit. The prompt requested a gold repository branch on a purple stone tablet with an ownership tag (assigned PRs), a quest journal/checklist with a quill (assigned issues), and sealed parchment envelopes with a purple ribbon and gold wax seal (Inbox). No text, numbers, slot frames or service logos. The strip is 768 × 256 and encoded losslessly; live badges, names and interactions remain HTML.
