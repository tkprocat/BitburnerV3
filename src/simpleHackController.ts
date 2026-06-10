import { NS } from "@ns";
import { getServerDetails } from "./lib/servers";
import { copyWorkerScripts, isPrepped, prepareServer, usableRam, workerScripts } from "./lib/hacking";

// Keep hacks small (5% of max money) so a single grow can comfortably restore the balance.
const hackFraction = 0.05;

export async function main(ns: NS): Promise<void> {
    const hostName = String(ns.args[0] || "");
    const targetName = String(ns.args[1] || hostName);

    if (!hostName) {
        ns.tprint("Usage: run simpleHackController.js <host> [target]");
        return;
    }

    ns.disableLog("ALL");
    copyWorkerScripts(ns, hostName);

    while (true) {
        const host = getServerDetails(ns, hostName);
        const target = getServerDetails(ns, targetName);

        if (!isPrepped(target)) {
            // Weaken/grow toward baseline one op at a time, waiting for each to land.
            const busy = prepareServer(ns, host, target);
            await ns.sleep(busy > 0 ? busy + 100 : 1000);
            continue;
        }

        const availableThreads = Math.floor(usableRam(host) / ns.getScriptRam(workerScripts.hack));
        const neededThreads = Math.max(1, Math.ceil(hackFraction / ns.hackAnalyze(targetName)));
        if (availableThreads > 0) {
            ns.exec(workerScripts.hack, hostName, Math.min(availableThreads, neededThreads), targetName);
            await ns.sleep(target.hackTime + 100);
        } else {
            await ns.sleep(1000);
        }
    }
}

export function autocomplete(data: { servers: string[] }): string[] {
    return data.servers;
}
