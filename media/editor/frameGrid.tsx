import React from "react";
import { DmiState, DirNames, frameBlob, loadRgba } from "../../shared/dmi";
import {
    captureFrames,
    imageCells,
    moveBefore,
    pasteTargets,
    putFrame,
    range,
    reorderColumns,
    shiftPixels
} from "../../shared/batch";
import { BatchBar, useSelection, editingText, useSelectionMenu, SelectionMenu } from "./selection";
import { copyFrame, quantity, pastedImages, useBatchClipboard } from "./clipboard";
import { useGlobalHandler } from "./useHelpers";
import { EditableField, IconButton, SpriteImage } from "./components";
import { useReorder } from "./reorder";

interface Props {
    state: DmiState;
    readOnly: boolean;
    update: (state: DmiState, label: string) => void;
    updateDelay: (i: number, value: string) => void;
}

const arrows = [
    { key: "ArrowLeft", label: "Left", icon: "arrow-left", dx: -1, dy: 0 },
    { key: "ArrowRight", label: "Right", icon: "arrow-right", dx: 1, dy: 0 },
    { key: "ArrowUp", label: "Up", icon: "arrow-up", dx: 0, dy: -1 },
    { key: "ArrowDown", label: "Down", icon: "arrow-down", dx: 0, dy: 1 }
];

