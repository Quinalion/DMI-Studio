import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useGlobalHandler } from "./useHelpers";

export function editingText(event: Event) {
    return event
        .composedPath()
        .some(
            node =>
                node instanceof HTMLElement &&
                (node.isContentEditable ||
                    node.matches("input, textarea, select, [role='textbox']"))
        );
}

type SelectionKey = string | number;

export function useSelection(
    order: number[],
    remove?: () => void,
    keyOf: (index: number) => SelectionKey = index => index
) {
    const [picked, setPicked] = useState<SelectionKey[]>([]);
    const anchor = useRef<SelectionKey | null>(null);
    const pickedKeys = new Set(picked);
    const selected = order.filter(i => pickedKeys.has(keyOf(i)));
    const chosen = new Set(selected);
    if (selected.length < picked.length) setPicked(selected.map(keyOf));

    function replaceKeys(keys: SelectionKey[]) {
        setPicked(keys);
        anchor.current = keys[0] ?? null;
    }

    function replace(indices: number[]) {
        replaceKeys(indices.map(keyOf));
    }

    function click(index: number, event: React.MouseEvent | React.KeyboardEvent) {
        const add = event.metaKey || event.ctrlKey;
        const from = order.findIndex(i => keyOf(i) === anchor.current);
        if (event.shiftKey && from >= 0) {
            const to = order.indexOf(index);
            const span = order.slice(Math.min(from, to), Math.max(from, to) + 1);
            setPicked((add ? [...new Set([...selected, ...span])] : span).map(keyOf));
        } else {
            anchor.current = keyOf(index);
            if (!add) setPicked([keyOf(index)]);
            else
                setPicked(
                    (chosen.has(index)
                        ? selected.filter(i => i !== index)
                        : [...selected, index]
                    ).map(keyOf)
                );
        }
    }

    useGlobalHandler<KeyboardEvent>(
        "keydown",
        event => {
            if (event.defaultPrevented || editingText(event)) return;
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
                event.preventDefault();
                replace(order);
            } else if (event.key === "Delete" && selected.length && remove && !event.repeat) {
                event.preventDefault();
                remove();
            } else if (event.key === "Escape") replace([]);
        },
        [order, remove]
    );

    return { selected, chosen, replace, replaceKeys, click };
}

type Selection = ReturnType<typeof useSelection>;
type ClipboardActions = {
    copy: () => void;
    cut: () => void;
    paste: () => void;
    canPaste: boolean;
};

export function BatchBar({
    count,
    noun,
    clipboard,
    readOnly,
    children
}: {
    count: number;
    noun: string;
    clipboard: ClipboardActions;
    readOnly: boolean;
    children?: React.ReactNode;
}) {
    return (
        <div className="batchBar" role="group" aria-label="Selection actions">
            <span className="selectionCount" aria-live="polite">
                {count} {noun} selected
            </span>
            {!readOnly && (
                <button disabled={!count} onClick={clipboard.cut}>
                    Cut
                </button>
            )}
            <button disabled={!count} onClick={clipboard.copy}>
                Copy
            </button>
            {!readOnly && (
                <button disabled={!clipboard.canPaste} onClick={clipboard.paste}>
                    Paste
                </button>
            )}
            {children}
        </div>
    );
}

type MenuPosition = { x: number; y: number; anchor: HTMLElement | null };

export function useSelectionMenu(selection: Selection) {
    const [position, setPosition] = useState<MenuPosition | null>(null);
    return {
        position,
        close: () => setPosition(null),
        onContextMenu(event: React.MouseEvent<HTMLElement>) {
            if (editingText(event.nativeEvent)) return;
            const anchor = (event.target as HTMLElement).closest<HTMLElement>(
                "[data-selection-index]"
            );
            if (anchor) {
                const index = Number(anchor.dataset.selectionIndex);
                if (!selection.chosen.has(index)) selection.replace([index]);
            }
            event.preventDefault();
            const rect = anchor?.getBoundingClientRect();
            setPosition({
                x: event.clientX || rect?.left || 0,
                y: event.clientY || rect?.bottom || 0,
                anchor
            });
        }
    };
}

export function SelectionMenu({
    position,
    close,
    clipboard,
    count,
    readOnly,
    remove,
    frames
}: {
    position: MenuPosition | null;
    close: () => void;
    clipboard: ClipboardActions;
    count: number;
    readOnly: boolean;
    remove: () => void;
    frames?: boolean;
}) {
    const menu = useRef<HTMLDivElement>(null);
    const items = () =>
        Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button:enabled") ?? []);
    useLayoutEffect(() => {
        if (!position || !menu.current) return;
        const { offsetWidth, offsetHeight } = menu.current;
        menu.current.style.left =
            Math.max(0, Math.min(position.x, window.innerWidth - offsetWidth)) + "px";
        menu.current.style.top =
            Math.max(0, Math.min(position.y, window.innerHeight - offsetHeight)) + "px";
        (items()[0] ?? menu.current).focus({ preventScroll: true });
    }, [position]);

    useEffect(() => {
        if (!position) return;
        const outside = (event: PointerEvent) => {
            if (!menu.current?.contains(event.target as Node)) close();
        };
        window.addEventListener("pointerdown", outside);
        window.addEventListener("resize", close);
        window.addEventListener("scroll", close, true);
        return () => {
            window.removeEventListener("pointerdown", outside);
            window.removeEventListener("resize", close);
            window.removeEventListener("scroll", close, true);
        };
    }, [position, close]);

    if (!position) return null;
    function finish(action?: () => void) {
        position?.anchor?.focus({ preventScroll: true });
        close();
        action?.();
    }

    return (
        <div
            className="contextMenu"
            ref={menu}
            role="menu"
            aria-label="Selection actions"
            tabIndex={-1}
            onContextMenu={event => event.preventDefault()}
            onKeyDown={event => {
                if (event.key === "Escape" || event.key === "Tab") {
                    if (event.key === "Escape") event.preventDefault();
                    event.stopPropagation();
                    finish();
                } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    const buttons = items();
                    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
                    const step = event.key === "ArrowDown" ? 1 : -1;
                    buttons[(current + step + buttons.length) % buttons.length]?.focus();
                    event.preventDefault();
                }
            }}
        >
            {!readOnly && (
                <button role="menuitem" disabled={!count} onClick={() => finish(clipboard.cut)}>
                    Cut
                </button>
            )}
            <button role="menuitem" disabled={!count} onClick={() => finish(clipboard.copy)}>
                Copy
            </button>
            {!readOnly && (
                <>
                    <button
                        role="menuitem"
                        disabled={!clipboard.canPaste}
                        onClick={() => finish(clipboard.paste)}
                    >
                        Paste
                    </button>
                    <button role="menuitem" disabled={!count} onClick={() => finish(remove)}>
                        {frames ? "Clear" : "Delete"}
                    </button>
                </>
            )}
        </div>
    );
}
