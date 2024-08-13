using EFT.InventoryLogic;
using System;
using System.Collections.Generic;
using System.Linq;
//using ItemPrice = TraderClass.GStruct219; // now use BrokerTraderPlugin.Reflections.ItemPrice instead of generic struct reference
//using CurrencyHelper = GClass2182; // now use BrokerTraderPlugin.Reflections.CurrencyHelper instead of generic class reference
//using PriceHelper = GClass1972; //GClass1969; // now use BrokerTraderPlugin.Reflections.PriceHelper instead of generic class reference
//using RepairKitComponent = GClass2387; //GClass2384; // not used since GetSingleItemBuyoutPrice is used for ragfair price calculation.
using EFT;
using UnityEngine;
using SPT.Common.Http;
using SPT.Common.Utils;
using Newtonsoft.Json;
using BrokerTraderPlugin.Reflections;
using EFT.Communications;
using BrokerTraderPlugin.Reflections.Extensions;
using Comfort.Common;
using SPT.Reflection.Utils;
using BepInEx.Logging;

namespace BrokerTraderPlugin
{
    internal struct ModConfig
    {
        public float BuyRateDollar { get; set; }
        public float BuyRateEuro { get; set; }
        public float ProfitCommissionPercentage { get; set; }
        public bool UseRagfair { get; set; }
        public bool RagfairIgnoreAttachments { get; set; }
        public bool RagfairIgnoreFoundInRaid { get; set; }
        public bool RagfairIgnorePlayerLevel { get; set; }
        public bool TradersIgnoreUnlockedStatus { get; set; }
        public bool UseNotifications { get; set; }
        public bool NotificationsLongerDuration { get; set; }
        public bool UseClientPlugin { get; set; }
    }

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
    internal readonly struct TraderItemPriceData
    {
        public readonly string TraderId { get; }
        public readonly object Price { get; }
        public readonly int Amount { get; }
        public readonly int AmountInRoubles { get; }
        public readonly int Commission { get; }
        public readonly int CommissionInRoubles { get; }
        public TraderItemPriceData(string traderId, object price, int amount = -1, int amountInRoubles = -1, int commission = 0, int commissionInRoubles = 0)
        {
            TraderId = traderId;
            Price = price;
            Amount = amount;
            AmountInRoubles = amountInRoubles;
            Commission = commission;
            CommissionInRoubles = commissionInRoubles;
        }

        public int Profit
        {
            get
            {
                return Amount - Commission;
            }
        }

        public int ProfitInRoubles
        {
            get
            {
                return AmountInRoubles - CommissionInRoubles;
            }
        }
    }

    internal readonly struct RagfairItemPriceData
    {
        public readonly object Price { get; }
        public readonly int RequirementsAmount { get; }
        public readonly int Tax { get; }
        public readonly int Commission { get; }
        public RagfairItemPriceData(object price, int requirementsAmount, int tax = 0, int commission = 0)
        {
            Price = price;
            RequirementsAmount = requirementsAmount;
            Tax = tax;
            Commission = commission;
        }

        public int Profit
        {
            get
            {
                return RequirementsAmount - Tax - Commission;
            }
        }
    }

    internal struct BrokerItemSellData
    {
        public string ItemId { get; set; }
        public string TraderId { get; set; }
        public int Price { get; set; }
        public int PriceInRoubles { get; set; }
        public int Tax { get; set; }
        public int Commission { get; set; }
        public int CommissionInRoubles { get; set; }
        public BrokerItemSellData(string itemId, string traderId, int price, int priceInRoubles, int tax, int commission, int commissionInRoubles)
        {
            ItemId = itemId;
            TraderId = traderId;
            Price = price;
            PriceInRoubles = priceInRoubles;
            Tax = tax;
            Commission = commission;
            CommissionInRoubles = commissionInRoubles;
        }
    }

    internal class RagfairPrices : IBasePriceSource
    {
        public readonly Dictionary<string, double> PriceTable;
        public RagfairPrices(Dictionary<string, double> priceTable)
        {
            PriceTable = priceTable;
        }
        public double GetBasePrice(string itemTplId)
        {
            return PriceTable[itemTplId];
        }
        public bool ContainsItem(string itemTplId)
        {
            return PriceTable.ContainsKey(itemTplId);
        }
    }

