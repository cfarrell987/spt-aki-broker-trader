import { TradeController } from "@spt-aki/controllers/TradeController";
import { ItemHelper } from "@spt-aki/helpers/ItemHelper";
import { ProfileHelper } from "@spt-aki/helpers/ProfileHelper";
import { TradeHelper } from "@spt-aki/helpers/TradeHelper";
import { IPmcData } from "@spt-aki/models/eft/common/IPmcData";
import { Item, Upd } from "@spt-aki/models/eft/common/tables/IItem";
import { IItemEventRouterResponse } from "@spt-aki/models/eft/itemEvent/IItemEventRouterResponse";
import { IProcessBaseTradeRequestData } from "@spt-aki/models/eft/trade/IProcessBaseTradeRequestData";
import { IProcessSellTradeRequestData } from "@spt-aki/models/eft/trade/IProcessSellTradeRequestData";
import { LogTextColor } from "@spt-aki/models/spt/logging/LogTextColor";
import { ILogger } from "@spt-aki/models/spt/utils/ILogger";
import { EventOutputHolder } from "@spt-aki/routers/EventOutputHolder";
import { ConfigServer } from "@spt-aki/servers/ConfigServer";
import { RagfairServer } from "@spt-aki/servers/RagfairServer";
import { LocalisationService } from "@spt-aki/services/LocalisationService";
import { HttpResponseUtil } from "@spt-aki/utils/HttpResponseUtil";
import { inject, injectable } from "tsyringe";

import {RagfairController} from "@spt-aki/controllers/RagfairController";

import * as baseJson from "../db/base.json";
import modInfo from "../package.json";
import modConfig from "../config/config.json";

