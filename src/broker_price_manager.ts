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
import { DependencyContainer, container as tsyringeContainer } from "tsyringe";
import { Item, Upd } from "@spt-aki/models/eft/common/tables/IItem";
import { RagfairPriceService } from "@spt-aki/services/RagfairPriceService";
import { RagfairTaxHelper } from "@spt-aki/helpers/RagfairTaxHelper";
import { RagfairOfferService } from "@spt-aki/services/RagfairOfferService";

import baseJson from "../db/base.json";
import modInfo from "../package.json";
import modConfig from "../config/config.json";
import { IGlobals } from "@spt-aki/models/eft/common/IGlobals";

import * as fs from "fs";
import * as path from "path";

interface BrokerPriceManagerCache
{
    tradersMetaData: TradersMetaData;
    itemTraderTable: Record<string, TraderBaseData>;
    itemRagfairPriceTable: Record<string, ItemRagfairPrice>;
}
class BrokerPriceManager 
{
    private static _instance: BrokerPriceManager;

    private _container: DependencyContainer;

    private handbook: IHandbookBase;
    private handbookHelper: HandbookHelper; // Using with hydrateLookup() might be good to check if items exist in handbook and find their ragfair avg price
    private itemHelper: ItemHelper;
    private itemBaseClassService: ItemBaseClassService;
    private ragfairServerHelper: RagfairServerHelper; // Mb remove in the future
    private ragfairPriceService: RagfairPriceService;
    private ragfairTaxHelper: RagfairTaxHelper;
    private ragfairOfferService: RagfairOfferService;

    public brokerTraderId = baseJson._id;
    
    private dbServer: DatabaseServer;
    private dbGlobals: IGlobals;
    private dbItems: Record<string, ITemplateItem>; // Might replace with ItemHelper.getItems() since I don't write anything into the database
    private dbTraders: Record<string, ITrader>;
    public supportedTraders: Record<string, string>;

    private _tradersMetaData: TradersMetaData;
    private _itemTraderTable: Record<string, TraderBaseData>; // used as a cache, contains: itemTplId => Most Profitable Trader TraderBaseData
    private _itemRagfairPriceTable: Record<string, ItemRagfairPrice>; // used as a cache, contains itemTplId => avg price, price per point(of durability/resource), tax, tax per point

    private constructor(container?: DependencyContainer)
    {
        this._container = container ?? tsyringeContainer;

        this.itemHelper = container.resolve<ItemHelper>("ItemHelper");
        this.handbookHelper = container.resolve<HandbookHelper>("HandbookHelper");
        this.itemBaseClassService = container.resolve<ItemBaseClassService>("ItemBaseClassService");
        this.ragfairServerHelper = container.resolve<RagfairServerHelper>("RagfairServerHelper");
        this.ragfairPriceService = container.resolve<RagfairPriceService>("RagfairPriceService");
        this.ragfairTaxHelper = container.resolve<RagfairTaxHelper>("RagfairTaxHelper");
        this.ragfairOfferService = container.resolve<RagfairOfferService>("RagfairOfferService");

        this.dbServer = container.resolve<DatabaseServer>("DatabaseServer");
        this.dbGlobals = this.dbServer.getTables().globals;
        this.handbook = this.dbServer.getTables().templates.handbook;
        this.dbItems = this.dbServer.getTables().templates.items;
        this.dbTraders = this.dbServer.getTables().traders;
        this.supportedTraders = Object.keys(Traders).filter(key => Traders[key] !== Traders.LIGHTHOUSEKEEPER).reduce((accum, key) => 
        {
            accum[key] = Traders[key];
            return accum;
        }, {});
        // console.log(`SUPPORTED TRADERS DUMP: ${JSON.stringify(this.supportedTraders)}`);

        // Generate tables after all dependencies are resolved.
        // Use cache to speed up server load time on next start ups.
        const cacheDir = path.normalize(path.resolve(`${__dirname}/../cache`));
        const cacheFullPath = path.normalize(path.resolve(`${__dirname}/../cache/cache.json`));
        console.log(cacheFullPath);
        if (fs.existsSync(cacheFullPath))
        {
            this.tryToLoadCache(cacheFullPath);
        }
        else 
        {
            this.generateCache();
            this.tryToSaveCache(cacheDir, cacheFullPath);         
        }
    }