    internal static class PriceManager
    {
        public const string BROKER_TRADER_ID = "broker-trader-id"; // "Currency ex. Broker tid" is handled serverside.

        public static ISession Session => ClientAppUtils.GetMainApp().GetClientBackEndSession();
        public static BackendConfigSettingsClass BackendCfg => Singleton<BackendConfigSettingsClass>.Instance;

        public static ModConfig ModConfig { get; set; }
        public static readonly ENotificationDurationType ModNotificationDuration;
        public static readonly string[] SupportedTraderIds = new string[0];
        public static readonly RagfairPrices RagfairPriceSource;
        public static readonly double RagfairSellRepGain;
        private static IEnumerable<TraderClass> _traderList;
        public static IEnumerable<TraderClass> TradersList
        {
            get
            {
                if (_traderList == null)
                {
                    _traderList = Session.Traders.Where((trader) => SupportedTraderIds.Contains(trader.Id) && (ModConfig.TradersIgnoreUnlockedStatus || trader.RInfo().Unlocked));
                }
                return _traderList;
            }
        }
        public static Dictionary<string, SupplyData> SupplyData = new Dictionary<string, SupplyData>();
        public static Dictionary<string, double> CurrencyBasePrices { get; set; } = [];
        // Requests in a static constructor will be performed only once for initialization.
        static PriceManager()
        {
            // Request config
            string response = RequestHandler.GetJson(Routes.GetModConfig);
            var modCfgBody = Json.Deserialize<ResponseBody<ModConfig>>(response);
            ThrowIfErrorResponseBody(modCfgBody, $"[BROKER TRADER] Couldn't get Mod Config!");
            ModConfig = modCfgBody.Data;
            ModNotificationDuration = ModConfig.NotificationsLongerDuration ? ENotificationDurationType.Long : ENotificationDurationType.Default;
            // Request PK and Skier USD/EUR prices
            response = RequestHandler.GetJson(Routes.GetCurrencyBasePrices);
            var currencyBasePricesData = Json.Deserialize<ResponseBody<Dictionary<string, double>>>(response);
            ThrowIfErrorResponseBody(currencyBasePricesData, $"[BROKER TRADER] Couldn't get Currency Base Prices!");
            CurrencyBasePrices = currencyBasePricesData.Data;

            // Request supported trader ids
            response = RequestHandler.GetJson(Routes.GetSupportedTraderIds);
            var supportedTradersBody = Json.Deserialize<ResponseBody<string[]>>(response);
            ThrowIfErrorResponseBody(supportedTradersBody, $"[BROKER TRADER] Couldn't get SupportedTraderIds!");
            SupportedTraderIds = supportedTradersBody.Data;

            // Request ragfair item price table.
            response = RequestHandler.GetJson(Routes.GetItemRagfairPriceTable);
            var ragfairTableBody = Json.Deserialize<ResponseBody<Dictionary<string, double>>>(response);
            ThrowIfErrorResponseBody(ragfairTableBody, $"[BROKER TRADER] Couldn't get Item Ragfair Price Table!");
            RagfairPriceSource = new RagfairPrices(ragfairTableBody.Data);

            // Request SupplyData from default SPT-AKI server route
            // Path example -> /client/items/prices/54cb57776803fa99248b456e
            foreach (string traderId in SupportedTraderIds)
            {
                response = RequestHandler.GetJson($"{Routes.ClientItemsPrices}/{traderId}");
                ResponseBody<SupplyData> body = Json.Deserialize<ResponseBody<SupplyData>>(response);
                ThrowIfErrorResponseBody(body, $"[BROKER TRADER] Couldn't get prices for traderId {traderId}");
                SupplyData.Add(traderId, body.Data);
            }

            // Request Ragfair Config Sell Rep Gain
            response = RequestHandler.GetJson(Routes.GetRagfairSellRepGain);
            var sellRepGainBody = Json.Deserialize<ResponseBody<double>>(response);
            ThrowIfErrorResponseBody(sellRepGainBody, $"[BROKER TRADER] Couldn't get Ragfair Sell Rep Gain!");
            RagfairSellRepGain = sellRepGainBody.Data;
        }
        // Gets the best paying trader and his price data.
        public static TraderItemPriceData GetBestTraderPriceData(Item item)
        {
            // Shouldn't happen, since tradersList will be assigned post MerchantsList.Show(),
            // before user opens any trader window.
            if (TradersList == null || TradersList?.Count() < 1)
            {
                const string msg = "Trying to PriceManager.getBestPrice while tradersList is empty, this shouldn't happen!";
                //Debug.LogError(msg); doesn't seem to work
                throw new Exception(msg);
            }

            // Explicitly assign Broker to currencies
            // So accepted items are governed by base.json, or setup in the mod.ts.
            if (CurrencyHelper.IsCurrencyId(item.TemplateId) && item.TemplateId != CurrencyHelper.ROUBLE_ID)
            {
                double amount = CurrencyBasePrices[item.TemplateId] * item.StackObjectsCount;
                if (item.TemplateId == CurrencyHelper.DOLLAR_ID) amount *= ModConfig.BuyRateDollar;
                if (item.TemplateId == CurrencyHelper.EURO_ID) amount *= ModConfig.BuyRateEuro;
                int roundedAmount = Convert.ToInt32(Math.Round(amount));
                return new TraderItemPriceData(BROKER_TRADER_ID, ItemPrice.New(CurrencyHelper.ROUBLE_ID, roundedAmount), roundedAmount, roundedAmount, 0, 0);
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
                // Debug.LogError("supplyData is null"); doesn't seem to work
                // use long duration, infinite is unneeded.
                NotificationManagerClass.DisplayWarningNotification("BrokerTrader error! GetTraderItemPriceData - supplyData is null", ENotificationDurationType.Default);
                return new TraderItemPriceData(trader.Id, null, -1, -1);
            }
            if (!trader.RInfo().CanBuyItem(item)) return new TraderItemPriceData(trader.Id, null, -1, -1);
            string currencyId = CurrencyHelper.GetCurrencyId(trader.Settings.Currency);
            double amount = PriceHelper.CalculateBasePriceForAllItems(item, 0, SupplyData[trader.Id], trader.Settings.BuyerUp);
            int amountInRoubles = Convert.ToInt32(Math.Floor(trader.RInfo().ApplyPriceModifier(amount))); // save rouble price
            int commissionInRoubles = Convert.ToInt32(Math.Round(amountInRoubles * ModConfig.ProfitCommissionPercentage / 100));


            amount /= SupplyData[trader.Id].CurrencyCourses[currencyId];
            amount = trader.RInfo().ApplyPriceModifier(amount);

            int finalAmount = Convert.ToInt32(Math.Floor(amount));
            int commission = Convert.ToInt32(Math.Round(finalAmount * ModConfig.ProfitCommissionPercentage / 100));
            if (amount.RApproxEquals(0.0))
            {
                return new TraderItemPriceData(trader.Id, null, -1, -1);
            }
            return new TraderItemPriceData(trader.Id, ItemPrice.New(currencyId, finalAmount - commission), finalAmount, amountInRoubles, commission, commissionInRoubles);
        }

