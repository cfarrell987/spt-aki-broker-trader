using HarmonyLib;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;

namespace BrokerTraderPlugin.Reflections
{
    internal static class ItemPrice
    {
        public static Type structType;
        public static ConstructorInfo structConstructor;
        public const string CurrencyId = "CurrencyId";
        public const string Amount = "Amount";

        static ItemPrice()
        {
            // A pretty specific search for the GStruct of ItemPrice, to make sure it's the correct one.
            structType = typeof(TraderClass).GetNestedTypes().FirstOrDefault(type =>
            {
                if (!type.IsNestedPublic) return false;
                var constructor = type.GetConstructor(new Type[] { typeof(string), typeof(int) });
                var fieldNames = type.GetFields().Select(field => field.Name).ToList();
                return constructor != null && fieldNames.Contains(CurrencyId) && fieldNames.Contains(Amount);
            });
            //structType = typeof(TraderClass).GetNestedType("GStruct219");
            if (structType == null) throw new Exception("ItemPrice. Couldn't find structure type by reflection.");
            structConstructor = structType.GetConstructor(new Type[] { typeof(string), typeof(int) });
            if (structConstructor == null) throw new Exception("ItemPrice. Couldn't find constructor by reflection.");
        }

        // Invoke a constructor to create an ItemPrice object.
        public static object createInstance(string currencyId, int amount)
        {
            return structConstructor.Invoke(new object[] { currencyId, amount });
        }

        public static string getCurrencyId(object instance)
        {
            return AccessTools.Field(structType, CurrencyId).GetValue(instance) as string;
        }

        public static int getAmount(object instance)
        {
            return (int)AccessTools.Field(structType, Amount).GetValue(instance);
        }
    }
}
