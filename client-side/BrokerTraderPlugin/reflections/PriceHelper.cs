using EFT;
using EFT.InventoryLogic;
using HarmonyLib;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;

namespace BrokerTraderPlugin.Reflections
{
    /// <summary>
    /// A dynamic reflection of a potential "PriceHelper" class to avoid generic referencing.
    /// </summary>
    internal static class PriceHelper
    {
        public static readonly Type ReflectedType;
        static PriceHelper()
        {
            var methodNames = new string[]
            {
                "CalculateTaxPrice",
                "CalculateBaseTaxesAllItems",
                "CalculateBasePriceForAllItems",
                "CalculateBuyoutBasePriceForSingleItem"
            };
            ReflectedType = ReflectionHelper.FindClassTypeByMethodNames(methodNames);
        }

        public static double CalculateBasePriceForAllItems(Item item, int itemsCount, IBasePriceSource basePriceSource, bool isFence)
        {
            return ReflectedType.InvokeMethod<double>("CalculateBasePriceForAllItems", new object[] { item, itemsCount, basePriceSource, isFence });
            //return (double)AccessTools.Method(ReflectedType, "CalculateBasePriceForAllItems").Invoke(null, new object[] { item, itemsCount, basePriceSource, isFence });
        }

        public static double CalculateBuyoutBasePriceForSingleItem(Item item, int itemsCount, IBasePriceSource basePriceSource, bool isFence)
        {
            return ReflectedType.InvokeMethod<double>("CalculateBuyoutBasePriceForSingleItem", new object[] { item, itemsCount, basePriceSource, isFence });
            //return (double)AccessTools.Method(ReflectedType, "CalculateBuyoutBasePriceForSingleItem").Invoke(null, new object[] { item, itemsCount, basePriceSource, isFence });
        }

        public static double CalculateTaxPrice(Item item, int offerItemCount, double requirementsPrice, bool sellInOnePiece)
        {
            return ReflectedType.InvokeMethod<double>("CalculateTaxPrice", new object[] { item, offerItemCount, requirementsPrice, sellInOnePiece });
            //return (double)AccessTools.Method(ReflectedType, "CalculateTaxPrice").Invoke(null, new object[] { item, offerItemCount, requirementsPrice, sellInOnePiece });
        }
    }
}
