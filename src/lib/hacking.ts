import { NS } from "@ns";
import { ServerDetails } from "./servers";
import { Logger } from "./logger";

export const delayBuffer = 200;          // ms gap between batch legs landing (>= game tick so legs land in distinct ticks)
export const hackMoneyPercentage = 0.1;  // fraction of a target's money to steal per cycle
export const homeRamBuffer = 32;         // GB kept free on home for other/manual scripts
export const batchSpacing = 4 * delayBuffer;  // ms between consecutive batches; >= one batch's landing span so batches don't collide
export const driftSecThreshold = 5;      // re-prep if security climbs this far above min
export const driftMoneyFloor = 0.5;      // re-prep if money falls below this fraction of max

// Single source of truth for the worker script locations.
export const workerScripts = {
    hack: "workers/hack.js",
    grow: "workers/grow.js",
    weaken: "workers/weaken.js",
} as const;

/** Copy the hack/grow/weaken workers to a host so the controllers can exec them there. */
export function copyWorkerScripts(ns: NS, host: string): boolean {
    return ns.scp(Object.values(workerScripts), host);
}

/** RAM a host may spend, reserving a buffer on home for other scripts. */
export function usableRam(host: ServerDetails): number {
    return host.name === "home"
        ? Math.max(0, host.currentAvailableRam - homeRamBuffer)
        : host.currentAvailableRam;
}

/**
 * Bring a target toward min security / max money, spreading one op's threads across `hosts`
 * (biggest usable RAM first, taking only what the op needs so the rest stays available).
 * Returns how long (ms) the launched op will take, so the caller can avoid re-firing until it
 * lands; 0 if nothing was launched.
 */
export function prepareServerOnHosts(ns: NS, hosts: ServerDetails[], target: ServerDetails, log?: Logger): number {
    let script: string;
    let wants: number;
    let opTime: number;
    if (target.currentSecurityLevel > target.minSecurityLevel) {
        script = workerScripts.weaken;
        wants = Math.ceil((target.currentSecurityLevel - target.minSecurityLevel) / ns.weakenAnalyze(1));
        opTime = ns.getWeakenTime(target.name);
    } else if (target.currentMoney < target.maxMoney) {
        script = workerScripts.grow;
        wants = Math.ceil(ns.growthAnalyze(target.name, target.maxMoney / Math.max(1, target.currentMoney)));
        opTime = ns.getGrowTime(target.name);
    } else {
        return 0;
    }

    const scriptRam = ns.getScriptRam(script);
    const pool = [...hosts].sort((a, b) => usableRam(b) - usableRam(a));
    let remaining = wants;
    for (const host of pool) {
        if (remaining <= 0) break;
        const threads = Math.min(remaining, Math.floor(usableRam(host) / scriptRam));
        if (threads <= 0) continue;
        ns.exec(script, host.name, threads, target.name);
        log?.(`    ${host.name}: ${threads} threads`);
        remaining -= threads;
    }
    const launched = wants - remaining;
    log?.(`  PREP ${script === workerScripts.weaken ? "weaken" : "grow"} want=${wants} run=${launched} hosts=${pool.length}`);
    return launched > 0 ? opTime : 0;
}

/** Single-host prep; see prepareServerOnHosts. */
export function prepareServer(ns: NS, host: ServerDetails, target: ServerDetails, log?: Logger): number {
    return prepareServerOnHosts(ns, [host], target, log);
}

/**
 * Launch one staggered Hack -> Weaken -> Grow -> Weaken batch from `host` against `target`.
 * Atomic: every leg is sized at full strength, and the batch only fires if the whole thing
 * fits in the host's RAM. A partial batch (e.g. hack without grow) corrupts the target, so we
 * bail beforehand rather than run an incomplete cycle.
 * Adaptive: starts at hackMoneyPercentage and halves the hack fraction until the batch fits,
 * so a small host streams smaller batches instead of stalling forever on a too-big one.
 */
