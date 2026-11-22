import React, { useEffect, useMemo } from "react";
import { DmiState, Dirs, Dmi, loadRgba, splitImage, stateKey } from "../../shared/dmi";
import { moveBefore, range, sortStateOrder } from "../../shared/batch";
import { EditableField, IconButton, SpriteImage } from "./components";
import { BatchBar, editingText, SelectionMenu, useSelection, useSelectionMenu } from "./selection";
import { copyState, quantity, pastedImages, pasteState, useBatchClipboard } from "./clipboard";
import { useReorder } from "./reorder";

type StateListProps = {
    dmi: Dmi;
    filterString: string;
    direction: Dirs;
    readOnly: boolean;
    pushUpdate: (dmi: Dmi, label: string) => void;
    onOpen: (id: string) => void;
    sortRequested: boolean;
    consumeSortRequest: () => void;
};

function stateWithFrame(name: string, frame: DmiState["frames"][number]) {
    const state = new DmiState(name);
    state.frames = [frame];
    return state;
}

export const StateList: React.FC<StateListProps> = ({
    dmi,
    filterString,
    direction,
    readOnly,
    pushUpdate,
    onOpen,
    sortRequested,
    consumeSortRequest
}) => {
    const visible = useMemo(() => {
        const query = filterString.toLowerCase();
        return range(dmi.states.length).filter(i =>
            dmi.states[i].name.toLowerCase().includes(query)
        );
    }, [dmi, filterString]);
    const counts = useMemo(() => {
        const result = new Map<string, number>();
        for (const state of dmi.states) {
            const key = stateKey(state);
            result.set(key, (result.get(key) ?? 0) + 1);
        }
        return result;
    }, [dmi]);
    const selection = useSelection(visible, readOnly ? undefined : remove, i => dmi.states[i].id);
    const { selected } = selection;
    const menu = useSelectionMenu(selection);
    const reorder = useReorder(visible, move, "states");

    function update(states: DmiState[], label: string) {
        const next = new Dmi(dmi.width, dmi.height);
        next.states = states;
        pushUpdate(next, label);
    }

    function remove(verb = "Delete") {
        const group = new Set(selected);
        update(
            dmi.states.filter((_, i) => !group.has(i)),
            verb + " " + quantity(selected.length, "state")
        );
        selection.replace([]);
    }

    function insert(states: DmiState[], verb = "Add") {
        const after = selected.length ? selected[selected.length - 1] + 1 : dmi.states.length;
        update(
            [...dmi.states.slice(0, after), ...states, ...dmi.states.slice(after)],
            verb + " " + quantity(states.length, "state")
        );
        selection.replaceKeys(states.map(state => state.id));
    }

    function applyOrder(order: number[], group: number[], label: string) {
        if (order.every((i, j) => i === j)) return;
        update(
            order.map(i => dmi.states[i]),
            label
        );
        selection.replace(group);
    }

    function move(group: number[], before: number) {
        applyOrder(moveBefore(dmi.states.length, group, before), group, "Move states");
    }

    function sort() {
        applyOrder(sortStateOrder(dmi.states), selected, "Sort states");
    }

    useEffect(() => {
        if (!sortRequested) return;
        if (!readOnly) sort();
        consumeSortRequest();
    }, [sortRequested]);

    const clipboard = useBatchClipboard(dmi, selected, {
        readOnly,
        canPaste: true,
        unit: "state",
        payload: async () => ({
            kind: "states",
            states: await Promise.all(selected.map(i => copyState(dmi.states[i])))
        }),
        preview: () => dmi.states[selected[0]].buildComposite(),
        remove: () => remove("Cut"),
        preparePaste: async clip => {
            let states: DmiState[];
            if (clip.kind === "states") {
                states = await Promise.all(clip.states.map(pasteState));
            } else if (clip.kind === "images") {
                states = (await pastedImages(clip.files)).flatMap(file => {
                    if (file.dmi) return file.dmi.states;
                    const { frames } = splitImage(file.image, dmi.width, dmi.height);
                    const base = file.name.replace(/\.png$/i, "") || "png";
                    return frames.map((frame, i) =>
                        stateWithFrame(
                            frames.length === 1 ? file.name : base + " " + (i + 1),
                            frame
                        )
                    );
                });
            } else {
                states = await Promise.all(
                    clip.cells.map(async cell =>
                        stateWithFrame("pasted frame", await loadRgba(cell.png))
                    )
                );
            }
            if (!states.length) throw Error("There are no states to paste.");
            if (
                states.some(state =>
                    state.frames.some(
                        frame => frame.width !== dmi.width || frame.height !== dmi.height
                    )
                )
            )
                throw Error(
                    "All pasted sprites must be " + dmi.width + " × " + dmi.height + " px."
                );
            return { count: states.length, apply: () => insert(states, "Paste") };
        }
    });

    return (
        <section>
            <header className="sectionHeader">
                <h2>States</h2>
                {!readOnly && (
                    <div className="controls">
                        <button
                            onClick={sort}
                            disabled={dmi.states.length < 2}
                            title="Sort states by name"
                        >
                            Sort
                        </button>
                        <button
                            className="primary"
                            aria-label="Add state"
                            onClick={() =>
                                insert([
                                    stateWithFrame(
                                        "new state",
                                        DmiState.empty_frame(dmi.width, dmi.height)
                                    )
                                ])
                            }
                        >
                            <span className="codicon codicon-add" aria-hidden="true" /> State
                        </button>
                    </div>
                )}
            </header>
            <BatchBar
                count={selected.length}
                noun="states"
                clipboard={clipboard}
                readOnly={readOnly}
            >
                {!readOnly && (
                    <>
                        <IconButton
                            icon="arrow-left"
                            label="Move states earlier"
                            disabled={!selected.length || selected[0] === 0}
                            onClick={() => move(selected, selected[0] - 1)}
                        />
                        <IconButton
                            icon="arrow-right"
                            label="Move states later"
                            disabled={
                                !selected.length ||
                                selected[selected.length - 1] === dmi.states.length - 1
                            }
                            onClick={() => move(selected, selected[selected.length - 1] + 2)}
                        />
                    </>
                )}
            </BatchBar>
            <div
                className="stateList"
                role="listbox"
                aria-label="Icon states"
                aria-multiselectable="true"
                data-dragging={reorder.active || undefined}
                onContextMenu={menu.onContextMenu}
                {...reorder.container}
            >
                {visible.map((i, position) => {
                    const state = dmi.states[i];
                    const active = selection.chosen.has(i);
                    return (
                        <div
                            key={state.id}
                            className={"statePreviewBox" + (active ? " selected" : "")}
                            role="option"
                            aria-selected={active}
                            data-selection-index={i}
                            data-drop={reorder.marker(position)}
                            aria-label={
                                (state.name || "Unnamed state") +
                                (state.movement ? " (movement)" : "")
                            }
                            tabIndex={0}
                            draggable={!readOnly}
                            onClick={event => selection.click(i, event)}
                            onKeyDown={event => {
                                if (event.target !== event.currentTarget) return;
                                if (event.key === "Enter") onOpen(state.id);
                                if (event.key === " ") {
                                    event.preventDefault();
                                    selection.click(i, event);
                                }
                            }}
                            onDragStart={event => {
                                if (readOnly || editingText(event.nativeEvent)) {
                                    event.preventDefault();
                                    return;
                                }
                                reorder.start(event, active ? selected : [i], state.name);
                                if (!active) selection.replace([i]);
                            }}
                            onDragEnd={reorder.end}
                        >
                            <div className="statePreview" onDoubleClick={() => onOpen(state.id)}>
                                <SpriteImage state={state} direction={direction} />
                            </div>
                            <EditableField
                                className="stateName"
                                title={state.name}
                                value={state.name}
                                displayValue={
                                    (state.name || "(unnamed)") + (state.movement ? " [M]" : "")
                                }
                                onChange={
                                    readOnly
                                        ? undefined
                                        : name => {
                                              const renamed = state.clone();
                                              renamed.name = name;
                                              update(
                                                  dmi.states.map((item, index) =>
                                                      i === index ? renamed : item
                                                  ),
                                                  "Rename state"
                                              );
                                          }
                                }
                            />
                            {(counts.get(stateKey(state)) ?? 0) > 1 && (
                                <span
                                    className="duplicate codicon codicon-warning"
                                    role="img"
                                    aria-label="Duplicate state"
                                    title="Duplicate state"
                                />
                            )}
                        </div>
                    );
                })}
            </div>
            {!visible.length && (
                <p className="empty" onContextMenu={menu.onContextMenu}>
                    {dmi.states.length ? "No matching states." : "No states yet."}
                </p>
            )}
            <SelectionMenu
                {...menu}
                clipboard={clipboard}
                count={selected.length}
                readOnly={readOnly}
                remove={remove}
            />
        </section>
    );
};
