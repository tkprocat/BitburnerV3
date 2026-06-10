import { NS } from "@ns";
import { ServerDetails, getServerDetails } from "./lib/servers";
import { UINode, colored, healthColor, panel, progressBar, statRow } from "./lib/ui";

// How far above min security counts as "fully bad" when coloring the security display.
const securityDisplayScale = 20;

// Tail window size; fits the panel's six rows without scrollbars.
const tailWidth = 480;
const tailHeight = 210;

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
    ns.ui.setTailTitle(`monitor: ${hostname}`);
    ns.ui.resizeTail(tailWidth, tailHeight);
    ns.disableLog("ALL");

    while (true) {
        ns.clearLog();
        ns.printRaw(monitorView(ns, getServerDetails(ns, hostname)));
        await ns.sleep(refreshRate);
    }
}

function monitorView(ns: NS, server: ServerDetails): UINode {
    const theme = ns.ui.getTheme();
    const money = Math.max(1, server.currentMoney);
    const moneyFraction = money / server.maxMoney;
    const securityOverMin = server.currentSecurityLevel - server.minSecurityLevel;
    const securityFraction = securityOverMin / securityDisplayScale;
    const securityColor = healthColor(1 - securityFraction);

    const hackThreads = Math.ceil(ns.hackAnalyzeThreads(server.name, money));
    const growThreads = Math.ceil(ns.growthAnalyze(server.name, server.maxMoney / money));
    const weakenThreads = Math.ceil(securityOverMin / ns.weakenAnalyze(1));

    return panel(server.name,
        statRow("money",
            progressBar(moneyFraction, theme.money),
            colored(`${ns.format.number(money)} / ${ns.format.number(server.maxMoney)} (${(moneyFraction * 100).toFixed(2)}%)`, theme.money)),
        statRow("security",
            progressBar(securityFraction, securityColor),
            colored(`+${securityOverMin.toFixed(2)}`, securityColor)),
        statRow("hack", `${ns.format.time(server.hackTime)} (t=${hackThreads})`),
        statRow("grow", `${ns.format.time(server.growTime)} (t=${growThreads})`),
        statRow("weaken", `${ns.format.time(server.weakenTime)} (t=${weakenThreads})`),
    );
}

export function autocomplete(data: { servers: string[] }): string[] {
    return data.servers;
}
