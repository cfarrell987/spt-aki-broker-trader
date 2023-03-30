using Aki.Reflection.Patching;
using BrokerTraderPlugin;
using EFT.InventoryLogic;
using EFT.UI;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Aki.Common.Http;

using ItemPrice = TraderClass.GStruct219;
using CurrencyHelper = GClass2179;
using PriceHelper = GClass1969;

using Aki.Common.Utils;

using static BrokerTraderPlugin.PriceManager;
using TMPro;
using System.Text.RegularExpressions;
using Comfort.Common;

namespace BrokerPatch
{
    //  Pull the TraderClass enumerable from EFT.UI.MerchantsList
    public class PatchMerchantsList : ModulePatch
    {
        protected override MethodBase GetTargetMethod()
        {
            return typeof(MerchantsList).GetMethod("Show", BindingFlags.Instance | BindingFlags.Public);
        }

        [PatchPostfix]
        private static void PatchPostfix(MerchantsList __instance, IEnumerable<TraderClass> tradersList)
        {
            //Logger.LogMessage($"[BROKER TRADER] Supported traders {PriceManager.SupportedTraderIds.Length}");
            //Logger.LogMessage($"[BROKER TRADER] Item ragfair price count {PriceManager.ItemRagfairPriceTable.Count}");
            //Logger.LogMessage($"[BROKER TRADER] Received {PriceManager.SupplyData.Count} SupplyData instances.");
            //Logger.LogMessage($"[BROKER TRADER] ITEM RAGFAIR TABLE.");
            //Logger.LogMessage($"{Json.Serialize(ItemRagfairPriceTable)}");
            //string response = RequestHandler.GetJson("/broker-trader/item-ragfair-price-table");
            //Logger.LogMessage($"{response}");
            //Logger.LogMessage($"[BROKER TRADER] {Json.Serialize(ItemRagfairPriceTable)}");

            //Logger.LogMessage($"{Json.Serialize(PriceManager.SupplyData)}");

            // Request SupplyData from default SPT-AKI server route
            // Path example -> /client/items/prices/54cb57776803fa99248b456e
            //string response = RequestHandler.GetJson($"/client/items/prices/54cb57776803fa99248b456e");
            //var body = Json.Deserialize<PriceManager.ResponseBody>(response);
            //Logger.LogMessage($"{Json.Serialize(body)}");
            //var body2 = Json.Deserialize<ResponseBody<SupplyData>>(response);
            //Logger.LogMessage($"{Json.Serialize(body2)}");

            //Logger.LogMessage($"{Json.Serialize(PriceManager.SupportedTraderIds)}");

            //Logger.LogMessage($"{Json.Serialize(PriceManager.ItemRagfairPriceTable)}");

            //string response2 = RequestHandler.GetJson($"/broker-trader/item-ragfair-price-table");
            //Logger.LogMessage($"{response2}");

            // Get supported TraderClass instancess to work with.
            // PriceManager static constructor will most likely init here, so expect requets
            TradersList = tradersList.Where((trader) => SupportedTraderIds.Contains(trader.Id));
            Session = typeof(MerchantsList).GetField("ginterface128_0", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(__instance) as ISession;
            BackendCfg = Singleton<BackendConfigSettingsClass>.Instance;
            //Logger.LogMessage($"[BROKER TRADER] PriceManager.TradersList count {PriceManager.TradersList.Count()}");
        }
    }
    //  Patch price calculation method in TraderClass
    public class PatchGetUserItemPrice : ModulePatch
    {
        protected override MethodBase GetTargetMethod()
        {
            //TraderClass - GetUserItemPrice - WORKS! use postfix patch 
            //TradingItemView - SetPrice -> WORKS! use prefix patch
            return typeof(TraderClass).GetMethod("GetUserItemPrice", BindingFlags.Instance | BindingFlags.Public);
            //return typeof(TradingItemView).Get("ItemPrice", BindingFlags.Instance | BindingFlags.NonPublic);
            //throw new NotImplementedException();
        }

        [PatchPostfix]
        private static void PatchPostfix(ref TraderClass __instance, Item item, ref ItemPrice? __result)
        {
            //Logger.LogInfo("PATCH EXECUTED");
            //Nullable<TradeItemPrice> nulprice = __result as Nullable<TradeItemPrice>;

            // Only affect the Broker
            if (__instance.Id == BROKER_TRADER_ID)
            {
                if (__result != null)
                {
                    //var bestPrice = GetBestTraderPrice(item);
                    //Logger.LogInfo($"TRADER {bestPrice.Trader.LocalizedName} ROUBLE AMOUNT {bestPrice.RoubleAmount}");
                    //Logger.LogInfo(Json.Serialize(GetBestSellItemPrice(item)));
                    //TraderItemPriceData traderPrice = GetBestTraderPriceData(item);
                    //RagfairItemPriceData ragfairPrice = GetRagfairItemPriceData(item);
                    //Logger.LogMessage($"[BROKER PRICE] Trader: {Json.Serialize(traderPrice.Price)} Ragfair: {Json.Serialize(ragfairPrice)}");
                    __result = GetBestItemPrice(item);
                    //TraderClass bestTrader = PriceManager.TradersList.First();
                    //SellItemPrice? bestPrice = PriceManager.GetUserItemPriceInRoubles(bestTrader, item);
                    //Logger.LogInfo($"First Trader Name {bestTrader.LocalizedName}");

                    //foreach (var trader in PriceManager.TradersList)
                    //{
                    //    Logger.LogMessage($"TRADER NAME: {trader.LocalizedName}");
                    //    var checkPrice = PriceManager.GetUserItemPriceInRoubles(trader, item);
                    //    Logger.LogInfo(Json.Serialize(checkPrice));
                    //    if (checkPrice == null) continue;
                    //    if (checkPrice.GetValueOrDefault().Amount > bestPrice.GetValueOrDefault().Amount)
                    //    {
                    //        bestTrader = trader;
                    //        bestPrice = checkPrice; 
                    //    }
                    //}
                    //Logger.LogInfo(Json.Serialize(bestPrice));
                    //__result = PriceManager.GetBestSellItemPrice(item);
                }
                //Logger.LogMessage($"[BROKER TRADER] Best Trader {}");
            }

            //Nullable<TradeItemPrice> nulprice = price as Nullable<TradeItemPrice>;
            //__instance = new TradeItemPrice(__instance.CurrencyId, 228);
            //int num = (nulprice != null) ? nulprice.GetValueOrDefault().Amount : 0;
            //Logger.LogInfo($"[BROKER TRADER] AMOUNT {num}!");
            //TradeItemPrice itemPrice = typeof(TradingItemView).GetField("ItemPrice", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(__instance) as ;

        }
    }
    //  Change how total transaction sum is generated when selling to trader.
    public class PatchEquivalentSum : ModulePatch
    {
        protected override MethodBase GetTargetMethod()
        {
            // method_10 assigns a sprite and text value to "_equivalentSum" when selling items
            return typeof(TraderDealScreen).GetMethod("method_10", BindingFlags.Instance | BindingFlags.NonPublic);
        }

