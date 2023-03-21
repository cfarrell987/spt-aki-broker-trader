import { HandbookHelper } from "@spt-aki/helpers/HandbookHelper";
import { ItemHelper } from "@spt-aki/helpers/ItemHelper";
import { RagfairServerHelper } from "@spt-aki/helpers/RagfairServerHelper";
import { IPmcData } from "@spt-aki/models/eft/common/IPmcData";
import { IHandbookBase } from "@spt-aki/models/eft/common/tables/IHandbookBase";
import { ITemplateItem } from "@spt-aki/models/eft/common/tables/ITemplateItem";
import { IItemBuyData, ITrader } from "@spt-aki/models/eft/common/tables/ITrader";
import { IProcessSellTradeRequestData, Item as SellDataItem } from "@spt-aki/models/eft/trade/IProcessSellTradeRequestData";
import { Traders } from "@spt-aki/models/enums/Traders"
import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { ItemBaseClassService } from "@spt-aki/services/ItemBaseClassService";
import { DependencyContainer } from "tsyringe";
import { Item, Upd } from "@spt-aki/models/eft/common/tables/IItem";
import { RagfairPriceService } from "@spt-aki/services/RagfairPriceService";
import { RagfairTaxHelper } from "@spt-aki/helpers/RagfairTaxHelper";
import { RagfairOfferService } from "@spt-aki/services/RagfairOfferService";

import baseJson from "../db/base.json";


class BrokerPriceManager 
{
    private static _instance: BrokerPriceManager;

    private container: DependencyContainer;

    private handbook: IHandbookBase;
    private handbookHelper: HandbookHelper; // Using with hydrateLookup() might be good to check if items exist in handbook and find their ragfair avg price
    private itemHelper: ItemHelper;
    private itemBaseClassService: ItemBaseClassService;
    private ragfairServerHelper: RagfairServerHelper; // Mb remove in the future
    private ragfairPriceService: RagfairPriceService;
    private ragfairTaxHelper: RagfairTaxHelper;
    private ragfairOfferService: RagfairOfferService;

    private brokerTraderId = baseJson._id;
    
    private dbServer: DatabaseServer;
    private dbItems: Record<string, ITemplateItem>; // Might replace with ItemHelper.getItems() since I don't write anything into the database
    private dbTraders: Record<string, ITrader>;
    public supportedTraders: Record<string, string>;

    private tradersMetaData: TradersMetaData;
    private _itemTraderTable: Record<string, TraderBaseData>; // used as a cache, contains: itemTplId => Most Profitable Trader TraderBaseData
    private _itemRagfairPriceTable: Record<string, ItemRagfairPrice>; // used as a cache, contains itemTplId => avg price, price per point(of durability/resource), tax, tax per point

    private constructor(container: DependencyContainer)
    {
        this.container = container;

        this.itemHelper = container.resolve<ItemHelper>("ItemHelper");
        this.handbookHelper = container.resolve<HandbookHelper>("HandbookHelper");
        this.itemBaseClassService = container.resolve<ItemBaseClassService>("ItemBaseClassService");
        this.ragfairServerHelper = container.resolve<RagfairServerHelper>("RagfairServerHelper");
        this.ragfairPriceService = container.resolve<RagfairPriceService>("RagfairPriceService");
        this.ragfairTaxHelper = container.resolve<RagfairTaxHelper>("RagfairTaxHelper");
        this.ragfairOfferService = container.resolve<RagfairOfferService>("RagfairOfferService");

        this.dbServer = container.resolve<DatabaseServer>("DatabaseServer");
        this.handbook = this.dbServer.getTables().templates.handbook;
        this.dbItems = this.dbServer.getTables().templates.items;
        this.dbTraders = this.dbServer.getTables().traders;
        this.supportedTraders = Object.keys(Traders).filter(key => Traders[key] !== Traders.LIGHTHOUSEKEEPER).reduce((accum, key) => 
        {
            accum[key] = Traders[key];
            return accum;
        }, {});
        console.log(`SUPPORTED TRADERS DUMP: ${JSON.stringify(this.supportedTraders)}`);

        // Generate tables after all dependencies are resolved.
        this.tradersMetaData = this.getTradersMetaData();
        this._itemTraderTable = this.getItemTraderTable();
        this._itemRagfairPriceTable = this.getFreshItemRagfairPriceTable();
    }

