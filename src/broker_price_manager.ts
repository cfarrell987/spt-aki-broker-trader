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
    WEAPON = "5422acb9af1c889c16000029"
}

const ragfair = "RAGFAIR";

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
        this.tradersMetaData = this.getTradersMetaData();
        this._itemTraderTable = this.getItemTraderTable();
        this._itemRagfairPriceTable = this.getItemRagfairPriceTable();
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

    public getBestTraderForItem(itemTplId: string): TraderBaseData
    {
        const sellableTraders = Object.values(this.tradersMetaData).filter(traderMeta => this.canBeBoughtByTrader(itemTplId, traderMeta.id));
        if (sellableTraders.length < 1) return null; // If no traders can buy this item return NULL
        // the lower the coef the more money you'll get
        const lowestCoef = Math.min(...sellableTraders.map(trader => trader.buyPriceCoef));
        return sellableTraders.find(trader => trader.buyPriceCoef === lowestCoef);
    }

    public getItemTraderTable(): Record<string, TraderBaseData>
    {
        // Also check if item exists in handbook to be sure that it's a valid item.
        return Object.keys(this.dbItems).filter(itemTplId => this.itemHelper.isValidItem(itemTplId) && this.existsInHandbook(itemTplId)).reduce((accum, itemTplId) => 
        {
            accum[itemTplId] = this.getBestTraderForItem(itemTplId);
            return accum;
        }, {});
    }

    public getItemRagfairPriceTable(): Record<string, ItemRagfairPrice>
    {
        const validRagfairItemTpls = Object.values(this.dbItems).filter(itemTpl => this.ragfairServerHelper.isItemValidRagfairItem([true, itemTpl]));
        return validRagfairItemTpls.reduce((accum, itemTpl) => 
        {
            // Check if item is descendant of any class that have points(durability/resource)
            const itemBaseClassWithPointsId = Object.values(BaseClassesWithPoints).find(baseClassId => this.itemHelper.isOfBaseclass(itemTpl._id, baseClassId));
            let itemMaxPoints = 1; // other can be assigned while filtering below
            // Collect offers with at least 85% durability/resource (if item has no points properties - its valid) and no sellInOnePiece
            // no sellInOnePiece is important - fully operational weapons with mods are sold with sellInOnePiece = true, here we need individual items only.
            // Here 
            const validOffersForItemTpl = this.ragfairOfferService.getOffersOfType(itemTpl._id).filter(offer => 
            {         
                const firstItem = offer.items[0];
                let hasMoreThan85PercentPoints = true;
                switch (itemBaseClassWithPointsId)
                {
                    case BaseClassesWithPoints.ARMORED_EQUIPMENT: // Armored_Equipment and Weapon use the same properties for durability
                    case BaseClassesWithPoints.WEAPON:{
                        if (firstItem.upd.Repairable == undefined) break; // since not all descendants of baseclass have durability/resource points
                        const durability = firstItem.upd.Repairable.Durability;
                        const maxDurability = firstItem.upd.Repairable.MaxDurability;
                        const originalMaxDurability = itemMaxPoints = itemTpl._props.MaxDurability;
                        hasMoreThan85PercentPoints = durability >= Math.round(originalMaxDurability * 0.85) && maxDurability >= Math.round(originalMaxDurability * 0.85);
                        break;
                    }
                    case BaseClassesWithPoints.FOOD_DRINK:{
                        if (firstItem.upd.FoodDrink == undefined) break;
                        const resource = firstItem.upd.FoodDrink.HpPercent; // not an actual percent, it's literally current resource value
                        const originalMaxResource = itemMaxPoints = itemTpl._props.MaxResource;
                        hasMoreThan85PercentPoints = resource >= Math.round(originalMaxResource * 0.85);
                        break;
                    }
                    case BaseClassesWithPoints.MEDS:{
                        if (firstItem.upd.MedKit == undefined) break;
                        const hpResource = firstItem.upd.MedKit.HpResource;
                        const originalMaxHpResource = itemMaxPoints = itemTpl._props.MaxHpResource;
                        hasMoreThan85PercentPoints = hpResource >= Math.round(originalMaxHpResource * 0.85);
                        break;
                    }
                }
                return !offer.sellInOnePiece && hasMoreThan85PercentPoints;
            });
            const avgPrice = validOffersForItemTpl.map(offer => offer.requirementsCost).reduce((accum, curr) => accum+curr, 0) / validOffersForItemTpl.length;
            // const avgTax = this.ragfairTaxHelper.calculateTax() - Don't calculate Tax in ItemRagfairCosts
            // since too many factors have to be counted in
            // E.g.: item durability/resource, total user tax reduction from hideout intelligence, hideout management skill affecting intel bonus, etc.
            accum[itemTpl._id] = {
                avgPrice: avgPrice,
                pricePerPoint: avgPrice / itemMaxPoints
            } as ItemRagfairPrice;
            return accum;
        }, {});
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
    public processSellDataForBestProfit(sellData: IProcessSellTradeRequestData, inventoryItems: Item[]): [TradersSellData, RagfairSellData]
    {
        // IMPLEMENT
        return;
    }

    /**
     * Calculates the sell price of an item template for a specific trader.
     * @param itemTplId Item Template Id.
     * @param traderId Trader Id.
     * @returns number - price of selling the item to trader.
     */
    public getItemTplSellToTraderPrice(itemTplId: string, traderId: string): number
    {
        const traderMeta = this.tradersMetaData[traderId];
        const buyPriceMult = 1 - traderMeta.buyPriceCoef/100;
        const basePrice = this.handbookHelper.getTemplatePrice(itemTplId);
        return basePrice * buyPriceMult;
    }

    /**
     * Calculates the tax and average flea price for an item template.
     * @param itemTplId Item Template Id.
     * @returns ItemRagFairCosts - flea tax and average flea price.
     */
    public getItemTplSellToRagfairCosts(itemTplId: string): ItemRagfairPrice
    {
        // IMPLEMENT
        return;
    }
}

/**
 * Avg and per point prices 
 */
interface ItemRagfairPrice
{
    avgPrice: number;
    pricePerPoint: number;
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