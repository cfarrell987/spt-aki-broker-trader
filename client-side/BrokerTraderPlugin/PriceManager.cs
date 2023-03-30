using EFT.InventoryLogic;
using System;
using System.Collections.Generic;
using System.Linq;
using ItemPrice = TraderClass.GStruct219;
using CurrencyHelper = GClass2179;
using PriceHelper = GClass1969;
using RepairKitComponent = GClass2384;
using EFT;
using UnityEngine;
using Aki.Common.Http;
using Aki.Common.Utils;
using Newtonsoft.Json;
using Comfort.Common;

namespace BrokerTraderPlugin
{
    internal struct ModConfig
    {
        public bool UseRagfair { get; set; }
        public bool RagfairIgnoreAttachments { get; set; }
        public bool RagfairIgnoreFoundInRaid { get; set; }
        public bool RagfairIgnorePlayerLevel { get; set; }
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

    internal readonly struct RagfairItemPriceData
    {
        public readonly int RequirementsAmount { get; }
        public readonly int Tax { get; }
        public readonly ItemPrice? Price { get; }
        public RagfairItemPriceData(int requirementsAmount, int tax, ItemPrice? price)
        {
            RequirementsAmount = requirementsAmount;
            Price = price;
            Tax = tax;
        }
    }

    internal struct BrokerItemSellData
    {
        public string ItemId { get; set; }
        public string TraderId { get; set; }
        public int Price { get; set; }
        public int PriceInRoubles { get; set; }
        public int Tax { get; set; }

        public BrokerItemSellData(string itemId, string traderId, int price, int priceInRoubles, int tax)
        {
            ItemId = itemId;
            TraderId = traderId;
            Price = price;
            PriceInRoubles = priceInRoubles;
            Tax = tax;
        }
    }

    internal static class PriceManager
    {
        public const string BROKER_TRADER_ID = "broker-trader-id";
        public static ISession Session { get; set; }
        public static ModConfig ModConfig { get; set; }
        public static BackendConfigSettingsClass BackendCfg { get; set; }
        public static readonly string[] SupportedTraderIds = new string[0];
        public static Dictionary<string, double> ItemRagfairPriceTable { get; set; } = new Dictionary<string, double>();
        public static IEnumerable<TraderClass> TradersList { get; set; } = null;
        public static Dictionary<string, SupplyData> SupplyData = new Dictionary<string, SupplyData>();
        // Requests in a static constructor will be performed only once for initialization.
        static PriceManager()
        {
            // Request config
            string response = RequestHandler.GetJson("/broker-trader/get/mod-config");
            var modCfgBody = Json.Deserialize<ResponseBody<ModConfig>>(response);
            ThrowIfErrorResponseBody(modCfgBody, $"[BROKER TRADER] Couldn't get Mod Config!");
            ModConfig = modCfgBody.Data;

            // Request supported trader ids
            response = RequestHandler.GetJson("/broker-trader/get/supported-trader-ids");
            var supportedTradersBody = Json.Deserialize<ResponseBody<string[]>>(response);
            ThrowIfErrorResponseBody(supportedTradersBody, $"[BROKER TRADER] Couldn't get SupportedTraderIds!");
            SupportedTraderIds = supportedTradersBody.Data;

            // Request ragfair item price table.
            response = RequestHandler.GetJson("/broker-trader/get/item-ragfair-price-table");
            var ragfairTableBody = Json.Deserialize<ResponseBody<Dictionary<string, double>>>(response);
            ThrowIfErrorResponseBody(ragfairTableBody, $"[BROKER TRADER] Couldn't get Item Ragfair Price Table!");
            ItemRagfairPriceTable = ragfairTableBody.Data;

            // Request SupplyData from default SPT-AKI server route
            // Path example -> /client/items/prices/54cb57776803fa99248b456e
            foreach (string traderId in SupportedTraderIds)
            {
                response = RequestHandler.GetJson($"/client/items/prices/{traderId}");
                ResponseBody<SupplyData> body = Json.Deserialize<ResponseBody<SupplyData>>(response);
                ThrowIfErrorResponseBody(body, $"[BROKER TRADER] Couldn't get prices for traderId {traderId}");
                SupplyData.Add(traderId, body.Data);
            }
        }
        // Gets the best paying trader and his price data.
        public static TraderItemPriceData GetBestTraderPriceData(Item item)
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

