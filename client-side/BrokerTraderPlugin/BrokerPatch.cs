using Aki.Reflection.Patching;
using BrokerTraderPlugin;
using EFT.InventoryLogic;
using EFT.UI;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Aki.Common.Http;

//using ItemPrice = TraderClass.GStruct219;
//using CurrencyHelper = GClass2182; // old was GClass2179 // now use BrokerTraderPlugin.CurrencyHelper instead of generic class reference

using Aki.Common.Utils;

using static BrokerTraderPlugin.PriceManager;
using TMPro;
using System.Text.RegularExpressions;
using Comfort.Common;
using HarmonyLib;
using System;
using BrokerTraderPlugin.Reflections;

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
        private static void PatchPostfix(MerchantsList __instance, IEnumerable<TraderClass> tradersList, ISession session)
        {
            // Get supported TraderClass instancess to work with.
            try
            {
                TradersList = tradersList.Where((trader) => SupportedTraderIds.Contains(trader.Id));
                //Session = Traverse.Create(__instance).Fields().Select(fName => AccessTools.Field(typeof(MerchantsList), fName)).FirstOrDefault(field => field.FieldType == typeof(ISession)).GetValue(__instance) as ISession;
                //Session = typeof(MerchantsList).GetField("ginterface128_0", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(__instance) as ISession;
                Session = session; // session is actually one of the args, bruh
                BackendCfg = Singleton<BackendConfigSettingsClass>.Instance;
                if (Session == null) throw new Exception("Session is null.");
            }
            catch (Exception ex)
            {
                var msg = $"{PluginInfo.PLUGIN_GUID} error! Threw an exception during MerchantsList patch, perhaps due to version incompatibility. Exception message: {ex.Message}";
                Logger.LogError(msg);
                NotificationManagerClass.DisplayWarningNotification(msg, EFT.Communications.ENotificationDurationType.Infinite);
            }
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
        }

        [PatchPostfix]
        private static void PatchPostfix(ref TraderClass __instance, Item item, ref object __result)
        {
            // Only affect the Broker
            if (__instance.Id == BROKER_TRADER_ID)
            {
                if (__result != null)
                {
                    try
                    {
                        __result = GetBestItemPrice(item);
                    }
                    catch (Exception ex)
                    {
                        var msg = $"{PluginInfo.PLUGIN_GUID} error! Threw an exception during GetUserItemPrice patch, perhaps due to version incompatibility. Exception message: {ex.Message}";
                        Logger.LogError(msg);
                        NotificationManagerClass.DisplayWarningNotification(msg, EFT.Communications.ENotificationDurationType.Infinite);
                    }
                }
            }
        }
    }
    //  Change how total transaction sum is generated when selling to trader.
    public class PatchEquivalentSum : ModulePatch
    {
        protected override MethodBase GetTargetMethod()
        {
            // method_10 assigns a sprite and text value to "_equivalentSum" when selling items
            // method_10 is still the same for 3.5.5. Identifying by CIL instructions could be used but that a pretty unnecessary stretch.
            return typeof(TraderDealScreen).GetMethod("method_10", BindingFlags.Instance | BindingFlags.NonPublic);
        }

        [PatchPostfix]
        private static void PatchPostfix(TraderDealScreen __instance)
        {
            try
            {
                //var trader = typeof(TraderDealScreen).GetField("gclass1949_0", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(__instance) as TraderClass; // has to be gclass1952_0
                // Search for trader fiels by type instead of a generic name.
                var trader = Traverse.Create(__instance).Fields().Select(fName => AccessTools.Field(__instance.GetType(), fName)).FirstOrDefault(field => field.FieldType == typeof(TraderClass) && !field.IsPublic).GetValue(__instance) as TraderClass;
                if (trader == null) throw new Exception("TraderDealScreen. Found trader field is null.");
                var _equivalentSumValue = typeof(TraderDealScreen).GetField("_equivalentSumValue", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(__instance) as TextMeshProUGUI;
                if (trader.Id == BROKER_TRADER_ID)
                {
                    // source is a list of ItemPrices, reference ItemPriceReflection.
                    var source = trader.CurrentAssortment.SellingStash.Containers.First().Items.Select(GetBestItemPrice).Where(itemPrice => itemPrice != null).ToList();
                    if (!source.Any()) _equivalentSumValue.text = "";
                    else
                    {
                        var groupByCurrency = source.GroupBy(ItemPrice.getCurrencyId).Select(currencyGroup => new
                        {
                            CurrencyId = currencyGroup.Key,
                            Amount = currencyGroup.Sum(ItemPrice.getAmount),
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
            catch (Exception ex)
            {
                var msg = $"{PluginInfo.PLUGIN_GUID} error! Threw an exception during EquivalentSum patch, perhaps due to version incompatibility. Exception message: {ex.Message}";
                Logger.LogError(msg);
                NotificationManagerClass.DisplayWarningNotification(msg, EFT.Communications.ENotificationDurationType.Infinite);
            }
        }
    }
    //  Before showing the trader screen refresh ragfair prices. This fixes calculated ragfair tax inconsistency if you didn't open ragfair menu yet.
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
            try
            {
                if (trader.Id == BROKER_TRADER_ID && PriceManager.ModConfig.UseRagfair)
                {
                    Session.RagFair.RefreshItemPrices();
                }
            }
            catch (Exception ex)
            {
                var msg = $"{PluginInfo.PLUGIN_GUID} error! Threw an exception during RefreshRagfairOnTraderScreenShow patch, perhaps due to version incompatibility. Exception message: {ex.Message}";
                Logger.LogError(msg);
                NotificationManagerClass.DisplayWarningNotification(msg, EFT.Communications.ENotificationDurationType.Infinite);
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
            try
            {
                var trader = Traverse.Create(__instance).Fields().Select(fName => AccessTools.Field(__instance.GetType(), fName)).FirstOrDefault(field => field.FieldType == typeof(TraderClass) && !field.IsPublic && field.IsInitOnly).GetValue(__instance) as TraderClass;
                if (trader == null) throw new Exception("TraderAssortmentControllerClass. Found trader field is null.");
                //var trader = __instance.GetType().GetField("gclass1949_0", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(__instance) as TraderClass;
                if (trader.Id == BROKER_TRADER_ID)
                {
                    // Both are probably be identical, but use lower for consistency with source code.
                    // var soldItems = __instance.SellingStash.Containers.First().Items; 
                    var soldItems = __instance.SellingTableGrid.ContainedItems.Keys.ToList();
                    if (soldItems.Count > 0)
                    {
                        Dictionary<string, BrokerItemSellData> sellData = soldItems.Select(GetBrokerItemSellData).ToDictionary(data => data.ItemId);
                        RequestHandler.PostJson("/broker-trader/post/sold-items-data", Json.Serialize(sellData));
                    }
                }
            }
            catch (Exception ex)
            {
                var msg = $"{PluginInfo.PLUGIN_GUID} error! Threw an exception during SendDataOnDealButtonPress patch, perhaps due to version incompatibility. Exception message: {ex.Message}";
                Logger.LogError(msg);
                NotificationManagerClass.DisplayWarningNotification(msg, EFT.Communications.ENotificationDurationType.Infinite);
            }
        }

    }

}
