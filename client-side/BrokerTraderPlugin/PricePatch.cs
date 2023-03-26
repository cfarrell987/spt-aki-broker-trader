using Aki.Reflection.Patching;
using BepInEx;
using BrokerTraderPlugin;
using EFT.InventoryLogic;
using EFT.UI;
using EFT.UI.DragAndDrop;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text;
using Aki.Common.Http;

using ItemPrice = TraderClass.GStruct219;
using Diz.Skinning;
using static MonoMod.Cil.RuntimeILReferenceBag.FastDelegateInvokers;
using EFT;
using System.ComponentModel;
using static UnityEngine.ParticleSystem;
using Aki.Common.Utils;
using UnityEngine;
using UnityEngine.Networking.Match;
using static BrokerTraderPlugin.PriceManager;

namespace PricePatch
{
    public class PatchMerchantsList : ModulePatch
    {
        protected override MethodBase GetTargetMethod()
        {
            return typeof(MerchantsList).GetMethod("Show", BindingFlags.Instance | BindingFlags.Public);
        }

        [PatchPostfix]
        private static void PatchPostfix(IEnumerable<TraderClass> tradersList)
        {
            Logger.LogMessage($"[BROKER TRADER] Supported traders {PriceManager.SupportedTraderIds.Length}");
            Logger.LogMessage($"[BROKER TRADER] Item ragfair price count {PriceManager.ItemRagfairPriceTable.Count}");
            Logger.LogMessage($"[BROKER TRADER] Received {PriceManager.SupplyData.Count} SupplyData instances.");
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
            PriceManager.TradersList = tradersList.Where((trader) => PriceManager.SupportedTraderIds.Contains(trader.Id));
            Logger.LogMessage($"[BROKER TRADER] PriceManager.TradersList count {PriceManager.TradersList.Count()}");
        }
    }
    public class PatchGetUserItemPrice : ModulePatch
    {
        private const string BROKER_TRADER_ID = "broker-trader-id";
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
            if(__instance.Id == BROKER_TRADER_ID)
            {
                if (__result != null)
                {
                    //var bestPrice = GetBestTraderPrice(item);
                    //Logger.LogInfo($"TRADER {bestPrice.Trader.LocalizedName} ROUBLE AMOUNT {bestPrice.RoubleAmount}");
                    //Logger.LogInfo(Json.Serialize(GetBestSellItemPrice(item)));


                    __result = GetBestTraderPrice(item).Price;
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


    //  Pull the TraderClass enumerable from EFT.UI.MerchantsList

}
