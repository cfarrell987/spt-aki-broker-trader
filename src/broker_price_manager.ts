import { HandbookHelper } from "@spt-aki/helpers/HandbookHelper";
import { ItemHelper } from "@spt-aki/helpers/ItemHelper";
import { RagfairServerHelper } from "@spt-aki/helpers/RagfairServerHelper";
import { IPmcData } from "@spt-aki/models/eft/common/IPmcData";
import { IHandbookBase } from "@spt-aki/models/eft/common/tables/IHandbookBase";
import { ITemplateItem } from "@spt-aki/models/eft/common/tables/ITemplateItem";
import { IItemBuyData, ITrader } from "@spt-aki/models/eft/common/tables/ITrader";
import { IProcessSellTradeRequestData } from "@spt-aki/models/eft/trade/IProcessSellTradeRequestData";
import { Traders } from "@spt-aki/models/enums/Traders"
import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { ItemBaseClassService } from "@spt-aki/services/ItemBaseClassService";
import { DependencyContainer, container as tsyringeContainer } from "tsyringe";
import { Item } from "@spt-aki/models/eft/common/tables/IItem";
import { RagfairPriceService } from "@spt-aki/services/RagfairPriceService";
import { RagfairTaxHelper } from "@spt-aki/helpers/RagfairTaxHelper";
import { RagfairOfferService } from "@spt-aki/services/RagfairOfferService";

import baseJson from "../db/base.json";
import modInfo from "../package.json";
import modConfig from "../config/config.json";
import { IGlobals, IItemEnhancementSettings, IPriceModifier } from "@spt-aki/models/eft/common/IGlobals";

import * as fs from "fs";
import * as path from "path";
import { PaymentHelper } from "@spt-aki/helpers/PaymentHelper";
import { MemberCategory } from "@spt-aki/models/enums/MemberCategory";
import { Money } from "@spt-aki/models/enums/Money";
import { PresetHelper } from "@spt-aki/helpers/PresetHelper";
import { RagfairController } from "@spt-aki/controllers/RagfairController";
import { RagfairOfferHelper } from "@spt-aki/helpers/RagfairOfferHelper";
import { ISearchRequestData, OfferOwnerType } from "@spt-aki/models/eft/ragfair/ISearchRequestData";
import { RagfairSort } from "@spt-aki/models/enums/RagfairSort";
import { ItemComponentHelper, ItemComponentTypes, ItemPointsData } from "./item_component_helper";

interface BrokerPriceManagerCache
{
    tradersMetaData: TradersMetaData;
    itemTraderTable: Record<string, TraderMetaData>;
    itemRagfairPriceTable: Record<string, number>;
}

interface BrokerSellData
{
    ItemId: string;
    TraderId: string;
    Price: number;
    PriceInRoubles: number;
    Tax: number;
}

class BrokerPriceManager 
{
    private static _instance: BrokerPriceManager;

    private _container: DependencyContainer;

    private handbook: IHandbookBase;
    private handbookHelper: HandbookHelper; // Using with hydrateLookup() might be good to check if items exist in handbook and find their ragfair avg price
    private paymentHelper: PaymentHelper;
    private itemHelper: ItemHelper;
    private itemBaseClassService: ItemBaseClassService;
    private presetHelper: PresetHelper;
    private ragfairServerHelper: RagfairServerHelper; // Mb remove in the future
    private ragfairPriceService: RagfairPriceService;
    private ragfairTaxHelper: RagfairTaxHelper;
    private ragfairOfferService: RagfairOfferService;
    private ragfairControler: RagfairController;
    private ragfairOfferHelper: RagfairOfferHelper;

    public static brokerTraderId = baseJson._id;
    private componentHelper: ItemComponentHelper;
    
    private dbServer: DatabaseServer;
    private dbGlobals: IGlobals;
    private dbItems: Record<string, ITemplateItem>; // Might replace with ItemHelper.getItems() since I don't write anything into the database
    private dbTraders: Record<string, ITrader>;
    public supportedTraders: Record<string, string>;

    private _tradersMetaData: TradersMetaData;
    private _itemTraderTable: Record<string, TraderMetaData>; // used as a cache, contains: itemTplId => Most Profitable Trader TraderBaseData
    private _itemRagfairPriceTable: Record<string, number>; // used as a cache, contains itemTplId => avg price, price per point(of durability/resource), tax, tax per point

    private _clientBrokerSellData: Record<string, BrokerSellData> = {};

