import { decodePng, encodePng } from "@lunapaint/png-codec";
import { Image } from "image-js";
import UPNG from "@pdf-lib/upng";

export const enum Dirs {
    NORTH = 1,
    SOUTH = 2,
    EAST = 4,
    WEST = 8,
    SOUTHEAST = SOUTH | EAST,
    SOUTHWEST = SOUTH | WEST,
    NORTHEAST = NORTH | EAST,
    NORTHWEST = NORTH | WEST
}

export const DirNames = [
    "South",
    "North",
    "East",
    "West",
    "Southeast",
    "Southwest",
    "Northeast",
    "Northwest"
];

type Hotspot = [number, number] | null | undefined;

export interface StateMetadata {
    name: string;
    loop: number;
    rewind: boolean;
    movement: boolean;
    dirs: number;
    delays: number[];
    hotspots: Hotspot[] | null;
}

export interface DmiData {
    width: number;
    height: number;
    states: (StateMetadata & { framecount: number })[];
    pixels: ArrayBuffer;
}

export type DmiSnapshot = { file: ArrayBuffer } | { document: DmiData };

function rgbaImage(width: number, height: number, data: Uint8Array) {
    return new Image(width, height, data, { components: 3, alpha: 1, bitDepth: 8 });
}

function pixelsOf(image: Image) {
    return new Uint8Array(image.data.buffer, image.data.byteOffset, image.width * image.height * 4);
}

async function decodeImage(bytes: Uint8Array, metadata = false) {
    const { image, metadata: chunks } = await decodePng(bytes, {
        force32: true,
        parseChunkTypes: metadata ? "*" : undefined
    });
    const description = chunks.find(
        chunk =>
            (chunk?.type === "zTXt" || chunk?.type === "tEXt" || chunk?.type === "iTXt") &&
            chunk.keyword === "Description" &&
            chunk.text.startsWith("# BEGIN DMI")
    );
    return {
        image: rgbaImage(image.width, image.height, image.data),
        metadata: description && "text" in description ? description.text : undefined
    };
}

export const pngPrefix = "data:image/png;base64,";

export async function loadRgba(source: string | Uint8Array) {
    const bytes =
        typeof source === "string"
            ? Uint8Array.from(atob(source.slice(pngPrefix.length)), char => char.charCodeAt(0))
            : source;
    return (await decodeImage(bytes)).image;
}

function pngUrl(data: Uint8Array) {
    let binary = "";
    for (let i = 0; i < data.length; i += 8192)
        binary += String.fromCharCode(...data.subarray(i, i + 8192));
    return pngPrefix + btoa(binary);
}

async function encodeImage(image: Image) {
    const { width, height } = image;
    return (await encodePng({ width, height, data: pixelsOf(image) }, { colorType: 6 })).data;
}

function pngBlob(bytes: Uint8Array) {
    return new Blob([Uint8Array.from(bytes)], { type: "image/png" });
}

export async function frameBlob(image: Image) {
    return pngBlob(await encodeImage(image));
}

const encodedFrames = new WeakMap<Image, Promise<string>>();

export function frameUrl(image: Image) {
    let url = encodedFrames.get(image);
    if (!url) {
        url = encodeImage(image).then(pngUrl);
        encodedFrames.set(image, url);
    }
    return url;
}

function blit(frame: Image, target: Uint8Array, targetWidth: number, x: number, y: number) {
    const source = pixelsOf(frame);
    const stride = frame.width * 4;
    for (let row = 0; row < frame.height; row++) {
        const start = row * stride;
        target.set(source.subarray(start, start + stride), ((y + row) * targetWidth + x) * 4);
    }
}

function crop(image: Image, x: number, y: number, width: number, height: number) {
    const source = pixelsOf(image);
    const pixels = new Uint8Array(width * height * 4);
    for (let row = 0; row < height; row++) {
        const start = ((y + row) * image.width + x) * 4;
        pixels.set(source.subarray(start, start + width * 4), row * width * 4);
    }
    return rgbaImage(width, height, pixels);
}

