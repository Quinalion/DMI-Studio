import { useEffect, useRef } from "react";
import { Dmi, DmiState, frameUrl, loadRgba, pngPrefix, StateMetadata } from "../../shared/dmi";
import { FrameCell, FrameImage } from "../../shared/batch";
import { ClipboardResult, MessageType } from "../../shared/messaging";
import { editingText } from "./selection";
import { messageHandler } from "./state";
import { useGlobalHandler } from "./useHelpers";

type ClipboardState = StateMetadata & { frames_encoded: string[] };
type Payload =
    | { kind: "states"; states: ClipboardState[] }
    | { kind: "frames"; cells: FrameCell[] };
export type Clip = Payload | { kind: "images"; files: Blob[] };
const prefix = "DMI Studio clipboard/1\n";
const legacy = "EncodedDmiStateHeaderIHateThis:";

export async function copyState(state: DmiState): Promise<ClipboardState> {
    return { ...state.metadata(), frames_encoded: await Promise.all(state.frames.map(frameUrl)) };
}

export async function pasteState(state: ClipboardState) {
    return DmiState.fromMetadata(state, await Promise.all(state.frames_encoded.map(loadRgba)));
}

export async function copyFrame({ time, dir, image }: FrameImage): Promise<FrameCell> {
    return { time, dir, png: await frameUrl(image) };
}

export async function pastedImages(files: Blob[]) {
    return Promise.all(
        files.map(async blob => {
            const file = await Dmi.readImage(new Uint8Array(await blob.arrayBuffer()));
            return { ...file, name: blob instanceof File ? blob.name : "png" };
        })
    );
}

function isPng(value: unknown) {
    return typeof value === "string" && value.startsWith(pngPrefix);
}

function decode(text: string): Payload | undefined {
    const version = /^DMI Studio clipboard\/1\r?\n/.exec(text);
    if (!version && !text.startsWith(legacy)) return;
    const payload = text.startsWith(legacy)
        ? { kind: "states", states: [JSON.parse(text.slice(legacy.length))] }
        : JSON.parse(text.slice(version![0].length));
    if (
        payload?.kind === "states" &&
        Array.isArray(payload.states) &&
        payload.states.length &&
        payload.states.every(
            (s: ClipboardState) =>
                s &&
                typeof s.name === "string" &&
                [1, 4, 8].includes(s.dirs) &&
                Array.isArray(s.frames_encoded) &&
                s.frames_encoded.length > 0 &&
                s.frames_encoded.length % s.dirs === 0 &&
                s.frames_encoded.every(isPng) &&
                Array.isArray(s.delays) &&
                s.delays.every(Number.isFinite) &&
                (s.hotspots === null || Array.isArray(s.hotspots))
        )
    )
        return payload;
    if (
        payload?.kind === "frames" &&
        Array.isArray(payload.cells) &&
        payload.cells.length &&
        payload.cells.every(
            (c: FrameCell) =>
                c &&
                isPng(c.png) &&
                Number.isSafeInteger(c.time) &&
                c.time >= 0 &&
                Number.isInteger(c.dir) &&
                c.dir >= 0 &&
                c.dir < 8
        )
    )
        return payload;
    throw Error("Invalid DMI clipboard data.");
}

async function write(payload: Promise<Payload>, preview: () => Promise<Blob>) {
    // Register the clipboard call during the user gesture, before encoding any frames.
    const text = payload.then(value => prefix + JSON.stringify(value));
    try {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/plain": text.then(value => new Blob([value], { type: "text/plain" })),
                "image/png": preview()
            })
        ]);
    } catch {
        const reply = await messageHandler.sendRequest<ClipboardResult>({
            type: MessageType.ClipboardWrite,
            text: await text
        });
        if (reply.error) throw Error(reply.error);
    }
}

async function read(event?: ClipboardEvent): Promise<Clip> {
    if (event?.clipboardData) {
        const payload = decode(event.clipboardData.getData("text/plain"));
        if (payload) return payload;
        const files = Array.from(event.clipboardData.files).filter(
            file => file.type === "image/png" || /\.(png|dmi)$/i.test(file.name)
        );
        if (files.length) return { kind: "images", files };
    }

    let items: ClipboardItems = [];
    try {
        items = await navigator.clipboard.read();
    } catch {
        // Clipboard access can also be provided by the extension host.
    }
    for (const item of items) {
        if (!item.types.includes("text/plain")) continue;
        const payload = decode(await (await item.getType("text/plain")).text());
        if (payload) return payload;
    }
    const files = await Promise.all(
        items
            .filter(item => item.types.includes("image/png"))
            .map(item => item.getType("image/png"))
    );
    if (files.length) return { kind: "images", files };
    const reply = await messageHandler.sendRequest<ClipboardResult>({
        type: MessageType.ClipboardRead
    });
    if (reply.error) throw Error(reply.error);
    const payload = decode(reply.text);
    if (payload) return payload;
    throw Error("Copy DMI states, frames, or a PNG first.");
}

export function useBatchClipboard(
    document: object,
    selected: number[],
    options: {
        readOnly: boolean;
        canPaste: boolean;
        payload: () => Promise<Payload>;
        preview: () => Promise<Blob>;
        remove: () => void;
        preparePaste: (clip: Clip) => Promise<() => void>;
    }
) {
    const selection = selected.join(",");
    const version = useRef({ document, selection });
    if (version.current.document !== document || version.current.selection !== selection)
        version.current = { document, selection };
    const mounted = useRef(false);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    const busy = useRef(false);
    async function act(action: "copy" | "cut" | "paste", event?: ClipboardEvent) {
        if (event && editingText(event)) return;
        if (action === "paste" ? !options.canPaste || options.readOnly : !selected.length) return;
        if (action === "cut" && options.readOnly) return;
        event?.preventDefault();
        if (busy.current) return;
        busy.current = true;
        const origin = version.current;
        try {
            let commit: (() => void) | undefined;
            if (action === "paste") commit = await options.preparePaste(await read(event));
            else {
                await write(options.payload(), options.preview);
                if (action === "cut") commit = options.remove;
            }
            if (commit && mounted.current && origin === version.current) commit();
            else if (commit && mounted.current)
                throw Error("The selection changed. Repeat the action.");
        } catch (error) {
            messageHandler.sendEvent({
                type: MessageType.Alert,
                text: error instanceof Error ? error.message : String(error)
            });
        } finally {
            busy.current = false;
        }
    }

    useGlobalHandler<ClipboardEvent>("copy", event => void act("copy", event), [options]);
    useGlobalHandler<ClipboardEvent>("cut", event => void act("cut", event), [options]);
    useGlobalHandler<ClipboardEvent>("paste", event => void act("paste", event), [options]);
    return {
        copy: () => void act("copy"),
        cut: () => void act("cut"),
        paste: () => void act("paste"),
        canPaste: options.canPaste && !options.readOnly
    };
}
