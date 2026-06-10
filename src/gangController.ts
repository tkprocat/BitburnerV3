import { NS } from "@ns";
import { GangEquipment, GangEquipmentType, GangFocus, GangMember, GangTask, getGangEquipment, getGangMembers, getNextRecruitName, isCombatEquipmentType, isGangFull, parseGangFocus, setGangMemberTask } from "./lib/gang";

const minWantedPenalty = 0.85;
const safeWantedPenalty = 0.95;
const ascensionFactor = 1.5;
const ascensionCooldownMs = 2 * 60 * 1000;

// Crime ladder for the money focus: first task whose combat-stat threshold the member is still under.
const moneyTaskLadder: Array<[number, GangTask]> = [
    [400, GangTask.TrainCombat],
    [800, GangTask.MugPeople],
    [1200, GangTask.StrongarmCivilians],
    [1500, GangTask.TraffickIllegalArms],
];

export async function main(ns: NS): Promise<void> {
    const flags = ns.flags([
        ["focus", "auto"],
    ]);

    const flagFocus = parseGangFocus(flags.focus);
    if (flagFocus === null) {
        ns.tprint(`Unknown focus "${flags.focus}". Valid values: ${Object.values(GangFocus).join(", ")}.`);
        return;
    }

    //Bail if we are not in a gang.
    if (!ns.gang.inGang()) {
        ns.print("We are not currently in gang, bailing out!");
        return;
    }

    let reducingWanted = false;
    let nextAscensionAt = 0;

    ns.disableLog("getServerMoneyAvailable");
    ns.disableLog("gang.setMemberTask");

    while (true) {
        // Auto mode prioritizes respect until the gang is full, then falls back to the requested default focus.
        const focus = flagFocus === GangFocus.Auto && !isGangFull(ns)
            ? GangFocus.Respect
            : flagFocus;

        if (ns.gang.canRecruitMember()) {
            ns.gang.recruitMember(getNextRecruitName(ns));
        }

        const gangInfo = ns.gang.getGangInformation();

        reducingWanted = updateWantedReduction(gangInfo.wantedPenalty, reducingWanted);

        const gangMemberNames = ns.gang.getMemberNames();
        const { equipmentList, augmentationList } = getCombatEquipmentLists(ns);

        /*
        * We are gonna split buying equipment and buying augmentations due to the fact that buying augmentations resets stats on the gang member.
        * Since we get a stat reset, we would prefer one member get all augmentations in "one go" or as soon as possible money wise.
        * On the other hand, for equipment we want to "spread the wealth" so each member gets similar equipment and have similar stats instead of having a few "great members".
        */

        buyEquipmentForMembers(ns, gangMemberNames, equipmentList);
        buyAugmentationsForMembers(ns, gangMemberNames, augmentationList);

        if (Date.now() >= nextAscensionAt)
            nextAscensionAt = ascendGangMembers(ns, getGangMembers(ns));

        await assignGangMemberTasks(ns, reducingWanted, focus);

        await ns.gang.nextUpdate();
    }
}

function updateWantedReduction(wantedPenalty: number, reducingWanted: boolean): boolean {
    // Use two thresholds so members do not bounce between crime and Vigilante Justice every update.
    if (wantedPenalty < minWantedPenalty) {
        return true;
    }

    if (wantedPenalty > safeWantedPenalty) {
        return false;
    }

    return reducingWanted;
}

function getCombatEquipmentLists(ns: NS): { equipmentList: GangEquipment[], augmentationList: GangEquipment[] } {
    const combatEquipmentList = getGangEquipment(ns).filter((equipment) => isCombatEquipmentType(equipment.type));

    // Regular equipment is spread across members; augmentations are grouped per member because they reset stats.
    return {
        equipmentList: combatEquipmentList.filter((equipment) => equipment.type !== GangEquipmentType.Augmentation),
        augmentationList: combatEquipmentList.filter((equipment) => equipment.type === GangEquipmentType.Augmentation),
    };
}

function buyEquipmentForMembers(ns: NS, gangMemberNames: string[], equipmentList: GangEquipment[]): void {
    for (const equipment of equipmentList) {
        for (const gangMemberName of gangMemberNames) {
            purchaseIfMissing(ns, gangMemberName, equipment);
        }
    }
}

function buyAugmentationsForMembers(ns: NS, gangMemberNames: string[], augmentationList: GangEquipment[]): void {
    for (const gangMemberName of gangMemberNames) {
        for (const augmentation of augmentationList) {
            purchaseIfMissing(ns, gangMemberName, augmentation);
        }
    }
}

function purchaseIfMissing(ns: NS, gangMemberName: string, equipment: GangEquipment): void {
    const gangMemberInfo = ns.gang.getMemberInformation(gangMemberName);
    if (gangMemberInfo.upgrades.includes(equipment.name) || gangMemberInfo.augmentations.includes(equipment.name))
        return;

    if (equipment.cost < ns.getServerMoneyAvailable("home") && ns.gang.purchaseEquipment(gangMemberName, equipment.name))
        ns.print(`Bought ${equipment.name} (${equipment.type}) for ${gangMemberName}`);
}

function ascendGangMembers(ns: NS, gangMembers: GangMember[]): number {
    for (const gangMember of gangMembers) {
        const ascensionResult = ns.gang.getAscensionResult(gangMember.name);
        if ((ascensionResult !== undefined) && (ascensionResult.agi > ascensionFactor || ascensionResult.def > ascensionFactor || ascensionResult.dex > ascensionFactor || ascensionResult.str > ascensionFactor)) {
            // Ascend one eligible member at a time so the gang does not lose all trained stats in one update.
            ns.gang.ascendMember(gangMember.name);
            ns.print(`Ascending gang member ${gangMember.name}`);
            return Date.now() + ascensionCooldownMs;
        }
    }

    return Date.now();
}

async function assignGangMemberTasks(ns: NS, reducingWanted: boolean, focus: GangFocus): Promise<void> {
    for (const gangMember of getGangMembers(ns)) {
        assignGangMemberTask(ns, gangMember, reducingWanted, focus);
        // Wanted gain updates after each assignment, so wait before deciding the next member's task.
        await ns.gang.nextUpdate();
    }
}

function assignGangMemberTask(ns: NS, gangMember: GangMember, reducingWanted: boolean, focus: GangFocus): void {
    // Attempt to keep a low wanted level.
    if (reducingWanted || ns.gang.getGangInformation().wantedPenalty < minWantedPenalty) {
        setGangMemberTask(ns, gangMember.name, GangTask.VigilanteJustice);
        return;
    }

    switch (focus) {
        case GangFocus.Respect:
            setGangMemberTask(ns, gangMember.name, GangTask.Terrorism);
            break;
        case GangFocus.TerritoryWarfare:
            setGangMemberTask(ns, gangMember.name, GangTask.TerritoryWarfare);
            break;
        default:
            setGangMemberTask(ns, gangMember.name, pickMoneyTask(gangMember));
    }
}

function pickMoneyTask(gangMember: GangMember): GangTask {
    const { str, def, dex, agi } = gangMember.info;
    const combatStats = str + def + dex + agi;

    for (const [threshold, task] of moneyTaskLadder) {
        if (combatStats < threshold) return task;
    }

    return GangTask.HumanTrafficking;
}
