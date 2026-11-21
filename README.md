# DMI Studio

A BYOND sprite editor for desktop VS Code, for reordering states, adjusting animation delays, and shifting pixels across selected frames.

Based on [AnturK/dmiEditor](https://github.com/AnturK/dmiEditor) 1.0.10 (commit `851d505`). Licensed under [GPL-3.0](LICENSE).

## Install

Download `dmi-studio-1.0.0.vsix` and use **Extensions: Install from VSIX…**, or run:

```sh
code --install-extension dmi-studio-1.0.0.vsix
```

If a `.dmi` opens as binary or in another editor, use **Open With… → DMI Studio**. **DMI Studio: Create DMI File** creates a file in a project folder.

## Editing

Ctrl/Cmd-click toggles selection. Shift-click selects a range. Ctrl/Cmd+A selects everything in the current view, or just the matches when a filter is active.

| Action | How |
| --- | --- |
| Open a state | Double-click its sprite. |
| Rename a state | Double-click its name. |
| Reorder states | Drag to the insertion line between cards, including across rows, or use the arrow buttons. Selected states move as a block and keep their order. |
| Sort states | **Sort** or **DMI Studio: Sort States**. Sorting ignores case and puts `walk2` before `walk10`. |
| Reorder animation frames | Click a column number to select all its directions. Drag it to an insertion line or use the arrow buttons. Delays and hotspots move with the column. |

The editor has search, zoom, a checkerboard background, and a choice of preview direction. You can change the DMI dimensions, frame and direction counts, delays, loop count, and movement and rewind flags. Each group edit takes one undo step.

Pixel shifts affect the selected frames. Pixels past the frame edges are clipped. The vacated area becomes transparent. Delays and hotspots stay in place.

**Open With… → DMI Preview** opens a read-only view. **Compare** compares two DMI files in read-only mode and marks added, removed, changed, and reordered states. Click a sprite to inspect its frames and settings.

## Copy and paste

Right-click a sprite or frame for **Cut**, **Copy**, and **Paste**. Right-clicking a selected item keeps the selection, so the action applies to the whole group. Right-clicking an unselected item selects it first.

In the state list, paste inserts after the last selected state, or at the end when nothing is selected. Copies retain names, directions, frames, delays, loops, flags, and hotspots. Duplicate names are flagged. Copying between open DMIs requires matching frame sizes.

Inside a state, each cell holds one direction at one point in the animation. Cut clears the selected cells and keeps the animation length. Paste depends on the destination selection:

- One cell selected. Paste the whole group with its original positions in time and direction rows. Add columns on the right as needed.
- Several cells selected, one cell copied. Fill every selected cell with that image.
- The same number of cells selected and copied. Replace them pairwise in on-screen row order.

Pasting into cells replaces pixels. Delays and hotspots belong to columns and stay in place.

PNG sheets use the DMI frame size as the tile size. Both image dimensions must be exact multiples of it. In the state list, paste creates one state per tile in row order. In the frame grid, image rows map to directions when they fit. Larger sheets fill consecutive frames in the destination direction.

The full selection goes to the clipboard as `text/plain`, with the header `DMI Studio clipboard/1`, a newline, and JSON. When the webview supports image access, Copy also exports the first selected item as `image/png`. DMI Studio uses the text data to paste the full group.

## Building

Requires Git and Node.js 22.12+ or 24 LTS.

```sh
npm ci
npm test -- --runInBand
npm run package
```

The pinned png-codec fork writes BYOND's compressed `Description` chunk immediately after `IHDR`. esbuild bundles the Codicon stylesheet and font from the editor's CSS import.
