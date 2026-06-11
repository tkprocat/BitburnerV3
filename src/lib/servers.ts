import { NS } from "@ns";

export interface ServerDetails {
    name: string;
    requiredHackingLevel: number;
    requiredPorts: number;
    hasAdminRights: boolean;
    currentAvailableRam: number;
    maxAvailableRam: number;
    currentMoney: number;
    maxMoney: number;
    currentSecurityLevel: number;
    minSecurityLevel: number;
    baseSecurityLevel: number;
    growthRate: number;
    hackTime: number;
    growTime: number;
    weakenTime: number;
}

// Scoring strategies decide how targets are prioritized. They take the already-built
// ServerDetails so they're cheap, and `pickScorer` selects one based on game state.
export type ScoreStrategy = (ns: NS, s: ServerDetails) => number;

export const scoreByMoney: ScoreStrategy = (ns, s) =>
    s.maxMoney / s.weakenTime;

export const scoreByDifficulty: ScoreStrategy = (ns, s) =>
    ns.hackAnalyzeChance(s.name) * Math.sqrt(s.maxMoney) / s.weakenTime;

// Hacking exp per thread scales with a server's BASE security (and weaken/grow always grant
// it, success or not), so exp rate ~ base security over how fast ops cycle. The exact value
// needs Formulas.exe (ns.formulas.hacking.hackExp); this ranks targets the same without it.
export const scoreByExp: ScoreStrategy = (ns, s) =>
    s.baseSecurityLevel / s.weakenTime;

export function pickScorer(ns: NS): ScoreStrategy {
    const hackingLevel = ns.getHackingLevel();
    if (hackingLevel < 500) return scoreByExp;       // level fast first
    if (hackingLevel < 2000) return scoreByDifficulty;
    return scoreByMoney;
}

export function getServers(ns: NS, root = "home", servers = new Set<string>([root])): string[] {
    const discovered = ns.scan(root);
    for (const server of discovered) {
        if (!servers.has(server)) {
            servers.add(server);
            getServers(ns, server, servers);
        }
    }
    return Array.from(servers);
}

export function getServerDetails(ns: NS, server: string): ServerDetails {
    // One getServer() call instead of a dozen individual getters keeps the script's RAM cost down.
    const info = ns.getServer(server);
    return {
        name: server,
        requiredHackingLevel: info.requiredHackingSkill ?? 0,
        requiredPorts: info.numOpenPortsRequired ?? 0,
        hasAdminRights: info.hasAdminRights,
        currentAvailableRam: info.maxRam - info.ramUsed,
        maxAvailableRam: info.maxRam,
        currentMoney: info.moneyAvailable ?? 0,
        maxMoney: info.moneyMax ?? 0,
        currentSecurityLevel: info.hackDifficulty ?? 0,
        minSecurityLevel: info.minDifficulty ?? 0,
        baseSecurityLevel: info.baseDifficulty ?? 0,
        growthRate: info.serverGrowth ?? 0,
        hackTime: ns.getHackTime(server),
        growTime: ns.getGrowTime(server),
        weakenTime: ns.getWeakenTime(server),
    };
}

export function getServerListWithDetails(ns: NS): ServerDetails[] {
    const servers = getServers(ns);
    return servers.map(server => getServerDetails(ns, server));
}

export function getHostServers(ns: NS): ServerDetails[] {
    const servers = getServerListWithDetails(ns);
    return servers.filter(server => server.hasAdminRights && server.maxAvailableRam > 0);
}

export function getTargetServers(ns: NS): ServerDetails[] {
    const playerHackingLevel = ns.getHackingLevel();
    const servers = getServerListWithDetails(ns);
    return servers.filter(server =>
        server.hasAdminRights &&
        server.requiredHackingLevel <= playerHackingLevel &&
        server.maxMoney > 0
    );
}

// Adjacency map of the network: hostname -> direct neighbors.
export type ServerGraph = Record<string, string[]>;

/** Build an adjacency map of the whole network by breadth-first scan from `root`. */
export function scanServerGraph(ns: NS, root = "home"): ServerGraph {
    const graph: ServerGraph = {};
    const queue: string[] = [root];
    const visited = new Set<string>([root]);

    while (queue.length > 0) {
        const host = queue.shift() as string;
        const neighbors = ns.scan(host);
        graph[host] = neighbors;
        for (const neighbor of neighbors) {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
            }
        }
    }

    return graph;
}

/** Shortest path from home to target (inclusive of both), or [] if unreachable/unknown. */
export function findPathToServer(graph: ServerGraph, target: string): string[] {
    if (!(target in graph)) {
        return [];
    }

    const start = "home";
    const queue: string[] = [start];
    const visited = new Set<string>([start]);
    const parent: Record<string, string> = {};

    while (queue.length > 0) {
        const host = queue.shift() as string;
        if (host === target) {
            const path: string[] = [];
            for (let cur: string | undefined = target; cur !== undefined; cur = parent[cur]) {
                path.unshift(cur);
            }
            return path;
        }
        for (const neighbor of graph[host] ?? []) {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                parent[neighbor] = host;
                queue.push(neighbor);
            }
        }
    }

    return [];
}

export function rootServers(ns: NS, servers: string[]): number {
    const crackers: Array<[string, (host: string) => void]> = [
        ["BruteSSH.exe", h => ns.brutessh(h)],
        ["FTPCrack.exe", h => ns.ftpcrack(h)],
        ["relaySMTP.exe", h => ns.relaysmtp(h)],
        ["HTTPWorm.exe", h => ns.httpworm(h)],
        ["SQLInject.exe", h => ns.sqlinject(h)],
    ];
    let rooted = 0;
    for (const host of servers) {
        if (ns.hasRootAccess(host)) continue;
        let opened = 0;
        for (const [file, crack] of crackers) {
            if (ns.fileExists(file, "home")) { crack(host); opened++; }
        }
        if (opened >= ns.getServerNumPortsRequired(host)) {
            ns.nuke(host);
            ns.tprint(`Rooted ${host} with ${opened} ports opened.`);
            rooted++;
        }
    }
    return rooted;
}