using Aki.Reflection.Patching;
using BrokerTraderPlugin;
using EFT.InventoryLogic;
using EFT.UI;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Aki.Common.Http;

//using ItemPrice = TraderClass.GStruct219; // now use BrokerTraderPlugin.Reflections.ItemPrice instead of generic struct reference
//using CurrencyHelper = GClass2182; // old was GClass2179 // now use BrokerTraderPlugin.Reflections.CurrencyHelper instead of generic class reference

using Aki.Common.Utils;

using static BrokerTraderPlugin.PriceManager;
using TMPro;
using System.Text.RegularExpressions;
using Comfort.Common;
using HarmonyLib;
using System;
using BrokerTraderPlugin.Reflections;
using UnityEngine;
using static UnityEngine.RemoteConfigSettingsHelper;
using UnityEngine.UIElements;
using InventoryOrganizingFeatures.Reflections.Extensions;
using BrokerTraderPlugin.Reflections.Extensions;

namespace BrokerPatch
{
    //  Initialize PriceMaganer properties with values from EFT.UI.TraderScreensGroup before they can be used in later patches.
    public class PatchTraderScreensGroup : ModulePatch
    {
        protected override MethodBase GetTargetMethod()
        {
            return typeof(TraderScreensGroup).GetMethod("Show", BindingFlags.Instance | BindingFlags.Public);
        }