    private generateCache(): void
    {
        console.log(`[${modInfo.name} ${modInfo.version}] Generating cache...`);
        console.log(`[${modInfo.name} ${modInfo.version}] Generating Traders Meta Data...`);
        this._tradersMetaData = this.getTradersMetaData();
        console.log(`[${modInfo.name} ${modInfo.version}] Generating Item Trader Table...`);
        this._itemTraderTable = this.getItemTraderTable();
        console.log(`[${modInfo.name} ${modInfo.version}] Generating Item Ragfair Price Table...`);
        this._itemRagfairPriceTable = this.getFreshItemRagfairPriceTable();
        console.log(`[${modInfo.name} ${modInfo.version}] Cache generation completed.`);
    }

    private tryToSaveCache(absCacheDir: string, absCacheFullPath: string): void
    {
        console.log(`[${modInfo.name} ${modInfo.version}] Saving cache...`);
        try 
        {
            const bpmCache: BrokerPriceManagerCache = {
                tradersMetaData: this._tradersMetaData,
                itemTraderTable: this._itemTraderTable,
                itemRagfairPriceTable: this._itemRagfairPriceTable
            }
            fs.mkdirSync(absCacheDir);
            fs.writeFileSync(absCacheFullPath, JSON.stringify(bpmCache), {flag: "w"});
        }
        catch (error) 
        {
            console.log(`[${modInfo.name} ${modInfo.version}] Error. Couldn't save cache.`);
        }
        console.log(`[${modInfo.name} ${modInfo.version}] Cache successfully saved.`);
    }

    private tryToLoadCache(absCacheFullPath: string): void
    {
        console.log(`[${modInfo.name} ${modInfo.version}] Loading cache...`);
        try 
        {
            const bpmCache = JSON.parse(fs.readFileSync(absCacheFullPath, {flag: "r"}).toString()) as BrokerPriceManagerCache;
            this._tradersMetaData = bpmCache.tradersMetaData;
            this._itemTraderTable = bpmCache.itemTraderTable;
            this._itemRagfairPriceTable = bpmCache.itemRagfairPriceTable;
            console.log("CACHE:");
            console.log(`${JSON.stringify(bpmCache)}`);
        }
        catch (error) 
        {
            console.log(`[${modInfo.name} ${modInfo.version}] Error. Couldn't load cache from file. Please remove cache file if it exists, to resave the cache next time you launch the server.`);
            this.generateCache();
        }
        console.log(`[${modInfo.name} ${modInfo.version}] Cache successfully loaded.`);
    }

    public static getInstance(container?: DependencyContainer): BrokerPriceManager
    {
        if (!this._instance)
        {
            BrokerPriceManager._instance = new BrokerPriceManager(container);
        }
        return this._instance;
    }

    public isBrokerTraderId(traderId: string): boolean
    {
        return this.brokerTraderId === traderId;
    }

    public get container(): DependencyContainer
    {
        return this._container;
    }

    public static get instance(): BrokerPriceManager
    {
        return this.getInstance();
    }

