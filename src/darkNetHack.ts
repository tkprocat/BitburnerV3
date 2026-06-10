import { NS } from "@ns";

const maxAttempts = 25;

export async function main(ns: NS): Promise<void> {
    for (const server of ns.dnet.probe(true)) {
        const auth = await ns.dnet.authenticate(server, "1");
        if (auth.success) {
            ns.tprint(`Authenticated to ${server} successfully without heartbleed!`);
            continue;
        }

        await heartbleedServer(ns, server);
    }
}

/** Retry heartbleed until it succeeds (printing its logs) or the attempt budget runs out. */
async function heartbleedServer(ns: NS, server: string): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const result = await ns.dnet.heartbleed(server);
        if (result.success) {
            for (const log of result.logs) {
                ns.tprint(`Heartbleed log for ${server}: ${log}`);
            }
            return;
        }
    }

    ns.tprint(`Failed to perform heartbleed on ${server} after ${maxAttempts} attempts.`);
}

export function autocomplete(data: { servers: string[] }): string[] {
    return data.servers;
}