    public static getInstance(container: DependencyContainer): BrokerPriceManager
    {
        if (!this._instance)
        {
            BrokerPriceManager._instance = new BrokerPriceManager(container);
        }
        return this._instance;
    }

    public get itemTraderTable(): Record<string, TraderBaseData>
    {
        return this._itemTraderTable;
    }

    public get itemRagfairPriceTable(): Record<string, ItemRagfairPrice>
    {
        return this._itemRagfairPriceTable;
    }

    public getItemTraderTable(): Record<string, TraderBaseData>
    {
        // Also check if item exists in handbook to be sure that it's a valid item.
        return Object.keys(this.dbItems).filter(itemTplId => this.itemHelper.isValidItem(itemTplId) && this.existsInHandbook(itemTplId)).reduce((accum, itemTplId) => 
        {
            accum[itemTplId] = this.getBestTraderForItemTpl(itemTplId);
            return accum;
        }, {});
    }

    public getFreshItemRagfairPriceTable(): Record<string, ItemRagfairPrice>
    {
        const validRagfairItemTpls = Object.values(this.dbItems).filter(itemTpl => this.ragfairServerHelper.isItemValidRagfairItem([true, itemTpl]));
        return validRagfairItemTpls.reduce((accum, itemTpl) => 
        {
            accum[itemTpl._id] = this.getFreshItemTplRagfairPrice(itemTpl._id);
            return accum;
        }, {});
    }

    private getTradersMetaData(): TradersMetaData
    {
        const data: TradersMetaData = {};
        for (const traderName in this.supportedTraders)
        {
            const traderId = this.supportedTraders[traderName];
            const traderCoef = this.dbTraders[traderId].base.loyaltyLevels[0].buy_price_coef;
            const itemsBuy = this.dbTraders[traderId].base.items_buy;
            const itemsBuyProhibited = this.dbTraders[traderId].base.items_buy_prohibited;
            data[traderId] = {
                id: traderId,
                name: traderName,
                itemsBuy: itemsBuy,
                itemsBuyProhibited: itemsBuyProhibited,
                buyPriceCoef: traderCoef
            };
        }
        // Manually add Broker's Meta Data
        // Only used as a sort of "sell to flea" flag
        data[baseJson._id] = {
            id: baseJson._id,
            name: baseJson.name,
            itemsBuy: {category: [], id_list: []},
            itemsBuyProhibited: {category: [], id_list: []},
            buyPriceCoef: Infinity // to make sure it's never selected as the most profitable trader
        }
        return data;
    }

    public canBeBoughtByTrader(itemTplId: string, traderId: string ): boolean
    {
        const traderMetaData = this.tradersMetaData[traderId];
        const item = this.dbItems[itemTplId];
        // Might use itemBaseClassService but right now seems unnecessary
        // Also a very good option is itemHelpes.isOfBaseClass, check for every category (category.some()).
        const buysItem = traderMetaData.itemsBuy.category.some(categoryId => this.itemHelper.isOfBaseclass(itemTplId, categoryId)) || traderMetaData.itemsBuy.id_list.includes(itemTplId);
        const notProhibited = !traderMetaData.itemsBuyProhibited.category.some(categoryId => this.itemHelper.isOfBaseclass(itemTplId, categoryId)) && !traderMetaData.itemsBuyProhibited.id_list.includes(itemTplId);
        return buysItem && notProhibited;
    }

    public getBestTraderForItemTpl(itemTplId: string): TraderBaseData
    {
        const sellableTraders = Object.values(this.tradersMetaData).filter(traderMeta => this.canBeBoughtByTrader(itemTplId, traderMeta.id));
        if (sellableTraders.length < 1) return null; // If no traders can buy this item return NULL
        // the lower the coef the more money you'll get
        const lowestCoef = Math.min(...sellableTraders.map(trader => trader.buyPriceCoef));
        return sellableTraders.find(trader => trader.buyPriceCoef === lowestCoef);
    }

