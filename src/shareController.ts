import { NS } from "@ns";
import { getServers, rootServers } from "./lib/servers";

const SHARE_SCRIPT = "share.js";

export async function main(ns: NS): Promise<void> {
    const flags = ns.flags([
        ["force", false],
        ["include-home", false],
        ["help", false],
    ]);

    if (flags.help) {
        ns.tprint("Usage: run shareController.js [--force] [--include-home]");
        return;
    }

    const force = Boolean(flags.force);
    const includeHome = Boolean(flags["include-home"]);
    const servers = getServers(ns);

    // First, root all servers we can. This maximizes the number of machines we can run share.js on, and thus our share power.
    const rooted = rootServers(ns, servers);

    let started = 0;
    let skipped = 0;

    // Then, deploy share.js on all rooted servers. If --force is specified, kill any existing scripts to free up RAM; otherwise, skip servers that are currently running other scripts.
    for (const server of servers) {
        if (server === "home" && !includeHome) {
            continue;
        }

        if (!ns.hasRootAccess(server)) {
            skipped++;
            continue;
        }

        const maxRam = ns.getServerMaxRam(server);
        if (maxRam <= 0) {
            continue;
        }

        if (force) {
            ns.scriptKill(SHARE_SCRIPT, server);
        } else if (hasRunningScript(ns.ps(server), SHARE_SCRIPT)) {
            skipped++;
            continue;
        }

        if (server !== "home" && !(ns.scp(SHARE_SCRIPT, server, "home"))) {
            ns.tprint(`Skipping ${server}: failed to copy ${SHARE_SCRIPT}.`);
            skipped++;
            continue;
        }

        const threads = getRunnableThreads({
            maxRam,
            usedRam: ns.getServerUsedRam(server),
            scriptRam: ns.getScriptRam(SHARE_SCRIPT, server),
        });

        if (threads < 1) {
            skipped++;
            continue;
        }

        const pid = ns.exec(SHARE_SCRIPT, server, threads);
        if (pid === 0) {
            ns.tprint(`Failed to start ${SHARE_SCRIPT} on ${server}.`);
            skipped++;
            continue;
        }

        started++;
        ns.tprint(`Started ${SHARE_SCRIPT} on ${server} with ${threads} threads.`);
    }

    ns.tprint(
        `Share deploy finished. Rooted: ${rooted}. Started: ${started}. Skipped: ${skipped}. Power: ${ns.getSharePower().toFixed(3)}x.`,
    );
}

function hasRunningScript(ps: ReturnType<NS["ps"]>, script: string): boolean {
    return ps.some((process) => process.filename === script);
}

function getRunnableThreads(options: { maxRam: number; usedRam: number; scriptRam: number }): number {
    const availableRam = options.maxRam - options.usedRam;
    if (availableRam <= 0 || options.scriptRam <= 0) {
        return 0;
    }
    return Math.floor(availableRam / options.scriptRam);
}
