import React, { useEffect, useRef, useState } from "react";
import { Image } from "image-js";
import { Dirs, DmiState, frameUrl } from "../../shared/dmi";

export function IconButton({
    icon,
    label,
    ...props
}: {
    icon: string;
    label: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button type="button" className="iconButton" title={label} aria-label={label} {...props}>
            <span className={"codicon codicon-" + icon} aria-hidden="true" />
        </button>
    );
}

export function CommitInput({
    value,
    label,
    onChange,
    ...props
}: {
    value: string;
    label: string;
    onChange: (value: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
    const [draft, setDraft] = useState(value);
    const cancelled = useRef(false);
    useEffect(() => setDraft(value), [value]);

    return (
        <input
            {...props}
            aria-label={label}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onBlur={() => {
                if (!cancelled.current && draft !== value) onChange(draft);
                cancelled.current = false;
                setDraft(value);
            }}
            onKeyDown={event => {
                if (event.key !== "Enter" && event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                cancelled.current = event.key === "Escape";
                event.currentTarget.blur();
            }}
        />
    );
}

export function EditableField({
    value,
    displayValue,
    title,
    className,
    onChange
}: {
    value: string;
    displayValue?: string;
    title?: string;
    className?: string;
    onChange?: (value: string) => void;
}) {
    const [editing, setEditing] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    const cancelled = useRef(false);
    function finish() {
        const draft = input.current?.value;
        setEditing(false);
        if (!cancelled.current && draft !== undefined && draft !== value) onChange?.(draft);
    }
    return (
        <div
            className={className}
            title={title}
            onDoubleClick={
                onChange &&
                (event => {
                    event.stopPropagation();
                    cancelled.current = false;
                    setEditing(true);
                })
            }
        >
            {editing && onChange ? (
                <input
                    autoFocus
                    draggable={false}
                    ref={input}
                    defaultValue={value}
                    aria-label="Edit value"
                    onFocus={event => event.target.select()}
                    onClick={event => event.stopPropagation()}
                    onBlur={finish}
                    onKeyDown={event => {
                        if (event.key !== "Enter" && event.key !== "Escape") return;
                        event.preventDefault();
                        event.stopPropagation();
                        cancelled.current = event.key === "Escape";
                        event.currentTarget.blur();
                    }}
                />
            ) : (
                displayValue ?? value
            )}
        </div>
    );
}

const pending = new Map<Element, () => void>();
let observer: IntersectionObserver | undefined;

function whenVisible(element: Element, show: () => void) {
    observer ??= new IntersectionObserver(
        entries => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                pending.get(entry.target)?.();
                pending.delete(entry.target);
                observer?.unobserve(entry.target);
            }
        },
        { rootMargin: "120px" }
    );
    pending.set(element, show);
    observer.observe(element);
    return () => {
        pending.delete(element);
        observer?.unobserve(element);
    };
}

export function SpriteImage(
    props:
        | { image: Image }
        | {
              state: DmiState;
              direction: Dirs;
              animate?: boolean;
          }
) {
    const image = "image" in props ? props.image : undefined;
    const state = "state" in props ? props.state : undefined;
    const direction = "direction" in props ? props.direction : Dirs.SOUTH;
    const animate = "animate" in props ? props.animate : true;
    const [visible, setVisible] = useState(false);
    const [src, setSrc] = useState<string>();
    const ref = useRef<HTMLImageElement>(null);

    useEffect(() => whenVisible(ref.current!, () => setVisible(true)), []);
    useEffect(() => {
        if (!visible) return;
        let cancelled = false;
        const source = image ? frameUrl(image) : state?.preview(direction, animate ?? true);
        source?.then(
            url => {
                if (!cancelled) setSrc(url);
            },
            () => {
                if (!cancelled) setSrc(undefined);
            }
        );
        return () => {
            cancelled = true;
        };
    }, [visible, image, state, direction, animate]);

    return <img ref={ref} className="frame" draggable={false} alt="" src={src} />;
}
