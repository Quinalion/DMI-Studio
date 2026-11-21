import { readFileSync } from "fs";
import { Dmi, DmiState, frameUrl, loadRgba, splitImage } from "../shared/dmi";
import { encodePng } from "@lunapaint/png-codec";
import { expect, test } from "@jest/globals";
import { resolve } from "path";

test("basic DMI creation", () => {
    const test_dmi = new Dmi(32, 32);
    expect(test_dmi.width).toBe(32);
    expect(test_dmi.height).toBe(32);
});

test("basic DMI parsing", async () => {
    const dmi_data = readFileSync(resolve(__dirname, "./examples/letters.dmi"));
    const dmi = await Dmi.parse(dmi_data);
    expect(dmi.width).toBe(32);
    expect(dmi.height).toBe(32);
    expect(dmi.states.length).toBe(3);
    expect(dmi.states.map(x => x.name)).toContain("a");
    expect(dmi.states.map(x => x.name)).toContain("b");
    expect(dmi.states.map(x => x.name)).toContain("c");
});

test("stateless DMI parsing", async () => {
    const dmi_data = readFileSync(resolve(__dirname, "./examples/stateless.dmi"));
    const dmi = await Dmi.parse(dmi_data);
    expect(dmi.width).toBe(32);
    expect(dmi.height).toBe(32);
    expect(dmi.states.length).toBe(0);
});

test("non-square DMI parsing", async () => {
    const dmi_data = readFileSync(resolve(__dirname, "./examples/rectangles.dmi"));
    const dmi = await Dmi.parse(dmi_data);
    expect(dmi.width).toBe(32);
    expect(dmi.height).toBe(64);
    expect(dmi.states.length).toBe(4);
});

test("binary snapshots preserve RGBA and DMI metadata through save and reopen", async () => {
    const dmi = new Dmi(2, 1);
    const state = new DmiState('test "a" = "b" \\');
    const first = DmiState.empty_frame(2, 1);
    first.setPixelXY(0, 0, [12, 34, 56, 0]);
    const second = DmiState.empty_frame(2, 1);
    second.setPixelXY(0, 0, [123, 234, 32, 255]);
    state.frames = [first, second];
    state.delays = [0.5, 2];
    state.hotspots = [null, [4, 9]];
    dmi.states.push(state);

    const restored = Dmi.fromData(dmi.toData());
    expect(restored.isSame(dmi)).toBe(true);
    const data = await restored.getFileData();
    expect(Buffer.from(data).subarray(37, 41).toString("ascii")).toBe("zTXt");
    const reopened = await Dmi.fromSnapshot({ file: Uint8Array.from(data).buffer });
    expect(reopened.isSame(dmi)).toBe(true);
    expect((await loadRgba(await frameUrl(first))).getPixelXY(0, 0)).toEqual([12, 34, 56, 0]);
});

test("a PNG sheet with its own description still splits into row-major sprites", async () => {
    const pixels = Uint8Array.from([10, 0, 0, 255, 20, 0, 0, 255, 30, 0, 0, 255, 40, 0, 0, 255]);
    const { data } = await encodePng(
        { data: pixels, width: 2, height: 2 },
        {
            ancillaryChunks: [
                {
                    type: "zTXt",
                    keyword: "Description",
                    text: "Sprite sheet",
                    compressionLevel: undefined
                }
            ]
        }
    );
    const source = await Dmi.readImage(data);
    expect(source.dmi).toBeUndefined();
    expect(splitImage(source.image!, 1, 1).frames.map(frame => frame.getPixelXY(0, 0)[0])).toEqual([
        10, 20, 30, 40
    ]);
});
