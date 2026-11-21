import React, { useMemo, useState } from "react";
import { Dmi, DmiState, Dirs, sameState, stateKey } from "../../shared/dmi";
import { IconButton, SpriteImage } from "./components";
import { StateDetailView } from "./detailView";

export type Comparison = {
    original: { name: string; dmi: Dmi };
    modified: { name: string; dmi: Dmi };
};

type SideEntry = { state: DmiState; index: number };
type Row = { left?: SideEntry; right?: SideEntry; status: string };

function alignStates(original: Dmi, modified: Dmi) {
    const byKey = new Map<string, { entries: SideEntry[]; consumed: number }>();
    original.states.forEach((state, index) => {
        const key = stateKey(state);
        let group = byKey.get(key);
        if (!group) {
            group = { entries: [], consumed: 0 };
            byKey.set(key, group);
        }
        group.entries.push({ state, index });
    });

    const matched = new Set<number>();
    const pairs = modified.states.map((state, index) => {
        const group = byKey.get(stateKey(state));
        const left = group?.entries[group.consumed++];
        if (left) matched.add(left.index);
        return { left, right: { state, index } };
    });
    const originalOrder = new Map(
        [...matched].sort((a, b) => a - b).map((index, rank) => [index, rank])
    );
    let modifiedRank = 0;
    const rows: Row[] = pairs.map(({ left, right }) => {
        if (!left) return { right, status: "Added" };
        const moved = originalOrder.get(left.index) !== modifiedRank++;
        const changed = !sameState(left.state, right.state);
        return {
            left,
            right,
            status: changed ? (moved ? "Changed · Moved" : "Changed") : moved ? "Moved" : ""
        };
    });
    original.states.forEach((state, index) => {
        if (!matched.has(index)) rows.push({ left: { state, index }, status: "Removed" });
    });
    return rows;
}

export function CompareView({ original, modified }: Comparison) {
    const rows = useMemo(
        () => alignStates(original.dmi, modified.dmi),
        [original.dmi, modified.dmi]
    );
    const [all, setAll] = useState(false);
    const [detail, setDetail] = useState<{ side: "original" | "modified"; entry: SideEntry }>();
    const sizeChanged =
        original.dmi.width !== modified.dmi.width || original.dmi.height !== modified.dmi.height;

    function dimensions({ width, height }: DmiState) {
        return {
            "--spriteWidth": "calc(" + width + "px * var(--zoomFactor))",
            "--spriteHeight": "calc(" + height + "px * var(--zoomFactor))",
            "--spriteRatio": width + " / " + height
        } as React.CSSProperties;
    }

    function card(side: "original" | "modified", entry?: SideEntry) {
        if (!entry)
            return (
                <div className="diffEmpty" aria-label="No state">
                    —
                </div>
            );
        return (
            <button
                className="diffCard"
                style={dimensions(entry.state)}
                onClick={() => setDetail({ side, entry })}
                title={"Open " + side + " state"}
            >
                <SpriteImage state={entry.state} direction={Dirs.SOUTH} animate={false} />
                <span>
                    {entry.state.name || "(unnamed)"}
                    {entry.state.movement ? " [M]" : ""}
                </span>
                <small>{entry.index + 1}</small>
            </button>
        );
    }

    return (
        <>
            <header className="sectionHeader">
                <div className="controls">
                    {detail && (
                        <IconButton
                            icon="arrow-left"
                            label="Back to comparison"
                            onClick={() => setDetail(undefined)}
                        />
                    )}
                    <h2>
                        {detail
                            ? detail.side === "original"
                                ? original.name
                                : modified.name
                            : "Compare"}
                    </h2>
                    <span className="readOnly">Read only</span>
                </div>
                {!detail && (
                    <label className="field checkbox">
                        <input
                            type="checkbox"
                            checked={all}
                            onChange={event => setAll(event.target.checked)}
                        />
                        Show all
                    </label>
                )}
            </header>
            {detail ? (
                <div style={dimensions(detail.entry.state)}>
                    <StateDetailView
                        key={detail.side + detail.entry.index}
                        state={detail.entry.state}
                        readOnly
                        pushUpdate={() => undefined}
                    />
                </div>
            ) : (
                <div className="comparison">
                    <div className="diffHeader">
                        <strong>{original.name}</strong>
                        <small>
                            Original · {original.dmi.width} × {original.dmi.height}
                        </small>
                    </div>
                    <div className="diffHeader">
                        <strong>{modified.name}</strong>
                        <small>
                            Modified · {modified.dmi.width} × {modified.dmi.height}
                        </small>
                    </div>
                    {sizeChanged && <div className="diffStatus">Frame size changed</div>}
                    {(all ? rows : rows.filter(row => row.status)).map(row => (
                        <React.Fragment
                            key={row.right ? "right-" + row.right.index : "left-" + row.left!.index}
                        >
                            {row.status && (
                                <div className="diffStatus" data-status={row.status}>
                                    {row.status}
                                </div>
                            )}
                            {card("original", row.left)}
                            {card("modified", row.right)}
                        </React.Fragment>
                    ))}
                    {!rows.some(row => row.status) && !all && (
                        <p className="empty">No state changes.</p>
                    )}
                </div>
            )}
        </>
    );
}