    public getBestTraderForItem(item: Item): TraderBaseData
    {
        const pointsData = this.getItemPointsData(item);
        // Preserve game balance, by checking if item is Repairable and should be sold to Fence.
        // Even if for some reason Fence doesn't buy this item category(probably shouldn't even be possible)
        // it will be force sold to him anyway
        return pointsData.currentMaxPoints < pointsData.OriginalMaxPoints * 0.6 && this.isOfRepairableBaseClass(item._tpl)
            ? this.tradersMetaData[Traders.FENCE]
            : this.getBestTraderForItemTpl(item._tpl);
    }

    public getBestSellDesicionForItem(pmcData: IPmcData, item: Item): SellDecision
    {
        const bestTrader = this.getBestTraderForItem(item);
        const traderPrice = this.getItemTraderPrice(item, bestTrader.id, pmcData);
        const ragfairPrice = this.getItemRagfairPrice(item, pmcData);  
        console.log(`[traderPrice] ${traderPrice}`);      
        console.log(`[ragfairPrice] ${ragfairPrice}`);      
        if (ragfairPrice > traderPrice && this.canSellOnFlea(item) && this.playerCanUseFlea(pmcData))
        {
            return {
                traderId: this.brokerTraderId,
                price: ragfairPrice,
                tax: this.ragfairTaxHelper.calculateTax(item, pmcData, ragfairPrice, this.getItemStackObjectsCount(item), true) // not exactly precise, but no other choice
            };
        }
        return {
            traderId: bestTrader.id,
            price: traderPrice
        };
    }

    public getItemPointsData(item: Item): ItemPointsData
    {
        // Check if item is descendant of any class that have points(durability/resource)
        const itemBaseClassWithPointsId = Object.values(BaseClassesWithPoints).find(baseClassId => this.itemHelper.isOfBaseclass(item._tpl, baseClassId));
        const itemTpl = this.dbItems[item._tpl];
        let currentPoints = 1;
        let currentMaxPoints = 1;
        let originalMaxPoints = 1;
        switch (itemBaseClassWithPointsId)
        {
            case BaseClassesWithPoints.ARMORED_EQUIPMENT: // Armored_Equipment and Weapon use the same properties for durability
            case BaseClassesWithPoints.WEAPON:{
                originalMaxPoints = itemTpl._props.MaxDurability;
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
            }
            case BaseClassesWithPoints.FOOD_DRINK:{
                originalMaxPoints = itemTpl._props.MaxResource;
                if (item.upd?.FoodDrink == undefined) 
                    currentPoints = currentMaxPoints = originalMaxPoints;
                else
                    currentPoints = item.upd.FoodDrink.HpPercent; // not an actual percent, it's literally current resource value
                break;
            }
            case BaseClassesWithPoints.MEDS:{
                originalMaxPoints = itemTpl._props.MaxHpResource;
                if (item.upd?.MedKit == undefined) 
                    currentPoints = currentMaxPoints = originalMaxPoints;
                else
                    currentPoints = item.upd.MedKit.HpResource;
                break;
            }
            case BaseClassesWithPoints.BARTER_ITEM:{
                originalMaxPoints = itemTpl._props.MaxResource;
                if (item.upd?.Resource == undefined) 
                    currentPoints = currentMaxPoints = originalMaxPoints;
                else
                    currentPoints = item.upd.Resource.Value;
                break;
            }
        }
        if (item.upd?.Repairable == undefined) currentMaxPoints = originalMaxPoints; // if can't be repaired, current max point capacity doesn't change (food/meds/etc.)
        return {
            // Check if values are not falsey, since by default 
            // some items with no resource points can assign a 0 
            // and it will make the price in latter calculations become null
            currentPoints: currentPoints || 1,
            currentMaxPoints: currentMaxPoints || 1,
            OriginalMaxPoints: originalMaxPoints || 1
        };
    }

