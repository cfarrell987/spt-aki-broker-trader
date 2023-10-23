import { DependencyContainer } from "tsyringe";

import { IPreAkiLoadMod } from "@spt-aki/models/external/IPreAkiLoadMod";
import { IPostDBLoadMod } from "@spt-aki/models/external/IPostDBLoadMod";
import { PreAkiModLoader } from "@spt-aki/loaders/PreAkiModLoader";
import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { ImageRouter } from "@spt-aki/routers/ImageRouter";
import { ConfigServer } from "@spt-aki/servers/ConfigServer";
import { ConfigTypes } from "@spt-aki/models/enums/ConfigTypes";
import { ITraderAssort, ITraderBase } from "@spt-aki/models/eft/common/tables/ITrader";
import { ITraderConfig, UpdateTime } from "@spt-aki/models/spt/config/ITraderConfig";
import { JsonUtil } from "@spt-aki/utils/JsonUtil";
import { Item } from "@spt-aki/models/eft/common/tables/IItem";
import { IDatabaseTables } from "@spt-aki/models/spt/server/IDatabaseTables";
import { Money } from "@spt-aki/models/enums/Money";
import { TradeController } from "@spt-aki/controllers/TradeController";

import baseJson from "../db/base.json";
import modInfo from "../package.json";
import modCfg from "../config/config.json";
import { BrokerTradeController } from "./broker_trade_controller";
import { VerboseLogger } from "./verbose_logger";
import { BrokerPriceManager } from "./broker_price_manager";
import { Traders } from "@spt-aki/models/enums/Traders";
import { TraderHelper } from "@spt-aki/helpers/TraderHelper";
import { DynamicRouterModService } from "@spt-aki/services/mod/dynamicRouter/DynamicRouterModService"
import { BrokerTraderRouter } from "./broker_trader_router";
import { IPostAkiLoadMod } from "@spt-aki/models/external/IPostAkiLoadMod";
import { ItemBaseClassService } from "@spt-aki/services/ItemBaseClassService";
import { FixedItemBaseClassService } from "./temporary_ItemBaseClassService_fix";

class BrokerTrader implements IPreAkiLoadMod, IPostDBLoadMod, IPostAkiLoadMod
{
    mod: string;
    logger: VerboseLogger;

    private static container: DependencyContainer;

    constructor() 
    {
        this.mod = `${modInfo.name} ${modInfo.version}`; // Set name of mod so we can log it to console later
    }

    /**
     * Some work needs to be done prior to SPT code being loaded, registering the profile image + setting trader update time inside the trader config json
     * @param container Dependency container
     */
    public preAkiLoad(container: DependencyContainer): void 
    {
        BrokerTrader.container = container;
        this.logger = new VerboseLogger(container);
        this.logger.explicitInfo(`[${this.mod}] preAki Loading... `);
        
        // Temporary
        if (modCfg["useItemBaseClassServiceFix"] === true)
        {
            this.logger.explicitInfo(`[${this.mod}] Fixing ItemBaseClassService...`);
            container.register<FixedItemBaseClassService>(FixedItemBaseClassService.name, FixedItemBaseClassService);
            container.register(ItemBaseClassService.name, {useToken: FixedItemBaseClassService.name});
        }

        if (modCfg.profitCommissionPercentage < 0 || modCfg.profitCommissionPercentage > 99)
        {
            this.logger.explicitError(`[${this.mod}] Config error! "profitCommissionPercentage": ${modCfg.profitCommissionPercentage}, must have a value not less than 0 and not more than 99.`)
            throw (`${this.mod} Config error. "profitCommissionPercentage" out of range [0-99]`);
        }

        if (modCfg.buyRateDollar < 0 || modCfg.buyRateEuro < 0)
        {
            this.logger.explicitError(`[${this.mod}] Config error! One of currencies "buyRate", is less than 0.`)
            throw (`${this.mod} Config error. A currency "buyRate" must be a positive number.`);
        }

        if (!(modCfg["useClientPlugin"] ?? true))
        {
            this.logger.explicitWarning(`[${this.mod}] Warning! Using this mod with "useClientPlugin": false is not directly supported. Price inaccuracies are expected. If you encounted serious problems(features completely not functioning, endless loadings, server exceptions etc.), please inform the developer directly.`);
        }

        const preAkiModLoader: PreAkiModLoader = container.resolve<PreAkiModLoader>("PreAkiModLoader");
        const imageRouter: ImageRouter = container.resolve<ImageRouter>("ImageRouter");
        const configServer = container.resolve<ConfigServer>("ConfigServer");
        const traderConfig: ITraderConfig = configServer.getConfig<ITraderConfig>(ConfigTypes.TRADER);
        // const routerService = container.resolve<DynamicRouterModService>(DynamicRouterModService.name); - not used

        // Controller override - to handle trade requests
        container.register<BrokerTradeController>(BrokerTradeController.name, BrokerTradeController);
        container.register(TradeController.name, {useToken: BrokerTradeController.name});

        // DataCallbacks override - to handle sell price display
        // container.register<BrokerDataCallbacks>(BrokerDataCallbacks.name, BrokerDataCallbacks);
        // container.register(DataCallbacks.name, {useToken: BrokerDataCallbacks.name});

        // Register router to handle broker-trader specific requests
        BrokerTraderRouter.registerRouter(container);

        this.registerProfileImage(preAkiModLoader, imageRouter);
        
        this.setupTraderUpdateTime(traderConfig);
        
        this.logger.explicitInfo(`[${this.mod}] preAki Loaded`);
    }
    
