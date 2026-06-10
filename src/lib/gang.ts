import { NS } from "@ns";

export enum GangTask {
    TrainCombat = "Train Combat",
    VigilanteJustice = "Vigilante Justice",
    Terrorism = "Terrorism",
    MugPeople = "Mug People",
    StrongarmCivilians = "Strongarm Civilians",
    TraffickIllegalArms = "Traffick Illegal Arms",
    HumanTrafficking = "Human Trafficking",
    TerritoryWarfare = "Territory Warfare"
}

export enum GangEquipmentType {
    Weapon = "Weapon",
    Armor = "Armor",
    Vehicle = "Vehicle",
    Augmentation = "Augmentation",
}

export enum GangFocus {
    Auto = "auto",
    Respect = "respect",
    Money = "money",
    TerritoryWarfare = "territory warfare",
}

export const combatEquipmentTypes = [
    GangEquipmentType.Weapon,
    GangEquipmentType.Armor,
    GangEquipmentType.Vehicle,
    GangEquipmentType.Augmentation,
] as const;

export interface GangEquipment {
    name: string;
    type: string;
    cost: number;
}

export interface GangMember {
    name: string;
    info: ReturnType<NS["gang"]["getMemberInformation"]>;
}

export function isCombatEquipmentType(equipmentType: string): equipmentType is typeof combatEquipmentTypes[number] {
    return (combatEquipmentTypes as readonly string[]).includes(equipmentType);
}

export function getGangEquipment(ns: NS): GangEquipment[] {
    return ns.gang.getEquipmentNames().map((name) => ({
        name,
        type: ns.gang.getEquipmentType(name),
        cost: ns.gang.getEquipmentCost(name),
    }));
}

export function getGangMembers(ns: NS): GangMember[] {
    return ns.gang.getMemberNames().map((name) => ({
        name,
        info: ns.gang.getMemberInformation(name),
    }));
}

/** Parse a --focus flag value; null when unrecognized so callers can reject typos loudly. */
export function parseGangFocus(value: unknown): GangFocus | null {
    const normalized = String(value).trim().toLowerCase();

    switch (normalized) {
        case GangFocus.Respect:
            return GangFocus.Respect;
        case GangFocus.Money:
            return GangFocus.Money;
        case GangFocus.TerritoryWarfare:
        case "territory":
        case "warfare":
            return GangFocus.TerritoryWarfare;
        case GangFocus.Auto:
            return GangFocus.Auto;
        default:
            return null;
    }
}

export function setGangMemberTask(ns: NS, gangMember: string, task: GangTask): boolean {
    return ns.gang.setMemberTask(gangMember, task);
}

const recruitNames = [
    "Emma", "Maria", "Olivia", "Sophia", "Charlotte", "Amelia",
    "Mia", "Isabella", "Evelyn", "Sofia", "Eliana", "Ava",
    "Camila", "Luna", "Harper", "Eleanor", "Violet", "Aurora",
    "Elizabeth", "Hazel", "Chloe", "Ellie", "Nora", "Gianna",
    "Lily", "Emily", "Aria", "Scarlett", "Penelope", "Zoe",
];

/** First unused name from the pool, or a numbered fallback once the pool runs dry. */
export function getNextRecruitName(ns: NS): string {
    const existing = ns.gang.getMemberNames();
    return recruitNames.find((name) => !existing.includes(name))
        ?? `GangMember${existing.length + 1}`;
}

/** True when the gang is at its size cap (no amount of respect unlocks another recruit). */
export function isGangFull(ns: NS): boolean {
    return ns.gang.respectForNextRecruit() === Infinity;
}
