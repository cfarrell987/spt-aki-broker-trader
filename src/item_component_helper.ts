import { ItemHelper } from "@spt-aki/helpers/ItemHelper";
import { IGlobals } from "@spt-aki/models/eft/common/IGlobals";
import { Item } from "@spt-aki/models/eft/common/tables/IItem";
import { ITemplateItem } from "@spt-aki/models/eft/common/tables/ITemplateItem";
import { ITrader } from "@spt-aki/models/eft/common/tables/ITrader";
import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { DependencyContainer } from "tsyringe";
import { Dictionary } from "tsyringe/dist/typings/types";

class ItemComponentHelper
{
    private container: DependencyContainer;

    private dbServer: DatabaseServer;
    private dbGlobals: IGlobals;
    private dbItems: Record<string, ITemplateItem>;
    private dbTraders: Record<string, ITrader>;
    private itemHelper: ItemHelper;

    constructor(container: DependencyContainer)
    {
        this.container = container;
        this.dbServer = container.resolve<DatabaseServer>(DatabaseServer.name);
        this.dbGlobals = this.dbServer.getTables().globals;
        this.dbItems = this.dbServer.getTables().templates.items;
        this.dbTraders = this.dbServer.getTables().traders;
        this.itemHelper = this.container.resolve<ItemHelper>(ItemHelper.name);
    }

    public getTemplateComponentMaxPoints(itemTplId: string, componentType: string): number
    {
        const props = this.getItemTemplate(itemTplId)._props;
        switch (componentType)
        {
            case ItemComponentTypes.REPAIRABLE:
                return props.MaxDurability;
            case ItemComponentTypes.KEY:
                return props.MaximumNumberOfUsage;
            case ItemComponentTypes.RESOURCE:
            case ItemComponentTypes.SIDE_EFFECT:
            case ItemComponentTypes.FOOD_DRINK:
                return props.MaxResource;
            case ItemComponentTypes.MEDKIT:
                return props.MaxHpResource;
            case ItemComponentTypes.REPAIRKIT:
                return props.MaxRepairResource;
            default:
                return null;
        }
    }
 
    public getItemComponentPoints(item: Item, componentType: string): ItemPointsData
    {
        let currentPoints = 0;
        let currentMaxPoints = 0;
        const originalMaxPoints = this.getTemplateComponentMaxPoints(item._tpl, componentType) ?? 0;
        switch (componentType)
        {
            // "Repairable" items use the same properties for durability
            case ItemComponentTypes.REPAIRABLE:
                // since not all descendants of baseclass might have durability/resource points
                // and also some items (e.g. just bought from flea) might have no "upd" property
                // so consider them brand new with full points.
                if (item.upd?.Repairable == undefined) 
                    currentPoints = currentMaxPoints = originalMaxPoints;
                else 
                {
                    currentPoints = item.upd.Repairable.Durability;
                    currentMaxPoints = item.upd.Repairable.MaxDurability;
                } 
                break;
            case ItemComponentTypes.BUFF:
                if (item.upd?.Buff == undefined)
                    currentPoints = currentMaxPoints = originalMaxPoints;
                else
                    currentPoints = item.upd.Buff.value;
                break;
            case ItemComponentTypes.DOGTAG:
                if (item.upd?.Dogtag == undefined)
                    currentPoints = currentMaxPoints = originalMaxPoints;
                else
                    currentPoints = item.upd.Dogtag.Level;
                break;
            case ItemComponentTypes.SIDE_EFFECT:
                if (item.upd?.SideEffect == undefined) 
                    currentPoints = currentMaxPoints = originalMaxPoints;
                else 
                    currentPoints = item.upd.SideEffect.Value;
                break;
            case ItemComponentTypes.FOOD_DRINK:
                if (item.upd?.FoodDrink == undefined) 
                    currentPoints = currentMaxPoints = originalMaxPoints;
                else
                    currentPoints = item.upd.FoodDrink.HpPercent; // not an actual percent, it's literally current resource value
                break;
            case ItemComponentTypes.MEDKIT:
                if (item.upd?.MedKit == undefined) 
                    currentPoints = currentMaxPoints = originalMaxPoints;
                else
                    currentPoints = item.upd.MedKit.HpResource;
                break;
            case ItemComponentTypes.RESOURCE:
                if (item.upd?.Resource == undefined) 
                    currentPoints = currentMaxPoints = originalMaxPoints;
                else
                    currentPoints = item.upd.Resource.Value;
                break;
            case ItemComponentTypes.KEY:
                if (item.upd?.Key == undefined)
                    currentPoints = currentMaxPoints = originalMaxPoints;
                else
                    currentPoints = originalMaxPoints - item.upd.Key.NumberOfUsages; // It's wacky, but for some reason NumberOfUsages = Actual Times Used
                break;
            case ItemComponentTypes.REPAIRKIT:
                if (item.upd?.RepairKit == undefined)
                    currentPoints = currentMaxPoints = originalMaxPoints;
                else
                    currentPoints = item.upd.RepairKit.Resource;
                break;
        }
        if (componentType !== ItemComponentTypes.REPAIRABLE) currentMaxPoints = originalMaxPoints; // if can't be repaired, current max point capacity doesn't change (food/meds/etc.)
        return {
            points: currentPoints || 1,
            maxPoints: currentMaxPoints || 1,
            templateMaxPoints: originalMaxPoints || 1
        }
    }
    
