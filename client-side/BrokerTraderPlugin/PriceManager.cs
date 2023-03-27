using EFT.InventoryLogic;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using ItemPrice = TraderClass.GStruct219;
using CurrencyHelper = GClass2179;
using PriceHelper = GClass1969;
using RepairKitComponent = GClass2384;
using EFT;
using UnityEngine;
using Aki.Common.Http;
using Aki.Common.Utils;
using Newtonsoft.Json;
using static UnityEngine.UIElements.UIRAtlasManager;
using Comfort.Common;

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

    internal static class PriceManager
    {
        public static readonly string[] SupportedTraderIds = new string[0];
        public static Dictionary<string, int> ItemRagfairPriceTable { get; set; } = new Dictionary<string, int>();
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
            ItemRagfairPriceTable = Json.Deserialize<Dictionary<string, int>>(response);

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
        public static RagfairItemPriceData GetRagfairItemPriceData(Item item)
        {
            if (!item.CanSellOnRagfairRaidRelated || !ItemRagfairPriceTable.ContainsKey(item.TemplateId) /*|| item.CanSellOnRagfair*/) return new RagfairItemPriceData(-1, -1, null);

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
            int tax = Convert.ToInt32(Math.Round(PriceHelper.CalculateTaxPrice(item, item.StackObjectsCount, requirementsPrice, true))); 
            // !IMPORTANT Floor the price
            int amount = Convert.ToInt32(Math.Floor(requirementsPrice)); 
            Debug.LogError($"TplId {item.TemplateId} Item Tax {tax}, StackObjectsCount {item.StackObjectsCount}");
            return new RagfairItemPriceData(amount, tax, new ItemPrice?(new ItemPrice(CurrencyHelper.ROUBLE_ID, amount - tax)));
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
