import { NS } from "@ns";
import { getServerDetails, rootServers } from "./lib/servers";
import { copyWorkerScripts, runTarget, newTargetState, usableRam } from "./lib/hacking";
import { fileLogger } from "./lib/logger";

// Single-pair streaming harness for diagnosing batch timing, verbose, mirroring every line to a
// tail and to debugHack.txt. Usage: run debugHackController.js [target] [host]
//   defaults: target=n00dles, host=home
const LOG_FILE = "debugHack.txt";
const LOOP_MS = 50;   // fine-grained so the money/security trace catches each landing

export async function main(ns: NS): Promise<void> {
    ns.disableLog("ALL");
    ns.ui.openTail();

    const targetName = String(ns.args[0] ?? "n00dles");
    const hostName = String(ns.args[1] ?? "home");

    rootServers(ns, [targetName]);   // open ports + nuke if we can
    if (!ns.hasRootAccess(targetName)) {
        ns.tprint(`No root on ${targetName} (need more port crackers). Aborting.`);
        return;
    }
    copyWorkerScripts(ns, hostName);

    const log = fileLogger(ns, LOG_FILE);
    const state = newTargetState();

    // High-res trace: log only when money/security actually changes (i.e. a leg landed) so each
    // line is one real effect -- reveals whether each grow restores to max or leaves a ratchet.
    let lastMoney = -1;
    let lastSec = -1;

    while (true) {
        const now = Date.now();
        const moneyPct = +(ns.getServerMoneyAvailable(targetName) / ns.getServerMaxMoney(targetName) * 100).toFixed(1);
        const secOver = +(ns.getServerSecurityLevel(targetName) - ns.getServerMinSecurityLevel(targetName)).toFixed(2);
        const due = now >= state.nextFire;

        if (due || moneyPct !== lastMoney || secOver !== lastSec) {
            log(`${due ? "FIRE" : "    "} [${state.mode}] $${moneyPct}% sec+${secOver}`);
            lastMoney = moneyPct;
            lastSec = secOver;
        }

        if (due) {
            const host = getServerDetails(ns, hostName);
            const target = getServerDetails(ns, targetName);
            log(`     free=${usableRam(host).toFixed(0)}GB`);
            runTarget(ns, host, target, state, now, log);
        }
        await ns.sleep(LOOP_MS);
    }
}

export function autocomplete(data: { servers: string[] }) {
    return data.servers;
}