    /**
     * @deprecated Not implemented.
     * @param itemId 
     * @returns 
     */
    protected getItemPointsDataById(itemId: string): ItemPointsData
    {
        return undefined;
    }

    /**
     * @deprecated Not implemented.
     * @param itemId 
     * @returns 
     */
    protected getOriginalMaxPointsByTplId(itemTplId: string): number
    {
        return undefined;
    }

    public canSellOnFlea(item: Item): boolean
    {
        // const itemTpl = this.itemHelper.getItem(item._tpl)[1]; - keep it here if I move to itemHelper later
        const itemTpl = this.dbItems[item._tpl];
        // The first boolean param seems to refer to "spawnedInSession"(found in raid)
        return this.ragfairServerHelper.isItemValidRagfairItem([item.upd?.SpawnedInSession ?? false, itemTpl]);
    }

    // Or use handbookHelper.getTemplatePrice
    public existsInHandbook(itemTplId: string): boolean
    {
        // return this.handbookHelper.getTemplatePrice(itemTplId) !== 1;
        return this.handbook.Items.findIndex(hbkItem => hbkItem.Id === itemTplId) > -1;
    }

    /**
     * Checks if user level fits the flea requirement.
     * @param pmcData PMC profile data
     * @returns true | false. Does user have the level to use flea?
     */
    public playerCanUseFlea(pmcData: IPmcData): boolean
    {
        return pmcData.Info.Level >= this.dbServer.getTables().globals.config.RagFair.minUserLevel;
    }

    // inventory items are required to check for "item.upd.spawnedInSession"
    // so you'd have to pass either pmcData and look for items there or inventory items themselves
    public processSellDataForMostProfit(pmcData: IPmcData, sellData: IProcessSellTradeRequestData): Record<string, IProcessSellTradeRequestData>
    {
        const sellDataItems = sellData.items;
        return sellDataItems.reduce((accum, curr) => 
        {
            const inventoryItem = this.getItemFromInventoryById(curr.id, pmcData);
            const sellDesicion = this.getBestSellDesicionForItem(pmcData, inventoryItem);
            const groupBy = sellDesicion.traderId;
            if (accum[groupBy] == undefined)
            {
                accum[groupBy] = {
                    Action: sellData.Action,
                    items: [curr],
                    price: sellDesicion.price - (sellDesicion.tax ?? 0),
                    tid: groupBy,
                    type: sellData.type
                };
            }
            else 
            {
                accum[groupBy].items.push(curr);
                accum[groupBy].price += sellDesicion.price - (sellDesicion.tax ?? 0);
            }
            return accum;
        }, {} as Record<string, IProcessSellTradeRequestData>);
    }

    /**
     * Calculates the sell price of an item template for a specific trader.
     * @param itemTplId Item Template Id.
     * @param traderId Trader Id.
     * @returns number - price of selling the item template to trader.
     */
    public getItemTplTraderPrice(itemTplId: string, traderId: string): number
    {
        const traderMeta = this.tradersMetaData[traderId];
        const buyPriceMult = 1 - traderMeta.buyPriceCoef/100;
        const basePrice = this.handbookHelper.getTemplatePrice(itemTplId); // this.ragfairPriceService.getStaticPriceForItem - can be used instead
        return Math.round(basePrice * buyPriceMult);
    }

    /**
     * Calculates the sell price of an inventory item for a specific trader.
     * For an inventory item durability/resource points are accounted for.
     * @param itemTplId Item Template Id.
     * @param traderId Trader Id.
     * @returns number - price of selling the item to trader.
     */
    public getSingleItemTraderPrice(item: Item, traderId: string): number
    {
        const tplPrice = this.getItemTplTraderPrice(item._tpl, traderId);
        const pointsData = this.getItemPointsData(item);
        console.log(`[tplPrice] ${JSON.stringify(tplPrice)}`);
        console.log(`[pointsData] ${JSON.stringify(pointsData)}`);
        return this.isOfRepairableBaseClass(item._tpl) 
            // for repairable items approximate based on current Max Durability
            // although it won't account for current durability, game balance impact should be negligible.
            ? Math.round(tplPrice / pointsData.OriginalMaxPoints * pointsData.currentMaxPoints) * this.getItemStackObjectsCount(item)
            // for others(food/drink/meds) calculate based on currentPoints - seeems 100% accurate.
            // if item doesn't have points (stims/barter items) maxPoints and currentPoints will = 1
            : Math.round(tplPrice / pointsData.OriginalMaxPoints * pointsData.currentPoints) * this.getItemStackObjectsCount(item); 
    }

