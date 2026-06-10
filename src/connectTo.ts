import { NS } from "@ns";
import { ServerGraph, findPathToServer, scanServerGraph } from "./lib/servers";

export async function main(ns: NS): Promise<void> {
    const flags = ns.flags([
        ["target", ""],
        ["list", false],
        ["help", false],
    ]);

    if (flags.help) {
        ns.tprint("Usage: run connectTo.js <hostname>");
        ns.tprint("       run connectTo.js --target <hostname>");
        return;
    }

    const graph = scanServerGraph(ns);
    const positionalArgs = Array.isArray(flags._) ? flags._ : [];
    const target = String(flags.target || positionalArgs[0] || "");

    if (flags.list) {
        printServerPaths(ns, graph);
        return;
    }

    if (!target) {
        ns.tprint("Missing target. Usage: run connectTo.js <hostname>");
        return;
    }

    const path = findPathToServer(graph, target);
    if (path.length === 0) {
        ns.tprint(`Could not find ${target}.`);
        return;
    }

    let singularityAvailable = true;
    try {
        ns.singularity.connect("home");
    } catch {
        singularityAvailable = false;
    }

    if (!singularityAvailable) {
        ns.tprint(`Manual path: ${formatManualConnectPath(path)}`);
        return;
    }

    for (const server of path) {
        if (server === "home") {
            ns.singularity.connect("home");
            continue;
        }

        const connected = ns.singularity.connect(server);
        if (!connected) {
            ns.tprint(`Failed to connect to ${server}.`);
            ns.tprint(`Manual path: ${formatManualConnectPath(path)}`);
            return;
        }
    }

    ns.tprint(`Connected to ${target}.`);
}

function printServerPaths(ns: NS, graph: ServerGraph): void {
    for (const server of Object.keys(graph)) {
        const path = findPathToServer(graph, server);
        ns.tprint(`${server}: ${path.join(" -> ")}`);
    }
}

/** Render a path (starting at home) as copy-pasteable terminal connect commands. */
function formatManualConnectPath(path: string[]): string {
    const hops = path.slice(1);   // skip home (you start there)
    return hops.length > 0 ? hops.map(s => `connect ${s}`).join("; ") : "(already at home)";
}

export function autocomplete(data: { servers: string[] }): string[] {
    return data.servers;
}