export function setUpHWGWCycle(ns: NS, host: ServerDetails, target: ServerDetails, log?: Logger): number {
    const hackScriptRam = ns.getScriptRam(workerScripts.hack);
    const weakenScriptRam = ns.getScriptRam(workerScripts.weaken);
    const growScriptRam = ns.getScriptRam(workerScripts.grow);

    const hackTime = ns.getHackTime(target.name);
    const growTime = ns.getGrowTime(target.name);
    const weakenTime = ns.getWeakenTime(target.name);
    // Needs room for the full H->W->G->W stagger (up to 3*delayBuffer of offset) so no leg gets a negative delay.
    const cycleTime = Math.max(hackTime, growTime, weakenTime) + 4 * delayBuffer;

    // Size every leg off the PREPPED baseline (max money), NOT live state. A batch is designed to
    // leave the server at max money / min security, so each batch must assume that starting point.
    // Sizing off target.currentMoney would feed transient mid-cycle values from in-flight batches
    // into the math and corrupt thread counts. Grow's multiplier is therefore a constant: it just
    // undoes the fixed % the hack removes (e.g. 0.9 -> 1.0).
    // Size the hack by FRACTION, not dollars: hackAnalyze gives the fraction stolen per thread
    // (depends on security/level, NOT current money), so the thread count is stable regardless of
    // the server's live money. hackAnalyzeThreads(maxMoney*pct) instead uses current money for
    // per-thread yield -> oversizes at low money -> over-hacks when it lands -> money death-spirals.
    const hackFraction = ns.hackAnalyze(target.name);
    if (hackFraction <= 0) {
        log?.(`  HWGW skip: hackFraction=${hackFraction}`);
        return 0;
    }
    const weakenPerThread = ns.weakenAnalyze(1);
    const availableRam = usableRam(host);

    for (let percentage = hackMoneyPercentage; ; percentage /= 2) {
        const hackThreads = Math.max(1, Math.ceil(percentage / hackFraction));
        // Counter the security the hack adds. Omit the host arg (same cap gotcha as growthAnalyzeSecurity:
        // with host it limits threads to "needed to hack max money"); uncapped gives the true increase.
        const weakenThreads1 = Math.ceil(ns.hackAnalyzeSecurity(hackThreads) / weakenPerThread);
        // Grow must undo the ACTUAL fraction the hack removes. ceil() on hackThreads pushes that a bit
        // above the nominal percentage, so sizing grow off the nominal under-restores -> money ratchets
        // down ~0.6%/cycle. Size off the real fraction (clamped <1 to keep the multiplier finite).
        const actualHackPct = Math.min(0.99, hackThreads * hackFraction);
        const growThreads = Math.ceil(ns.growthAnalyze(target.name, 1 / (1 - actualHackPct)));
        // Counter the security the grow WILL add. NB: omit the host arg -- with it, growthAnalyzeSecurity
        // CAPS the increase to "threads needed to reach max money", which is ~0 at our prepped baseline.
        // But the grow runs AFTER the hack drops money, so it adds the FULL amount; size W2 off that.
        const weakenThreads2 = growThreads > 0
            ? Math.max(1, Math.ceil(ns.growthAnalyzeSecurity(growThreads) / weakenPerThread))
            : 0;

        const totalRam = hackThreads * hackScriptRam
            + weakenThreads1 * weakenScriptRam
            + growThreads * growScriptRam
            + weakenThreads2 * weakenScriptRam;

        if (totalRam > availableRam) {
            if (hackThreads === 1) {
                // Even the minimum possible batch doesn't fit; this pairing can't batch right now.
                log?.(`  HWGW skip: minimal batch needs ${totalRam.toFixed(0)}GB, have ${availableRam.toFixed(0)}GB`);
                return 0;
            }
            continue;   // halve the hack percentage and re-size
        }

        return fireHWGWBatch(ns, host, target, log, {
            hackThreads, weakenThreads1, growThreads, weakenThreads2,
            hackTime, growTime, weakenTime, cycleTime, totalRam, availableRam,
        });
    }
}

interface HWGWBatch {
    hackThreads: number;
    weakenThreads1: number;
    growThreads: number;
    weakenThreads2: number;
    hackTime: number;
    growTime: number;
    weakenTime: number;
    cycleTime: number;
    totalRam: number;
    availableRam: number;
}