        [PatchPostfix]
        private static void PatchPostfix(TraderDealScreen __instance)
        {
            var trader = typeof(TraderDealScreen).GetField("gclass1949_0", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(__instance) as TraderClass;
            var _equivalentSumValue = typeof(TraderDealScreen).GetField("_equivalentSumValue", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(__instance) as TextMeshProUGUI;
            if (trader.Id == BROKER_TRADER_ID)
            {
                List<ItemPrice?> source = trader.CurrentAssortment.SellingStash.Containers.First().Items.Select(GetBestItemPrice).Where(itemPrice => itemPrice != null).ToList();
                if (!source.Any()) _equivalentSumValue.text = "";
                else
                {
                    //_equivalentSumValue.text = "ПАШОЛ НАХУЙ БОМЖ";
                    var groupByCurrency = source.GroupBy(price => price.GetValueOrDefault().CurrencyId).Select(currencyGroup => new
                    {
                        CurrencyId = currencyGroup.Key,
                        Amount = currencyGroup.Sum(price => price.GetValueOrDefault().Amount),
                    });
                    // Rouble amount has to be always first. Since Broker's main currency is RUB.
                    _equivalentSumValue.text = groupByCurrency.Where(group => group.CurrencyId == CurrencyHelper.ROUBLE_ID).Select(group => group.Amount).FirstOrDefault().ToString();
                    foreach (var currency in groupByCurrency.Where(group => group.CurrencyId != CurrencyHelper.ROUBLE_ID))
                    {
                        _equivalentSumValue.text += $" + {CurrencyHelper.GetCurrencyCharById(currency.CurrencyId)} {currency.Amount}";
                    }
                }
            }
            Regex regex = new Regex("\\B(?=(\\d{3})+(?!\\d))");
            _equivalentSumValue.text = regex.Replace(_equivalentSumValue.text, " ");
        }
    }
    //  Before showing the trader screen refresh ragfair prices. This fixes price inconsistency if you didn't open ragfair menu yet.
    public class PatchRefreshRagfairOnTraderScreenShow : ModulePatch
    {
        protected override MethodBase GetTargetMethod()
        {
            // method_10 assigns a sprite and text value to "_equivalentSum" when selling items
            return typeof(TraderDealScreen).GetMethod("Show", BindingFlags.Instance | BindingFlags.Public);
        }

        [PatchPrefix]
        private static void PatchPrefix(TraderClass trader)
        {
            if (trader.Id == BROKER_TRADER_ID && PriceManager.ModConfig.UseRagfair)
            {
                //Logger.LogMessage($"Ragfair status {Session.RagFair.Status}");
                Session.RagFair.RefreshItemPrices();
            }
        }
    }
    //  Send accurate client item data to server when user pressed "DEAL!" on the trade screen.
    public class PatchSendDataOnDealButtonPress : ModulePatch
    {
        protected override MethodBase GetTargetMethod()
        {
            // Might be NonPublic, unknown. If won't work, try TraderAssortmentControllerClass method Sell().
            return typeof(TraderAssortmentControllerClass).GetMethod("Sell", BindingFlags.Instance | BindingFlags.Public);
        }

        // Prefer prefix patch to make sure that the request is sent in time. (Although it's probably sync)
        [PatchPrefix]
        private static void PatchPrefix(TraderAssortmentControllerClass __instance)
        {
            var trader = __instance.GetType().GetField("gclass1949_0", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(__instance) as TraderClass;
            if (trader.Id == BROKER_TRADER_ID)
            {
                // Both are probably be identical, but use lower for consistency with source code.
                // var soldItems = __instance.SellingStash.Containers.First().Items; 
                var soldItems = __instance.SellingTableGrid.ContainedItems.Keys.ToList();
                //foreach(var soldItem in soldItems)
                //{
                //    Logger.LogMessage($"{soldItem.LocalizedName()} tax: {PriceHelper.CalculateTaxPrice(soldItem, soldItem.StackObjectsCount, GetBrokerItemSellData(soldItem).PriceInRoubles, true)}");
                //}
                if(soldItems.Count > 0)
                {
                    Dictionary<string, BrokerItemSellData> sellData = soldItems.Select(GetBrokerItemSellData).ToDictionary(data => data.ItemId);
                    RequestHandler.PostJson("/broker-trader/post/sold-items-data", Json.Serialize(sellData));
                }
            }
        }

        
    }

}
