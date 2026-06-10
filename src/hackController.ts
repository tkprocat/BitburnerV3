import { NS } from "@ns";
import { getTargetServers, getHostServers, getServerDetails, rootServers, getServers, pickScorer } from "./lib/servers";
import { runTarget, newTargetState, TargetState } from "./lib/hacking";

const LOOP_MS = 200;   // fine-grained so per-target batch spacing is honored

export async function main(ns: NS): Promise<void> {
    ns.disableLog("ALL");

    // Root everything we can, then build a FIXED host->target assignment ONCE.
    // Re-run the script to pick up newly rooted servers or hacking-level changes.
    rootServers(ns, getServers(ns));
    const hosts = getHostServers(ns).sort((a, b) => b.maxAvailableRam - a.maxAvailableRam);
    const scorer = pickScorer(ns);
    const targets = getTargetServers(ns).sort((a, b) => scorer(ns, b) - scorer(ns, a));

    // Strict 1:1 pairing: biggest host -> best target. Extra hosts/targets are left idle.
    // Each target gets its own streaming lifecycle state (prep -> batch).
    const assignments: { host: string; target: string; state: TargetState }[] = [];
    for (let i = 0; i < Math.min(hosts.length, targets.length); i++) {
        ns.scp(["hack.js", "weaken.js", "grow.js"], hosts[i].name);
        assignments.push({ host: hosts[i].name, target: targets[i].name, state: newTargetState() });
    }
    ns.print(`Assigned ${assignments.length} host->target pairs.`);

    while (true) {
        const now = Date.now();
        for (const { host: hostName, target: targetName, state } of assignments) {
            if (now < state.nextFire) continue;   // not this target's turn yet

            // Re-read live state only when a target is due to act; the pairing stays fixed.
            const host = getServerDetails(ns, hostName);
            const target = getServerDetails(ns, targetName);
            runTarget(ns, host, target, state, now);
        }
        await ns.sleep(LOOP_MS);
    }
}
