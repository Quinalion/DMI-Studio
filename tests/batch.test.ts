import { expect, test } from "@jest/globals";
import { Dmi, DmiState } from "../shared/dmi";
import {
    captureFrames,
    imageCells,
    moveBefore,
    pasteTargets,
    putFrame,
    range,
    reorderColumns,
    shiftPixels,
    sortStateOrder
} from "../shared/batch";
import { findInsertion } from "../media/editor/reorder";

function fixture() {
    const state = new DmiState("run", 2, true, true, 4);
    state.delays = [0.5, 2, 4];
    state.hotspots = [
        [1, 2],
        [3, 4],
        [5, 6]
    ];
    for (const i of range(12)) {
        const image = DmiState.empty_frame(3, 2);
        image.setPixelXY(0, 0, [i, 90, 10, 255]);
        putFrame(state, i, image);
    }
    return state;
}

test("sparse selection moves as a stable group to either end", () => {
    expect(moveBefore(6, [4, 1], 0)).toEqual([1, 4, 0, 2, 3, 5]);
    expect(moveBefore(6, [1, 4], 6)).toEqual([0, 2, 3, 5, 1, 4]);
});

test("drop gaps and row ends identify insertion boundaries without swapping cards", () => {
    const rectangle = (i: number) => ({
        left: (i % 3) * 60,
        right: (i % 3) * 60 + 50,
        top: Math.floor(i / 3) * 60,
        bottom: Math.floor(i / 3) * 60 + 50
    });
    const slot = (x: number, y: number) => {
        const { index, side } = findInsertion(8, 3, rectangle, x, y, 10);
        return index + Number(side === "after");
    };
    expect(slot(55, 20)).toBe(1);
    expect(slot(175, 20)).toBe(3);
    expect(slot(2, 62)).toBe(3);
    expect(slot(175, 135)).toBe(8);
    expect(moveBefore(8, [1], slot(175, 20))).toEqual([0, 2, 1, 3, 4, 5, 6, 7]);
    expect(moveBefore(8, [5, 2], slot(55, 20))).toEqual([0, 2, 5, 1, 3, 4, 6, 7]);
});

test("sort uses numeric names and keeps the relative order of equal names", () => {
    const states = ["walk10", "Walk2", "Idle", "walk2"].map(name => new DmiState(name));
    expect(sortStateOrder(states)).toEqual([2, 1, 3, 0]);
});
test("timeline move survives a real DMI save with timings, hotspots, flags and directions", async () => {
    const dmi = new Dmi(3, 2);
    dmi.states = [reorderColumns(fixture(), [2, 0, 1])];
    const reopened = await Dmi.parse(await dmi.getFileData());
    const state = reopened.states[0];
    expect(state.delays).toEqual([4, 0.5, 2]);
    expect(state.hotspots).toEqual([
        [5, 6],
        [1, 2],
        [3, 4]
    ]);
    expect([state.loop, state.rewind, state.movement, state.dirs]).toEqual([2, true, true, 4]);
    expect(state.frames.map(f => f.getPixelXY(0, 0)[0])).toEqual([
        8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7
    ]);
});
test("pixel shift preserves RGBA, clears vacated pixels and clips without wrapping", () => {
    const frame = fixture().frames[7];
    const moved = shiftPixels(frame, 1, 1);
    expect(moved.getPixelXY(1, 1)).toEqual([7, 90, 10, 255]);
    expect(moved.getPixelXY(0, 0)[3]).toBe(0);
    expect(
        shiftPixels(frame, -1, 0)
            .getRGBAData()
            .filter((_, i) => i % 4 === 3)
            .every(a => a === 0)
    ).toBe(true);
    expect(frame.getPixelXY(0, 0)[3]).toBe(255);
});
test("clipboard copies a sparse footprint into a later time and can extend the timeline", () => {
    const state = fixture();
    const cells = captureFrames(state, [0, 8, 5]);
    expect(pasteTargets(state, cells, [5]).map(x => x.target)).toEqual([5, 13, 10]);
    expect(() => pasteTargets(state, cells, [3])).toThrow("direction");
    expect(() => pasteTargets(state, cells, [1, 2])).toThrow("destination");
});
test("single image fills selection and equally sized groups map in display order", () => {
    const state = fixture();
    const cells = captureFrames(state, [0, 4]);
    expect(pasteTargets(state, cells.slice(0, 1), [2, 6]).map(t => t.source)).toEqual([0, 0]);
    expect(pasteTargets(state, cells, [2, 6])).toEqual([
        { target: 2, source: 0 },
        { target: 6, source: 1 }
    ]);
});

test("PNG sheets preserve rows when directions fit and extend a single direction in tile order", () => {
    const state = fixture();
    const sheet = DmiState.empty_frame(6, 4);
    [11, 22, 33, 44].forEach((value, i) => {
        sheet.setPixelXY((i % 2) * 3, Math.floor(i / 2) * 2, [value, 0, 0, 255]);
    });
    const cells = imageCells([sheet], state, [5]);
    expect(cells.map(cell => cell.image.getPixelXY(0, 0)[0])).toEqual([11, 22, 33, 44]);
    expect(pasteTargets(state, cells, [5]).map(cell => cell.target)).toEqual([5, 9, 6, 10]);
    const single = fixture();
    single.set_dirs(1);
    expect(
        pasteTargets(single, imageCells([sheet], single, [1]), [1]).map(cell => cell.target)
    ).toEqual([1, 2, 3, 4]);
    expect(() => imageCells([DmiState.empty_frame(5, 4)], state, [5])).toThrow("multiples");
});
test("direction changes retain each animation column", () => {
    const state = fixture();
    state.set_dirs(1);
    expect(state.frames.map(f => f.getPixelXY(0, 0)[0])).toEqual([0, 4, 8]);
    state.set_dirs(8);
    expect(state.frames[16].getPixelXY(0, 0)[0]).toBe(8);
    expect(state.frames[17].getPixelXY(0, 0)[3]).toBe(0);
});