    public getRagfairItemComponentPoints(item: Item): ItemPointsData
    {
        return this.getItemComponentPoints(item, this.getItemRagfairComponentType(item));
    }

    /**
     * For Items
     * @param item 
     * @param componentType 
     * @returns 
     */
    public hasComponent(item: Item, componentType: string): boolean
    {
        return this.getItemComponentTypes(item).includes(componentType);
    }

    /**
     * For Item Templates
     * @param itemTplId 
     * @param componentType 
     * @returns 
     */
    public hasTemplateComponent(itemTplId: string, componentType: string): boolean
    {
        return this.getTemplateComponentTypes(itemTplId).includes(componentType);
    }

    public getItemComponentTypes(item: Item): string[]
    {
        const components = this.getTemplateComponentTypes(item._tpl);
        // "Buff" is the only component that can't be checked by Template
        if (item.upd?.Buff != undefined)
        {
            components.push(ItemComponentTypes.BUFF);
        }
        return components;
    }

    // Needed only to preserve current ragfair pricing implementation
    public getItemRagfairComponentType(item: Item): string
    {
        return this.getTemplateComponentTypes(item._tpl).find(componentType => Object.keys(RagfairItemComponentTypes).some(key => RagfairItemComponentTypes[key] === componentType));
    }

    public getTemplateComponentTypes(itemTplId: string): string[]
    {
        const props = this.getItemTemplate(itemTplId)._props;
        const components = [];

        // Some components have the same property names, so isOfBaseClass check provided where needed

        // Repairable
        if (this.allNotNull([props.Durability, props.MaxDurability]))
            components.push(ItemComponentTypes.REPAIRABLE);
        // Dogtag
        if (this.isDogtagTplId(itemTplId))
            components.push(ItemComponentTypes.DOGTAG);
        // Key
        if (props.MaximumNumberOfUsage != null)
            components.push(ItemComponentTypes.KEY);
        // Resource
        if (this.allNotNull([props.Resource, props.MaxResource]) && this.itemHelper.isOfBaseclass(itemTplId, ClassesWithPoints.BARTER_ITEM))
            components.push(ItemComponentTypes.RESOURCE);
        // Side Effect
        if (this.allNotNull([props.MaxResource, props.StimulatorBuffs]))
            components.push(ItemComponentTypes.SIDE_EFFECT);
        // Medkit
        if (this.itemHelper.isOfBaseclass(itemTplId, ClassesWithPoints.MEDS))
            components.push(ItemComponentTypes.MEDKIT)
        // Food Drink
        if (props.MaxResource != null && this.itemHelper.isOfBaseclass(itemTplId, ClassesWithPoints.FOOD_DRINK))
            components.push(ItemComponentTypes.FOOD_DRINK);
        // Repair kit
        if (this.allNotNull([props.MaxRepairResource /*, props.RepairCost, props.RepairQuality, props.RepairType*/]) && this.itemHelper.isOfBaseclass(itemTplId, ClassesWithPoints.REPAIR_KITS))
            components.push(ItemComponentTypes.REPAIRKIT);

        return components;
    }

