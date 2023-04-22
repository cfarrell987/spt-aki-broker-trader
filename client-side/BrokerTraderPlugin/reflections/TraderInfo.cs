using EFT.InventoryLogic;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace BrokerTraderPlugin.Reflections
{
    internal class TraderInfo : ReflectionBase
    {
        public TraderInfo(object instance)
        {
            ReflectedInstance = instance;
            ReflectedType = instance.GetType();
        }

        public bool CanBuyItem(Item item)
        {
            return InvokeMethod<bool>("CanBuyItem", new object[] { item }, new Type[] { typeof(Item) });
        }

        public double ApplyPriceModifier(double basePrice)
        {
            return InvokeMethod<double>("ApplyPriceModifier", new object[] { basePrice }, new Type[] { typeof(double) });
        }

        public bool Unlocked
        {
            get
            {
                return GetFieldValue<bool>("Unlocked");
            }
        }
    }
}
