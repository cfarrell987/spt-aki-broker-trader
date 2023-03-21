import { TradeController } from "@spt-aki/controllers/TradeController";
import { ItemHelper } from "@spt-aki/helpers/ItemHelper";
import { ProfileHelper } from "@spt-aki/helpers/ProfileHelper";
import { TradeHelper } from "@spt-aki/helpers/TradeHelper";
import { IPmcData } from "@spt-aki/models/eft/common/IPmcData";
import { Item, Upd } from "@spt-aki/models/eft/common/tables/IItem";
import { IItemEventRouterResponse } from "@spt-aki/models/eft/itemEvent/IItemEventRouterResponse";
import { IProcessBaseTradeRequestData } from "@spt-aki/models/eft/trade/IProcessBaseTradeRequestData";
import { IProcessBuyTradeRequestData } from "@spt-aki/models/eft/trade/IProcessBuyTradeRequestData";
import { IProcessRagfairTradeRequestData } from "@spt-aki/models/eft/trade/IProcessRagfairTradeRequestData";
import { IProcessSellTradeRequestData } from "@spt-aki/models/eft/trade/IProcessSellTradeRequestData";
import { LogTextColor } from "@spt-aki/models/spt/logging/LogTextColor";
import { ILogger } from "@spt-aki/models/spt/utils/ILogger";
import { EventOutputHolder } from "@spt-aki/routers/EventOutputHolder";
import { ConfigServer } from "@spt-aki/servers/ConfigServer";
import { RagfairServer } from "@spt-aki/servers/RagfairServer";
import { LocalisationService } from "@spt-aki/services/LocalisationService";
import { HttpResponseUtil } from "@spt-aki/utils/HttpResponseUtil";
import { container, inject, injectable } from "tsyringe";

import {RagfairController} from "@spt-aki/controllers/RagfairController";

import * as baseJson from "../db/base.json";
import { RagfairSellHelper } from "@spt-aki/helpers/RagfairSellHelper";
import { RagfairOfferHelper } from "@spt-aki/helpers/RagfairOfferHelper";
import { TProfileChanges, Warning } from "@spt-aki/models/eft/itemEvent/IItemEventRouterBase";
import { RagfairOfferHolder } from "@spt-aki/utils/RagfairOfferHolder";
import { BrokerPriceManager } from "./broker_price_manager";
import { RagfairOfferService } from "@spt-aki/services/RagfairOfferService";
import { RagfairServerHelper } from "@spt-aki/helpers/RagfairServerHelper";
import { RagfairPriceService } from "@spt-aki/services/RagfairPriceService";
import { RagfairTaxHelper } from "@spt-aki/helpers/RagfairTaxHelper";

@injectable()
export class BrokerTradeController extends TradeController
{
    constructor(
    @inject("WinstonLogger") logger: ILogger, 
        @inject("EventOutputHolder") eventOutputHolder: EventOutputHolder, 
        @inject("TradeHelper") tradeHelper: TradeHelper, 
        @inject("ItemHelper") itemHelper: ItemHelper, 
        @inject("ProfileHelper") profileHelper: ProfileHelper, 
        @inject("RagfairServer") ragfairServer: RagfairServer, 
        @inject("HttpResponseUtil") httpResponse: HttpResponseUtil, 
        @inject("LocalisationService") localisationService: LocalisationService, 
        @inject("ConfigServer") configServer: ConfigServer)
    {
        super(logger, eventOutputHolder, tradeHelper, itemHelper, profileHelper, ragfairServer, httpResponse, localisationService, configServer);
    }

