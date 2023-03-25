using Aki.Reflection.Patching;
using BepInEx;
using EFT.InventoryLogic;
using EFT.UI.DragAndDrop;
using System;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text;

using TradeItemPrice = TraderClass.GStruct219;

namespace PricePatch
{
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
        private static void PatchPostfix(ref TraderClass __instance, ref TradeItemPrice? __result)
        {
            //Logger.LogInfo("PATCH EXECUTED");
            //Nullable<TradeItemPrice> nulprice = __result as Nullable<TradeItemPrice>;
            
            // Works well
            if(__instance.Id == "broker-trader")
            {
                if (__result != null)
                    __result = new TradeItemPrice(__result.GetValueOrDefault().CurrencyId, 228);

                int num = (__result != null) ? __result.GetValueOrDefault().Amount : 0;
                Logger.LogInfo($"[BROKER COCK] NULPRICE {num}");
            }

            //Nullable<TradeItemPrice> nulprice = price as Nullable<TradeItemPrice>;
            //__instance = new TradeItemPrice(__instance.CurrencyId, 228);
            //int num = (nulprice != null) ? nulprice.GetValueOrDefault().Amount : 0;
            //Logger.LogInfo($"[BROKER TRADER] AMOUNT {num}!");
            //TradeItemPrice itemPrice = typeof(TradingItemView).GetField("ItemPrice", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(__instance) as ;

        }
    }
}