    public getItemTraderPrice(item: Item, traderId: string, pmcData: IPmcData): number
    {
        const itemAndChildren = this.itemHelper.findAndReturnChildrenAsItems(pmcData.Inventory.items, item._id);
        console.log(`[itemAndChildren] ${JSON.stringify(itemAndChildren)}`);
        return itemAndChildren.reduce((accum, curr) => accum + this.getSingleItemTraderPrice(curr, traderId), 0);
    }

    /**
     * Gets ragfair avg and perPoint price for template, accesses the cached price table.
     * @param itemTplId Item Template Id.
     * @returns ItemRagFairCosts - flea tax and average flea price.
     */
    public getItemTplRagfairPrice(itemTplId: string): ItemRagfairPrice
    {
        return this._itemRagfairPriceTable[itemTplId] ?? {
            avgPrice: 0,
            pricePerPoint: 0
        };
    }

    /**
     * Calculate a fresh item template ragfair price. Should be used only once, to generate ragfair price table.
     * 
     * but...
     * 
     * Can be used to always keep item prices up to date, but it's usage wouldn't make sense,
     * because it's more performance intensive and you could for example buy off all specific 
     * item offers and the received price would be based off Static or Dynamic price, which is
     * less accurate that an actual average price based on existing offers.
     * @param itemTplId Item Template Id.
     * @returns ItemRagfairPrice with avg and perPoint price.
     */
    protected getFreshItemTplRagfairPrice(itemTplId: string): ItemRagfairPrice
    {
        let itemOrigMaxPts = 1;
        // Collect offers with at least 85% durability/resource (if item has no points properties - its valid) and no sellInOnePiece
        // no sellInOnePiece is important - fully operational weapons with mods are sold with sellInOnePiece = true, here we need individual items only.
        const validOffersForItemTpl = this.ragfairOfferService.getOffersOfType(itemTplId)?.filter(offer => 
        {         
            const firstItem = offer.items[0];
            const pointsData = this.getItemPointsData(firstItem);
            itemOrigMaxPts = pointsData.OriginalMaxPoints;
            const originalMaxPtsBoundary = pointsData.OriginalMaxPoints * 0.85; // 85% of max capacity
            const hasMoreThan85PercentPoints = pointsData.currentPoints >= originalMaxPtsBoundary && pointsData.currentMaxPoints >= originalMaxPtsBoundary;
            return !offer.sellInOnePiece && hasMoreThan85PercentPoints;
        });
            // Some items might have no offers on flea (some event stuff, e.g. jack-o-lantern) so getOffersOfType will return "undefined"
        const avgPrice = validOffersForItemTpl != undefined 
            ? validOffersForItemTpl.map(offer => offer.requirementsCost).reduce((accum, curr) => accum+curr, 0) / validOffersForItemTpl.length
            //Get the bigger price, either static or dynamic. Makes sense most of the time to approximate actual flea price when you have no existing offers.
            // getDynamicPriceForItem might return "undefined" for some reason, so check for it (getStaticPriceForItem too just in case)
            : Math.max(this.ragfairPriceService.getStaticPriceForItem(itemTplId) ?? 0, this.ragfairPriceService.getDynamicPriceForItem(itemTplId) ?? 0);
        // if (itemTplId === "5e8488fa988a8701445df1e4")
        // {
        //     console.log(`[getItemPointsData] ${JSON.stringify(this.getItemPointsData(validOffersForItemTpl[0].items[0]))}`)
        //     console.log(`[itemOrigMaxPts] ${JSON.stringify(itemOrigMaxPts)}`)
        //     console.log(`[validOffersForItemTpl] ${JSON.stringify(avgPrice)}`)
        // }
        return {
            avgPrice: Math.round(avgPrice),
            pricePerPoint: Math.round(avgPrice / itemOrigMaxPts)
        };
    }