    public override confirmTrading(pmcData: IPmcData, body: IProcessBaseTradeRequestData, sessionID: string, foundInRaid?: boolean, upd?: Upd): IItemEventRouterResponse 
    {
        if (body.tid === baseJson._id)
        {
            this.logger.log(JSON.stringify(body), LogTextColor.CYAN);
            if (body.type === "buy_from_trader") 
            {
                const buyData = body as IProcessBuyTradeRequestData;
                this.logger.log(JSON.stringify(buyData), LogTextColor.CYAN);
                return this.tradeHelper.buyItem(pmcData, buyData, sessionID, foundInRaid, upd);
            }
    
            if (body.type === "sell_to_trader") 
            {
                
                const priceManager = BrokerPriceManager.getInstance(container);
                const sellData = body as IProcessSellTradeRequestData;
                const itemsToSell = Object.values(sellData.items).map(sdItem => this.getItemFromInventoryById(sdItem.id, pmcData));

                const ragfairServerHelper = container.resolve<RagfairServerHelper>(RagfairServerHelper.name);
                const ragfairTaxHelper = container.resolve<RagfairTaxHelper>(RagfairTaxHelper.name);
                const itemHelper = container.resolve<ItemHelper>(ItemHelper.name);
                const testItem = this.getItemFromInventoryById(sellData.items[0].id, pmcData);


                // const fleaTax = ragfairTaxHelper.calculateTax(testItem, pmcData, 50000, priceManager.getItemStackObjectsCount(testItem), true);
                // this.logger.log(`ITEM TAX DUMP => ${JSON.stringify(fleaTax)}`, LogTextColor.RED);

                // const itemChildrenIds = itemHelper.findAndReturnChildrenByItems(pmcData.Inventory.items, testItem._id);
                // const itemChildren = itemChildrenIds.map(id => this.getItemFromInventoryById(id, pmcData));
                // this.logger.log(`ITEMHELPER children IDS => ${JSON.stringify(itemChildrenIds)}`, LogTextColor.RED);
                // this.logger.log(`ITEMHELPER children ITEMS => ${JSON.stringify(itemChildren)}`, LogTextColor.RED);
                // this.logger.log(`ITEMHELPER by assort => ${JSON.stringify(itemHelper.findAndReturnChildrenAsItems([testItem], testItem.parentId))}`, LogTextColor.RED);
                // this.logger.log(`ITEMHELPER manager recursive  => ${JSON.stringify(priceManager.getAllChildren(testItem))}`, LogTextColor.RED);
                
                this.logger.log(`getItemTraderPrice => ${(priceManager.getSingleItemTraderPrice(testItem, priceManager.getBestTraderForItemTpl(testItem._tpl).id))}`, LogTextColor.RED);


                const ragfairPriceService = container.resolve<RagfairPriceService>("RagfairPriceService");
                this.logger.log(`getFleaPriceForItem => ${ragfairPriceService.getFleaPriceForItem(testItem._tpl)}`, LogTextColor.GREEN);
                this.logger.log(`getDynamicPriceForItem => ${ragfairPriceService.getDynamicPriceForItem(testItem._tpl)}`, LogTextColor.GREEN);
                this.logger.log(`getStaticPriceForItem => ${ragfairPriceService.getStaticPriceForItem(testItem._tpl)}`, LogTextColor.GREEN);
                // this.logger.log(`calculateItemWorth IS ROOT - true => ${ragfairTaxHelper.calculateItemWorth(testItem, itemHelper.getItem(testItem._tpl)[1], 1, pmcData, true)}`, LogTextColor.GREEN);
                // this.logger.log(`calculateItemWorth IS ROOT - false => ${ragfairTaxHelper.calculateItemWorth(testItem, itemHelper.getItem(testItem._tpl)[1], 1, pmcData, false)}`, LogTextColor.GREEN);

                // this.logger.log(`getDynamicOfferPrice => ${ragfairPriceService.getDynamicOfferPrice(testItem._tpl)}`, LogTextColor.GREEN);

                

                this.logger.log(`TESTING isValidRagfairItem SpawnedInSession() TPL_ID (${testItem._tpl}) -> ${ragfairServerHelper.isItemValidRagfairItem([false, itemHelper.getItem(testItem._tpl)[1]])}`, LogTextColor.YELLOW);
                this.logger.log(`TESTING isValidRagfairItem SpawnedInSession() TPL_ID (${testItem._tpl}) -> ${ragfairServerHelper.isItemValidRagfairItem([true, itemHelper.getItem(testItem._tpl)[1]])}`, LogTextColor.YELLOW);
                // this.logger.log(`TESTING isValidRagfairItem SpawnedInSession(${testItem.upd.SpawnedInSession}) TPL_ID (${testItem._tpl}) -> ${ragfairServerHelper.isItemValidRagfairItem([testItem.upd.SpawnedInSession, itemHelper.getItem(testItem._tpl)[1]])}`, LogTextColor.YELLOW);


                this.logger.log(`ITEMS TO SELL DUMP: ${JSON.stringify(itemsToSell)}`, LogTextColor.CYAN);

                const testData = {...sellData};

                this.logger.log(`TESTING PRICE MANAGER: ${JSON.stringify(priceManager.processSellDataForMostProfit(pmcData, sellData))}`, LogTextColor.CYAN);

                // Distribute items to their according best profit traders.
                const itemsToSellPerTrader = Object.keys(priceManager.supportedTraders).reduce((accum, traderName) => 
                {
                    const traderId = priceManager.supportedTraders[traderName]; 
                    
                    const traderItemsToSell = itemsToSell.filter(item => 
                    {
                        this.logger.error(`TEMPLATE ID ${item._tpl} ITEMTRADERTABLE LENGTH ${Object.keys(priceManager.itemTraderTable).length}`);
                        return priceManager.itemTraderTable[item._tpl].id === traderId;
                    });
                    accum[traderName] = {
                        traderId: traderId,
                        sellData: {
                            Action: sellData.Action,
                            tid: traderId,
                            type: sellData.type,
                            items: sellData.items.filter(sdItem => traderItemsToSell.map(item => item._id).includes(sdItem.id)),
                            price: 1 // Calculate price per trader
                        } as IProcessSellTradeRequestData,
                        sellItems: traderItemsToSell
                    }
                    return accum;
                }, {});

                const responses: IItemEventRouterResponse[] = []; // CONCATENATE RESPONSES INTO ONE BIG RESPONSE
                for (const traderName in itemsToSellPerTrader)
                {
                    if (itemsToSellPerTrader[traderName].sellItems.length > 0)
                    {
                        this.logger.error(`SELLING TO TRADER: ${traderName}`);
                        responses.push(super.confirmTrading(pmcData, itemsToSellPerTrader[traderName].sellData, sessionID, foundInRaid, upd));
                    }
                }

                this.logger.log(`RESPONSES ARRAY DUMP: ${JSON.stringify(responses)}`, LogTextColor.CYAN);



                return super.confirmTrading(pmcData, body, sessionID, foundInRaid, upd);
            }
        }
        return super.confirmTrading(pmcData, body, sessionID, foundInRaid, upd);
    }