function fireHWGWBatch(ns: NS, host: ServerDetails, target: ServerDetails, log: Logger | undefined, batch: HWGWBatch): number {
    const { hackThreads, weakenThreads1, growThreads, weakenThreads2, hackTime, growTime, weakenTime, cycleTime, totalRam, availableRam } = batch;

    // Whole batch fits -> fire all four. Landing time of each leg = cycleTime - N*delayBuffer.
    // Each leg is still guarded: a leg that needs 0 threads (e.g. nothing to grow) is just skipped,
    // since ns.exec rejects a 0 thread count.
    if (hackThreads > 0) ns.exec(workerScripts.hack, host.name, hackThreads, target.name, cycleTime - hackTime - 3 * delayBuffer);
    if (weakenThreads1 > 0) ns.exec(workerScripts.weaken, host.name, weakenThreads1, target.name, cycleTime - weakenTime - 2 * delayBuffer);
    if (growThreads > 0) ns.exec(workerScripts.grow, host.name, growThreads, target.name, cycleTime - growTime - 1 * delayBuffer);
    if (weakenThreads2 > 0) ns.exec(workerScripts.weaken, host.name, weakenThreads2, target.name, cycleTime - weakenTime);

    if (log) {
        log(`  HWGW H=${hackThreads} W1=${weakenThreads1} G=${growThreads} W2=${weakenThreads2} ` +
            `ram=${totalRam.toFixed(0)}/${availableRam.toFixed(0)}GB`);
        log(`    land H=+${(cycleTime - 3 * delayBuffer).toFixed(0)} W1=+${(cycleTime - 2 * delayBuffer).toFixed(0)} ` +
            `G=+${(cycleTime - delayBuffer).toFixed(0)} W2=+${cycleTime.toFixed(0)}`);
    }

    return cycleTime;
}

// ---- Streaming per-target lifecycle -------------------------------------------------

export type TargetMode = "prep" | "batch";

export interface TargetState {
    mode: TargetMode;
    nextFire: number;   // timestamp (ms) when this target may next act
}

export function newTargetState(): TargetState {
    return { mode: "prep", nextFire: 0 };
}

/** Solidly at baseline (small tolerances so sub-thread noise doesn't trap it in prep). */
export function isPrepped(t: ServerDetails): boolean {
    return t.currentMoney >= t.maxMoney * 0.999
        && t.currentSecurityLevel <= t.minSecurityLevel + 0.05;
}

/** Real desync (not the normal per-hack money dip): security climbing or money crashing. */
function hasDrifted(t: ServerDetails): boolean {
    return t.currentSecurityLevel > t.minSecurityLevel + driftSecThreshold
        || t.currentMoney < t.maxMoney * driftMoneyFloor;
}

/**
 * Advance one target's lifecycle. Call every loop tick; it no-ops until `state.nextFire`.
 * - PREP: fix the server one op at a time (waiting for each to land) until it's at baseline,
 *   then switch to BATCH. `supportHosts` (e.g. hosts left idle by the assignment) pitch in
 *   so big preps don't crawl on a single host's RAM.
 * - BATCH: stream staggered batches every `batchSpacing`, trusting each to self-heal. Money is
 *   allowed to swing; only drop back to PREP if the server drifts beyond tolerance (real desync).
 *   RAM-full firings are skipped by setUpHWGWCycle and act as natural backpressure on depth.
 *   Batches always run on `host` alone.
 */
export function runTarget(ns: NS, host: ServerDetails, target: ServerDetails, state: TargetState, now: number, log?: Logger, supportHosts: ServerDetails[] = []): void {
    if (now < state.nextFire) return;

    if (state.mode === "prep") {
        if (isPrepped(target)) {
            state.mode = "batch";
            log?.(`${target.name}: prepped -> BATCHING`);
        } else {
            const busy = prepareServerOnHosts(ns, [host, ...supportHosts], target, log);
            state.nextFire = now + (busy > 0 ? busy : 1000);   // wait for the op to land; retry soon if RAM-blocked
            return;
        }
    }

    // batch mode
    if (hasDrifted(target)) {
        log?.(`${target.name}: drifted (money ${(target.currentMoney / target.maxMoney * 100).toFixed(0)}% ` +
            `sec +${(target.currentSecurityLevel - target.minSecurityLevel).toFixed(2)}) -> PREPPING`);
        state.mode = "prep";
        state.nextFire = now;
        return;
    }
    setUpHWGWCycle(ns, host, target, log);
    state.nextFire = now + batchSpacing;
}