import { RagfairSellHelper } from "@spt-aki/helpers/RagfairSellHelper";
import { RagfairOfferHelper } from "@spt-aki/helpers/RagfairOfferHelper";
import { TProfileChanges, ProfileChange, Warning } from "@spt-aki/models/eft/itemEvent/IItemEventRouterBase";
import { BrokerPriceManager } from "./broker_price_manager";
import { VerboseLogger } from "./verbose_logger";
import { HandbookHelper } from "@spt-aki/helpers/HandbookHelper";
import { LogBackgroundColor } from "@spt-aki/models/spt/logging/LogBackgroundColor";

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
        // Exceptions seem to be handled somewhere where this method is used.
        // And due to the way they are handled - only "error" is displayed instead of the actual error msg.
        // This sort of fixes it sometimes.     
        try 
        {
            if (body.tid === baseJson._id)
            {
                const logPrefix = `[${modInfo.name} ${modInfo.version}]`;        
                if (body.type === "sell_to_trader") 
                {
                    const priceManager = BrokerPriceManager.instance;
                    // Kind of an interesting way to pass DependencyContainer instance from mod.ts but will do.
                    // Not sure if simply importing container from "tsyringe" is good.
                    const container = priceManager.container; 
                    const verboseLogger = new VerboseLogger(container);
                    const sellRequestBody = body as IProcessSellTradeRequestData;
                    const handbookHelper = container.resolve<HandbookHelper>(HandbookHelper.name);

                    // Logging. Shouldn't be executed during normal use, since it additionally searches for items in player inventory by id.
                    if (verboseLogger.isVerboseEnabled)
                    {
                        verboseLogger.log(`${logPrefix} SELL REQUEST BODY DUMP: ${JSON.stringify(sellRequestBody)}`, LogTextColor.RED);
                        const requestInventoryItems = sellRequestBody.items.map(reqItem => priceManager.getItemFromInventoryById(reqItem.id, pmcData));
                        verboseLogger.log(`${logPrefix} REQUEST INVENTORY ITEMS DUMP: ${JSON.stringify(requestInventoryItems)}`, LogTextColor.YELLOW);
                    }
    
                    const responses: IItemEventRouterResponse[] = [];
                    const sellReqDataPerTrader = priceManager.processSellRequestDataForMostProfit(pmcData, sellRequestBody);

                    for (const traderId in sellReqDataPerTrader)
                    {
                        const tReqData = sellReqDataPerTrader[traderId];
                        const tradeResponse = super.confirmTrading(pmcData, tReqData.requestBody, sessionID, foundInRaid, upd);
    
                        // Logging section
                        if (tReqData.isFleaMarket)
                        {
                            let profitMsg = `${logPrefix} ${tReqData.traderName}: Sold ${tReqData.fullItemCount} items. `+ 
                            `Profit: ${BrokerPriceManager.getNumberWithSpaces(tReqData.totalProfit)} RUB (`+
                            `Price: ${BrokerPriceManager.getNumberWithSpaces(tReqData.totalPrice)} RUB | `+
                            `Tax: ${BrokerPriceManager.getNumberWithSpaces(tReqData.totalTax)} RUB).`;
                            if (modConfig.profitCommissionPercentage > 0)
                            {
                                profitMsg += ` Commission: ${tReqData.commissionInRoubles} RUB.`;
                            }
                            verboseLogger.explicitSuccess(profitMsg);
                        }
                        else 
                        {
                            const tCurrency = BrokerPriceManager.instance.tradersMetaData[traderId].currency;
                            let profitMsg = 
                                `${logPrefix} ${tReqData.traderName}: Sold ${tReqData.fullItemCount} items. Profit ${BrokerPriceManager.getNumberWithSpaces(tReqData.totalProfitInRoubles)} RUB`;
                            if (tCurrency !== "RUB")
                            {
                                profitMsg += ` (In ${tCurrency}: ${BrokerPriceManager.getNumberWithSpaces(tReqData.totalProfit)})`;
                            }
                            profitMsg += ".";
                            if (modConfig.profitCommissionPercentage > 0 && tReqData.commissionInRoubles > 0) // no need for commission log when it's 0 (e.g. currency exhange)
                            {
                                profitMsg += ` Commission: ${tReqData.commissionInRoubles} RUB`;
                                if (tCurrency !== "RUB")
                                {
                                    profitMsg += ` (In ${tCurrency}: ${BrokerPriceManager.getNumberWithSpaces(tReqData.commission)})`;
                                }
                                profitMsg += ".";
                            }
                            verboseLogger.explicitSuccess(profitMsg);
                        }
    
                        // Items sold to Broker are sold with Flea Prices, here simulate other flea market things
                        if (tReqData.isFleaMarket)
                        {
                            // Use total price, since the tax doesn't count towards flea rep.
                            // You get 0.01 rep per 50 000 RUB sold. 
                            const repGain = this.ragfairConfig.sell.reputation.gain;
                            const ratingIncrease = tReqData.totalPrice * repGain;
                            pmcData.RagfairInfo.isRatingGrowing = true;
                            pmcData.RagfairInfo.rating += ratingIncrease;
                            verboseLogger.explicitSuccess(
                                `${logPrefix} ${tReqData.traderName}(Flea Market): Flea rep increased to ${pmcData.RagfairInfo.rating} (+${ratingIncrease})`
                            );
    
                            // Usually flea operations increase the salesSum of a hidden "ragfair" trader, it's simulated here
                            // I think it's probably unnecessary to show it in the logs since salesSum also includes your purchases from flea (tested).
                            const profileChange = tradeResponse?.profileChanges[sessionID] as ProfileChange;
                            if (profileChange == undefined) throw ("Either trade response is undefined, or profile changes user id doesnt match with current user. This probably shouldn't happen.");
                            const currFleaRelations = pmcData.TradersInfo["ragfair"];
                            if (currFleaRelations == undefined) throw ("Couldn't get current Flea Market relations from user profile. Maybe you haven't traded on flea yet? Notify the developer about this.")
                            // this.logger.log(`${JSON.stringify(pmcData._id)}`, LogTextColor.RED);
                            // this.logger.log(`${JSON.stringify(sessionID)}`, LogTextColor.RED);
                            // this.logger.log(`${JSON.stringify(tradeResponse)}`, LogTextColor.RED);
                            // this.logger.log(`${JSON.stringify(currFleaRelations)}`, LogTextColor.RED);
                            
                            profileChange.traderRelations["ragfair"] = {
                                disabled: currFleaRelations.disabled,
                                loyaltyLevel: currFleaRelations.loyaltyLevel,
                                salesSum: currFleaRelations.salesSum + tReqData.totalPrice,
                                standing: currFleaRelations.standing,
                                nextResupply: currFleaRelations.nextResupply,
                                unlocked: currFleaRelations.unlocked
                            }
                        }
                        verboseLogger.log(`${logPrefix} ${tReqData.traderName} RESPONSE DUMP: ${JSON.stringify(tradeResponse)}`, LogTextColor.CYAN);
                        responses.push(tradeResponse);
                    }
    
                    // verboseLogger.log(`${logPrefix} ALL RESPONSES ARRAY DUMP: ${JSON.stringify(responses)}`, LogTextColor.CYAN);
                    // const mergedResponse = this.mergeResponses(sessionID, responses);

                    // Apparently every single of these responses point to the same object
                    // which is updated with every transaction, so no manual merging is needed.
                    // Just take the last respons. For now I'll leave the array here, but will probably remove later.
                    const mergedResponse = responses[responses.length-1];
                    verboseLogger.log(`${logPrefix} LAST RESPONSE DUMP: ${JSON.stringify(responses)}`, LogTextColor.YELLOW);
    
                    return mergedResponse;
                }
            }
            return super.confirmTrading(pmcData, body, sessionID, foundInRaid, upd);
        }
        catch (error) 
        {
            this.logger.error(error);
            throw "error";
        }
    }

    /**
     * @deprecated After testing responses seem to be merging changes automatically. Probably should've tested it before hand fml hahah.
     * 
     * Merges multiple "IItemEventRouterResponse"s for a specific user.
     * Used to merge multiple trade responses when Broker redirects the transaction to other traders.
     * @param sessionId Session id, Contained response's in "profileChanges".
     * @param responses Array with responses to merge.
     * @returns A single merged response.
     */
    private mergeResponses(sessionId: string, responses: IItemEventRouterResponse[]): IItemEventRouterResponse
    {
        const logPrefix = `[${modInfo.name} ${modInfo.version}]`;
        const mergedResponse: IItemEventRouterResponse = {warnings: [], profileChanges: {}};
        for (const response of responses)
        {
            mergedResponse.warnings = mergedResponse.warnings.concat(response.warnings);
            // const profileId = Object.keys(response.profileChanges)[0]; // probably not the best way to do it, but shall do for now
            const profileChange = response.profileChanges[sessionId] as ProfileChange;
            if (profileChange == undefined) throw ("Either trade response is undefined, or profile changes user id doesnt match with current user. This probably shouldn't happen.");
            
            if (mergedResponse.profileChanges[sessionId] == undefined) 
            {
                mergedResponse.profileChanges[sessionId] = {...profileChange};
            }
            else 
            {
                const mergedProfileChange = mergedResponse.profileChanges[sessionId] as ProfileChange;
                if (profileChange._id !== mergedProfileChange._id) throw ("Profile id mismatch while meging responses. This probably shouldn't happen. Notify the developer.");
                mergedProfileChange.experience = Math.max(mergedProfileChange.experience, profileChange.experience);
                mergedProfileChange.quests = mergedProfileChange.quests.concat(profileChange.quests);
                mergedProfileChange.ragFairOffers = mergedProfileChange.ragFairOffers.concat(profileChange.ragFairOffers);
                mergedProfileChange.builds = mergedProfileChange.builds.concat(profileChange.builds);
                mergedProfileChange.items.new = mergedProfileChange.items.new.concat(profileChange.items.new);
                mergedProfileChange.items.change = mergedProfileChange.items.change.concat(profileChange.items.change);
                mergedProfileChange.items.del = mergedProfileChange.items.del.concat(profileChange.items.del);

                // Not sure about the "skills" object
                if (mergedProfileChange.skills.Points !== profileChange.skills.Points)
                {
                    // Don't know if at any point trade response will have any "skills" data, so let it be like this for now.
                    this.logger.log(`${logPrefix} RESPONSE MERGE EVENT. "skills.Points" between two responses differ. Might not matter for your gameplay(or actually the opposite). Please notify the developer about it.`, LogTextColor.WHITE, LogBackgroundColor.YELLOW);
                    if (mergedProfileChange.skills.Points < profileChange.skills.Points)
                        mergedProfileChange.skills.Points += profileChange.skills.Points;
                }
                mergedProfileChange.skills.Common = {...mergedProfileChange.skills.Common, ...profileChange.skills.Common};
                mergedProfileChange.skills.Mastering = {...mergedProfileChange.skills.Mastering, ...profileChange.skills.Mastering};

                // Should probably stay the same between all responses unless maybe you are regenerating, no harm in doing this
                mergedProfileChange.health = {...profileChange.health};

                // Every response, except for Broker's response will probably contain only one trader.
                // Broker should contain it's own relations and "ragfair".
                for (const traderId in profileChange.traderRelations)
                {
                    const traderRelation = profileChange.traderRelations[traderId];
                    const mergedTraderRelation = mergedProfileChange.traderRelations[traderId];
                    if (mergedTraderRelation == undefined)
                    {
                        // If trader hasn't been merged in yet
                        mergedProfileChange.traderRelations[traderId] = {...traderRelation};
                    }
                    else 
                    {
                        this.logger.log(`${logPrefix} RESPONSE MERGE EVENT. Multiple responses of the same trader found. Please notify the developer about it.`, LogTextColor.WHITE, LogBackgroundColor.YELLOW);
                        // If trader has already been merged in. 
                        // Although probably shouldn't happen unless somehow Broker made several transactions to the same trader.
                        if ((traderRelation.loyaltyLevel ?? -1) > mergedTraderRelation.loyaltyLevel)
                            mergedTraderRelation.loyaltyLevel = traderRelation.loyaltyLevel;
                        if ((traderRelation.salesSum ?? -1) > mergedTraderRelation.salesSum)
                            mergedTraderRelation.salesSum = traderRelation.salesSum;
                        if ((traderRelation.standing ?? -1) > mergedTraderRelation.standing)
                            mergedTraderRelation.standing = traderRelation.standing;
                        // I don't touch other possibe properties since they'll most likely won't appear in simple trader trade responses.
                    }
                }
                mergedProfileChange.recipeUnlocked = {...mergedProfileChange.recipeUnlocked, ...profileChange.recipeUnlocked};
                mergedProfileChange.questsStatus = mergedProfileChange.questsStatus.concat(profileChange.questsStatus);
            }
        }
        return mergedResponse;
    }

    /**
     * @deprecated Contains a testing messy impelmentation of generating Flea Offers
     * @param body 
     * @param pmcData 
     * @param sessionID 
     */
    private fleaSell(body, pmcData, sessionID): void
    {
        const container = BrokerPriceManager.instance.container;
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

    /**
     * @deprecated
     * @param itemId 
     * @param pmcData 
     * @returns 
     */
    // Find item by it's id in inventory. If not found return undefined.
    private getItemFromInventoryById(itemId: string, pmcData: IPmcData): Item
    {        
        return pmcData.Inventory.items.find(item => item._id === itemId);
    }

}