    /**
     * Majority of trader-related work occurs after the aki database has been loaded but prior to SPT code being run
     * @param container Dependency container
     */
    public postDBLoad(container: DependencyContainer): void 
    {
        this.logger.explicitInfo(`[${this.mod}] postDb Loading... `);

        // !Required! Instantialize BrokerPriceManager after DB has loaded.
        BrokerPriceManager.getInstance(container);

        // Resolve SPT classes we'll use
        const databaseServer: DatabaseServer = container.resolve<DatabaseServer>("DatabaseServer");
        // const configServer: ConfigServer = container.resolve<ConfigServer>("ConfigServer");
        // const traderConfig: ITraderConfig = configServer.getConfig(ConfigTypes.TRADER);
        const jsonUtil: JsonUtil = container.resolve<JsonUtil>("JsonUtil");

        // Get a reference to the database tables
        const tables = databaseServer.getTables();

        const brokerBase = {...baseJson};
        // Ignore config "items_buy" and merge all buy categories from other traders.
        brokerBase.items_buy.category = [];
        brokerBase.items_buy.id_list = [];
        
        //console.log(JSON.stringify(BrokerPriceManager.instance.supportedTraders));
        for (const tId of Object.values(BrokerPriceManager.instance.supportedTraders))
        {
            const trader = tables.traders[tId];
            // if (trader == undefined) console.log(`[TRADER BASE] ${tId}`);
            brokerBase.items_buy.category = brokerBase.items_buy.category.concat(trader.base.items_buy.category);
            brokerBase.items_buy.id_list = brokerBase.items_buy.id_list.concat(trader.base.items_buy.id_list);
        }
        // Init currency exchange
        if (modCfg.buyRateDollar > 0) brokerBase.items_buy.id_list.push(Money.DOLLARS);
        else brokerBase.items_buy_prohibited.id_list.push(Money.DOLLARS);
        if (modCfg.buyRateEuro > 0) brokerBase.items_buy.id_list.push(Money.EUROS);
        else brokerBase.items_buy_prohibited.id_list.push(Money.EUROS);
        
        // Add new trader to the trader dictionary in DatabaseServer
        this.addTraderToDb(baseJson, tables, jsonUtil, container);

        const brokerDesc = 
            "In the past, he worked at one of the largest exchanges in Russia. "+
            "At some point, he decided to move to the growing Norvinsk Special Economic Zone in pursuit of alluring opportunities. "+
            "Whether he somehow knew of the upcoming conflict in the region or not, he definetly found his profits in the current situation. "+
            "Nowadays he provides brokerage services at Tarkov's central market.";

        this.addTraderToLocales(tables, `${baseJson.name} ${baseJson.surname}`, baseJson.name, baseJson.nickname, baseJson.location, brokerDesc);

        this.logger.explicitInfo(`[${this.mod}] postDb Loaded`);
    }

    public postAkiLoad(container: DependencyContainer): void
    {
        // Initialize look-up tables and cache them here.
        // Most likely it's required to be done at "postAkiLoad()" to get proper flea offers from SPT-AKI API.
        // Passing a container is just an extra measure, since it should be already instantialized at "postDBLoad()"
        BrokerPriceManager.getInstance(container).initializeLookUpTables();
    }

