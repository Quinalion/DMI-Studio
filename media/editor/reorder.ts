import { DragEvent, useRef, useState } from "react";

type Placement = { index: number; side: "before" | "after"; boundary: number };

export function findInsertion(
    count: number,
    columns: number,
    rectangle: (index: number) => Pick<DOMRect, "top" | "bottom" | "left" | "right">,
    x: number,
    y: number,
    rowGap: number
): Omit<Placement, "boundary"> {
    let low = 0;
    let high = Math.ceil(count / columns) - 1;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (y <= rectangle(mid * columns).bottom + rowGap / 2) high = mid;
        else low = mid + 1;
    }
    const first = low * columns;
    const last = Math.min(first + columns, count) - 1;
    if (y < rectangle(0).top - rowGap / 2) return { index: 0, side: "before" };
    if (y > rectangle(last).bottom + rowGap / 2) return { index: last, side: "after" };

    low = first;
    high = last + 1;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        const { left, right } = rectangle(mid);
        if (x < (left + right) / 2) high = mid;
        else low = mid + 1;
    }
    if (low > last) return { index: last, side: "after" };
    if (low > first && x < rectangle(low).left) {
        const previous = rectangle(low - 1);
        const next = rectangle(low);
        if (x < (previous.right + next.left) / 2) return { index: low - 1, side: "after" };
    }
    return { index: low, side: "before" };
}

export function useReorder(
    indices: number[],
    move: (group: number[], boundary: number) => void,
    layout: "states" | "timeline"
) {
    const group = useRef<number[]>([]);
    const [active, setActive] = useState(false);
    const [marker, setMarker] = useState<Placement | null>(null);

    function locate(event: DragEvent<HTMLElement>) {
        const { currentTarget, clientX, clientY } = event;
        const offset = layout === "timeline" ? 1 : 0;
        const rectangle = (index: number) =>
            currentTarget.children[index + offset].getBoundingClientRect();
        const style = getComputedStyle(currentTarget);
        const gap = parseFloat(style.columnGap) || 0;
        const columns =
            layout === "timeline"
                ? indices.length
                : Math.max(
                      1,
                      Math.round((currentTarget.clientWidth + gap) / (rectangle(0).width + gap))
                  );
        const position = findInsertion(
            indices.length,
            columns,
            rectangle,
            clientX,
            layout === "timeline" ? rectangle(0).top : clientY,
            parseFloat(style.rowGap) || 0
        );
        const slot = position.index + Number(position.side === "after");
        return { ...position, boundary: indices[slot] ?? indices[slot - 1] + 1 };
    }

    function end() {
        group.current = [];
        setActive(false);
        setMarker(null);
    }

    return {
        active,
        start(event: DragEvent<HTMLElement>, indices: number[], label: string) {
            group.current = indices;
            event.dataTransfer.setData("text/plain", label);
            event.dataTransfer.effectAllowed = "move";
            setActive(true);
        },
        end,
        marker(index: number) {
            return marker?.index === index ? marker.side : undefined;
        },
        container: {
            onDragOver(event: DragEvent<HTMLElement>) {
                if (!group.current.length || !indices.length) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const next = locate(event);
                setMarker(previous =>
                    previous?.index === next.index && previous.side === next.side ? previous : next
                );
            },
            onDragLeave(event: DragEvent<HTMLElement>) {
                const next = event.relatedTarget;
                if (!(next instanceof Node) || !event.currentTarget.contains(next)) setMarker(null);
            },
            onDrop(event: DragEvent<HTMLElement>) {
                if (!group.current.length || !indices.length) return;
                event.preventDefault();
                move(group.current, locate(event).boundary);
                end();
            }
        }
    };
}
