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
using static UnityEngine.UIElements.UIRAtlasManager;

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
    [Serializable]
    internal struct RagfairPrice
    {
        [JsonProperty("avgPrice")]
        public int AveragePrice { get; private set; }
        [JsonProperty("pricePerPoint")]
        public int PricePerPoint { get; private set; }
    }

    internal readonly struct TraderItemPriceData
    {
        public readonly TraderClass Trader { get; }
        public readonly ItemPrice? Price { get; }
        public readonly int AmountInRoubles { get; }
        public TraderItemPriceData(TraderClass trader, ItemPrice? price, int amountInRoubles)
        {
            Trader = trader;
            Price = price;
            AmountInRoubles = amountInRoubles;
        }
    }

    internal static class PriceManager
    {

        public static readonly string[] SupportedTraderIds = new string[0];

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
            ItemRagfairPriceTable = Json.Deserialize<Dictionary<string, RagfairPrice>>(response);

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
        // Gets the best paying trader and his price data.
        public static TraderItemPriceData GetBestTraderPrice(Item item)
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
            TraderItemPriceData bestTraderPrice = GetTraderItemPriceData(TradersList.First(), item);
            foreach (TraderClass trader in TradersList.Skip(1))
            {
                TraderItemPriceData checkedPrice = GetTraderItemPriceData(trader, item);
                if (checkedPrice.Price == null) continue;
                if (checkedPrice.AmountInRoubles > bestTraderPrice.AmountInRoubles)
                {
                    bestTraderPrice = checkedPrice;
                }
            }
            return bestTraderPrice;
        }
        // Basically a copy of original TraderClass.GetUserItemPrice but with a few changes, to collect useful data.
        public static TraderItemPriceData GetTraderItemPriceData(TraderClass trader, Item item)
        {
            if (SupplyData[trader.Id] == null)
            {
                Debug.LogError("supplyData is null");
                return new TraderItemPriceData(trader, null, -1);
            }
            if (!trader.Info.CanBuyItem(item)) return new TraderItemPriceData(trader, null, -1);
            string currencyId = CurrencyHelper.GetCurrencyId(trader.Settings.Currency);
            double amount = PriceHelper.CalculateBasePriceForAllItems(item, 0, SupplyData[trader.Id], trader.Settings.BuyerUp);
            int amountInRoubles = Convert.ToInt32(Math.Floor(trader.Info.ApplyPriceModifier(amount))); // save rouble price

            amount /= SupplyData[trader.Id].CurrencyCourses[currencyId];
            amount = trader.Info.ApplyPriceModifier(amount);
            if (amount.ApproxEquals(0.0))
            {
                return new TraderItemPriceData(trader, null, -1);
            }
            return new TraderItemPriceData(trader, new ItemPrice?(new ItemPrice(currencyId, Convert.ToInt32(Math.Floor(amount)))), amountInRoubles); ;
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
