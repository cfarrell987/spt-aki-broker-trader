using System;
using System.Linq;
using System.Reflection;


namespace BrokerTraderPlugin.Reflections
{
    internal class ItemPrice : ReflectionBase
    {
        public static readonly Type DeclaredType;
        public static readonly ConstructorInfo DeclaredConstructor;
        public const string FieldNameCurrencyId = "CurrencyId";
        public const string FieldNameAmount = "Amount";

        static ItemPrice()
        {
            // A pretty specific search for the GStruct of ItemPrice, to make sure it's the correct one.
            DeclaredType = typeof(TraderClass).GetNestedTypes().FirstOrDefault(type =>
            {
                if (!type.IsNestedPublic) return false;
                var constructor = type.GetConstructor([typeof(string), typeof(int)]);
                var fieldNames = type.GetFields().Select(field => field.Name).ToList();
                return constructor != null && fieldNames.Contains(FieldNameCurrencyId) && fieldNames.Contains(FieldNameAmount);
            });
            //structType = typeof(TraderClass).GetNestedType("GStruct219");
            if (DeclaredType == null) throw new Exception("ItemPrice. Couldn't find structure type by reflection.");
            DeclaredConstructor = DeclaredType.GetConstructor(new Type[] { typeof(string), typeof(int) });
            if (DeclaredConstructor == null) throw new Exception("ItemPrice. Couldn't find constructor by reflection.");
        }

        // Invoke a constructor to create an object of original declared type.
        public static object New(string currencyId, double amount)
        {
            int iAmount;
            if (amount > Int32.MaxValue)
            {
                iAmount = Int32.MaxValue;
            }
            else if(amount < Int32.MinValue)
            {
                iAmount = Int32.MinValue;
            }
            else
            {
                iAmount = Convert.ToInt32(amount);
            }
            return DeclaredConstructor.Invoke([currencyId, iAmount]);        
            }

        public static string GetCurrencyId(object instance)
        {
            return instance.GetFieldValue<string>(FieldNameCurrencyId);
            //return AccessTools.Field(structType, CurrencyId).GetValue(instance) as string;
        }

        public static int GetAmount(object instance)
        {
            return instance.GetFieldValue<int>(FieldNameAmount);
            //return (int)AccessTools.Field(structType, Amount).GetValue(instance);
        }
    }
}