        public static RagfairItemPriceData GetRagfairItemPriceData(Item item)
        {
            if (!ModConfig.UseRagfair)
            {
                return new RagfairItemPriceData(null, -1);
            }

            if (item.IsContainer && item.RGetAllItems().Count() > 1)
            {
                return new RagfairItemPriceData(null, -1);
            }
            double requirementsPrice = 0.0;

            if (ModConfig.RagfairIgnoreAttachments)
            {
                requirementsPrice = GetSingleRagfairItemPriceData(item);
                if (requirementsPrice < 1) return new RagfairItemPriceData(null, -1);
            }
            else
            {
                //foreach (var itemIter in item.GetAllItems())
                foreach (var itemIter in item.RGetAllItems())
                {
                    double priceIter = GetSingleRagfairItemPriceData(itemIter);
                    if (priceIter < 1) return new RagfairItemPriceData(null, -1);
                    requirementsPrice += priceIter;
                }
            }

            // !IMPORTANT Ceil the price. Reference -> AddOfferWindow.method_3().
            // Before passing offer requirements amount into CalculateTaxPrice its always Ceiled.
            int amount = Convert.ToInt32(Math.Ceiling(requirementsPrice));
            // !IMPORTANT Use Mathf.RoundToInt for the tax. Helps with Infinity occurences.
            // The tax displayed on AddOfferWindow seems to be rounded due to calling FormatSeparate()
            int tax = Mathf.RoundToInt((float)PriceHelper.CalculateTaxPrice(item, item.StackObjectsCount, amount, true));

            int commission = Convert.ToInt32(Math.Round(amount * ModConfig.ProfitCommissionPercentage / 100));


            return new RagfairItemPriceData(ItemPrice.New(CurrencyHelper.ROUBLE_ID, amount - tax - commission), amount, tax, commission);
        }