    public getSingleItemRagfairPrice(item: Item): number
    {
        const pointsData = this.getItemPointsData(item);
        // Round, since weapon or armor durability can be float, etc.
        // console.log(`[POINTS DATA] ${JSON.stringify(pointsData)}`);
        // console.log(`[RAGFAIR PRICE DATA] ${JSON.stringify(this.getItemTplRagfairPrice(item._tpl))}`);
        // console.log(`[GET STACK OBJECT COUNT DATA] ${JSON.stringify(this.getItemStackObjectsCount(item))}`);
        return Math.round(pointsData.currentPoints * this.getItemTplRagfairPrice(item._tpl).pricePerPoint) * this.getItemStackObjectsCount(item);
    }

    public getItemRagfairPrice(item: Item, pmcData: IPmcData): number
    {
        const itemAndChildren = this.itemHelper.findAndReturnChildrenAsItems(pmcData.Inventory.items, item._id);
        return itemAndChildren.reduce((accum, curr) => accum + this.getSingleItemRagfairPrice(curr), 0);
    }

    public getItemFromInventoryById(itemId: string, pmcData: IPmcData): Item
    {
        return pmcData.Inventory.items.find(item => item._id === itemId);
    }

    public isOfRepairableBaseClass(itemTplId: string): boolean
    {
        return [BaseClassesWithPoints.ARMORED_EQUIPMENT, BaseClassesWithPoints.WEAPON].some(baseClassId => this.itemHelper.isOfBaseclass(itemTplId, baseClassId));
    }

    public getItemStackObjectsCount(item: Item): number
    {
        return item.upd?.StackObjectsCount ?? 1;
    }

    // public getItemRagfairTax(item: Item, pmcData: IPmcData, requirementsValue: number, offerItemCount: number, sellInOnePiece: boolean): number{
    //     return this.ragfairTaxHelper.calculateTax(item, pmcData, requirementsValue, offerItemCount, sellInOnePiece);
    // }
}

interface SellDecision 
{
    // trader: TraderBaseData; unnecessary
    traderId: string;
    price: number;
    tax?: number;
}
interface TraderBaseData
{
    id: string;
    name: string;
    itemsBuy: IItemBuyData;
    itemsBuyProhibited: IItemBuyData;
    buyPriceCoef: number;
}

interface TradersMetaData 
{
    [traderId: string]: TraderBaseData
}

enum BaseClassesWithPoints 
    {
    ARMORED_EQUIPMENT = "57bef4c42459772e8d35a53b",
    MEDS = "543be5664bdc2dd4348b4569",
    FOOD_DRINK = "543be6674bdc2df1348b4569",
    WEAPON = "5422acb9af1c889c16000029",
    BARTER_ITEM = "5448eb774bdc2d0a728b4567"
    // fuel cans, water/air fiters in spt-aki, at least as of 3.5.3
    // inside the flea offer don't seem to contain the "item.upd.Resource" property
    // so it resource points seem unaccounted for. And also all offers with them are 100% condition.
    // But when calculating trader sell prices it needs to be accounted for.
}

/**
 * Avg and per point prices 
 */
interface ItemRagfairPrice
{
    avgPrice: number;
    pricePerPoint: number;
}

/**
 * Item data with durability/resource points
 */
interface ItemPointsData
{
    currentPoints: number;
    currentMaxPoints: number;
    OriginalMaxPoints: number;
}

// Data used to process several sell requests
interface TradersSellData
{
    [traderId: string]:{
        traderId: string;
        traderName: string;
        sellData: IProcessSellTradeRequestData;
    }
}

// Data used to process the one big ragfair sell request REMAKE TO FIT TRADER
interface RagfairSellData
{
    [itemId: string]:{
        itemId: string;
        itemTplId: string;
        item: Item;
        sellDataItem: SellDataItem;
    }
}

export {BrokerPriceManager}