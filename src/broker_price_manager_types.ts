import { IItemBuyData } from "@spt-aki/models/eft/common/tables/ITrader";
import { IProcessSellTradeRequestData } from "@spt-aki/models/eft/trade/IProcessSellTradeRequestData";

export interface BrokerPriceManagerCache
{
    itemRagfairPriceTable: Record<string, number>;
}

export interface BrokerSellData
{
    ItemId: string;
    TraderId: string;
    Price: number;
    PriceInRoubles: number;
    Commission: number;
    CommissionInRoubles: number;
    Tax: number;
}

export interface SellDecision 
{
    // trader: TraderBaseData; unnecessary
    traderId: string;
    price: number;
    priceInRoubles: number;
    commission: number;
    commissionInRoubles: number;
    tax?: number;
}
export interface TraderMetaData
{
    id: string;
    name: string;
    currency: string;
    itemsBuy: IItemBuyData;
    itemsBuyProhibited: IItemBuyData;
    buyPriceCoef: number;
}

export interface TradersMetaData 
{
    [traderId: string]: TraderMetaData
}

/**
 * Processed sell data per trader.
 */
// Sort of has a little bit of unnecessary data,
// but that helps calculating the flea rep change
// inside the controler, and also log some info.
export interface ProcessedSellData
{
    [traderId: string]: {
        isFleaMarket: boolean;
        traderName: string;
        totalPrice: number;
        totalTax: number;
        totalProfit: number;
        totalProfitInRoubles: number;
        commission: number;
        commissionInRoubles: number;
        totalItemCount: number;
        totalStackObjectsCount: number;
        fullItemCount: number;
        requestBody: IProcessSellTradeRequestData;
    }
}