        // using CalculateBuyoutPrice from PriceHelper would help with reflection.
        public static double GetSingleRagfairItemPriceData(Item item)
        {
            //if (!isFoundInRaid(item) || !isRagfairUnlocked() || !ItemRagfairPriceTable.ContainsKey(item.TemplateId) /*|| item.CanSellOnRagfair*/) return new RagfairItemPriceData(-1, -1, null);
            // !ItemRagfairPriceTable.ContainsKey(item.TemplateId) - checks if item not blacklisted.
            // Should be correct since the look-up table provided by the server contains only non-blacklisted items.
            if (!isFoundInRaid(item) || !isRagfairUnlocked() || !RagfairPriceSource.ContainsItem(item.TemplateId) /*|| item.CanSellOnRagfair*/) return -1;

            // When zero is used as "itemsCount" param - StackObjectsCount is used.
            // isFence has to be true, to ignore component restrictions(durability, resource, etc.)
            // RagfairPriceSource is used as IBasePriceSource object, it will be used as base price source instead of handbook.
            return PriceHelper.CalculateBuyoutBasePriceForSingleItem(item, 0, RagfairPriceSource, true);
        }
        public static object GetBestItemPrice(Item item)
        {
            TraderItemPriceData traderPrice = GetBestTraderPriceData(item);
            RagfairItemPriceData ragfairPrice = GetRagfairItemPriceData(item);
            // UseRagfair check is not necessary but let it be an extra measure.
            return ModConfig.UseRagfair && ragfairPrice.Profit >= traderPrice.ProfitInRoubles
                ? ragfairPrice.Price
                : traderPrice.Price;
        }
        public static BrokerItemSellData GetBrokerItemSellData(Item item)
        {
            TraderItemPriceData traderPrice = GetBestTraderPriceData(item);
            RagfairItemPriceData ragfairPrice = GetRagfairItemPriceData(item);
            // UseRagfair check is not necessary but let it be an extra measure.
            return ModConfig.UseRagfair && ragfairPrice.Profit >= traderPrice.ProfitInRoubles
                ? new BrokerItemSellData(item.Id, BROKER_TRADER_ID, ragfairPrice.RequirementsAmount, ragfairPrice.RequirementsAmount, ragfairPrice.Tax, ragfairPrice.Commission, ragfairPrice.Commission)
                : new BrokerItemSellData(item.Id, traderPrice.TraderId, traderPrice.Amount, traderPrice.AmountInRoubles, 0, traderPrice.Commission, traderPrice.CommissionInRoubles);
        }

        private static bool isFoundInRaid(Item item)
        {
            // item.MarkedAsSpawnedInSession also can be used, they return the same property anyway.
            return item.CanSellOnRagfairRaidRelated || ModConfig.RagfairIgnoreFoundInRaid;
        }
        private static bool isRagfairUnlocked()
        {
            if (Session?.RagFair?.Available == null) return false;
            return Session.RagFair.Available;
        }

        private static void ThrowIfErrorResponseBody<T>(ResponseBody<T> body, string message)
        {
            if (body.Error != 0)
            {
                //Debug.LogError(message); doesn't seem to work
                throw new Exception(message);
            }
        }
    }
}