    public get tradersMetaData(): TradersMetaData
    {
        return this._tradersMetaData;
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
            name: baseJson.nickname.toUpperCase(),
            itemsBuy: {category: [], id_list: []},
            itemsBuyProhibited: {category: [], id_list: []},
            buyPriceCoef: Infinity // to make sure it's never selected as the most profitable trader
        }
        return data;
    }

    public canBeBoughtByTrader(itemTplId: string, traderId: string ): boolean
    {
        const traderMetaData = this._tradersMetaData[traderId];
        const item = this.dbItems[itemTplId];
        // Might use itemBaseClassService but right now seems unnecessary
        // Also a very good option is itemHelpes.isOfBaseClass, check for every category (category.some()).
        const buysItem = traderMetaData.itemsBuy.category.some(categoryId => this.itemHelper.isOfBaseclass(itemTplId, categoryId)) || traderMetaData.itemsBuy.id_list.includes(itemTplId);
        const notProhibited = !traderMetaData.itemsBuyProhibited.category.some(categoryId => this.itemHelper.isOfBaseclass(itemTplId, categoryId)) && !traderMetaData.itemsBuyProhibited.id_list.includes(itemTplId);
        return buysItem && notProhibited;
    }

    public getBestTraderForItemTpl(itemTplId: string): TraderBaseData
    {
        const sellableTraders = Object.values(this._tradersMetaData).filter(traderMeta => this.canBeBoughtByTrader(itemTplId, traderMeta.id));
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
            ? this._tradersMetaData[Traders.FENCE]
            : this.getBestTraderForItemTpl(item._tpl);
    }

    public getBestSellDesicionForItem(pmcData: IPmcData, item: Item): SellDecision
    {
        const bestTrader = this.getBestTraderForItem(item);
        const traderPrice = this.getItemTraderPrice(item, bestTrader.id, pmcData);
        // ragfairAccountForAttachments - Check if we ignore each child ragfair price when calculating ragfairPrice.
        // When accounting child items - total flea price of found in raid weapons can be very unbalanced due to how in SPT-AKI
        // some random, even default weapon attachments have unreasonable price on flea.
        const ragfairPrice =  modConfig.ragfairAccountForAttachments ? this.getItemRagfairPrice(item, pmcData) : this.getSingleItemRagfairPrice(item);  
        // console.log(`[traderPrice] ${traderPrice}`);      
        // console.log(`[ragfairPrice] ${ragfairPrice}`);      
        // console.log(`[TAX] ${this.ragfairTaxHelper.calculateTax(item, pmcData, ragfairPrice, this.getItemStackObjectsCount(item), true)}`);
        // console.log("PARAMS:",item, pmcData, ragfairPrice, this.getItemStackObjectsCount(item), true);
        if (ragfairPrice > traderPrice && this.canSellOnFlea(item) && this.playerCanUseFlea(pmcData))
        {
            return {
                traderId: this.brokerTraderId,
                price: ragfairPrice,
                tax: this.getItemRagfairTax(item, pmcData, ragfairPrice, this.getItemStackObjectsCount(item), true) ?? 0
            };
        }
        return {
            traderId: bestTrader.id,
            price: traderPrice
        };
    }

    /**
     * Calculates the flea tax while taking in account user's Intelligence Center bonus and Hideout Management skill.
     * 
     * Had to make it myself since the provided RagfairTaxHelper.calculateTax is unreliable and sometimes returned NULL.
     * @param item Item to evaluate the tax.
     * @param pmcData PMC profile to whom the item belongs.
     * @param requirementsValue The price you want to sell the item for.
     * @param offerItemCount How many items in the flea offer.
     * @param sellInOnePiece Sell in batch or not.
     * @returns Flea tax value.
     */
    public getItemRagfairTax(item: Item, pmcData: IPmcData, requirementsValue: number, offerItemCount: number, sellInOnePiece: boolean): number
    {
        //         Tax
        // The fee you'll have to pay to post an offer on Flea Market is calculated using the following formula:
        // VO × Ti × 4^PO × Q + VR × Tr × 4^PR × Q
        // Where:
        // VO is the total value of the offer, calculated by multiplying the base price of the item times the amount (base price × total item count / Q). The Base Price is a predetermined value for each item.
        // VR is the total value of the requirements, calculated by adding the product of each requirement base price by their amount.
        // PO is a modifier calculated as log10(VO / VR).
        // If VR is less than VO then PO is also raised to the power of 1.08.
        // PR is a modifier calculated as log10(VR / VO).
        // If VR is greater or equal to VO then PR is also raised to the power of 1.08.
        // Q is the "quantity" factor which is either 1 when "Require for all items in offer" is checked or the amount of items being offered otherwise.
        // Ti and Tr are tax constants; currently set to Ti = 0.03 and Tr = 0.03

        //The base price of any item can be calculated by dividing the trader buyback price with the multiplier of that trader. 
        //Traders have a different multiplier,
        //Therapist=0.63, Ragman=0.62, Jaeger=0.6, Mechanic=0.56, Prapor=0.5, Skier=0.49, Peacekeeper=0.45, Fence=0.4.
        //Durability of items or number of uses affects the base price, so in order to get the base price of full items, don't compare with damaged/used ones.
        // const basePrice = this.handbookHelper.getTemplatePrice(item._tpl);
        const bestTrader = this.getBestTraderForItem(item);
        const basePrice = this.getItemTraderPrice(item, bestTrader.id, pmcData);

        const Q = sellInOnePiece ? offerItemCount : 1;
        const VO = basePrice * offerItemCount / Q;
        const VR = requirementsValue;
        let PO = Math.log10(VO/VR);
        if (VR < VO) PO = Math.pow(PO, 1.08);
        let PR = Math.log10(VR/VO);
        if (VR >= VO) PR = Math.pow(PR, 1.08);
        const Ti = 0.03;
        const Tr = 0.03;

        const pureTax = VO * Ti * Math.pow(4, PO) * Q + VR * Tr * Math.pow(4, PR) * Q;

        // Accounts for only one flea tax reduction bonus, since no other hideout are provides such bonuses.
        const intelBonus = pmcData.Bonuses.find(bonus => bonus.type === "RagfairCommission");
        // It might be undefined when you have no intel center built at all.
        // if (hideoutManagement == undefined) console.log("[Broker Trader] COULDN'T FIND INTELLIGENCE CENTER , DEFAULTING TO NO TAX REDUCTION");
        const intelBonusVal = intelBonus?.value ?? 0; // expect that bonus.value will be NEGATIVE
        const hideoutManagement = pmcData.Skills.Common.find(skill => skill.Id === "HideoutManagement");
        if (hideoutManagement == undefined) console.log("[Broker Trader] COULDN'T FIND HIDEOUT MANAGEMENT SKILL, DEFAULTING TO SKILL LEVEL 1");
        const hmProgress = hideoutManagement?.Progress ?? 1; // total skill xp
        // Wiki states that hideout management hives 0.3% per level. But config says 1%. Ingame says 1%. Select config value.
        const hmSkillBoostPercent = this.dbGlobals.config.SkillsSettings.HideoutManagement.SkillBoostPercent; // precent per 1 level
        // When calculating hideout management level (hmprogress/100) might wanna drop floating digits, but for now this works.
        const hmAreaMultiplier = 1 + hmProgress / 100 * hmSkillBoostPercent / 100; // how much the intel tax reduction should be buffed
        const intelTaxReduction = 1 - Math.abs(intelBonusVal) * hmAreaMultiplier / 100; // total intel center reduction with hideout management accounted for
        
        // console.log(`[PURE TAX] ${pureTax}`);
        // console.log(`[HM AREA MULT] ${hmAreaMultiplier}`);
        // console.log(`[intel tax reduction CALC] ${Math.abs(intelBonusVal) * hmAreaMultiplier / 100}`);
        // console.log(`[intel tax reduction] ${intelTaxReduction}`);

        // Might use trunc later to truncate the floating point.
        return Math.round(pureTax * intelTaxReduction);
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
     * Get the Original Max Points value (MaxDurbility/MaxResource etc.) from the database. 
     * 
     * Return value is checked for falsey value and if so - returns 1 to preserve calculations.
     * E.g.: If item wasn't found, or if found value is 0, or item has no points property at all.
     * @param itemTplId Item Template Id
     * @returns Original Max Points value, from item template in the database
     */
    public getOriginalMaxPointsByItemTplId(itemTplId: string): number
    {
        // Check if item is descendant of any class that have points(durability/resource)
        const itemBaseClassWithPointsId = Object.values(BaseClassesWithPoints).find(baseClassId => this.itemHelper.isOfBaseclass(itemTplId, baseClassId));
        const itemTpl = this.dbItems[itemTplId];
        if (itemTpl == undefined)
        {
            console.log("[BrokerPriceManager] Couldn't find item in database (getOriginalMaxPointsByItemTplId). Defaulting to 1");
            return 1;
        }
        switch (itemBaseClassWithPointsId)
        {
            case BaseClassesWithPoints.ARMORED_EQUIPMENT: // Armored_Equipment and Weapon use the same properties for durability
            case BaseClassesWithPoints.WEAPON:{
                return itemTpl._props.MaxDurability || 1;
            }
            case BaseClassesWithPoints.FOOD_DRINK:{
                return itemTpl._props.MaxResource || 1;
            }
            case BaseClassesWithPoints.MEDS:{
                return itemTpl._props.MaxHpResource || 1;
            }
            case BaseClassesWithPoints.BARTER_ITEM:{
                return itemTpl._props.MaxResource || 1;
            }
            default:
                return 1;
        }
    }

    /**
     * @deprecated Not implemented.
     * @param itemId 
     * @returns 
     */
    private getItemPointsDataById(itemId: string): ItemPointsData
    {
        return undefined;
    }

    /**
     * @deprecated Not implemented.
     * @param itemId 
     * @returns 
     */
    private getOriginalMaxPointsByTplId(itemTplId: string): number
    {
        return undefined;
    }

    public canSellOnFlea(item: Item): boolean
    {
        // const itemTpl = this.itemHelper.getItem(item._tpl)[1]; - keep it here if I move to itemHelper later
        const itemTpl = this.dbItems[item._tpl];
        // const founInRaid = item.upd?.SpawnedInSession ?? false;
        // console.log(item.upd?.SpawnedInSession ?? false);
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
    public processSellRequestDataForMostProfit(pmcData: IPmcData, sellData: IProcessSellTradeRequestData): ProcessedSellData
    {
        const sellDataItems = sellData.items;
        return sellDataItems.reduce((accum, currItem) => 
        {
            const inventoryItem = this.getItemFromInventoryById(currItem.id, pmcData);
            const sellDesicion = this.getBestSellDesicionForItem(pmcData, inventoryItem);
            const groupByTraderId = sellDesicion.traderId;
            const itemTax = (sellDesicion.tax ?? 0);
            // console.log(`[SELL DECISION] ${JSON.stringify(sellDesicion)}`);
            // console.log(`[ITEM TAX] ${itemTax}`);
            const itemPrice = sellDesicion.price; 
            const sellProfit = itemPrice - itemTax;
            const itemStackObjectsCount = this.getItemStackObjectsCount(inventoryItem);
            // No need to stress the database and count every child when we ignore item children, due to how getFullItemCont works.
            const fullItemCount = modConfig.ragfairAccountForAttachments ? this.getFullItemCount(inventoryItem, pmcData) : itemStackObjectsCount; // might be unnessecary and performance intensive
            if (accum[groupByTraderId] == undefined)
            {
                // Creating new group
                accum[groupByTraderId] = {
                    isFleaMarket: this.isBrokerTraderId(groupByTraderId),
                    traderName: this._tradersMetaData[groupByTraderId].name,
                    totalPrice: itemPrice,
                    totalTax: itemTax,
                    totalProfit: sellProfit,
                    totalItemCount: 1,
                    totalStackObjectsCount: itemStackObjectsCount,
                    fullItemCount: fullItemCount,
                    requestBody: {
                        Action: sellData.Action,
                        items: [currItem],
                        price: sellProfit, // important, subtract the tax to properly calculate profit
                        tid: groupByTraderId,
                        type: sellData.type
                    }
                };
            }
            else 
            {
                // Updating existing group
                accum[groupByTraderId].totalPrice += itemPrice;
                accum[groupByTraderId].totalTax += itemTax;
                accum[groupByTraderId].totalProfit += sellProfit;
                accum[groupByTraderId].totalItemCount += 1;
                accum[groupByTraderId].totalStackObjectsCount += itemStackObjectsCount;
                accum[groupByTraderId].fullItemCount += fullItemCount;

                accum[groupByTraderId].requestBody.items.push(currItem);
                accum[groupByTraderId].requestBody.price += sellProfit; // important, subtract the tax to properly calculate profit
            }
            return accum;
        }, {} as ProcessedSellData);
    }

    /**
     * Calculates the sell price of an item template for a specific trader.
     * @param itemTplId Item Template Id.
     * @param traderId Trader Id.
     * @returns number - price of selling the item template to trader.
     */
    public getItemTplTraderPrice(itemTplId: string, traderId: string): number
    {
        const traderMeta = this._tradersMetaData[traderId];
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
        // BEAR DOGTAG - "59f32bb586f774757e1e8442"
        // USEC DOGTAG - "59f32c3b86f77472a31742f0"
        const tplPrice = this.getItemTplTraderPrice(item._tpl, traderId);
        if (item._tpl === "59f32bb586f774757e1e8442" || item._tpl === "59f32c3b86f77472a31742f0")
        {
            // Shouldn't need rounding
            return tplPrice * this.getDogtagLevel(item);
        }
        const pointsData = this.getItemPointsData(item);
        // console.log(`[tplPrice] ${JSON.stringify(tplPrice)}`);
        // console.log(`[pointsData] ${JSON.stringify(pointsData)}`);
        if (this.isOfRepairableBaseClass(item._tpl))
            // for repairable items approximate based on current Max Durability
            // although it won't account for current durability, game balance impact should be negligible.
            return Math.round(tplPrice / pointsData.OriginalMaxPoints * pointsData.currentMaxPoints) * this.getItemStackObjectsCount(item)
        else
            // for others(food/drink/meds) calculate based on currentPoints - seeems 100% accurate.
            // if item doesn't have points (stims/barter items) maxPoints and currentPoints will = 1
            return Math.round(tplPrice / pointsData.OriginalMaxPoints * pointsData.currentPoints) * this.getItemStackObjectsCount(item); 
    }

    public getItemTraderPrice(item: Item, traderId: string, pmcData: IPmcData): number
    {
        const itemAndChildren = this.itemHelper.findAndReturnChildrenAsItems(pmcData.Inventory.items, item._id);
        // console.log(`[itemAndChildren] ${JSON.stringify(itemAndChildren)}`);
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
    private getFreshItemTplRagfairPrice(itemTplId: string): ItemRagfairPrice
    {
        // Collect offers with at least 85% durability/resource (if item has no points properties - its valid) and no sellInOnePiece
        // no sellInOnePiece is important - fully operational weapons with mods are sold with sellInOnePiece = true, here we need individual items only.
        const validOffersForItemTpl = this.ragfairOfferService.getOffersOfType(itemTplId)?.filter(offer => 
        {         
            const firstItem = offer.items[0];
            const pointsData = this.getItemPointsData(firstItem);
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
            pricePerPoint: Math.round(avgPrice / this.getOriginalMaxPointsByItemTplId(itemTplId))
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
        console.log(`[ITEM AND CHILDREN] ${JSON.stringify(itemAndChildren)}`)
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

    public getDogtagLevel(item: Item): number
    {
        return item.upd?.Dogtag.Level ?? 1;
    }

    /**
     * Looking for children is pretty intensive, maybe shouldn't be used, since I only intend to use it for logging.
     * @param item 
     * @param pmcData 
     * @returns 
     */
    public getFullItemCount(item: Item, pmcData: IPmcData): number
    {
        const itemAndChildren = this.itemHelper.findAndReturnChildrenAsItems(pmcData.Inventory.items, item._id);
        return itemAndChildren.reduce((accum, curr) => accum + this.getItemStackObjectsCount(curr), 0);
    }

    /**
     * Formats a number with spaces. (Separates thousands)
     * @param input Number you want to format.
     * @returns Formatted string with spaces.
     */
    public static getNumberWithSpaces(input: number): string 
    {
        const parts = input.toString().split(".");
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
        return parts.join(".");
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

/**
 * Processed sell data per trader.
 */
// Sort of has a little bit of unnecessary data,
// but that helps calculating the flea rep change
// inside the controler, and also log some info.
interface ProcessedSellData
{
    [traderId: string]: {
        isFleaMarket: boolean;
        traderName: string;
        totalPrice: number;
        totalTax: number;
        totalProfit: number;
        totalItemCount: number;
        totalStackObjectsCount: number;
        fullItemCount: number;
        requestBody: IProcessSellTradeRequestData;
    }
}

export {BrokerPriceManager}