export function splitImage(image: Image, width: number, height: number) {
    if (image.width % width || image.height % height)
        throw Error(
            "PNG is " +
                image.width +
                " × " +
                image.height +
                " px. Its dimensions must be multiples of " +
                width +
                " × " +
                height +
                " px."
        );
    const columns = image.width / width;
    const rows = image.height / height;
    const frames: Image[] = [];
    if (columns === 1 && rows === 1) return { frames: [image], columns, rows };
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < columns; x++)
            frames.push(crop(image, x * width, y * height, width, height));
    }
    return { frames, columns, rows };
}

export class DmiState implements StateMetadata {
    frames: Image[] = [];
    delays: number[] = [];
    hotspots: Hotspot[] | null = null;

    constructor(
        public name: string,
        public loop = 0,
        public rewind = false,
        public movement = false,
        public dirs = 1
    ) {}

    static readonly DIR_ORDER = [
        Dirs.SOUTH,
        Dirs.NORTH,
        Dirs.EAST,
        Dirs.WEST,
        Dirs.SOUTHEAST,
        Dirs.SOUTHWEST,
        Dirs.NORTHEAST,
        Dirs.NORTHWEST
    ];

    private readonly previews = new Map<number, string>();

    private directionIndex(dir: Dirs) {
        const index = DmiState.DIR_ORDER.indexOf(dir);
        return index >= 0 && index < this.dirs ? index : 0;
    }

    get framecount() {
        return this.frames.length / this.dirs;
    }
    get width() {
        return this.frames[0].width;
    }
    get height() {
        return this.frames[0].height;
    }

    metadata(): StateMetadata {
        return {
            name: this.name,
            loop: this.loop,
            rewind: this.rewind,
            movement: this.movement,
            dirs: this.dirs,
            delays: this.delays,
            hotspots: this.hotspots
        };
    }

    static fromMetadata(state: StateMetadata, frames: Image[]) {
        const result = new DmiState(
            state.name,
            state.loop,
            state.rewind,
            state.movement,
            state.dirs
        );
        result.frames = frames;
        result.delays = state.delays.slice();
        result.hotspots = state.hotspots?.slice() ?? null;
        return result;
    }

    clone() {
        return DmiState.fromMetadata(this, this.frames.slice());
    }

    set_dirs(dirs: number) {
        const frames: Image[] = [];
        for (let time = 0; time < this.framecount; time++) {
            for (let dir = 0; dir < dirs; dir++)
                frames.push(
                    dir < this.dirs
                        ? this.frames[time * this.dirs + dir]
                        : DmiState.empty_frame(this.width, this.height)
                );
        }
        this.dirs = dirs;
        this.frames = frames;
        this.previews.clear();
    }

    set_framecount(count: number) {
        const { width, height } = this;
        this.frames = resizeArray(this.frames, count * this.dirs, () =>
            DmiState.empty_frame(width, height)
        );
        if (this.delays.length) this.delays = resizeArray(this.delays, count, () => 1);
        if (this.hotspots) {
            const last = this.hotspots[this.hotspots.length - 1];
            this.hotspots = resizeArray(this.hotspots, count, () => last);
        }
        this.previews.clear();
    }

    static empty_frame(width: number, height: number) {
        const pixels = new Uint8Array(width * height * 4).fill(192);
        for (let i = 3; i < pixels.length; i += 4) pixels[i] = 0;
        return rgbaImage(width, height, pixels);
    }

    async preview(dir: Dirs, animate = true) {
        const offset = this.directionIndex(dir);
        if (!animate || this.framecount === 1) return frameUrl(this.frames[offset]);
        let url = this.previews.get(offset);
        if (!url) {
            const frames = Array.from(
                { length: this.framecount },
                (_, i) => Uint8Array.from(pixelsOf(this.frames[i * this.dirs + offset])).buffer
            );
            const delays = frames.map((_, i) => (this.delays[i] ?? 1) * 100);
            url = pngUrl(new Uint8Array(UPNG.encode(frames, this.width, this.height, 0, delays)));
            this.previews.set(offset, url);
        }
        return url;
    }

    async buildComposite() {
        const width = this.width * this.framecount;
        const height = this.height * this.dirs;
        const data = new Uint8Array(width * height * 4);
        for (let time = 0; time < this.framecount; time++) {
            for (let dir = 0; dir < this.dirs; dir++)
                blit(
                    this.frames[time * this.dirs + dir],
                    data,
                    width,
                    time * this.width,
                    dir * this.height
                );
        }
        return frameBlob(rgbaImage(width, height, data));
    }
}