export function FrameGrid({ state, readOnly, update, updateDelay }: Props) {
    const times = range(state.framecount);
    const directions = range(state.dirs);
    const order = directions.flatMap(dir => times.map(time => time * state.dirs + dir));
    const selection = useSelection(
        order,
        readOnly ? undefined : clear,
        i => Math.floor(i / state.dirs) * DirNames.length + (i % state.dirs)
    );
    const { selected } = selection;
    const columns = [...new Set(selected.map(i => Math.floor(i / state.dirs)))].sort(
        (a, b) => a - b
    );
    const menu = useSelectionMenu(selection);
    const reorder = useReorder(times, move, "timeline");

    function clear(verb = "Clear") {
        const next = state.clone();
        const blank = DmiState.empty_frame(state.width, state.height);
        for (const i of selected) putFrame(next, i, blank);
        update(next, verb + " " + quantity(selected.length, "cell"));
    }

    function nudge(dx: number, dy: number) {
        const next = state.clone();
        for (const i of selected) putFrame(next, i, shiftPixels(state.frames[i], dx, dy));
        update(next, "Shift pixels");
    }

    function move(group: number[], boundary: number) {
        const order = moveBefore(state.framecount, group, boundary);
        if (order.every((value, i) => value === i)) return;
        const positions = new Map(order.map((time, i) => [time, i]));
        update(reorderColumns(state, order), "Move frame columns");
        selection.replace(
            selected.map(
                i => positions.get(Math.floor(i / state.dirs))! * state.dirs + (i % state.dirs)
            )
        );
    }

    function selectColumn(time: number) {
        selection.replace(directions.map(dir => time * state.dirs + dir));
    }

    useGlobalHandler<KeyboardEvent>(
        "keydown",
        event => {
            if (
                event.defaultPrevented ||
                readOnly ||
                !selected.length ||
                editingText(event) ||
                !event.altKey ||
                event.ctrlKey ||
                event.metaKey
            )
                return;
            const arrow = arrows.find(item => item.key === event.key);
            if (arrow) {
                event.preventDefault();
                nudge(arrow.dx, arrow.dy);
            }
        },
        [state, readOnly, selected]
    );

    const clipboard = useBatchClipboard(state, selected, {
        readOnly,
        canPaste: !!selected.length,
        unit: "cell",
        payload: async () => ({
            kind: "frames",
            cells: await Promise.all(captureFrames(state, selected).map(copyFrame))
        }),
        preview: () => frameBlob(state.frames[selected[0]]),
        remove: () => clear("Cut"),
        preparePaste: async clip => {
            if (clip.kind === "states") throw Error("Paste states in the state list.");
            const cells =
                clip.kind === "frames"
                    ? await Promise.all(
                          clip.cells.map(async cell => ({
                              time: cell.time,
                              dir: cell.dir,
                              image: await loadRgba(cell.png)
                          }))
                      )
                    : imageCells(
                          (await pastedImages(clip.files)).map(file => {
                              const image = file.image ?? file.dmi?.states[0]?.frames[0];
                              if (!image) throw Error("Image has no frames.");
                              return image;
                          }),
                          state,
                          selected
                      );

            if (
                cells.some(
                    ({ image }) => image.width !== state.width || image.height !== state.height
                )
            )
                throw Error("All frames must be " + state.width + " × " + state.height + " px.");
            const targets = pasteTargets(state, cells, selected);
            const next = state.clone();
            const count = targets.reduce(
                (max, target) => Math.max(max, Math.floor(target.target / next.dirs) + 1),
                next.framecount
            );
            if (count !== next.framecount) next.set_framecount(count);
            for (const { target, source } of targets) putFrame(next, target, cells[source].image);
            return {
                count: targets.length,
                apply: () => {
                    update(next, "Paste into " + quantity(targets.length, "cell"));
                    selection.replace(targets.map(entry => entry.target));
                }
            };
        }
    });

    return (
        <section aria-label="Frames">
            <div className="frameTools">
                <BatchBar
                    count={selected.length}
                    noun="frames"
                    clipboard={clipboard}
                    readOnly={readOnly}
                >
                    {!readOnly && (
                        <>
                            <IconButton
                                icon="arrow-left"
                                label="Move columns earlier"
                                disabled={!columns.length || columns[0] === 0}
                                onClick={() => move(columns, columns[0] - 1)}
                            />
                            <IconButton
                                icon="arrow-right"
                                label="Move columns later"
                                disabled={
                                    !columns.length ||
                                    columns[columns.length - 1] === state.framecount - 1
                                }
                                onClick={() => move(columns, columns[columns.length - 1] + 2)}
                            />
                        </>
                    )}
                </BatchBar>
                {!readOnly && (
                    <div className="controls shiftControls" role="group" aria-label="Shift pixels">
                        <span>Shift</span>
                        {arrows.map(arrow => (
                            <IconButton
                                key={arrow.key}
                                icon={arrow.icon}
                                label={"Shift " + arrow.label.toLowerCase() + " 1 px"}
                                title={
                                    "Shift " +
                                    arrow.label.toLowerCase() +
                                    " 1 px (Alt+" +
                                    arrow.label +
                                    ")"
                                }
                                disabled={!selected.length}
                                onClick={() => nudge(arrow.dx, arrow.dy)}
                            />
                        ))}
                    </div>
                )}
            </div>
            <div className="scrollGrid" onContextMenu={menu.onContextMenu}>
                <div
                    className="frameGrid"
                    style={{
                        gridTemplateColumns:
                            "max-content repeat(" + state.framecount + ", max-content)"
                    }}
                    data-dragging={reorder.active || undefined}
                    {...reorder.container}
                >
                    <div className="gridHeader">Frame</div>
                    {times.map(time => (
                        <button
                            key={time}
                            className="timeHeader"
                            aria-label={"Select frame column " + (time + 1)}
                            aria-pressed={directions.every(dir =>
                                selection.chosen.has(time * state.dirs + dir)
                            )}
                            title={readOnly ? "Select column" : "Select column or drag to reorder"}
                            draggable={!readOnly}
                            data-drop={reorder.marker(time)}
                            onDragStart={event => {
                                if (readOnly) return;
                                const active = columns.includes(time);
                                reorder.start(event, active ? columns : [time], String(time + 1));
                                if (!active) selectColumn(time);
                            }}
                            onDragEnd={reorder.end}
                            onClick={() => selectColumn(time)}
                        >
                            {time + 1}
                        </button>
                    ))}
                    <div className="gridHeader">Delay</div>
                    {times.map(time => (
                        <EditableField
                            key={time}
                            className="gridHeader delay"
                            value={String(state.delays[time] ?? 1)}
                            onChange={readOnly ? undefined : value => updateDelay(time, value)}
                        />
                    ))}
                    {directions.map(dir => (
                        <React.Fragment key={dir}>
                            <div className="gridHeader">{DirNames[dir]}</div>
                            {times.map(time => {
                                const index = time * state.dirs + dir;
                                const active = selection.chosen.has(index);
                                return (
                                    <button
                                        key={time}
                                        className={"gridElement" + (active ? " selected" : "")}
                                        aria-pressed={active}
                                        aria-label={DirNames[dir] + " · frame " + (time + 1)}
                                        data-selection-index={index}
                                        onClick={event => selection.click(index, event)}
                                    >
                                        <SpriteImage image={state.frames[index]} />
                                    </button>
                                );
                            })}
                        </React.Fragment>
                    ))}
                </div>
            </div>
            <SelectionMenu
                {...menu}
                clipboard={clipboard}
                count={selected.length}
                readOnly={readOnly}
                remove={clear}
                frames
            />
        </section>
    );
}
