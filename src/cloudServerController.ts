import { NS } from "@ns";

const prefix = "private-";
const startingRam = 16;

export async function main(ns: NS): Promise<void> {
    while (true) {
        const ramLimit = ns.cloud.getRamLimit();
        const serverNames = ns.cloud.getServerNames();

        if (serverNames.length < ns.cloud.getServerLimit()) {
            buyNewServer(ns, ramLimit);
        } else {
            upgradeServers(ns, serverNames, ramLimit);
        }

        await ns.sleep(1000);
    }
}

/** Largest power-of-two RAM (from `minRam` up to `ramLimit`) whose cost stays within `money`. */
function maxAffordableRam(minRam: number, money: number, ramLimit: number, costOf: (ram: number) => number): number {
    let ram = minRam;
    while (ram * 2 <= ramLimit && costOf(ram * 2) <= money) {
        ram *= 2;
    }
    return ram;
}

function buyNewServer(ns: NS, ramLimit: number): void {
    const money = ns.getServerMoneyAvailable("home");
    const ram = maxAffordableRam(startingRam, money, ramLimit, (r) => ns.cloud.getServerCost(r));
    const cost = ns.cloud.getServerCost(ram);
    if (cost > money) return;   // can't even afford the starting tier yet

    const name = ns.cloud.purchaseServer(`${prefix}${ns.cloud.getServerNames().length + 1}`, ram);
    if (name) {
        ns.tprint(`Purchased new ${name} server with ${ram}GB RAM for ${ns.format.number(cost)} money.`);
    }
}

function upgradeServers(ns: NS, serverNames: string[], ramLimit: number): void {
    let money = ns.getServerMoneyAvailable("home");
    for (const server of serverNames) {
        const nextRam = ns.getServerMaxRam(server) * 2;
        if (nextRam > ramLimit) continue;   // already at the cap

        const newRam = maxAffordableRam(nextRam, money, ramLimit, (r) => ns.cloud.getServerUpgradeCost(server, r));
        const cost = ns.cloud.getServerUpgradeCost(server, newRam);
        if (cost > 0 && cost <= money) {
            ns.cloud.upgradeServer(server, newRam);
            ns.tprint(`Upgraded server ${server} to ${newRam}GB RAM for ${ns.format.number(cost)} money.`);
            money -= cost;
        }
    }
}
