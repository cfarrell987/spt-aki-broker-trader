using EFT;
using EFT.InventoryLogic;
using HarmonyLib;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;

namespace BrokerTraderPlugin
{
    /// <summary>
    /// A dynamic reflection of a potential "CurrencyHelper" class to avoid generic referencing.
    /// </summary>
    internal static class CurrencyHelper
    {
        public static Type classType;
        public static readonly string ROUBLE_ID;
        public static readonly string DOLLAR_ID;
        public static readonly string EURO_ID;
        static CurrencyHelper()
        {
            var assembly = Assembly.GetAssembly(typeof(TarkovApplication));
            // Find the static class
            classType = AccessTools.GetTypesFromAssembly(assembly).FirstOrDefault(type =>
            {
                var fieldNames = AccessTools.GetFieldNames(type);
                return fieldNames.Contains("ROUBLE_ID") && fieldNames.Contains("DOLLAR_ID") && fieldNames.Contains("EURO_ID");
            });
            if (classType == null) throw new Exception($"{PluginInfo.PLUGIN_GUID}. Couldn't find a \"CurrencyHelper\" type by reflection.");
            // Init "constants" for easy access and code consistency.
            ROUBLE_ID = classType.GetField("ROUBLE_ID").GetValue(null) as string;
            DOLLAR_ID = classType.GetField("DOLLAR_ID").GetValue(null) as string;
            EURO_ID = classType.GetField("EURO_ID").GetValue(null) as string;
        }

        public static string GetCurrencyCharById(string templateId)
        {
            return AccessTools.Method(classType, "GetCurrencyCharById").Invoke(null, new object[] { templateId }) as string;
        }

        public static string GetCurrencyId(ECurrencyType currencyType)
        {
            return AccessTools.Method(classType, "GetCurrencyId").Invoke(null, new object[] { currencyType }) as string;

        }

        public static bool IsCurrencyId(string id)
        {
            return (bool)AccessTools.Method(classType, "IsCurrencyId").Invoke(null, new object[] { id });

        }

    }
}
