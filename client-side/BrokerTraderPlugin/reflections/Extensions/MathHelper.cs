using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace BrokerTraderPlugin.Reflections.Extensions
{
    /// <summary>
    /// Some sort of a helper class with extension methods. As of SPT-AKI 3.5.5 it's GClass782
    /// It does have lots of even math unrelated stuff, but only ApproxEquals is used in the Broker mod.
    /// Follows naming of original classes, prefixed with "R"
    /// </summary>
    internal static class MathHelper
    {
        public static readonly Type ReflectedType;
        static MathHelper()
        {
            var methodNames = new string[]
            {
                "ApproxEquals",
                "LowAccuracyApprox",
                "IsZero",
                "Positive",
                "Negative",
                "ZeroOrNegative",
                "Clamp",
                "Multiply",
                "Divide",
                "Scale"
            };
            ReflectedType = ReflectionHelper.FindClassTypeByMethodNames(methodNames);
        }

        public static bool RApproxEquals(this float value, float value2)
        {
            return ReflectedType.InvokeMethod<bool>("ApproxEquals", new object[] { value, value2 }, new Type[] { typeof(float), typeof(float) });
        }

        public static bool RApproxEquals(this double value, double value2)
        {
            return ReflectedType.InvokeMethod<bool>("ApproxEquals", new object[] { value, value2 }, new Type[] { typeof(double), typeof(double) });
        }
    }
}
