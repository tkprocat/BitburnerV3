import { NS } from "@ns";

// The definitions file doesn't export its React types directly, but they can be
// extracted from the NS signatures that use them.
export type UINode = Parameters<NS["printRaw"]>[0];
export type UITheme = ReturnType<NS["ui"]["getTheme"]>;

type UIProps = Record<string, unknown> | null;

// Bitburner scripts run in the browser and the game exposes its own React instance
// globally. Reach it through globalThis: the static RAM checker charges 25GB for the
// identifiers `window` and `document`, but globalThis is free.
const React = (globalThis as unknown as {
    React: { createElement(type: string, props: UIProps, ...children: UINode[]): UINode };
}).React;

/** React.createElement shorthand so UI can be built from plain .ts (no JSX needed). */
export function e(type: string, props: UIProps, ...children: UINode[]): UINode {
    return React.createElement(type, props, ...children);
}

/** Inline text in a specific color. */
export function colored(text: string, color: string): UINode {
    return e("span", { style: { color } }, text);
}

/** Map a 0..1 fraction to a color from red (0, unhealthy) to green (1, healthy). */
export function healthColor(fraction: number): string {
    const clamped = Math.max(0, Math.min(1, fraction));
    return `hsl(${Math.round(clamped * 130)}, 100%, 50%)`;
}

/** Horizontal bar filled to a 0..1 fraction, in `color` on a translucent track. */
export function progressBar(fraction: number, color: string, width = 160): UINode {
    const percentage = Math.max(0, Math.min(1, fraction)) * 100;
    return e("div", {
        style: {
            width: `${width}px`,
            height: "0.6em",
            background: "rgba(128, 128, 128, 0.25)",
            borderRadius: "3px",
            overflow: "hidden",
            flexShrink: 0,
        },
    }, e("div", { style: { width: `${percentage}%`, height: "100%", background: color } }));
}

/** One labeled line: fixed-width label followed by arbitrary content. */
export function statRow(label: string, ...children: UINode[]): UINode {
    return e("div", { style: { display: "flex", alignItems: "center", gap: "0.5em" } },
        e("span", { style: { width: "5.5em", flexShrink: 0 } }, label),
        ...children);
}

/** Titled container for stat rows. */
export function panel(title: UINode, ...rows: UINode[]): UINode {
    return e("div", { style: { lineHeight: "1.5" } },
        e("div", { style: { fontWeight: "bold" } }, title),
        ...rows);
}
