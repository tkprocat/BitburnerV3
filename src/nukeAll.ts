import { NS } from "@ns";
import { rootServers, getServers} from "./lib/servers";

export async function main(ns: NS): Promise<void> {
    rootServers(ns, getServers(ns));
}
