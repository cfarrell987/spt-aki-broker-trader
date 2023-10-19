using EFT.InventoryLogic;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace BrokerTraderPlugin.Reflections.Extensions
{
    /// <summary>
    /// Static Extension class which has some item helper methods. As of SPT-AKI 3.5.5 is GClass2411.
    /// Due to original class also having extension methods, all method names imitate the original but are prefixed with "R"
    /// </summary>
    internal static class ItemHelper
    {
        public static readonly Type ReflectedType;
        static ItemHelper()
        {
            var methodNames = new string[]
            {
                "GetIndexOfItemType",
                "GetComponents",
                "GetAllItems",
                "GetAllItemsFromCollection",
                "GetAllItemsFromCollections",
                "FilterNullContainers",
                //"GetAllMergedItems", - not present, anymore (maybe since SPT 3.7.1)
                "GetAllItemsNonAlloc",
                "GetTopLevelItemsFromCollection"
            };
            ReflectedType = ReflectionHelper.FindClassTypeByMethodNames(methodNames);
        }

        public static IEnumerable<Item> RGetAllItems(this Item item)
        {
            return ReflectedType.InvokeMethod<IEnumerable<Item>>("GetAllItems", new object[] { item }, new Type[] { typeof(Item) });
        }
    }
}
