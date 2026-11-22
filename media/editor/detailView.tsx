import React from "react";
import { DmiState, Dirs } from "../../shared/dmi";
import { FrameGrid } from "./frameGrid";
import { CommitInput, SpriteImage } from "./components";

const previewDirections = [
    Dirs.NORTHWEST,
    Dirs.NORTH,
    Dirs.NORTHEAST,
    Dirs.WEST,
    undefined,
    Dirs.EAST,
    Dirs.SOUTHWEST,
    Dirs.SOUTH,
    Dirs.SOUTHEAST
];

export function StateDetailView({
    state,
    readOnly,
    pushUpdate
}: {
    state: DmiState;
    readOnly: boolean;
    pushUpdate: (state: DmiState, label: string) => void;
}) {
    function edit(label: string, change: (next: DmiState) => void) {
        if (readOnly) return;
        const next = state.clone();
        change(next);
        pushUpdate(next, label);
    }

    function editCount(value: string, apply: (count: number) => void) {
        const count = Number(value);
        if (Number.isSafeInteger(count) && count > 0) apply(count);
    }

    function updateDelay(index: number, value: string) {
        const delay = Number(value);
        if (!value.trim() || !Number.isFinite(delay)) return;
        if ((state.delays[index] ?? 1) === Math.abs(delay)) return;
        edit("Change frame delay", next => {
            next.delays = Array.from({ length: state.framecount }, (_, i) =>
                i === index ? Math.abs(delay) : state.delays[i] ?? 1
            );
        });
    }

    return (
        <section>
            <header className="sectionHeader">
                <h2>{state.name || "(unnamed state)"}</h2>
            </header>
            <div className="stateProperties">
                <label className="field">
                    Name
                    <CommitInput
                        label="State name"
                        value={state.name}
                        readOnly={readOnly}
                        onChange={name =>
                            edit("Rename state", next => {
                                next.name = name;
                            })
                        }
                    />
                </label>
                <label className="field">
                    Directions
                    <select
                        disabled={readOnly}
                        value={state.dirs}
                        onChange={event => {
                            const value = Number(event.target.value);
                            edit("Change directions", next => next.set_dirs(value));
                        }}
                    >
                        <option value={1}>1</option>
                        <option value={4}>4</option>
                        <option value={8}>8</option>
                    </select>
                </label>
                <label className="field">
                    Frames
                    <CommitInput
                        label="Frames"
                        className="numberInput"
                        inputMode="numeric"
                        readOnly={readOnly}
                        value={String(state.framecount)}
                        onChange={value =>
                            editCount(value, count => {
                                if (count !== state.framecount)
                                    edit("Change frame count", next => next.set_framecount(count));
                            })
                        }
                    />
                </label>
                <label className="field">
                    Loops
                    <CommitInput
                        label="Loop count"
                        className="numberInput"
                        inputMode="numeric"
                        readOnly={readOnly}
                        disabled={state.loop === 0}
                        value={state.loop === 0 ? "∞" : String(state.loop)}
                        onChange={value =>
                            editCount(value, count => {
                                if (count !== state.loop)
                                    edit("Change loop count", next => {
                                        next.loop = count;
                                    });
                            })
                        }
                    />
                </label>
                <label className="field checkbox">
                    <input
                        type="checkbox"
                        disabled={readOnly}
                        checked={state.loop === 0}
                        onChange={() =>
                            edit("Change loop count", next => {
                                next.loop = next.loop === 0 ? 1 : 0;
                            })
                        }
                    />
                    Infinite
                </label>
                <label className="field checkbox">
                    <input
                        type="checkbox"
                        disabled={readOnly}
                        checked={state.movement}
                        onChange={() =>
                            edit("Change movement flag", next => {
                                next.movement = !next.movement;
                            })
                        }
                    />
                    Movement
                </label>
                <label className="field checkbox">
                    <input
                        type="checkbox"
                        disabled={readOnly}
                        checked={state.rewind}
                        onChange={() =>
                            edit("Change rewind flag", next => {
                                next.rewind = !next.rewind;
                            })
                        }
                    />
                    Rewind
                </label>
            </div>
            <div className="directionalDetailPreview">
                {state.dirs === 1 ? (
                    <SpriteImage state={state} direction={Dirs.SOUTH} />
                ) : (
                    <div className="dirGrid">
                        {previewDirections.map((direction, i) =>
                            direction && (state.dirs === 8 || i % 2 === 1) ? (
                                <SpriteImage key={i} state={state} direction={direction} />
                            ) : (
                                <div key={i} />
                            )
                        )}
                    </div>
                )}
            </div>
            <FrameGrid
                state={state}
                readOnly={readOnly}
                update={pushUpdate}
                updateDelay={updateDelay}
            />
        </section>
    );
}
