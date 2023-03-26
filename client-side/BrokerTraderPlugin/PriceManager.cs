using EFT.InventoryLogic;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using ItemPrice = TraderClass.GStruct219;
using CurrencyHelper = GClass2179;
using PriceHelper = GClass1969;
using EFT;
using UnityEngine;
using Aki.Common.Http;
using Aki.Common.Utils;
using Newtonsoft.Json;

namespace BrokerTraderPlugin
{
    [Serializable]
    internal struct ResponseBody<T>
    {
        [JsonProperty("err")]
        public int Error { get; private set; }
        [JsonProperty("errmsg")]
        public string ErrorMessage { get; private set; }
        [JsonProperty("data")]
        public T Data { get; private set; }
    }
    internal static class PriceManager
    {

        public static readonly string[] SupportedTraderIds = new string[0];
        [Serializable]
        public struct RagfairPrice
        {
            [JsonProperty("avgPrice")]
            public int AveragePrice { get; private set; }
            [JsonProperty("pricePerPoint")]
            public int PricePerPoint { get; private set; }
        }
        public struct TraderItemPrice
        {
            public TraderClass Trader;
            public int RoubleAmount;
            public TraderItemPrice(TraderClass Trader, int RoubleAmount)
            {
                this.Trader = Trader;
                this.RoubleAmount = RoubleAmount;
            }
        }
        public static Dictionary<string, RagfairPrice> ItemRagfairPriceTable { get; set; } = new Dictionary<string, RagfairPrice>();
        public static IEnumerable<TraderClass> TradersList { get; set; } = null;
        public static Dictionary<string, SupplyData> SupplyData = new Dictionary<string, SupplyData>();
        // Requests in a static constructor will be performed only once for initialization.
        static PriceManager()
        {
            // Request supported trader ids
            string response = RequestHandler.GetJson("/broker-trader/supported-trader-ids");
            ThrowIfNullResponse(response, $"[BROKER TRADER] Couldn't get SupportedTraderIds!");
            SupportedTraderIds = Json.Deserialize<string[]>(response);

            // Request ragfair item price table.
            response = RequestHandler.GetJson("/broker-trader/item-ragfair-price-table");
            ThrowIfNullResponse(response, $"[BROKER TRADER] Couldn't get Item Ragfair Price Table!");
            ItemRagfairPriceTable = Json.Deserialize<Dictionary<string, PriceManager.RagfairPrice>>(response);

            // Request SupplyData from default SPT-AKI server route
            // Path example -> /client/items/prices/54cb57776803fa99248b456e
            foreach (string traderId in SupportedTraderIds)
            {
                response = RequestHandler.GetJson($"/client/items/prices/{traderId}");
                ThrowIfNullResponse(response, $"[BROKER TRADER] Couldn't get prices for traderId {traderId}");
                ResponseBody<SupplyData> body = Json.Deserialize<ResponseBody<SupplyData>>(response);
                SupplyData.Add(traderId, body.Data);
            }
        }
        // Gets the best paying trader and his rouble price.
        public static TraderItemPrice GetBestTraderPrice(Item item)
        {
            // Shouldn't happen, since tradersList will be assigned post MerchantsList.Show(),
            // before user opens any trader window.
            if (TradersList == null || TradersList?.Count() < 1)
            {
                const string msg = "Trying to PriceManager.getBestPrice while tradersList is empty, this shouldn't happen!";
                Debug.LogError(msg);
                throw (new Exception(msg));
            }

            // Look for highest paying trader, but get price in roubles,
            // trader appropriate conversion should be done separately, for precision.
            TraderClass bestTrader = TradersList.First();
            ItemPrice? bestPrice = GetUserItemPriceInRoubles(bestTrader, item);
            foreach (TraderClass trader in TradersList)
            {
                ItemPrice? checkedPrice = GetUserItemPriceInRoubles(trader, item);
                if (checkedPrice == null) continue;
                if (checkedPrice.GetValueOrDefault().Amount > bestPrice.GetValueOrDefault().Amount)
                {
                    bestTrader = trader;
                    bestPrice = checkedPrice;
                }
            }
            int roubleAmount = bestPrice != null ? bestPrice.GetValueOrDefault().Amount : 0;
            return new TraderItemPrice(bestTrader, roubleAmount);
        }
        // Gets the actual proper UserItemPrice but from the best paying trader.
        public static ItemPrice? GetBestUserItemPrice(Item item)
        {
            TraderItemPrice bestTraderPrice = GetBestTraderPrice(item);
            if (bestTraderPrice.RoubleAmount == 0) return null;
            // Recalculating with GetUserItemPrice with convertion is important for accuracy, due to rounding!
            return GetUserItemPrice(bestTraderPrice.Trader, item);
        }
        // Basically a copy of original GetUserItemPrice but with currency convertion
        // made optional. Allows to compare the prices of different with good accuracy.
        // Due to rounding after the conversion, the inaccuracy could be from 1 to ~500 roubles,
        // if you did re-convertion into roubles post factum.
        public static ItemPrice? GetUserItemPrice(TraderClass trader, Item item, bool convertToTraderCurrency = true)
        {
            if (SupplyData[trader.Id] == null)
            {
                Debug.LogError("supplyData is null");
                return null;
            }
            if (!trader.Info.CanBuyItem(item)) return null;
            string currencyId = CurrencyHelper.GetCurrencyId(trader.Settings.Currency);
            double amount = PriceHelper.CalculateBasePriceForAllItems(item, 0, SupplyData[trader.Id], trader.Settings.BuyerUp);
            if(convertToTraderCurrency) amount /= SupplyData[trader.Id].CurrencyCourses[currencyId];
            amount = trader.Info.ApplyPriceModifier(amount);
            if (amount.ApproxEquals(0.0))
            {
                return null;
            }
            return new ItemPrice?(new ItemPrice(currencyId, Convert.ToInt32(Math.Floor(amount))));
        }
        // Just an alias to not get confused.
        public static ItemPrice? GetUserItemPriceInRoubles(TraderClass trader, Item item)
        {
            return GetUserItemPrice(trader, item, false);
        }
        private static void ThrowIfNullResponse(string response, string message)
        {
            if (response == null || response == "")
            {
                Debug.LogError(message);
                throw (new Exception(message));
            }
        }
    }
}
