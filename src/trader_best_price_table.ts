import { HandbookHelper } from "@spt-aki/helpers/HandbookHelper";
import { ItemHelper } from "@spt-aki/helpers/ItemHelper";
import { RagfairServerHelper } from "@spt-aki/helpers/RagfairServerHelper";
import { IHandbookBase } from "@spt-aki/models/eft/common/tables/IHandbookBase";
import { ITemplateItem } from "@spt-aki/models/eft/common/tables/ITemplateItem";
import { IItemBuyData, ITrader } from "@spt-aki/models/eft/common/tables/ITrader";
import { Traders } from "@spt-aki/models/enums/Traders"
import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { ItemBaseClassService } from "@spt-aki/services/ItemBaseClassService";
import { DependencyContainer } from "tsyringe";


interface TraderData
{
    id: string;
    name: string;
    itemsBuy: IItemBuyData;
    itemsBuyProhibited: IItemBuyData;
    buyPriceCoef: number;
}

interface TradersMetaData 
{
    [key: string]: TraderData
}

class BrokerPriceManager 
{
    private static _instance: BrokerPriceManager;

    private container: DependencyContainer;

    private handbook: IHandbookBase;
    private itemHelper: ItemHelper;
    private itemBaseClassService: ItemBaseClassService;
    private ragfairServerHelper: RagfairServerHelper; // Mb remove in the future
    private dbServer: DatabaseServer;
    private dbItems: Record<string, ITemplateItem>; // Might replace with ItemHelper.getItems() since I don't write anything into the database
    private dbTraders: Record<string, ITrader>;
    public supportedTraders: Record<string, string>;

    private tradersMetaData: TradersMetaData;
    private _itemTraderTable: Record<string, TraderData>;

    private constructor(container: DependencyContainer)
    {
        this.container = container;

        this.itemHelper = container.resolve<ItemHelper>("ItemHelper");
        this.itemBaseClassService = container.resolve<ItemBaseClassService>("ItemBaseClassService");
        this.ragfairServerHelper = container.resolve<RagfairServerHelper>("RagfairServerHelper");
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
    }

    public static getInstance(container: DependencyContainer): BrokerPriceManager
    {
        if (!this._instance)
        {
            BrokerPriceManager._instance = new BrokerPriceManager(container);
        }
        return this._instance;
    }

    public get itemTraderTable(): Record<string, TraderData>
    {
        return this._itemTraderTable;
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

    private canBeBoughtByTrader(itemTplId: string, traderId: string ): boolean
    {
        const traderMetaData = this.tradersMetaData[traderId];
        const item = this.dbItems[itemTplId];
        // Might use itemBaseClassService but right now seems unnecessary
        // Also a very good option is itemHelpes.isOfBaseClass, check for every category (category.some()).
        const buysItem = traderMetaData.itemsBuy.category.some(categoryId => this.itemHelper.isOfBaseclass(itemTplId, categoryId)) || traderMetaData.itemsBuy.id_list.includes(itemTplId);
        const notProhibited = !traderMetaData.itemsBuyProhibited.category.some(categoryId => this.itemHelper.isOfBaseclass(itemTplId, categoryId)) && !traderMetaData.itemsBuyProhibited.id_list.includes(itemTplId);
        return buysItem && notProhibited;
    }

    public getBestTraderForItem(itemTplId: string): TraderData
    {
        const sellableTraders = Object.values(this.tradersMetaData).filter(traderMeta => this.canBeBoughtByTrader(itemTplId, traderMeta.id));
        if (sellableTraders.length < 1) return null; // If no traders can buy this item return NULL
        // the lower the coef the more money you'll get
        const lowestCoef = Math.min(...sellableTraders.map(trader => trader.buyPriceCoef));
        return sellableTraders.find(trader => trader.buyPriceCoef === lowestCoef);
    }

    public getItemTraderTable(): Record<string, TraderData>
    {
        // Also check if item exists in handbook to be sure that it's a valid item.
        return Object.keys(this.dbItems).filter(itemTplId => this.itemHelper.isValidItem(itemTplId) && this.existsInHandbook(itemTplId)).reduce((accum, itemTplId) => 
        {
            accum[itemTplId] = this.getBestTraderForItem(itemTplId);
            return accum;
        }, {});
    }

    // Maybe use manual check
    private canSellOnFlea(itemTplId: string): boolean
    {
        const item = this.dbItems[itemTplId];
        return this.ragfairServerHelper.isItemValidRagfairItem([false, item]); // what does the first array element do is absolutely fucking unknown
    }

    // Or use handbookHelper.getTemplatePrice
    private existsInHandbook(itemTplId: string): boolean
    {
        return this.handbook.Items.findIndex(hbkItem => hbkItem.Id === itemTplId) > -1;
    }
}
export {BrokerPriceManager}