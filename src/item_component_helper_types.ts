export interface ItemPointsData
{
    points: number;
    maxPoints: number;
    templateMaxPoints: number;
}

// All component type which matter for trader price calculation
// And tax calculation.
export enum ItemComponentTypes
    {
    REPAIRABLE = "Repairable",
    BUFF = "Buff",
    DOGTAG = "Dogtag",
    KEY = "Key",
    RESOURCE = "Resource",
    SIDE_EFFECT = "SideEffect",
    MEDKIT = "MedKit",
    FOOD_DRINK = "FoodDrink",
    REPAIRKIT = "RepairKit"
}

// Component types which matter for ragfair specifically.
// They are used when filtering ragfair offers to calculate template average price.
// Needed only to preserve current ragfair pricing implementation
export enum RagfairItemComponentTypes
    {
    REPAIRABLE = "Repairable",
    KEY = "Key",
    RESOURCE = "Resource",
    MEDKIT = "MedKit",
    FOOD_DRINK = "FoodDrink",
    REPAIRKIT = "RepairKit"
}

export enum ClassesWithPoints 
    {
    ARMORED_EQUIPMENT = "57bef4c42459772e8d35a53b",
    MEDS = "543be5664bdc2dd4348b4569",
    FOOD_DRINK = "543be6674bdc2df1348b4569",
    WEAPON = "5422acb9af1c889c16000029",
    KNIFE = "5447e1d04bdc2dff2f8b4567",
    // fuel cans, water/air fiters in spt-aki, at least as of 3.5.3
    // inside the flea offer don't seem to contain the "item.upd.Resource" property
    // so it resource points seem unaccounted for. And also all offers with them are 100% condition.
    // But when calculating trader sell prices it needs to be accounted for.
    BARTER_ITEM = "5448eb774bdc2d0a728b4567",
    KEY = "54009119af1c881c07000029",
    REPAIR_KITS = "616eb7aea207f41933308f46"
}