        public static RagfairItemPriceData GetRagfairItemPriceData(Item item)
        {
            if(!ModConfig.UseRagfair)
            {
                return new RagfairItemPriceData(-1, -1, null);
            }

            if (item.IsContainer && item.GetAllItems().Count() > 1)
            {
                return new RagfairItemPriceData(-1, -1, null);
            }
            double requirementsPrice = 0.0;

            if (ModConfig.RagfairIgnoreAttachments)
            {
                requirementsPrice = GetSingleRagfairItemPriceData(item);
                if (requirementsPrice < 1) return new RagfairItemPriceData(-1, -1, null);
            }
            else
            {
                foreach (var itemIter in item.GetAllItems())
                {
                    double priceIter = GetSingleRagfairItemPriceData(itemIter);
                    if (priceIter < 1) return new RagfairItemPriceData(-1, -1, null);
                    requirementsPrice += priceIter;
                }
            }

            // !IMPORTANT Ceil the price. Reference -> AddOfferWindow.method_3().
            // Before passing offer requirements amount into CalculateTaxPrice its always Ceiled.
            int amount = Convert.ToInt32(Math.Ceiling(requirementsPrice));
            // !IMPORTANT Use Mathf.RoundToInt for the tax. Helps with Infinity occurences.
            // The tax displayed on AddOfferWindow seems to be rounded due to calling FormatSeparate()
            int tax = Mathf.RoundToInt((float)PriceHelper.CalculateTaxPrice(item, item.StackObjectsCount, amount, true));


            return new RagfairItemPriceData(amount, tax, new ItemPrice?(new ItemPrice(CurrencyHelper.ROUBLE_ID, amount - tax)));
        }

