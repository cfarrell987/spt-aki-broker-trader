using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace BrokerTraderPlugin.Reflections.Extensions
{
    internal static class TraderReflector
    {
        public static TraderInfo RInfo(this TraderClass trader)
        {
            return new TraderInfo(trader.GetPropertyValue("Info"));
        }
    }
}
