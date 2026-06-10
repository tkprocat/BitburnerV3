import { NS } from "@ns";
import { getServerDetails } from "./lib/servers";

export async function main(ns: NS): Promise<void> {
    const flags = ns.flags([
        ["hostname", ""],
        ["refreshrate", 200],
        ["help", false],
    ]);
    const hostname = String(flags.hostname);
    const refreshRate = Number(flags.refreshrate);

    if (!hostname || flags.help) {
        ns.tprint("This script helps visualize the money and security of a server.");
        ns.tprint(`USAGE: run ${ns.getScriptName()} --hostname SERVER_NAME`);
        ns.tprint("Example:");
        ns.tprint(`> run ${ns.getScriptName()} --hostname n00dles`);
        return;
    }

    ns.ui.openTail();
    ns.disableLog("ALL");

    while (true) {
        const server = getServerDetails(ns, hostname);
        const money = Math.max(1, server.currentMoney);
        const securityOverMin = server.currentSecurityLevel - server.minSecurityLevel;

        ns.clearLog();
        ns.print(`${hostname}:`);
        ns.print(` $_______: ${ns.format.number(money)} / ${ns.format.number(server.maxMoney)} (${(money / server.maxMoney * 100).toFixed(2)}%)`);
        ns.print(` security: +${securityOverMin.toFixed(2)}`);
        ns.print(` hack____: ${ns.format.time(server.hackTime)} (t=${Math.ceil(ns.hackAnalyzeThreads(hostname, money))})`);
        ns.print(` grow____: ${ns.format.time(server.growTime)} (t=${Math.ceil(ns.growthAnalyze(hostname, server.maxMoney / money))})`);
        ns.print(` weaken__: ${ns.format.time(server.weakenTime)} (t=${Math.ceil(securityOverMin / ns.weakenAnalyze(1))})`);
        await ns.sleep(refreshRate);
    }
}

export function autocomplete(data: { servers: string[] }): string[] {
    return data.servers;
}