        public static double GetSingleRagfairItemPriceData(Item item)
        {
            //if (!isFoundInRaid(item) || !isRagfairUnlocked() || !ItemRagfairPriceTable.ContainsKey(item.TemplateId) /*|| item.CanSellOnRagfair*/) return new RagfairItemPriceData(-1, -1, null);
            // !ItemRagfairPriceTable.ContainsKey(item.TemplateId) - checks if item not blacklisted.
            // Should be correct since the look-up table provided by the server contains only non-blacklisted items.
            if (!isFoundInRaid(item) || !isRagfairUnlocked() || !ItemRagfairPriceTable.ContainsKey(item.TemplateId) /*|| item.CanSellOnRagfair*/) return -1;

            // Basically base price(avg flea price)
            // Will be overwritten.
            double requirementsPrice = ItemRagfairPriceTable[item.TemplateId];

            RepairableComponent repairableComponent;
            if (item.TryGetItemComponent(out repairableComponent))
            {
                // - Will be useful when Repairable prices on flea will start accounting all this
                //
                //double num2 = 0.01 * Math.Pow(0.0, (double)repairableComponent.MaxDurability);
                //float num3 = Mathf.Ceil(repairableComponent.MaxDurability);
                //float num4 = (float)item.RepairCost * (num3 - (float)Mathf.CeilToInt(repairableComponent.Durability));
                //requirementsPrice = requirementsPrice * ((double)(num3 / (float)repairableComponent.TemplateDurability) + num2) - (double)num4;

                // - As of SPT-AKI 3.5.3 Repairable items only seems to change based on current Durability, not anything else.
                //
                requirementsPrice = requirementsPrice / repairableComponent.TemplateDurability * repairableComponent.Durability;
                // Same goes for every other item.
            }

            //DogtagComponent dogtagComponent;
            //if (item.TryGetItemComponent<DogtagComponent>(out dogtagComponent))
            //{
            //    requirementsPrice *= (double)dogtagComponent.Level;
            //}
            KeyComponent keyComponent;
            if (item.TryGetItemComponent<KeyComponent>(out keyComponent) && keyComponent.Template.MaximumNumberOfUsage > 0)
            {
                // IMPORTANT
                // keyComponent.NumberOfUsages <- actually means TIMES USED, so to get NumberOfUsages "left" subtract this from MaximumNumberOfUsage
                //
                // bruh
                requirementsPrice = requirementsPrice / (double)keyComponent.Template.MaximumNumberOfUsage * (double)(keyComponent.Template.MaximumNumberOfUsage - keyComponent.NumberOfUsages);

            }
            ResourceComponent resourceComponent;
            if (item.TryGetItemComponent<ResourceComponent>(out resourceComponent) && resourceComponent.MaxResource > 0f)
            {
                requirementsPrice = requirementsPrice * 0.1 + requirementsPrice * 0.9 / (double)resourceComponent.MaxResource * (double)resourceComponent.Value;
            }
            SideEffectComponent sideEffectComponent;
            if (item.TryGetItemComponent<SideEffectComponent>(out sideEffectComponent) && sideEffectComponent.MaxResource > 0f)
            {
                requirementsPrice = requirementsPrice * 0.1 + requirementsPrice * 0.9 / (double)sideEffectComponent.MaxResource * (double)sideEffectComponent.Value;
            }
            MedKitComponent medKitComponent;
            if (item.TryGetItemComponent<MedKitComponent>(out medKitComponent))
            {
                requirementsPrice = requirementsPrice / (double)medKitComponent.MaxHpResource * (double)medKitComponent.HpResource;
            }
            FoodDrinkComponent foodDrinkComponent;
            if (item.TryGetItemComponent<FoodDrinkComponent>(out foodDrinkComponent))
            {
                requirementsPrice = requirementsPrice / (double)foodDrinkComponent.MaxResource * (double)foodDrinkComponent.HpPercent;
            }
            RepairKitComponent repairKitComponent;
            if ((repairKitComponent = (item as RepairKitComponent)) != null)
            {
                requirementsPrice = requirementsPrice / (double)repairKitComponent.MaxRepairResource * (double)Math.Max(repairKitComponent.Resource, 1f);
            }
            // Moved it from the first spot in the order to the last one, since it's some sort of multiplier.
            BuffComponent buffComponent;
            BackendConfigSettingsClass.GClass1301.GClass1303 gclass;
            if (item.TryGetItemComponent(out buffComponent) && Singleton<BackendConfigSettingsClass>.Instance.RepairSettings.ItemEnhancementSettings != null && Singleton<BackendConfigSettingsClass>.Instance.RepairSettings.ItemEnhancementSettings.TryGetValue(buffComponent.BuffType, out gclass))
            {
                requirementsPrice *= 1.0 + Math.Abs(buffComponent.Value - 1.0) * (double)gclass.PriceModifier;
            }
            requirementsPrice *= item.StackObjectsCount;
            // !IMPORTANT Round the tax
            //int tax = Convert.ToInt32(Math.Round(PriceHelper.CalculateTaxPrice(item, item.StackObjectsCount, requirementsPrice, true)));
            // !IMPORTANT Floor the price
            //int amount = Convert.ToInt32(Math.Floor(requirementsPrice));
            //return new RagfairItemPriceData(amount, tax, new ItemPrice?(new ItemPrice(CurrencyHelper.ROUBLE_ID, amount - tax)));
            return requirementsPrice;
        }
        public static ItemPrice? GetBestItemPrice(Item item)
        {
            TraderItemPriceData traderPrice = GetBestTraderPriceData(item);
            RagfairItemPriceData ragfairPrice = GetRagfairItemPriceData(item);
            // For now leave the "useRagfair" here so if any integral issues are present
            // they will be detected since both the code for trader and ragfair pricing will run.
            // Later "useRagfair" should simply set the RequirementsAmount to -1 in GetSignleRagfairItemPriceData
            return ModConfig.UseRagfair && ragfairPrice.RequirementsAmount >= traderPrice.AmountInRoubles
                ? ragfairPrice.Price
                : traderPrice.Price;
        }
        public static BrokerItemSellData GetBrokerItemSellData(Item item)
        {
            TraderItemPriceData traderPrice = GetBestTraderPriceData(item);
            RagfairItemPriceData ragfairPrice = GetRagfairItemPriceData(item);
            // For now leave the "useRagfair" here so if any integral issues are present
            // they will be detected since both the code for trader and ragfair pricing will run.
            // Later "useRagfair" should simply set the RequirementsAmount to -1 in GetSignleRagfairItemPriceData
            return ModConfig.UseRagfair && ragfairPrice.RequirementsAmount >= traderPrice.AmountInRoubles
                ? new BrokerItemSellData(item.Id, BROKER_TRADER_ID, ragfairPrice.RequirementsAmount, ragfairPrice.RequirementsAmount, ragfairPrice.Tax)
                : new BrokerItemSellData(item.Id, traderPrice.Trader.Id, traderPrice.Price.GetValueOrDefault().Amount, traderPrice.AmountInRoubles, 0);
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
                Debug.LogError(message);
                throw (new Exception(message));
            }
        }
    }
}