        [PatchPrefix]
        private static bool PatchPrefix(TraderScreensGroup __instance, object controller)
        {
            try
            {
                // Grab list of traders and session instance from the controller.
                var tradersList = controller.GetFieldValue<IEnumerable<TraderClass>>("TradersList");
                var session = controller.GetFieldValue<ISession>("Session");

                // Get supported TraderClass instancess to work with.
                TradersList = tradersList.Where((trader) => SupportedTraderIds.Contains(trader.Id) && (PriceManager.ModConfig.TradersIgnoreUnlockedStatus || trader.RInfo().Unlocked));
                Session = session;
                BackendCfg = Singleton<BackendConfigSettingsClass>.Instance;

                if (Session == null) throw new Exception("Session is null.");

                // Continue running original code.
                return true;
            }
            catch (Exception ex)
            {
                var msg = $"{PluginInfo.PLUGIN_GUID} error! Threw an exception during TraderScreensGroup patch, perhaps due to version incompatibility. Exception message: {ex.Message}";
                Logger.LogError(msg);
                NotificationManagerClass.DisplayWarningNotification(msg, EFT.Communications.ENotificationDurationType.Infinite);
                throw ex;
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

        // Use prefix patch to save already miserable Tarkov UI performance.
        // The old postfix implementation is kept commented as a back-up/reference.
        [PatchPrefix]
        private static bool PatchPrefix(ref TraderClass __instance, Item item, ref object __result)
        {
            try
            {
                // Only affect the Broker
                if (__instance.Id == BROKER_TRADER_ID)
                {
                    __result = GetBestItemPrice(item);
                    return false;
                }
                return true;
            }
            catch (Exception ex)
            {
                var msg = $"{PluginInfo.PLUGIN_GUID} error! Threw an exception during GetUserItemPrice patch, perhaps due to version incompatibility. Exception message: {ex.Message}";
                Logger.LogError(msg);
                NotificationManagerClass.DisplayWarningNotification(msg, EFT.Communications.ENotificationDurationType.Infinite);
                throw ex;
            }
        }

        //[PatchPostfix]
        //private static void PatchPostfix(ref TraderClass __instance, Item item, ref object __result)
        //{
        //    // Only affect the Broker
        //    if (__instance.Id == BROKER_TRADER_ID)
        //    {
        //        if (__result != null)
        //        {
        //            try
        //            {
        //                __result = GetBestItemPrice(item);
        //            }
        //            catch (Exception ex)
        //            {
        //                var msg = $"{PluginInfo.PLUGIN_GUID} error! Threw an exception during GetUserItemPrice patch, perhaps due to version incompatibility. Exception message: {ex.Message}";
        //                Logger.LogError(msg);
        //                NotificationManagerClass.DisplayWarningNotification(msg, EFT.Communications.ENotificationDurationType.Infinite);
        //            }
        //        }
        //    }
        //}
    }
    //  Change how total transaction sum is generated when selling to trader.
    public class PatchEquivalentSum : ModulePatch
    {
        protected override MethodBase GetTargetMethod()
        {
            // For reference: the "method_10" is no longer relevant in the current version, as of 3.7.1 it's method_16.
            // This info is in general not much relevant but I suppose gives at least a little bit of direction.
            //
            // method_10 assigns a sprite and text value to "_equivalentSum" when selling items
            // method_10 is still the same for 3.5.5. Identifying by CIL instructions could be used but that's a pretty unnecessary stretch.

            // The original method_10 has several properties to distinct it:
            // * GetMethodBody().MaxStackSize == 4
            // * LocalVariables.Count = 2 
            // * One(first) of the variables is an "ItemPrice" generic structure (in 3.5.5. a TraderClass.GStruct219).
            // For now dynamically reaching this method is possible by simply checking if it has a variable of generic "ItemPrice" structure type.
            // Later this might be changed for more precision. IL code checks are still a last resort.
            var method = AccessTools.GetDeclaredMethods(typeof(TraderDealScreen)).Where(method => method.GetMethodBody().LocalVariables.Any(variable => variable.LocalType == ItemPrice.DeclaredType)).FirstOrDefault();
            if (method == null) throw new Exception("PatchEquivalentSum. Couldn't find the method by reflection.");
            return method;
        }

        // TraderClass field has a generic name
        private static readonly FieldInfo TraderField;
        // Constructor will run before patch is enabled.
        // Unlike GetTargetMethod, the patched code will run multiple times so reflection search results should be cached.
        //
        // TODO: This could be removed and rewritten with the use of ReflectionHelper since I've already implemented caching there.
        // But for some reason there are 2 instances of TraderClass type in TraderDealScreen.
        // As far as it's code goes it seems that both of them will have the same value which is assigned in the Show() method.
        //
        // Shouldn't touch it as long as it works, I guess.
        static PatchEquivalentSum()
        {
            TraderField = typeof(TraderDealScreen).GetFields(AccessTools.allDeclared).FirstOrDefault(field => field.FieldType == typeof(TraderClass) && !field.IsPublic);
        }

        [PatchPostfix]
        private static void PatchPostfix(TraderDealScreen __instance, ref TMP_Text[] ____equivalentSumValue)
        {
            try
            {
                // Search for trader fiels by type instead of a generic name.
                if (TraderField.GetValue(__instance) is not TraderClass trader) throw new Exception("TraderDealScreen. Found trader field is null.");
                //var ____equivalentSumValue = typeof(TraderDealScreen).GetField("_equivalentSumValue", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(__instance) as TextMeshProUGUI;

                // With the new 13.5 (or whatever it was) trader screen, they seem to have an array of TMP_Text objects
                // and for some reason they seem to loop through the whole array and apply the SAME value to each object.

                // This method seems to be called every time you add or remove an item from the sell table, if I'm not mistaken.
                foreach (TMP_Text tpmText in ____equivalentSumValue)
                {
                    if (trader.Id == BROKER_TRADER_ID)
                    {
                        // source is a list of ItemPrices, reference ItemPriceReflection.
                        var source = trader.CurrentAssortment.SellingStash.Containers.First().Items.Select(GetBestItemPrice).Where(itemPrice => itemPrice != null).ToList();
                        if (!source.Any()) tpmText.text = "";
                        else
                        {
                            var groupByCurrency = source.GroupBy(ItemPrice.GetCurrencyId).Select(currencyGroup => new
                            {
                                CurrencyId = currencyGroup.Key,
                                Amount = currencyGroup.Sum(ItemPrice.GetAmount),
                            });
                            // Rouble amount has to be always first. Since Broker's main currency is RUB.
                            tpmText.text = groupByCurrency.Where(group => group.CurrencyId == CurrencyHelper.ROUBLE_ID).Select(group => group.Amount).FirstOrDefault().ToString();
                            foreach (var currency in groupByCurrency.Where(group => group.CurrencyId != CurrencyHelper.ROUBLE_ID))
                            {
                                tpmText.text += $" + {CurrencyHelper.GetCurrencyCharById(currency.CurrencyId)} {currency.Amount}";
                            }
                        }
                    }
                    Regex regex = new Regex("\\B(?=(\\d{3})+(?!\\d))");
                    tpmText.text = regex.Replace(tpmText.text, " ");
                }
            }
            catch (Exception ex)
            {
                var msg = $"{PluginInfo.PLUGIN_GUID} error! Threw an exception during EquivalentSum patch, perhaps due to version incompatibility. Exception message: {ex.Message}";
                Logger.LogError(msg);
                NotificationManagerClass.DisplayWarningNotification(msg, EFT.Communications.ENotificationDurationType.Infinite);
                throw ex;
            }
        }
    }
    //  Before showing the trader screen refresh ragfair prices. This fixes calculated ragfair tax inconsistency if you didn't open ragfair menu yet.
    public class PatchRefreshRagfairOnTraderScreenShow : ModulePatch
    {
        protected override MethodBase GetTargetMethod()
        {
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
                throw ex;
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

        // TraderClass field has a generic name
        private static readonly FieldInfo TraderField;
        // Constructor will run before patch is enabled.
        // Unlike GetTargetMethod, the patched code will run multiple times so reflection search results should be cached.
        static PatchSendDataOnDealButtonPress()
        {
            TraderField = typeof(TraderAssortmentControllerClass).GetFields(AccessTools.allDeclared).FirstOrDefault(field => field.FieldType == typeof(TraderClass) && !field.IsPublic && field.IsInitOnly);
        }

        // Prefer prefix patch to make sure that the request is sent in time. (Although it's probably sync)
        [PatchPrefix]
        private static void PatchPrefix(TraderAssortmentControllerClass __instance)
        {
            try
            {
                if (TraderField.GetValue(__instance) is not TraderClass trader) throw new Exception("TraderAssortmentControllerClass. Found trader field is null.");
                if (trader.Id == BROKER_TRADER_ID)
                {
                    //var soldItems = __instance.SellingTableGrid.ContainedItems.Keys.ToList(); - used in original code, but has generic references
                    var soldItems = __instance.SellingStash.Containers.First().Items.ToList(); // - identical result, no generic references

                    if (soldItems.Count > 0)
                    {
                        var itemsSellData = soldItems.Select(GetBrokerItemSellData);
                        // Send sell data to server
                        Dictionary<string, BrokerItemSellData> sellData = itemsSellData.ToDictionary(data => data.ItemId);
                        RequestHandler.PostJson(Routes.PostSoldItemsData, Json.Serialize(sellData));
                        // Show notifications for reputation increments.
                        if (PriceManager.ModConfig.UseNotifications)
                        {
                            var groupByTrader = sellData.Select(entry => entry.Value).GroupBy(data => data.TraderId);
                            Regex regex = new Regex("\\B(?=(\\d{3})+(?!\\d))"); // format thousands with spaces
                            string ragfairLocale = "";
                            foreach (var word in "RAG FAIR".RLocalized().Split(' '))
                            {
                                ragfairLocale += char.ToUpper(word[0]) + word.Substring(1).ToLower() + " ";
                            }
                            ragfairLocale.Trim();
                            const string messageInitVal = "\nReputation changes:\n\n";
                            string message = messageInitVal;
                            foreach (var group in groupByTrader.Where(group => group.Key != BROKER_TRADER_ID))
                            {
                                int totalPrice = group.Sum(data => data.Price);
                                string currencyChar = CurrencyHelper.GetCurrencyChar(TradersList.First(trader => trader.Id == group.First().TraderId).Settings.Currency);
                                message += $"    \u2022    {$"{group.Key} Nickname".RLocalized()}:    + {currencyChar} {regex.Replace(totalPrice.ToString(), " ")}\n\n";
                            }
                            // For Broker Trader - show flea rep increment
                            foreach (var group in groupByTrader.Where(group => group.Key == BROKER_TRADER_ID))
                            {
                                int totalPrice = group.Where(item => !CurrencyHelper.IsCurrencyId(soldItems.First(soldItem => soldItem.Id == item.ItemId).TemplateId)).Sum(item => item.Price);
                                if (totalPrice < 1) break; // if no "non-currency" items just break out of the loop
                                string currencyChar = CurrencyHelper.GetCurrencyChar(ECurrencyType.RUB);
                                string repIncStr = (totalPrice * RagfairSellRepGain).ToString();
                                // add a space 2 digits after the floating point for better contextual readability
                                message += $"    \u2022    {ragfairLocale}:    +{repIncStr.Insert(repIncStr.IndexOf('.') + 2 + 1, " ")}\n\n";
                            }
                            if (message != messageInitVal)
                            {
                                NotificationManagerClass.DisplayMessageNotification(
                                    message,
                                    ModNotificationDuration,
                                    EFT.Communications.ENotificationIconType.RagFair,
                                    Color.white
                                );
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                var msg = $"{PluginInfo.PLUGIN_GUID} error! Threw an exception during SendDataOnDealButtonPress patch, perhaps due to version incompatibility. Exception message: {ex.Message}";
                Logger.LogError(msg);
                NotificationManagerClass.DisplayWarningNotification(msg, EFT.Communications.ENotificationDurationType.Infinite);
                throw ex;
            }
        }

    }

}