    /**
     * Add profile picture to our trader
     * @param preAkiModLoader mod loader class - used to get the mods file path
     * @param imageRouter image router class - used to register the trader image path so we see their image on trader page
     */
    private registerProfileImage(preAkiModLoader: PreAkiModLoader, imageRouter: ImageRouter): void
    {
        // Reference the mod "res" folder
        const imageFilepath = `./${preAkiModLoader.getModPath(`nightingale-broker_trader-${modInfo.version}`)}res`;

        // Register a route to point to the profile picture
        imageRouter.addRoute(baseJson.avatar.replace(".png", ""), `${imageFilepath}/broker_portrait1.png`);
    }

    /**
     * Add record to trader config to set the refresh time of trader in seconds (default is 60 minutes)
     * @param traderConfig trader config to add our trader to
     */
    private setupTraderUpdateTime(traderConfig: ITraderConfig): void
    {
        // Add refresh time in seconds to config
        const traderRefreshRecord: UpdateTime = { traderId: baseJson._id, seconds: 3600 }
        traderConfig.updateTime.push(traderRefreshRecord);
    }

    /**
     * Add our new trader to the database
     * @param traderDetailsToAdd trader details
     * @param tables database
     * @param jsonUtil json utility class
     */
    
    // rome-ignore lint/suspicious/noExplicitAny: traderDetailsToAdd comes from base.json, so no type
    private addTraderToDb(traderDetailsToAdd: any, tables: IDatabaseTables, jsonUtil: JsonUtil, container: DependencyContainer): void
    {
        // Add trader to trader table, key is the traders id
        tables.traders[traderDetailsToAdd._id] = {
            assort: this.createAssortTable(tables, jsonUtil, container), // assorts are the 'offers' trader sells, can be a single item (e.g. carton of milk) or multiple items as a collection (e.g. a gun)
            base: jsonUtil.deserialize(jsonUtil.serialize(traderDetailsToAdd)) as ITraderBase,
            questassort: {
                started: {},
                success: {},
                fail: {}
            } // Empty object as trader has no assorts unlocked by quests
        };
    }

    /**
     * Create assorts for trader and add milk and a gun to it
     * @returns ITraderAssort
     */
    private createAssortTable(tables: IDatabaseTables, jsonUtil: JsonUtil, container: DependencyContainer): ITraderAssort
    {
        // Create a blank assort object, ready to have items added
        const assortTable: ITraderAssort = {
            nextResupply: 0,
            items: [],
            barter_scheme: {},
            loyal_level_items: {}
        }

        const traderHelper = container.resolve<TraderHelper>(TraderHelper.name);
        const dollarsId = Money.DOLLARS;
        const eurosId = Money.EUROS;

        // Get USD and EUR prices from PK and Skier assorts
        const pkAssort = traderHelper.getTraderAssortsByTraderId(Traders.PEACEKEEPER);
        const pkUsdItemId = pkAssort.items.find(item => item._tpl === dollarsId)._id;
        const pkDollarPrice = pkAssort.barter_scheme[pkUsdItemId][0][0].count;

        const skiAssort = traderHelper.getTraderAssortsByTraderId(Traders.SKIER);
        const skiEurItemId = skiAssort.items.find(item => item._tpl === eurosId)._id;
        const skiEuroPrice = skiAssort.barter_scheme[skiEurItemId][0][0].count;
        
        // View function documentation for what all the parameters are
        this.addSingleItemToAssort(assortTable, dollarsId, true, 9999999, 1, Money.ROUBLES, pkDollarPrice);
        this.addSingleItemToAssort(assortTable, eurosId, true, 9999999, 1, Money.ROUBLES, skiEuroPrice);

        // Get the mp133 preset and add to the traders assort (Could make your own Items[] array, doesnt have to be presets)
        // const mp133GunPreset = tables.globals.ItemPresets["584148f2245977598f1ad387"]._items;
        // this.addCollectionToAssort(jsonUtil, assortTable, mp133GunPreset, false, 5, 1, Money.ROUBLES, 500);

        return assortTable;
    }

