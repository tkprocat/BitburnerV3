import { NS } from "@ns";
import { getTargetServers, getHostServers, getServerDetails, rootServers, getServers, pickScorer } from "./lib/servers";
import { copyWorkerScripts, runTarget, newTargetState, TargetState } from "./lib/hacking";

const LOOP_MS = 200;                    // fine-grained so per-target batch spacing is honored
const REFRESH_MS = 10 * 60 * 1000;      // rebuild assignments to pick up new roots, hosts and level-driven ranking shifts

interface Assignment {
    host: string;
    target: string;
    state: TargetState;
}

export async function main(ns: NS): Promise<void> {
    ns.disableLog("ALL");

    // Target states outlive the assignments: a target that stays assigned across a refresh
    // keeps its prep/batch mode instead of being reset to prep every REFRESH_MS.
    const states = new Map<string, TargetState>();
    let { assignments, idleHostNames } = buildAssignments(ns, states);
    let nextRefresh = Date.now() + REFRESH_MS;

    while (true) {
        const now = Date.now();
        if (now >= nextRefresh) {
            ({ assignments, idleHostNames } = buildAssignments(ns, states));
            nextRefresh = now + REFRESH_MS;
        }

        for (const { host: hostName, target: targetName, state } of assignments) {
            if (now < state.nextFire) continue;   // not this target's turn yet

            // Re-read live state only when a target is due to act; the pairing stays fixed
            // between refreshes.
            const host = getServerDetails(ns, hostName);
            const target = getServerDetails(ns, targetName);
            // Idle hosts pitch in on preps. Read live each time: RAM claimed by an earlier
            // prepping target this tick is reserved by exec, so later targets see the rest.
            const supportHosts = state.mode === "prep"
                ? idleHostNames.map((name) => getServerDetails(ns, name))
                : [];
            runTarget(ns, host, target, state, now, undefined, supportHosts);
        }
        await ns.sleep(LOOP_MS);
    }
}

/**
 * Root everything we can, then pair hosts and targets 1:1: biggest host -> best target.
 * Hosts beyond the pairing are reported as idle so preps can borrow their RAM. Existing
 * target states are reused so in-flight lifecycles continue seamlessly across refreshes.
 */
function buildAssignments(ns: NS, states: Map<string, TargetState>): { assignments: Assignment[]; idleHostNames: string[] } {
    rootServers(ns, getServers(ns));
    const hosts = getHostServers(ns).sort((a, b) => b.maxAvailableRam - a.maxAvailableRam);
    const scorer = pickScorer(ns);
    const targets = getTargetServers(ns).sort((a, b) => scorer(ns, b) - scorer(ns, a));

    // Every host gets the workers: paired hosts run batches, idle hosts assist preps.
    for (const host of hosts) {
        copyWorkerScripts(ns, host.name);
    }

    const pairCount = Math.min(hosts.length, targets.length);
    const assignments: Assignment[] = [];
    for (let i = 0; i < pairCount; i++) {
        const targetName = targets[i].name;
        let state = states.get(targetName);
        if (!state) {
            state = newTargetState();
            states.set(targetName, state);
        }
        assignments.push({ host: hosts[i].name, target: targetName, state });
    }
    const idleHostNames = hosts.slice(pairCount).map((host) => host.name);
    ns.print(`Assigned ${assignments.length} host->target pairs (scorer=${scorer.name}, idle hosts=${idleHostNames.length}).`);
    return { assignments, idleHostNames };
}
