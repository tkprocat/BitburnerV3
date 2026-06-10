import { NS } from "@ns";

// A sink for diagnostic lines. Pass one to library functions to log; omit for silent runs.
export type Logger = (msg: string) => void;

/**
 * Logger that mirrors each line to the script's tail AND appends it to `file` (with a timestamp).
 * `fresh` truncates the file first so each run starts a clean log.
 * Read it in-game with `cat <file>` or pull it out with `download <file>`.
 */
export function fileLogger(ns: NS, file: string, fresh = true): Logger {
    if (fresh) ns.write(file, "", "w");
    return (msg: string) => {
        const line = `[${new Date().toISOString().slice(11, 23)}] ${msg}`;
        ns.print(line);
        ns.write(file, line + "\n", "a");
    };
}

/** Logger that only writes to the script's tail (no file). */
export function tailLogger(ns: NS): Logger {
    return (msg: string) => ns.print(msg);
}