    private constructor(container?: DependencyContainer)
    {
        this._container = container ?? tsyringeContainer;

        this.componentHelper = new ItemComponentHelper(this._container);

        this.itemHelper = container.resolve<ItemHelper>("ItemHelper");
        this.presetHelper = container.resolve<PresetHelper>("PresetHelper")
        this.handbookHelper = container.resolve<HandbookHelper>("HandbookHelper");
        this.paymentHelper = container.resolve<PaymentHelper>("PaymentHelper");
        this.itemBaseClassService = container.resolve<ItemBaseClassService>("ItemBaseClassService");
        this.ragfairServerHelper = container.resolve<RagfairServerHelper>("RagfairServerHelper");
        this.ragfairPriceService = container.resolve<RagfairPriceService>("RagfairPriceService");
        this.ragfairTaxHelper = container.resolve<RagfairTaxHelper>("RagfairTaxHelper");
        this.ragfairOfferService = container.resolve<RagfairOfferService>("RagfairOfferService");
        this.ragfairOfferHelper = container.resolve<RagfairOfferHelper>("RagfairOfferHelper")
        this.ragfairControler = container.resolve<RagfairController>("RagfairController");

        this.dbServer = container.resolve<DatabaseServer>("DatabaseServer");
        this.dbGlobals = this.dbServer.getTables().globals;
        this.handbook = this.dbServer.getTables().templates.handbook;
        this.dbItems = this.dbServer.getTables().templates.items;
        this.dbTraders = this.dbServer.getTables().traders;
        this.supportedTraders = Object.keys(Traders).filter(key => Traders[key] !== Traders.LIGHTHOUSEKEEPER).reduce((accum, key) => 
        {
            accum[key] = Traders[key];
            return accum;
        }, {}); // make sure it doesn't have the "broker-trader" in it, because he has a coef of 0, which allows him to accurately display his sell prices ingame
        // console.log(`SUPPORTED TRADERS DUMP: ${JSON.stringify(this.supportedTraders)}`);
    }

    public setClientBrokerPriceData(data: Record<string, BrokerSellData>): void
    {
        this._clientBrokerSellData = data;
        //console.log(`[SET BROKER DATA] ${JSON.stringify(this._clientBrokerSellData)}`);
    }

    /**
     * Should be used in postAkiLoad() and after the instance is initialized.
     * Generates look-up tables.
     * Uses cache to speed up server load time on next start ups.
     */
    public initializeLookUpTables(): void
    {        
        // BrokerPriceManager.getInstance(); - can be used as a temporary bandaid but...
        // This method should fail if class hasn't been yet instantialized.
        const cacheDir = path.normalize(path.resolve(`${__dirname}/../cache`));
        const cacheFullPath = path.normalize(path.resolve(`${__dirname}/../cache/cache.json`));
        // console.log(cacheFullPath);
        if (fs.existsSync(cacheFullPath))
        {
            this.tryToLoadCache(cacheFullPath);
        }
        else 
        {
            this.generateLookUpTables();
            this.tryToSaveCache(cacheDir, cacheFullPath);         
        }
    } 

    private generateLookUpTables(): void
    {
        console.log(`[${modInfo.name} ${modInfo.version}] Generating look-up tables...`);
        console.log(`[${modInfo.name} ${modInfo.version}] Generating Traders Meta Data...`);
        this._tradersMetaData = this.getTradersMetaData();
        console.log(`[${modInfo.name} ${modInfo.version}] Generating Item Trader Table...`);
        this._itemTraderTable = this.getItemTraderTable();
        console.log(`[${modInfo.name} ${modInfo.version}] Generating Item Ragfair Price Table...`);
        this._itemRagfairPriceTable = this.getItemRagfairPriceTable();
        console.log(`[${modInfo.name} ${modInfo.version}] Look-up tables generation completed.`);
    }

