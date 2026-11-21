import { DmiState, splitImage } from "./dmi";
import { Image } from "image-js";

export function range(length: number) {
    return Array.from({ length }, (_, i) => i);
}

// Insert the selected items, in document order, at an original list boundary.
export function moveBefore(length: number, selected: number[], before: number) {
    const all = range(length);
    const group = new Set(selected);
    return [
        ...all.filter(i => i < before && !group.has(i)),
        ...all.filter(i => group.has(i)),
        ...all.filter(i => i >= before && !group.has(i))
    ];
}

const stateNames = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function sortStateOrder(states: DmiState[]) {
    return range(states.length).sort((a, b) => stateNames.compare(states[a].name, states[b].name));
}

export function reorderColumns(state: DmiState, order: number[]) {
    const next = state.clone();
    const cells = order.flatMap(t => range(state.dirs).map(d => t * state.dirs + d));
    next.frames = cells.map(i => state.frames[i]);
    if (state.delays.length) next.delays = order.map(i => state.delays[i] ?? 1);
    if (state.hotspots) next.hotspots = order.map(i => state.hotspots![i]);
    return next;
}

export function putFrame(state: DmiState, index: number, image: Image) {
    state.frames[index] = image;
}

export function shiftPixels(frame: Image, dx: number, dy: number) {
    const { width, height } = frame;
    const pixels = frame.getRGBAData();
    const shifted = new Uint8Array(width * height * 4);
    const left = Math.max(0, -dx);
    const right = Math.min(width, width - dx);
    for (let y = Math.max(0, -dy); y < Math.min(height, height - dy); y++) {
        const start = (y * width + left) * 4;
        const end = (y * width + right) * 4;
        if (right > left)
            shifted.set(pixels.subarray(start, end), ((y + dy) * width + left + dx) * 4);
    }
    return new Image(width, height, shifted, { components: 3, alpha: 1, bitDepth: 8 });
}

export type FramePosition = { time: number; dir: number };
export type FrameCell = FramePosition & { png: string };
export type FrameImage = FramePosition & { image: Image };

export function captureFrames(state: DmiState, selection: number[]): FrameImage[] {
    const firstTime = Math.min(...selection.map(i => Math.floor(i / state.dirs)));
    const firstDir = Math.min(...selection.map(i => i % state.dirs));
    return selection.map(i => ({
        time: Math.floor(i / state.dirs) - firstTime,
        dir: (i % state.dirs) - firstDir,
        image: state.frames[i]
    }));
}

export function imageCells(images: Image[], state: DmiState, selected: number[]): FrameImage[] {
    let nextTime = 0;
    return images.flatMap(image => {
        const { frames, columns, rows } = splitImage(image, state.width, state.height);
        const asGrid = selected.length === 1 && rows <= state.dirs - (selected[0] % state.dirs);
        const start = nextTime;
        nextTime += asGrid ? columns : frames.length;
        return frames.map((frame, i) => ({
            time: start + (asGrid ? i % columns : i),
            dir: asGrid ? Math.floor(i / columns) : 0,
            image: frame
        }));
    });
}

export function pasteTargets(state: DmiState, cells: FramePosition[], selected: number[]) {
    if (!selected.length) throw Error("Select a destination frame.");
    if (!cells.length) throw Error("The clipboard has no frames.");
    if (selected.length > 1) {
        if (cells.length !== 1 && selected.length !== cells.length)
            throw Error("Select one starting cell, or as many destination cells as copied frames.");
        return selected.map((target, i) => ({ target, source: cells.length === 1 ? 0 : i }));
    }
    const t = Math.floor(selected[0] / state.dirs);
    const d = selected[0] % state.dirs;
    return cells.map((cell, source) => {
        if (
            !Number.isSafeInteger(cell.time) ||
            cell.time < 0 ||
            !Number.isInteger(cell.dir) ||
            cell.dir < 0 ||
            d + cell.dir >= state.dirs
        )
            throw Error("The copied frames do not fit these direction rows.");
        return { target: (t + cell.time) * state.dirs + d + cell.dir, source };
    });
}
