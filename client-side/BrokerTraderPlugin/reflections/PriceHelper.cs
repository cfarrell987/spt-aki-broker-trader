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
        public static Type classType;
        static PriceHelper()
        {
            // use AccessTools.AllAssemblies() or AllTypes()?
            var assembly = Assembly.GetAssembly(typeof(TarkovApplication));
            // Find the static class
            classType = AccessTools.GetTypesFromAssembly(assembly).FirstOrDefault(type =>
            {
                var methodNames = AccessTools.GetMethodNames(type);
                // Really make sure it's the correct class, just in case.
                return methodNames.Contains("CalculateTaxPrice")
                && methodNames.Contains("CalculateBaseTaxesAllItems")
                && methodNames.Contains("CalculateBasePriceForAllItems")
                && methodNames.Contains("CalculateBuyoutBasePriceForSingleItem");
            });
            if (classType == null) throw new Exception($"{PluginInfo.PLUGIN_GUID}. Couldn't find a \"PriceHelper\" type by reflection.");
        }

        public static double CalculateBasePriceForAllItems(Item item, int itemsCount, IBasePriceSource basePriceSource, bool isFence)
        {
            return (double)AccessTools.Method(classType, "CalculateBasePriceForAllItems").Invoke(null, new object[] { item, itemsCount, basePriceSource, isFence });
        }

        public static double CalculateTaxPrice(Item item, int offerItemCount, double requirementsPrice, bool sellInOnePiece)
        {
            return (double)AccessTools.Method(classType, "CalculateTaxPrice").Invoke(null, new object[] { item, offerItemCount, requirementsPrice, sellInOnePiece });
        }
    }
}
