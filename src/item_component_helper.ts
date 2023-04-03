import { ItemHelper } from "@spt-aki/helpers/ItemHelper";
import { IGlobals } from "@spt-aki/models/eft/common/IGlobals";
import { Item } from "@spt-aki/models/eft/common/tables/IItem";
import { ITemplateItem } from "@spt-aki/models/eft/common/tables/ITemplateItem";
import { ITrader } from "@spt-aki/models/eft/common/tables/ITrader";
import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { DependencyContainer } from "tsyringe";
import { ItemComponentTypes, ItemPointsData, RagfairItemComponentTypes, ClassesWithPoints } from "./item_component_helper_types";

export class ItemComponentHelper
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

    /**
     * Return the max durability/resource/key usage/etc. points for a template and a desired component type.
     * Component type has to be specified since items can have multiple components assigned (E.g. cultist knife is both Repairable and Side Effect).
     * @param itemTplId Item template id
     * @param componentType Component type
     * @returns number - max points value
     */
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
 
    /**
     * Get item points data for a certain component type.
     * @param item Item
     * @param componentType Component type
     * @returns ItemPointsData - current points, current max points, template max points.
     */
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
    
    /**
     * Get item component points for ragfair. In current implementation to mirror the observed SPT-AKI flea behaviour,
     * items use only one component and their price is scaled only based on current durability.
     * @param item Item
     * @returns ItemPointsData
     */
    public getRagfairItemComponentPoints(item: Item): ItemPointsData
    {
        return this.getItemComponentPoints(item, this.getItemRagfairComponentType(item));
    }

    /**
     * Check if item has a component type assigned.
     * @param item Item
     * @param componentType Component type
     * @returns true | false
     */
    public hasComponent(item: Item, componentType: string): boolean
    {
        return this.getItemComponentTypes(item).includes(componentType);
    }

    /**
     * Check if item template has a component type assigned. 
     * Some component types can't be assigned to a brand new "template" item by default, e.g. Weapon/Armour Buff.
     * @param itemTplId 
     * @param componentType 
     * @returns 
     */
    public hasTemplateComponent(itemTplId: string, componentType: string): boolean
    {
        return this.getTemplateComponentTypes(itemTplId).includes(componentType);
    }

    /**
     * Get all component types which provided item currently has.
     * @param item Item
     * @returns string[] - all component types an item has
     */
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

    /**
     * Get ragfair specific item component type. (Due to current implementation)
     * @param item Item
     * @returns string - component type
     */
    // Needed only to preserve current ragfair pricing implementation
    public getItemRagfairComponentType(item: Item): string
    {
        return this.getTemplateComponentTypes(item._tpl).find(componentType => Object.keys(RagfairItemComponentTypes).some(key => RagfairItemComponentTypes[key] === componentType));
    }

    /**
     * Get all component types of an item template.
     * @param itemTplId Item template id
     * @returns string[]
     */
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

    /**
     * Check if item is a dogtag(seems to also be a component).
     * @param itemTplId Item template id
     * @returns true | false
     */
    public isDogtagTplId(itemTplId: string): boolean
    {
        // BEAR DOGTAG - "59f32bb586f774757e1e8442"
        // USEC DOGTAG - "59f32c3b86f77472a31742f0"
        return itemTplId === "59f32bb586f774757e1e8442" || itemTplId === "59f32c3b86f77472a31742f0";
    }

    /**
     * Get an item template from the database. Throws an exception if item not found.
     * @param itemTplId Item template id
     * @returns ITemplateItem
     */
    private getItemTemplate(itemTplId: string): ITemplateItem
    {
        const itemTpl = this.dbItems[itemTplId]
        if (itemTpl == undefined) throw (`ItemComponentHelper | Couldn't find item template with id ${itemTplId}!`);
        return itemTpl;
    }

    /**
     * Check if all of the provided values have an assigned value(not null|undefined).
     * @param values Array of values
     * @returns true | false
     */
    private allNotNull(values: any[]): boolean
    {
        return !values.some(value => value == undefined);
    }
}