    public override confirmRagfairTrading(pmcData: IPmcData, body: IProcessRagfairTradeRequestData, sessionID: string): IItemEventRouterResponse 
    {
        const ragfairOfferService = container.resolve<RagfairOfferService>(RagfairOfferService.name);
        for (const offer of body.offers)
        {
            const ragfairOffer = ragfairOfferService.getOfferByOfferId(offer.id);
            this.logger.warning(`OFFER DUMP: ${JSON.stringify(ragfairOffer)}`);
        }
        const result = super.confirmRagfairTrading(pmcData, body, sessionID);
        this.logger.log(JSON.stringify(body), LogTextColor.CYAN);
        this.logger.log(JSON.stringify(result), LogTextColor.CYAN);
        return result;
    }

    /**
     * @deprecated Contains a testing impelmentation of generating Flea Offers
     * @param body 
     * @param pmcData 
     * @param sessionID 
     */
    private fleaSell(body, pmcData, sessionID): void
    {
        const sellData = body as IProcessSellTradeRequestData;
        this.logger.log(JSON.stringify(sellData), LogTextColor.CYAN);
        const ragfairController: RagfairController = container.resolve<RagfairController>(RagfairController.name);
        const ragfairOfferHelper: RagfairOfferHelper = container.resolve<RagfairOfferHelper>(RagfairOfferHelper.name);
        const ragfairSellHelper: RagfairSellHelper = container.resolve<RagfairSellHelper>(RagfairSellHelper.name);


        this.logger.log(JSON.stringify(sellData), LogTextColor.CYAN);
        const offerSellResult: IItemEventRouterResponse[] = [];

        const addOfferResult = ragfairController.addPlayerOffer(pmcData, {Action: "RagFairSellOffer", items: sellData.items.map(item => item.id), requirements: [{_tpl: "5449016a4bdc2d6f028b456f", count: 50000, level: 0, side: 0, onlyFunctional: false}], sellInOnePiece: false }, sessionID);
        offerSellResult.push(addOfferResult);
        // const playerOffers = ragfairOfferHelper.getProfileOffers(sessionID);
        const playerOffers = this.ragfairServer.getOffers().filter(offer => offer.user.id === pmcData._id);
                
        this.logger.error(`ADD OFFER RESULT:   ${JSON.stringify(addOfferResult)}`);
        for (const offer of playerOffers)
        {
            this.logger.log(`OFFER ID: ${offer._id} OFFER BODY: ${JSON.stringify(offer)}`, LogTextColor.YELLOW);
            const itemCount = offer.items[0].upd.StackObjectsCount;
            const originalItemCount = offer.items[0].upd.OriginalStackObjectsCount;
            const alreadyBoughtCount = offer.sellResult.map(sellRes => sellRes.amount).reduce((accum, curr) => accum+curr, 0);
            //this.logger.log(`${itemCount} - ${originalItemCount} - ${alreadyBoughtCount}`, LogTextColor.RED);

            // if (offer.sellResult != undefined && (offer.sellResult.length === 0 || offer.sellResult.map(sellRes => sellRes.amount).reduce((accum, curr) => accum+curr, 0) < originalItemCount))
            // {
            // const completeResult = ragfairOfferHelper.completeOffer(sessionID, offer, itemCount);
            if (this.ragfairServer.doesOfferExist(offer._id)) this.logger.log(`OFFER ${offer._id} EXISTS BEFORE COMPLETING`, LogTextColor.CYAN);
            // this.ragfairServer.hideOffer(offer._id);
            // const completeResult = ragfairOfferHelper.completeOffer(sessionID, offer, itemCount);
            // if (this.ragfairServer.doesOfferExist(offer._id)) this.logger.log(`OFFER ${offer._id} EXISTS`, LogTextColor.CYAN);
            // this.logger.error(`COMPLETE OFFER RESULT:   ${JSON.stringify(completeResult)}`);
            // pmcData.RagfairInfo.rating += 100000/50000*0.01;
            this.logger.log(`PMC RAGFAIR DATA:  ${JSON.stringify(this.profileHelper.getPmcProfile(sessionID).RagfairInfo.rating)}`, LogTextColor.CYAN);

            // offerSellResult.push(completeResult);
        }

        const reducedResponse = offerSellResult.reduce((accum, curr) => 
        {
            accum.warnings = accum.warnings.concat(curr.warnings);
            accum.profileChanges = {...accum.profileChanges, ...curr.profileChanges} as TProfileChanges;
            for (const profileId in accum.profileChanges)
            {
                // accum.profileChanges[profileId].ragFairOffers = [];
                // accum.profileChanges[profileId].traderRelations["ragfair"].salesSum*=2;
            }
                    
            return accum;
        }, {warnings: [] as Warning[], profileChanges: {} as TProfileChanges});
        // this.logger.error(JSON.stringify(reducedResponse));
        // warnings: Warning[];
        // profileChanges: TProfileChanges | "";
        // return reducedResponse;

        // {
        //     _id: string;
        //     _tpl: string;
        //     parentId?: string;
        //     slotId?: string;
        //     location?: Location | number;
        //     upd?: Upd;
        // }
        // const offerItems = sellData.items.map(item => {
        //     const itemTemplate = this.itemHelper.getItem()
        //     return {_id: }
        // });
        // const offer = ragfairController.createPlayerOffer(this.profileHelper.getFullProfile(sessionID), [{_tpl: "5449016a4bdc2d6f028b456f", count: 1, level: 0, side: 0, onlyFunctional: false}], );
                
        // return this.tradeHelper.sellItem(pmcData, sellData, sessionID);
        // return addOfferResult;
    }

    // Find item by it's id in inventory. If not found return undefined.
    private getItemFromInventoryById(itemId: string, pmcData: IPmcData): Item
    {        
        return pmcData.Inventory.items.find(item => item._id === itemId);
    }

    //private getTraderPriceForItem
}