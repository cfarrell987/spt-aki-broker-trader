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
    /// A dynamic reflection of a potential "CurrencyHelper" class to avoid generic referencing.
    /// </summary>
    internal static class CurrencyHelper
    {
        public static readonly Type ReflectedType;
        public static readonly string ROUBLE_ID;
        public static readonly string DOLLAR_ID;
        public static readonly string EURO_ID;
        static CurrencyHelper()
        {
            var fieldNames = new string[]
            {
                "ROUBLE_ID",
                "DOLLAR_ID",
                "EURO_ID"
            };
            ReflectedType = ReflectionHelper.FindClassTypeByFieldNames(fieldNames);

            // Init "constants".
            ROUBLE_ID = ReflectedType.GetFieldValue<string>("ROUBLE_ID");
            DOLLAR_ID = ReflectedType.GetFieldValue<string>("DOLLAR_ID");
            EURO_ID = ReflectedType.GetFieldValue<string>("EURO_ID");
        }

        public static string GetCurrencyCharById(string templateId)
        {
            return ReflectedType.InvokeMethod<string>("GetCurrencyCharById", new object[] { templateId });
        }

        public static string GetCurrencyChar(ECurrencyType currencyType)
        {
            return ReflectedType.InvokeMethod<string>("GetCurrencyChar", new object[] { currencyType });
        }

        public static string GetCurrencyId(ECurrencyType currencyType)
        {
            return ReflectedType.InvokeMethod<string>("GetCurrencyId", new object[] { currencyType });

        }

        public static bool IsCurrencyId(string id)
        {
            return ReflectedType.InvokeMethod<bool>("IsCurrencyId", new object[] { id });

        }

    }
}