export function stateKey(state: DmiState) {
    return JSON.stringify([state.name, state.movement]);
}

export function sameState(first: DmiState, second: DmiState) {
    if (first === second) return true;
    return (
        JSON.stringify(first.metadata()) === JSON.stringify(second.metadata()) &&
        first.frames.length === second.frames.length &&
        first.frames.every((frame, i) => {
            const other = second.frames[i];
            if (frame === other) return true;
            if (frame.width !== other.width || frame.height !== other.height) return false;
            const pixels = pixelsOf(other);
            return pixelsOf(frame).every((value, offset) => value === pixels[offset]);
        })
    );
}

export class Dmi {
    static readonly version = "4.0";
    states: DmiState[] = [];

    constructor(
        public width: number,
        public height: number
    ) {}

    isSame(other: Dmi) {
        return (
            this.width === other.width &&
            this.height === other.height &&
            this.states.length === other.states.length &&
            this.states.every((state, i) => sameState(state, other.states[i]))
        );
    }

    buildMetadata() {
        let text = "# BEGIN DMI\nversion = " + Dmi.version + "\n";
        text += "\twidth = " + this.width + "\n\theight = " + this.height + "\n";
        for (const state of this.states) {
            text += "state = " + escape_state_name(state.name) + "\n";
            text += "\tdirs = " + state.dirs + "\n\tframes = " + state.framecount + "\n";
            if (state.framecount > 1 && state.delays.length)
                text += "\tdelay = " + state.delays.join() + "\n";
            if (state.loop) text += "\tloop = " + state.loop + "\n";
            if (state.rewind) text += "\trewind = 1\n";
            if (state.movement) text += "\tmovement = 1\n";
            let previous: Hotspot;
            state.hotspots?.forEach((value, i) => {
                if (value && (value[0] !== previous?.[0] || value[1] !== previous?.[1])) {
                    text += "\thotspot = " + value[0] + "," + value[1] + "," + (i + 1) + "\n";
                    previous = value;
                }
            });
        }
        return text + "# END DMI\n";
    }

    async getFileData() {
        const frames = this.states.flatMap(state => state.frames);
        const columns = Math.max(1, Math.ceil(Math.sqrt(frames.length)));
        const width = columns * this.width;
        const height = Math.max(1, Math.ceil(frames.length / columns)) * this.height;
        const data = pixelsOf(DmiState.empty_frame(width, height));
        frames.forEach((frame, i) =>
            blit(
                frame,
                data,
                width,
                (i % columns) * this.width,
                Math.floor(i / columns) * this.height
            )
        );
        const result = await encodePng(
            { data, width, height },
            {
                colorType: 6,
                ancillaryChunks: [
                    {
                        type: "zTXt",
                        keyword: "Description",
                        text: this.buildMetadata(),
                        compressionLevel: undefined
                    }
                ],
                ancillaryChunksAfterIHDR: true
            }
        );
        return result.data;
    }

    toData(): DmiData {
        const states = this.states.map(state => ({
            ...state.metadata(),
            framecount: state.framecount
        }));
        const frameSize = this.width * this.height * 4;
        const pixels = new Uint8Array(
            frameSize * this.states.reduce((count, state) => count + state.frames.length, 0)
        );
        let offset = 0;
        for (const state of this.states) {
            for (const frame of state.frames) {
                pixels.set(pixelsOf(frame), offset);
                offset += frameSize;
            }
        }
        return { width: this.width, height: this.height, states, pixels: pixels.buffer };
    }

    static fromData({ width, height, states, pixels }: DmiData) {
        const dmi = new Dmi(width, height);
        const frameSize = width * height * 4;
        let offset = 0;
        dmi.states = states.map(state => {
            const frames = Array.from({ length: state.framecount * state.dirs }, () => {
                const image = rgbaImage(width, height, new Uint8Array(pixels, offset, frameSize));
                offset += frameSize;
                return image;
            });
            return DmiState.fromMetadata(state, frames);
        });
        return dmi;
    }

    static async fromSnapshot(snapshot: DmiSnapshot) {
        return "file" in snapshot
            ? Dmi.parse(new Uint8Array(snapshot.file))
            : Dmi.fromData(snapshot.document);
    }