    public isDogtagTplId(itemTplId: string): boolean
    {
        // BEAR DOGTAG - "59f32bb586f774757e1e8442"
        // USEC DOGTAG - "59f32c3b86f77472a31742f0"
        return itemTplId === "59f32bb586f774757e1e8442" || itemTplId === "59f32c3b86f77472a31742f0";
    }

    private getItemTemplate(itemTplId: string): ITemplateItem
    {
        const itemTpl = this.dbItems[itemTplId]
        if (itemTpl == undefined) throw (`ItemComponentHelper | Couldn't find item template with id ${itemTplId}!`);
        return itemTpl;
    }

    private allNotNull(values: any[]): boolean
    {
        return !values.some(value => value == undefined);
    }

    private get componentsProperties(): Dictionary<ItemComponentProperties>
    {
        const compProps = {};
        compProps[ItemComponentTypes.REPAIRABLE] = {
            template: [
                "MaxDurability"
            ],
            upd: [
                "Durability",
                "MaxDurability"
            ]
        }
        compProps[ItemComponentTypes.BUFF] = {
            template: [
            ],
            upd: [
                "rarity",
                "buffType",
                "value",
                "thresholdDurability"
            ]
        }
        compProps[ItemComponentTypes.DOGTAG] = {
            template: [
            ],
            upd: [
                // "AccountId",
                // "ProfileId",
                // "Nickname",
                // "Side",
                "Level" // only level is needed for price calculations
                // "Time",
                // "Status",
                // "KillerAccountId",
                // "KillerProfileId",
                // "KillerName",
                // "WeaponName"
            ]
        }
        compProps[ItemComponentTypes.KEY] = {
            template: [
                "MaximumNumberOfUsage"
            ],
            upd: [
                "NumberOfUsages"
            ]
        }
        compProps[ItemComponentTypes.RESOURCE] = {
            template: [
                "Resource",
                "MaxResource"
            ],
            upd: [
                "Value",
                "UnitsConsumed"
            ]
        }
        compProps[ItemComponentTypes.SIDE_EFFECT] = {
            template: [
                "StimulatorBuffs",
                "MaxResource"
            ],
            upd: [
                "Value"
            ]
        }
        compProps[ItemComponentTypes.MEDKIT] = {
            template: [
                "MaxHpResource"
            ],
            upd: [
                "HpResource"
            ]
        }
        compProps[ItemComponentTypes.FOOD_DRINK] = {
            template: [
                "MaxResource"
            ],
            upd: [
                "HpPercent"
            ]
        }
        compProps[ItemComponentTypes.REPAIRKIT] = {
            template: [
                "MaxRepairResource"
            ],
            upd: [
                "Resource"
            ]
        }
        return compProps;
    }
}

interface ItemPointsData
{
    points: number;
    maxPoints: number;
    templateMaxPoints: number;
}

interface ItemComponentProperties 
{
    template: string[];
    upd: string[];
}

// All component type which matter for trader price calculation
// And tax calculation.
enum ItemComponentTypes
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
enum RagfairItemComponentTypes
    {
    REPAIRABLE = "Repairable",
    KEY = "Key",
    RESOURCE = "Resource",
    MEDKIT = "MedKit",
    FOOD_DRINK = "FoodDrink",
    REPAIRKIT = "RepairKit"
}

enum ClassesWithPoints 
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

export {ItemComponentHelper, ItemPointsData, ItemComponentTypes, RagfairItemComponentTypes, ClassesWithPoints}