    private tryToSaveCache(absCacheDir: string, absCacheFullPath: string): void
    {
        console.log(`[${modInfo.name} ${modInfo.version}] Saving look-up tables to cache...`);
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
            console.log(`[${modInfo.name} ${modInfo.version}] Error. Couldn't save to cache.`);
        }
        console.log(`[${modInfo.name} ${modInfo.version}] Look-up tables successfully cached.`);
    }

    private tryToLoadCache(absCacheFullPath: string): void
    {
        console.log(`[${modInfo.name} ${modInfo.version}] Loading look-up tables from cache...`);
        try 
        {
            const bpmCache = JSON.parse(fs.readFileSync(absCacheFullPath, {flag: "r"}).toString()) as BrokerPriceManagerCache;
            this._tradersMetaData = bpmCache.tradersMetaData;
            this._itemTraderTable = bpmCache.itemTraderTable;
            this._itemRagfairPriceTable = bpmCache.itemRagfairPriceTable;
            // console.log("CACHE:");
            // console.log(`${JSON.stringify(bpmCache)}`);
        }
        catch (error) 
        {
            console.log(`[${modInfo.name} ${modInfo.version}] Error. Couldn't load look-up tables from cache. Please remove cache file if it exists, to resave the cache next time you launch the server.`);
            this.generateLookUpTables();
        }
        console.log(`[${modInfo.name} ${modInfo.version}] Look-up tables successfully loaded from cache.`);
    }

    public static getInstance(container?: DependencyContainer): BrokerPriceManager
    {
        if (!this._instance)
        {
            BrokerPriceManager._instance = new BrokerPriceManager(container);
        }
        return this._instance;
    }

    public static isBrokerTraderId(traderId: string): boolean
    {
        return BrokerPriceManager.brokerTraderId === traderId;
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

    public get itemTraderTable(): Record<string, TraderMetaData>
    {
        return this._itemTraderTable;
    }

    public get itemRagfairPriceTable(): Record<string, number>
    {
        return this._itemRagfairPriceTable;
    }

    public getItemTraderTable(): Record<string, TraderMetaData>
    {
        // Also check if item exists in handbook to be sure that it's a valid item.
        return Object.keys(this.dbItems).filter(itemTplId => this.itemHelper.isValidItem(itemTplId) && this.existsInHandbook(itemTplId)).reduce((accum, itemTplId) => 
        {
            accum[itemTplId] = this.getBestTraderForItemTpl(itemTplId);
            return accum;
        }, {});
    }

    public getItemRagfairPriceTable(): Record<string, number>
    {
        const validRagfairItemTplIds = Object.values(this.dbItems).filter(itemTpl => this.ragfairServerHelper.isItemValidRagfairItem([true, itemTpl])).map(itemTpl => itemTpl._id);
        return validRagfairItemTplIds.reduce((accum, itemTplId) => 
        {
            accum[itemTplId] = this.getItemTemplateRagfairPrice(itemTplId);
            return accum;
        }, {});
    }

    private getTradersMetaData(): TradersMetaData
    {
        const data: TradersMetaData = {};
        for (const traderName in this.supportedTraders)
        {
            const traderId = this.supportedTraders[traderName];
            const currency = this.dbTraders[traderId].base.currency;
            const traderCoef = this.dbTraders[traderId].base.loyaltyLevels[0].buy_price_coef;
            const itemsBuy = this.dbTraders[traderId].base.items_buy;
            const itemsBuyProhibited = this.dbTraders[traderId].base.items_buy_prohibited;
            data[traderId] = {
                id: traderId,
                name: traderName,
                currency: currency,
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
            currency: "RUB",
            itemsBuy: {category: [], id_list: []},
            itemsBuyProhibited: {category: [], id_list: []},
            buyPriceCoef: Infinity // to make sure it's never selected as the most profitable trader
        }
        return data;
    }

    /**
     * Check if an item can be sold to a trader.
     * Makes sure that both conditions are met: trader buys item template and item condition passes restrictions.
     * If trader is Fence - restrictions are not accounted.
     * @param pmcData PMC to whom item belongs.
     * @param item Item to check.
     * @param traderId Id of the trader to check.
     * @returns true | false
     */
    public canBeSoldToTrader(pmcData: IPmcData, item: Item, traderId: string): boolean
    {
        const itemAndChildren = this.itemHelper.findAndReturnChildrenAsItems(pmcData.Inventory.items, item._id);
        return !itemAndChildren.some(item => !this.canTemplateBeSoldToTrader(item._tpl, traderId) || !this.passesBuyoutRestrictions(item, traderId === Traders.FENCE));
    }

    /**
     * Check if item template can be sold to trader.
     * @param itemTplId Item Template Id
     * @param traderId Trader Id
     * @returns true | false
     */
    public canTemplateBeSoldToTrader(itemTplId: string, traderId: string ): boolean
    {
        const traderMetaData = this._tradersMetaData[traderId];
        const buysItem = traderMetaData.itemsBuy.category.some(categoryId => this.itemHelper.isOfBaseclass(itemTplId, categoryId)) || traderMetaData.itemsBuy.id_list.includes(itemTplId);
        const notProhibited = !traderMetaData.itemsBuyProhibited.category.some(categoryId => this.itemHelper.isOfBaseclass(itemTplId, categoryId)) && !traderMetaData.itemsBuyProhibited.id_list.includes(itemTplId);
        return buysItem && notProhibited;
    }

    /**
     * Get the most profitable trader for an item.
     * @param pmcData PMC to whom item belongs.
     * @param item Item
     * @returns TraderMetaData
     */
    public getBestTraderForItem(pmcData: IPmcData, item: Item): TraderMetaData
    {
        const sellableTraders = Object.values(this._tradersMetaData).filter(traderMeta => this.canBeSoldToTrader(pmcData, item, traderMeta.id));
        if (sellableTraders.length < 1) return null; // If no traders can buy this item return NULL
        // the lower the coef the more money you'll get
        const lowestCoef = Math.min(...sellableTraders.map(trader => trader.buyPriceCoef));
        return sellableTraders.find(trader => trader.buyPriceCoef === lowestCoef);
    }

    /**
     * Get the most profitable trader for an item template.
     * @param itemTplId Item Template
     * @returns TraderMetaData
     */
    public getBestTraderForItemTpl(itemTplId: string): TraderMetaData
    {
        const sellableTraders = Object.values(this._tradersMetaData).filter(traderMeta => this.canTemplateBeSoldToTrader(itemTplId, traderMeta.id));
        if (sellableTraders.length < 1) return null; // If no traders can buy this item return NULL
        // the lower the coef the more money you'll get
        const lowestCoef = Math.min(...sellableTraders.map(trader => trader.buyPriceCoef));
        return sellableTraders.find(trader => trader.buyPriceCoef === lowestCoef);
    }

    /**
     * Get the most profitable sell decision for an item. 
     * Selects between selling to most profitable trader or ragfair.
     * @param pmcData PMC to whom item belongs.
     * @param item Item 
     * @returns SellDecision
     */
    public getBestSellDecisionForItem(pmcData: IPmcData, item: Item): SellDecision
    {
        if (this._clientBrokerSellData[item._id] != undefined)
        {
            //console.log(`[BROKER] RECEIVED SELL DATA FROM CLIENT FOR ${item._id}`);
            const clientSellData = this._clientBrokerSellData[item._id];
            return {
                traderId: clientSellData.TraderId,
                price: clientSellData.Price,
                priceInRoubles: clientSellData.PriceInRoubles,
                tax: clientSellData.Tax
            };
        }
        console.log(`[${modInfo.name} ${modInfo.version}] Couldn't find Client Sell Data for item id ${item._id}. Processing by server. If this happens very often, inform the developer.`);
        const bestTrader = this.getBestTraderForItem(pmcData, item);
        const traderPrice = this.getItemTraderPrice(pmcData, item, bestTrader.id);
        // ragfairIgnoreAttachments - Check if we ignore each child ragfair price when calculating ragfairPrice.
        // When accounting child items - total flea price of found in raid weapons can be very unbalanced due to how in SPT-AKI
        // some random, even default weapon attachments have unreasonable price on flea.
        const ragfairPrice = modConfig.ragfairIgnoreAttachments ? this.getSingleItemRagfairPrice(item) : this.getItemRagfairPrice(item, pmcData);  
        // console.log(`[traderPrice] ${traderPrice}`);      
        // console.log(`[ragfairPrice] ${ragfairPrice}`);      
        // console.log(`[TAX] ${this.ragfairTaxHelper.calculateTax(item, pmcData, ragfairPrice, this.getItemStackObjectsCount(item), true)}`);
        // console.log("PARAMS:",item, pmcData, ragfairPrice, this.getItemStackObjectsCount(item), true);

        // Tarkov price logic is simple - Math.Floor profits, Math.Ceil losses.
        if (ragfairPrice > traderPrice && this.canSellOnFlea(item) && this.playerCanUseFlea(pmcData))
        {
            return {
                traderId: BrokerPriceManager.brokerTraderId,
                price: Math.floor(ragfairPrice),
                priceInRoubles: Math.floor(ragfairPrice),
                tax: Math.ceil(this.getItemRagfairTax(item, pmcData, ragfairPrice, this.getItemStackObjectsCount(item), true) ?? 0)
            };
        }
        return {
            traderId: bestTrader.id,
            price: Math.floor(this.convertRoublesToTraderCurrency(traderPrice, bestTrader.id)),
            priceInRoubles: Math.floor(traderPrice)
        };
    }

    /**
     * Calculates the flea tax while taking in account user's Intelligence Center bonus and Hideout Management skill.
     * 
     * Had to make it myself since the RagfairTaxHelper.calculateTax is not accurate and sometimes returned NULL.
     * @param item Item to evaluate the tax.
     * @param pmcData PMC profile to whom the item belongs.
     * @param requirementsPrice The price you want to sell the item for.
     * @param offerItemCount How many items in the flea offer.
     * @param sellInOnePiece Sell in batch or not.
     * @returns Flea tax value.
     */
    // Reference "GClass1969.CalculateTaxPrice()"
    public getItemRagfairTax(item: Item, pmcData: IPmcData, requirementsPrice: number, offerItemCount: number, sellInOnePiece: boolean): number
    {
        if (requirementsPrice < 1 || offerItemCount < 1) return 0;

        const num = this.getBaseTaxForAllItems(pmcData, item, offerItemCount);
        requirementsPrice *= sellInOnePiece ? 1 : offerItemCount;
        const ragfairConfig = this.dbGlobals.config.RagFair;
        const num2 = ragfairConfig.communityItemTax / 100;
        const num3 = ragfairConfig.communityRequirementTax / 100;
        let num4 = Math.log10(num / requirementsPrice);
        let num5 = Math.log10(requirementsPrice / num);
        if (requirementsPrice >= num)
            num5 = Math.pow(num5, 1.08);
        else
            num4 = Math.pow(num4, 1.08);
        num5 = Math.pow(4.0, num5);
        num4 = Math.pow(4.0, num4);

        let num6 = num * num2 * num4 + requirementsPrice * num3 * num5;

        // Accounts for only one flea tax reduction bonus, since no other hideout are provides such bonuses.
        const intelBonus = pmcData.Bonuses.find(bonus => bonus.type === "RagfairCommission");
        // It might be undefined when you have no intel center built at all.
        // if (hideoutManagement == undefined) console.log("[Broker Trader] COULDN'T FIND INTELLIGENCE CENTER , DEFAULTING TO NO TAX REDUCTION");
        const intelBonusVal = Math.abs(intelBonus?.value ?? 0); // expect that bonus.value will be NEGATIVE
        const hideoutManagement = pmcData.Skills.Common.find(skill => skill.Id === "HideoutManagement");
        if (hideoutManagement == undefined) console.log("[Broker Trader] COULDN'T FIND HIDEOUT MANAGEMENT SKILL, DEFAULTING TO SKILL LEVEL 1");
        const hmProgress = hideoutManagement?.Progress ?? 1; // total skill xp
        // Wiki states that hideout management hives 0.3% per level. But config says 1%. Ingame says 1%. Prefer config value.
        const hmSkillBoostPercent = this.dbGlobals.config.SkillsSettings.HideoutManagement.SkillBoostPercent; // precent per 1 level
        // Important! When calculating hideout management level (hmprogress/100) truncate floating digits.
        const hmAreaMultiplier = 1 + Math.trunc(hmProgress / 100) * hmSkillBoostPercent / 100; // how much the intel tax reduction should be buffed
        const intelTaxModifier = 1 - intelBonusVal * hmAreaMultiplier / 100; // total intel center reduction with hideout management accounted for

        // console.log(`[INTEL BONUS VAL] ${intelBonusVal}`)
        // console.log(`[H M MODIFIER] ${hmAreaMultiplier}`)
        // console.log(`[INTEL TAX MODIFIER] ${intelTaxModifier}`)

        num6 *= intelTaxModifier;

        const itemTpl = this.dbItems[item._tpl];
        if (item == undefined) throw (`BrokerPriceManager | Couldn't find item with template ${item._tpl} when calculating flea tax!`);
        num6 *= itemTpl._props.RagFairCommissionModifier;

        if (this.componentHelper.hasComponent(item, ItemComponentTypes.BUFF))
        {
            // "Points" is "Buff.value"
            const buffComponent = this.componentHelper.getItemComponentPoints(item, ItemComponentTypes.BUFF);
            const buffType = item.upd.Buff.buffType;
            const priceModifier = (this.dbGlobals.config.RepairSettings.ItemEnhancementSettings[buffType] as IPriceModifier).PriceModifier;
            num6 *= 1 + Math.abs(buffComponent.points - 1) * priceModifier;
        }

        return Math.ceil(num6);
    }

    public getBaseTaxForAllItems(pmcData: IPmcData, item: Item, itemCount: number, basePriceSrc?: Record<string, number>): number
    {
        const itemAndChildren = this.itemHelper.findAndReturnChildrenAsItems(pmcData.Inventory.items, item._id);
        // pass isFence explicitly true, to skip "passesRestrictions"
        return itemAndChildren.reduce((accum, curr) => accum + this.getBuyoutPriceForSingleItem(curr, (curr._id === item._id) ? itemCount : 0, true, basePriceSrc), 0);
    }

    /**
     * Check if item can be sold on flea market.
     * 
     * Uses "ragfairServerHelper.isItemValidRagfairItem". If "ragfairIgnoreFoundInRaid" config value is set to true - true will always be passed into "spawnedInSession" parameter.
     * @param item Item to check.
     * @returns true | false - can the item be sold on flea?
     */
    public canSellOnFlea(item: Item): boolean
    {
        // const itemTpl = this.itemHelper.getItem(item._tpl)[1]; - keep it here if I move to itemHelper later
        const itemTpl = this.dbItems[item._tpl];
        const foundInRaid = modConfig.ragfairIgnoreFoundInRaid || (item.upd?.SpawnedInSession ?? false);
        // console.log(item.upd?.SpawnedInSession ?? false);

        // The first boolean param seems to refer to "spawnedInSession"(found in raid)
        return this.ragfairServerHelper.isItemValidRagfairItem([foundInRaid, itemTpl]);
    }

    // Or use handbookHelper.getTemplatePrice
    public existsInHandbook(itemTplId: string): boolean
    {
        // return this.handbookHelper.getTemplatePrice(itemTplId) !== 1;
        return this.handbook.Items.findIndex(hbkItem => hbkItem.Id === itemTplId) > -1;
    }

    /**
     * Checks if user level fits the flea requirement. If "ragfairIgnorePlayerLevel" config value is true - always returns true.
     * @param pmcData PMC profile data
     * @returns true | false. Does user have the level to use flea?
     */
    public playerCanUseFlea(pmcData: IPmcData): boolean
    {
        return modConfig.ragfairIgnorePlayerLevel || (pmcData.Info.Level >= this.dbServer.getTables().globals.config.RagFair.minUserLevel);
    }

    // inventory items are required to check for "item.upd.spawnedInSession"
    // so you'd have to pass either pmcData and look for items there or inventory items themselves
    public processSellRequestDataForMostProfit(pmcData: IPmcData, sellData: IProcessSellTradeRequestData): ProcessedSellData
    {
        const sellDataItems = sellData.items;
        return sellDataItems.reduce((accum, currItem) => 
        {
            const inventoryItem = this.getItemFromInventoryById(currItem.id, pmcData);
            const sellDecision = this.getBestSellDecisionForItem(pmcData, inventoryItem);
            const groupByTraderId = sellDecision.traderId;
            const itemPrice = sellDecision.price; 
            const itemTax = (sellDecision.tax ?? 0);
            const profit = itemPrice - itemTax;
            const profitInRoubles = sellDecision.priceInRoubles - itemTax;
            const itemStackObjectsCount = this.getItemStackObjectsCount(inventoryItem);
            // No need to stress the server and count every child when we ignore item children, due to how getFullItemCont works.
            const fullItemCount = modConfig.ragfairIgnoreAttachments ? itemStackObjectsCount : this.getFullItemCount(inventoryItem, pmcData);
            if (accum[groupByTraderId] == undefined)
            {
                // Create new group
                accum[groupByTraderId] = {
                    isFleaMarket: BrokerPriceManager.isBrokerTraderId(groupByTraderId),
                    traderName: this._tradersMetaData[groupByTraderId].name,
                    totalPrice: itemPrice,
                    totalTax: itemTax,
                    totalProfit: profit,
                    totalProfitInRoubles: profitInRoubles,
                    totalItemCount: 1,
                    totalStackObjectsCount: itemStackObjectsCount,
                    fullItemCount: fullItemCount,
                    requestBody: {
                        Action: sellData.Action,
                        items: [currItem],
                        price: profit,
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
                accum[groupByTraderId].totalProfit += profit;
                accum[groupByTraderId].totalProfitInRoubles += profitInRoubles;
                accum[groupByTraderId].totalItemCount += 1;
                accum[groupByTraderId].totalStackObjectsCount += itemStackObjectsCount;
                accum[groupByTraderId].fullItemCount += fullItemCount;

                accum[groupByTraderId].requestBody.items.push(currItem);
                accum[groupByTraderId].requestBody.price += profit;
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

    // Reference - "TraderClass.GetUserItemPrice"
    public getItemTraderPrice(pmcData: IPmcData, item: Item, traderId: string): number
    {
        if (!this.canBeSoldToTrader(pmcData, item, traderId)) return 0;

        const traderMeta = this._tradersMetaData[traderId];
        if (traderMeta == undefined) throw (`BrokerPriceManager | getTraderItemPrice, couldn't find trader meta by id ${traderId}`);

        let price = this.getBuyoutPriceForAllItems(pmcData, item, 0, traderId === Traders.FENCE);
        price = price * (1 - traderMeta.buyPriceCoef/100); // apply trader price modifier
        return price;
    }

    /**
     * Calculates buyout price for item and it's children. (Sort of an item's worth.)
     * @param pmcData PMC to whom the item belongs.
     * @param item Item
     * @param itemCount Item Count. If passed 0 - uses item StackObjectsCount.
     * @param isFence Are you calculating for Fence? (Do you wan't to ignore buyout(min durability/resource) restrictions.)
     * @param basePriceSrc Source for the base price. By default and pretty much everywhere in client's source code - handbook price.
     * @returns number
     */
    // Refernce - "GClass1969.CalculateBasePriceForAllItems"
    public getBuyoutPriceForAllItems(pmcData: IPmcData, item: Item, itemCount: number, isFence: boolean, basePriceSrc?: Record<string, number>): number
    {
        let price = 0;
        
        // Here should be check if item is a container with items
        // but no need for it, since it's checked clientside.

        const itemAndChildren = this.itemHelper.findAndReturnChildrenAsItems(pmcData.Inventory.items, item._id);
        //console.log(`[BUYOUT] BASE ITEM IS AMONG CHILDREN ARRAY ${itemAndChildren.find(itc => itc._id === item._id) != undefined}`)
        for (const itemIter of itemAndChildren)
        {
            const priceIter = this.getBuyoutPriceForSingleItem(itemIter, (itemIter._id === item._id) ? itemCount : 0, isFence, basePriceSrc);
            if (priceIter === 0) return 0;
            price += priceIter;
        }
        return price;
    }

    // Reference - "GClass1969.CalculateBuyoutBasePriceForSingleItem()" and "GClass1969.smethod_0()"
    public getBuyoutPriceForSingleItem(item: Item, itemCount: number, isFence: boolean, basePriceSrc?: Record<string, number>): number
    {
        if (!this.passesBuyoutRestrictions(item, isFence)) return 0;

        if (itemCount < 1) itemCount = this.getItemStackObjectsCount(item);

        let price: number;

        if (basePriceSrc != null) price = basePriceSrc[item._tpl];
        else price = this.handbookHelper.getTemplatePrice(item._tpl);

        if (price == null) throw ("BrokerPriceManager | getBuyoutPriceForSingleItem \"price\" is undefined, something is wrong with handbook or basePriceSrc param!");

        let component: ItemPointsData;
        const props = this.dbItems[item._tpl]?._props;
        if (props == null) throw ("BrokerPriceManager | getBuyoutPriceForSingleItem \"props\" is undefined, couldn't find item template in database!");

        if (this.componentHelper.hasComponent(item, ItemComponentTypes.REPAIRABLE))
        {
            // "Points" are Durability
            component = this.componentHelper.getItemComponentPoints(item, ItemComponentTypes.REPAIRABLE);
            const num2 = 0.01 * Math.pow(0, component.maxPoints);
            const num3 = Math.ceil(component.maxPoints);
            const num4 = props.RepairCost * (num3 - Math.ceil(component.points));
            price = price * (num3 / component.templateMaxPoints + num2) - num4;
        }
        if (this.componentHelper.hasComponent(item, ItemComponentTypes.BUFF))
        {
            // "Points" is Buff.value
            const buffType = item.upd.Buff.buffType;
            const priceModifier = (this.dbGlobals.config.RepairSettings.ItemEnhancementSettings[buffType] as IPriceModifier).PriceModifier;
            component = this.componentHelper.getItemComponentPoints(item, ItemComponentTypes.BUFF);
            price *= 1 + Math.abs(component.points - 1) * priceModifier;
        }
        if (this.componentHelper.hasComponent(item, ItemComponentTypes.DOGTAG))
        {
            // "Points" is Dogtag.Level
            price *= this.componentHelper.getItemComponentPoints(item, ItemComponentTypes.DOGTAG).points;
        }
        if (this.componentHelper.hasComponent(item, ItemComponentTypes.KEY))
        {
            // "Points" is NumberOfUsages
            component = this.componentHelper.getItemComponentPoints(item, ItemComponentTypes.KEY);
            // Important! Use Math.max to avoid dividing by 0, when point, maxpoints, templatemaxpoints in component equal 1.
            price = price / Math.max(component.templateMaxPoints * (component.templateMaxPoints - component.points), 1);
        }
        if (this.componentHelper.hasComponent(item, ItemComponentTypes.RESOURCE))
        {
            // "Points" is Value, "MaxPoints" is MaxResource
            component = this.componentHelper.getItemComponentPoints(item, ItemComponentTypes.RESOURCE);
            price = price * 0.1 + price * 0.9 / component.maxPoints * component.points;
        }
        if (this.componentHelper.hasComponent(item, ItemComponentTypes.SIDE_EFFECT))
        {
            // "Points" is Value, "MaxPoints" is MaxResource
            component = this.componentHelper.getItemComponentPoints(item, ItemComponentTypes.SIDE_EFFECT);
            price = price * 0.1 + price * 0.9 / component.maxPoints * component.points;
        }
        if (this.componentHelper.hasComponent(item, ItemComponentTypes.MEDKIT))
        {
            // "Points" is HpResource, "MaxPoints" is MaxResource
            component = this.componentHelper.getItemComponentPoints(item, ItemComponentTypes.MEDKIT);
            price = price / component.maxPoints * component.points;
        }
        if (this.componentHelper.hasComponent(item, ItemComponentTypes.FOOD_DRINK))
        {
            // "Points" is HpPercent, "MaxPoints" is MaxResource
            component = this.componentHelper.getItemComponentPoints(item, ItemComponentTypes.FOOD_DRINK);
            price = price / component.maxPoints * component.points;
        }
        if (this.componentHelper.hasComponent(item, ItemComponentTypes.REPAIRKIT))
        {
            // "Points" is Resource, "MaxPoints" is MaxRepairResource
            component = this.componentHelper.getItemComponentPoints(item, ItemComponentTypes.REPAIRKIT);
            price = price / component.maxPoints * Math.max(component.points, 1);
        }
        return price * itemCount;
    }

    // Reference - GClass1969.CalculateBuyoutBasePriceForSingleItem() (the restriction checking part)
    public passesBuyoutRestrictions(item: Item, isFence: boolean): boolean
    {
        let component: ItemPointsData;
        const buyoutRestrictions = this.dbGlobals.config.TradingSettings.BuyoutRestrictions;
        if (!isFence && this.componentHelper.hasComponent(item, ItemComponentTypes.MEDKIT))
        {
            component = this.componentHelper.getItemComponentPoints(item, ItemComponentTypes.MEDKIT);
            return !(component.points/component.maxPoints < buyoutRestrictions.MinMedsResource);
        }
        if (!isFence && this.componentHelper.hasComponent(item, ItemComponentTypes.FOOD_DRINK))
        {
            component = this.componentHelper.getItemComponentPoints(item, ItemComponentTypes.FOOD_DRINK);
            return !(component.points < buyoutRestrictions.MinFoodDrinkResource);
        }
        if (!isFence && this.componentHelper.hasComponent(item, ItemComponentTypes.REPAIRABLE))
        {
            component = this.componentHelper.getItemComponentPoints(item, ItemComponentTypes.REPAIRABLE);
            return !(component.maxPoints < component.templateMaxPoints * buyoutRestrictions.MinDurability || component.points < component.maxPoints * buyoutRestrictions.MinDurability);
        }
        return true;
    }

    public isMissingVitalParts(item: Item): boolean
    {
        return this.getMissingVitalPartsCount(item) > 0;
    }

    public getMissingVitalPartsCount(item: Item): number
    {
        //const tpl = this.dbItems[item._tpl];
        //tpl._props.Slots[0].
        return 0;
    }

    public getVitalParts(item: Item): any
    {
        //item.slotId
        return;
    }

    /**
     * Gets ragfair average price for template, accesses the cached price table.
     * @param itemTplId Item Template Id.
     * @returns ItemRagFairCosts - flea tax and average flea price.
     */
    public getItemTplRagfairPrice(itemTplId: string): number
    {
        return this._itemRagfairPriceTable[itemTplId] ?? 0;
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
     * @returns number Average flea price
     */
    private getItemTemplateRagfairPrice(itemTplId: string): number
    {
        // Collect offers with at least 85% durability/resource (if item has no points properties - its valid) and no sellInOnePiece

        // sellInOnePiece check is not needed - I'll leave this as a reminder for my goofy aah
        // took me 3 hours to realize that I checked for sellInOnePiece === false and couldn't get
        // fully operational item offers, because a weapon preset with all the mods is sold with "sellInOnePiece" = true
        
        // On the other hand, why non-operational lower receivers of M4A1 cost 250k~ on flea?

        const validOffersForItemTpl = this.ragfairOfferService.getOffersOfType(itemTplId)?.filter(offer => 
        {    
            //console.log(`[validOffersForItemTpl] ${JSON.stringify(offer.user?.memberType)}`);
            const firstItem = offer.items[0];
            if (
                offer.user?.memberType === MemberCategory.TRADER || // no trader offers
                offer.items.length < 1 || // additional reliability measure
                offer.requirements.some(requirement => !Object.keys(Money).some(currencyName => Money[currencyName] === requirement._tpl)) || // no barter offers
                this.presetHelper.hasPreset(firstItem._tpl) && offer.items.length === 1 // no "not operational" offers 
            ) return false;    
            const pointsData = this.componentHelper.getRagfairItemComponentPoints(firstItem);
            const originalMaxPtsBoundary = pointsData.templateMaxPoints * 0.85; // 85% of max capacity
            const hasMoreThan85PercentPoints = pointsData.points >= originalMaxPtsBoundary && pointsData.maxPoints >= originalMaxPtsBoundary;
            return hasMoreThan85PercentPoints; 
        });
        //console.log(`[BROKER] ${itemTplId} COUNT OFFERS => ${JSON.stringify(this.ragfairOfferService.getOffersOfType(itemTplId)?.length)}`);
        // Some items might have no offers on flea (some event stuff, e.g. jack-o-lantern) so getOffersOfType will return "undefined"
        const avgPrice = validOffersForItemTpl?.length > 0
            ? validOffersForItemTpl.map(offer => offer.requirementsCost).reduce((accum, curr) => accum+curr, 0) / validOffersForItemTpl.length
            //Get the bigger price, either static or dynamic. Makes sense most of the time to approximate actual flea price when you have no existing offers.
            // getDynamicPriceForItem might return "undefined" for some reason, so check for it (getStaticPriceForItem too just in case)
            : Math.max(this.ragfairPriceService.getStaticPriceForItem(itemTplId) ?? 0, this.ragfairPriceService.getDynamicPriceForItem(itemTplId) ?? 0);
            
        //Some Items like Santa hat/Ushanka etc. have no durability displayed, but have an actual current durability and max durability.
        //Test how it influences their price.

        // if (itemTplId === "5447a9cd4bdc2dbd208b4567")
        // {
        //     // console.log(`[MIN_AVG_MAX] ${JSON.stringify(minMaxAvg)}`);
        //     console.log(`[Offers count] ${JSON.stringify(validOffersForItemTpl?.length)}`)
        //     validOffersForItemTpl?.forEach(offer => 
        //     {
        //         console.log(`[requirements cost] ${JSON.stringify(offer.requirements)}`)
        //         console.log(`[requirements cost] ${JSON.stringify(offer.requirementsCost)}`)
        //     });
        //     console.log(`[avg price] ${Math.round(avgPrice)}`)
        //     console.log(`[per point] ${Math.round(avgPrice / this.getOriginalMaxPointsByItemTplId(itemTplId))}`)
        // }
        return avgPrice;
        // return {
        //     avgPrice: Math.round(avgPrice),
        //     pricePerPoint: Math.round(avgPrice / this.getOriginalMaxPointsByItemTplId(itemTplId))
        // };
    }

    public getSingleItemRagfairPrice(item: Item): number
    {
        const pointsData = this.componentHelper.getRagfairItemComponentPoints(item);
        // Round, since weapon or armor durability can be float, etc.
        // console.log(`[POINTS DATA] ${JSON.stringify(pointsData)}`);
        // console.log(`[RAGFAIR PRICE DATA] ${JSON.stringify(this.getItemTplRagfairPrice(item._tpl))}`);
        // console.log(`[GET STACK OBJECT COUNT DATA] ${JSON.stringify(this.getItemStackObjectsCount(item))}`);
        return Math.floor(pointsData.points * this.getItemTplRagfairPrice(item._tpl) / pointsData.templateMaxPoints) * this.getItemStackObjectsCount(item);
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

    public convertRoublesToTraderCurrency(roubleAmount: number, traderId: string): number
    {
        const trader = this.dbTraders[traderId];
        if (trader == undefined) console.log(`[${modInfo.name} ${modInfo.version}] Error converting to trader currency. Couldn't find trader! Defaulting to RUB.`);

        const tCurrencyTag = trader?.base?.currency ?? "RUB";
        const currencyTpl = this.paymentHelper.getCurrency(tCurrencyTag);

        if (currencyTpl === Money.ROUBLES) return roubleAmount;

        const targetCurrPrice = this.handbookHelper.getTemplatePrice(currencyTpl);
        return targetCurrPrice ? roubleAmount / targetCurrPrice : 0;
        // return this.handbookHelper.fromRUB(roubleAmount, currencyTpl); doesn't do well, because it Rounds the return value, when it has to be Floored.
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
    priceInRoubles: number;
    tax?: number;
}
interface TraderMetaData
{
    id: string;
    name: string;
    currency: string;
    itemsBuy: IItemBuyData;
    itemsBuyProhibited: IItemBuyData;
    buyPriceCoef: number;
}

interface TradersMetaData 
{
    [traderId: string]: TraderMetaData
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
        totalProfitInRoubles: number;
        totalItemCount: number;
        totalStackObjectsCount: number;
        fullItemCount: number;
        requestBody: IProcessSellTradeRequestData;
    }
}

export {BrokerPriceManager}