    /**
     * Add item to assortTable + barter scheme + loyalty level objects
     * @param assortTable trader assorts to add item to
     * @param itemTpl Items tpl to add to traders assort
     * @param unlimitedCount Can an unlimited number of this item be purchased from trader
     * @param stackCount Total size of item stack trader sells
     * @param loyaltyLevel Loyalty level item can be purchased at
     * @param currencyType What currency does item sell for
     * @param currencyValue Amount of currency item can be purchased for
     */
    private addSingleItemToAssort(assortTable: ITraderAssort, itemTpl: string, unlimitedCount: boolean, stackCount: number, loyaltyLevel: number, currencyType: Money, currencyValue: number)
    {
        // Define item in the table
        const newItem: Item = {
            _id: itemTpl,
            _tpl: itemTpl,
            parentId: "hideout",
            slotId: "hideout",
            upd: {
                UnlimitedCount: unlimitedCount,
                StackObjectsCount: stackCount
            }
        };
        assortTable.items.push(newItem);

        // Barter scheme holds the cost of the item + the currency needed (doesnt need to be currency, can be any item, this is how barter traders are made)
        assortTable.barter_scheme[itemTpl] = [
            [
                {
                    count: currencyValue,
                    _tpl: currencyType
                }
            ]
        ];

        // Set loyalty level needed to unlock item
        assortTable.loyal_level_items[itemTpl] = loyaltyLevel;
    }

    /**
     * Add a complex item to trader assort (item with child items)
     * @param assortTable trader assorts to add items to
     * @param jsonUtil JSON utility class
     * @param items Items array to add to assort
     * @param unlimitedCount Can an unlimited number of this item be purchased from trader
     * @param stackCount Total size of item stack trader sells
     * @param loyaltyLevel Loyalty level item can be purchased at
     * @param currencyType What currency does item sell for
     * @param currencyValue Amount of currency item can be purchased for
     */
    private addCollectionToAssort(jsonUtil: JsonUtil, assortTable: ITraderAssort, items: Item[], unlimitedCount: boolean, stackCount: number, loyaltyLevel: number, currencyType: Money, currencyValue: number): void
    {
        // Deserialize and serialize to ensure we dont alter the original data
        const collectionToAdd: Item[] = jsonUtil.deserialize(jsonUtil.serialize(items));

        // Update item base with values needed to make item sellable by trader
        collectionToAdd[0].upd = {
            UnlimitedCount: unlimitedCount,
            StackObjectsCount: stackCount
        }
        collectionToAdd[0].parentId = "hideout";
        collectionToAdd[0].slotId = "hideout";

        // Push all the items into the traders assort table
        assortTable.items.push(...collectionToAdd);

        // Barter scheme holds the cost of the item + the currency needed (doesnt need to be currency, can be any item, this is how barter traders are made)
        assortTable.barter_scheme[collectionToAdd[0]._id] = [
            [
                {
                    count: currencyValue,
                    _tpl: currencyType
                }
            ]
        ];

        // Set loyalty level needed to unlock item
        assortTable.loyal_level_items[collectionToAdd[0]._id] = loyaltyLevel;
    }

    /**
     * Add traders name/location/description to the locale table
     * @param tables database tables
     * @param fullName fullname of trader
     * @param firstName first name of trader
     * @param nickName nickname of trader
     * @param location location of trader
     * @param description description of trader
     */
    private addTraderToLocales(tables: IDatabaseTables, fullName: string, firstName: string, nickName: string, location: string, description: string)
    {
        // For each language, add locale for the new trader
        const locales = Object.values(tables.locales.global) as Record<string, string>[];
        for (const locale of locales) 
        {
            locale[`${baseJson._id} FullName`] = fullName;
            locale[`${baseJson._id} FirstName`] = firstName;
            locale[`${baseJson._id} Nickname`] = nickName;
            locale[`${baseJson._id} Location`] = location;
            locale[`${baseJson._id} Description`] = description;
        }
    }

    private addItemToLocales(tables: IDatabaseTables, itemTpl: string, name: string, shortName: string, Description: string)
    {
        // For each language, add locale for the new trader
        const locales = Object.values(tables.locales.global) as Record<string, string>[];
        for (const locale of locales) 
        {
            locale[`${itemTpl} Name`] = name;
            locale[`${itemTpl} ShortName`] = shortName;
            locale[`${itemTpl} Description`] = Description;
        }
    }
}

module.exports = { mod: new BrokerTrader() }