    clone() {
        const dmi = new Dmi(this.width, this.height);
        dmi.states = this.states.map(state => state.clone());
        return dmi;
    }

    resize(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.states = this.states.map(state =>
            DmiState.fromMetadata(
                state,
                state.frames.map(frame => frame.resize({ width, height }))
            )
        );
    }

    static async readImage(bytes: Uint8Array) {
        const { image, metadata } = await decodeImage(bytes, true);
        return metadata === undefined ? { image } : { dmi: Dmi.fromAtlas(image, metadata) };
    }

    static async parse(bytes: Uint8Array) {
        const source = await Dmi.readImage(bytes);
        if (source.dmi) return source.dmi;
        const dmi = new Dmi(source.image.width, source.image.height);
        dmi.states = [new DmiState("png")];
        dmi.states[0].frames = [source.image];
        return dmi;
    }

    private static fromAtlas(image: Image, metadata: string) {
        const [header, version, ...lines] = metadata.split(/\r?\n/);
        if (header !== "# BEGIN DMI") throw Error("Missing DMI metadata header.");
        if (version !== "version = " + Dmi.version) throw Error("Invalid DMI version.");

        const dmi = new Dmi(32, 32);
        const counts = new Map<DmiState, number>();
        let state: DmiState | undefined;
        for (const line of lines) {
            if (line === "# END DMI") break;
            const match = line.trimStart().match(/^(\w+) = (.*)$/);
            if (!match) throw Error("Invalid DMI metadata line.");
            const [, key, value] = match;
            if (key === "width") dmi.width = Number(value);
            else if (key === "height") dmi.height = Number(value);
            else if (key === "state") {
                state = new DmiState(unescape_state_name(value));
                dmi.states.push(state);
            } else {
                if (!state) throw Error("State metadata appears before the state name.");
                switch (key) {
                    case "dirs":
                        state.dirs = Number(value);
                        break;
                    case "frames":
                        counts.set(state, Number(value));
                        break;
                    case "delay":
                        state.delays = value.split(",").map(Number);
                        break;
                    case "loop":
                        state.loop = Number(value);
                        break;
                    case "rewind":
                        state.rewind = value === "1";
                        break;
                    case "movement":
                        state.movement = value === "1";
                        break;
                    case "hotspot": {
                        const [x, y, first] = value.split(",").map(Number);
                        const count = counts.get(state);
                        if (!count || !Number.isInteger(first) || first < 1 || first > count)
                            throw Error("Invalid DMI hotspot.");
                        state.hotspots ??= Array<Hotspot>(count).fill(null);
                        state.hotspots.fill([x, y], first - 1);
                        break;
                    }
                    default:
                        throw Error("Unknown DMI metadata key: " + key);
                }
            }
        }

        if (
            !Number.isSafeInteger(dmi.width) ||
            dmi.width <= 0 ||
            !Number.isSafeInteger(dmi.height) ||
            dmi.height <= 0
        )
            throw Error("Invalid DMI frame size.");
        const columns = Math.floor(image.width / dmi.width);
        const capacity = columns * Math.floor(image.height / dmi.height);
        let index = 0;
        for (const entry of dmi.states) {
            const count = counts.get(entry);
            if (
                count === undefined ||
                !Number.isSafeInteger(count) ||
                count < 1 ||
                ![1, 4, 8].includes(entry.dirs) ||
                index + count * entry.dirs > capacity
            )
                throw Error("Invalid frame count or dimensions in state " + entry.name);
            for (let i = 0; i < count * entry.dirs; i++, index++) {
                const x = (index % columns) * dmi.width;
                const y = Math.floor(index / columns) * dmi.height;
                entry.frames.push(crop(image, x, y, dmi.width, dmi.height));
            }
        }
        return dmi;
    }
}

export function escape_state_name(value: string) {
    return '"' + value.replace(/["\\]/g, character => "\\" + character) + '"';
}

export function unescape_state_name(value: string) {
    if (value === "null") return "";
    if (!value.startsWith('"') || !value.endsWith('"')) throw Error("Invalid DMI state name.");
    return value.slice(1, -1).replace(/\\(["\\])/g, "$1");
}

function resizeArray<T>(array: T[], length: number, fill: () => T) {
    return Array.from({ length }, (_, i) => (i < array.length ? array[i] : fill()));
}
