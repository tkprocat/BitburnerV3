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
    let assignments = buildAssignments(ns, states);
    let nextRefresh = Date.now() + REFRESH_MS;

    while (true) {
        const now = Date.now();
        if (now >= nextRefresh) {
            assignments = buildAssignments(ns, states);
            nextRefresh = now + REFRESH_MS;
        }

        for (const { host: hostName, target: targetName, state } of assignments) {
            if (now < state.nextFire) continue;   // not this target's turn yet

            // Re-read live state only when a target is due to act; the pairing stays fixed
            // between refreshes.
            const host = getServerDetails(ns, hostName);
            const target = getServerDetails(ns, targetName);
            runTarget(ns, host, target, state, now);
        }
        await ns.sleep(LOOP_MS);
    }
}

/**
 * Root everything we can, then pair hosts and targets 1:1: biggest host -> best target.
 * Extra hosts/targets are left idle. Existing target states are reused so in-flight
 * lifecycles continue seamlessly across refreshes.
 */
function buildAssignments(ns: NS, states: Map<string, TargetState>): Assignment[] {
    rootServers(ns, getServers(ns));
    const hosts = getHostServers(ns).sort((a, b) => b.maxAvailableRam - a.maxAvailableRam);
    const scorer = pickScorer(ns);
    const targets = getTargetServers(ns).sort((a, b) => scorer(ns, b) - scorer(ns, a));

    const assignments: Assignment[] = [];
    for (let i = 0; i < Math.min(hosts.length, targets.length); i++) {
        copyWorkerScripts(ns, hosts[i].name);
        const targetName = targets[i].name;
        let state = states.get(targetName);
        if (!state) {
            state = newTargetState();
            states.set(targetName, state);
        }
        assignments.push({ host: hosts[i].name, target: targetName, state });
    }
    ns.print(`Assigned ${assignments.length} host->target pairs (scorer=${scorer.name}).`);
    return assignments;
}
