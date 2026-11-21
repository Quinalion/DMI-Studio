import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./dmiEditor.css";
import { Dirs, Dmi, DmiState } from "../../shared/dmi";
import { MessageType, ReadyResponseMessage } from "../../shared/messaging";
import { StateDetailView } from "./detailView";
import { StateList } from "./listView";
import { CommitInput, IconButton } from "./components";
import { CompareView, Comparison } from "./compareView";
import { listen, messageHandler, session } from "./state";

const directions = [Dirs.SOUTH, Dirs.WEST, Dirs.NORTH, Dirs.EAST];
const directionNames = ["South", "West", "North", "East"];

function Editor() {
    const [dmi, setDmi] = useState<Dmi>();
    const [comparison, setComparison] = useState<Comparison>();
    const [readOnly, setReadOnly] = useState(false);
    const [error, setError] = useState<string>();
    const [revision, setRevision] = useState(0);
    const [zoom, setZoom] = useState(1);
    const [direction, setDirection] = useState(0);
    const [openState, setOpenState] = useState<number | null>(null);
    const [search, setSearch] = useState("");
    const [checkerboard, setCheckerboard] = useState(false);
    const [sortRequested, setSortRequested] = useState(false);

    function open(index: number | null) {
        setOpenState(index);
        session.save({ openStateId: index });
    }

    function changeZoom(value: number) {
        setZoom(value);
        session.save({ zoom: value });
    }

    useEffect(() => {
        let generation = 0;
        let alive = true;
        function report(error: unknown) {
            if (alive) setError(error instanceof Error ? error.message : String(error));
        }

        const unlisten = listen(message => {
            if (message.type === MessageType.SortEvent) {
                open(null);
                setSortRequested(true);
            } else if (message.type === MessageType.DocumentChangedEvent) {
                const current = ++generation;
                void Dmi.fromSnapshot(message.snapshot).then(updated => {
                    if (!alive || current !== generation) return;
                    setDmi(updated);
                    setError(undefined);
                    setRevision(value => value + 1);
                }, report);
            }
        });

        async function initialize() {
            const { input, defaultZoom } = await messageHandler.sendRequest<ReadyResponseMessage>({
                type: MessageType.ReadyRequest
            });
            if (!alive) return;
            const saved = session.read();
            setZoom(Math.max(1, saved.zoom ?? defaultZoom));
            if (input.mode === "comparison") {
                const [original, modified] = await Promise.all([
                    Dmi.fromSnapshot(input.original.snapshot),
                    Dmi.fromSnapshot(input.modified.snapshot)
                ]);
                if (alive)
                    setComparison({
                        original: { name: input.original.name, dmi: original },
                        modified: { name: input.modified.name, dmi: modified }
                    });
            } else {
                setReadOnly(input.readOnly);
                const initial = await Dmi.fromSnapshot(input.snapshot);
                if (!alive || generation !== 0) return;
                setDmi(initial);
                setOpenState(saved.openStateId ?? null);
            }
        }
        void initialize().catch(report);
        return () => {
            alive = false;
            unlisten();
        };
    }, []);

    function update(next: Dmi) {
        if (readOnly) return;
        messageHandler.sendEvent({ type: MessageType.EditEvent, data: next.toData() });
        setDmi(next);
    }

    function resize(width: number, height: number) {
        if (!dmi || (width === dmi.width && height === dmi.height)) return;
        if (
            !Number.isSafeInteger(width) ||
            !Number.isSafeInteger(height) ||
            width < 1 ||
            height < 1
        )
            return;
        const next = dmi.clone();
        next.resize(width, height);
        update(next);
    }

    function updateState(state: DmiState) {
        if (!dmi || openState === null) return;
        const next = new Dmi(dmi.width, dmi.height);
        next.states = dmi.states.map((item, index) => (index === openState ? state : item));
        update(next);
    }

    if (error)
        return (
            <p className="error" role="alert">
                {error}
            </p>
        );
    if (!dmi && !comparison)
        return (
            <p className="empty" role="status">
                Loading…
            </p>
        );
    const width = dmi?.width ?? 32;
    const height = dmi?.height ?? 32;
    const current = openState === null ? undefined : dmi?.states[openState];
    const variables = {
        "--zoomFactor": zoom,
        "--spriteWidth": width * zoom + "px",
        "--spriteHeight": height * zoom + "px"
    } as React.CSSProperties;

    return (
        <main className="editor" style={variables} data-checkerboard={checkerboard || undefined}>
            <div className="toolbar">
                {current && (
                    <IconButton
                        icon="arrow-left"
                        label="Back to states"
                        onClick={() => open(null)}
                    />
                )}
                {dmi && (
                    <div className="controls dimensions">
                        <CommitInput
                            className="numberInput"
                            label="Width"
                            value={String(width)}
                            title="Width"
                            readOnly={readOnly}
                            inputMode="numeric"
                            onChange={value => resize(Number(value), height)}
                        />
                        <span aria-hidden="true">×</span>
                        <CommitInput
                            className="numberInput"
                            label="Height"
                            value={String(height)}
                            title="Height"
                            readOnly={readOnly}
                            inputMode="numeric"
                            onChange={value => resize(width, Number(value))}
                        />
                    </div>
                )}
                <div className="controls" role="group" aria-label="Zoom">
                    <IconButton
                        icon="zoom-out"
                        label="Zoom out"
                        disabled={zoom <= 1}
                        onClick={() => changeZoom(zoom - 1)}
                    />
                    <span className="toolValue">{zoom}×</span>
                    <IconButton
                        icon="zoom-in"
                        label="Zoom in"
                        onClick={() => changeZoom(zoom + 1)}
                    />
                    <IconButton
                        icon="color-mode"
                        label="Checkerboard"
                        aria-pressed={checkerboard}
                        onClick={() => setCheckerboard(!checkerboard)}
                    />
                </div>
                {dmi && !current && (
                    <>
                        <div className="controls" role="group" aria-label="Preview direction">
                            <IconButton
                                icon="chevron-left"
                                label="Previous direction"
                                onClick={() => setDirection((direction + 3) % directions.length)}
                            />
                            <span className="toolValue directionValue">
                                {directionNames[direction]}
                            </span>
                            <IconButton
                                icon="chevron-right"
                                label="Next direction"
                                onClick={() => setDirection((direction + 1) % directions.length)}
                            />
                        </div>
                        <label className="search">
                            <span className="codicon codicon-search" aria-hidden="true" />
                            <input
                                type="search"
                                aria-label="Filter states"
                                placeholder="Filter states"
                                value={search}
                                onChange={event => setSearch(event.target.value)}
                            />
                        </label>
                    </>
                )}
                {dmi && (
                    <>
                        {readOnly && <span className="readOnly">Read only</span>}
                        <button
                            className="compareAction"
                            onClick={() =>
                                messageHandler.sendEvent({ type: MessageType.CompareRequest })
                            }
                        >
                            <span className="codicon codicon-git-compare" aria-hidden="true" />{" "}
                            Compare
                        </button>
                    </>
                )}
            </div>
            {comparison ? (
                <CompareView {...comparison} />
            ) : current ? (
                <StateDetailView
                    key={revision + ":" + openState}
                    state={current}
                    readOnly={readOnly}
                    pushUpdate={updateState}
                />
            ) : (
                dmi && (
                    <StateList
                        key={revision + ":" + search}
                        dmi={dmi}
                        filterString={search}
                        direction={directions[direction]}
                        readOnly={readOnly}
                        pushUpdate={update}
                        onOpen={open}
                        sortRequested={sortRequested}
                        consumeSortRequest={() => setSortRequested(false)}
                    />
                )
            )}
        </main>
    );
}

createRoot(document.body).render(<Editor />);
