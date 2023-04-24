import { ILogger } from "@spt-aki/models/spt/utils/ILogger";
import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { ItemBaseClassService } from "@spt-aki/services/ItemBaseClassService";
import { LocalisationService } from "@spt-aki/services/LocalisationService";
import { inject, injectable } from "tsyringe";

/**
 * Cache the baseids for each item in the tiems db inside a dictionary
 */
@injectable()
export class FixedItemBaseClassService extends ItemBaseClassService
{
    constructor(
        @inject("WinstonLogger") protected logger: ILogger,
        @inject("LocalisationService") protected localisationService: LocalisationService,
        @inject("DatabaseServer") protected databaseServer: DatabaseServer
    )
    {
        super(logger, localisationService, databaseServer);
    }

    /**
     * Does item tpl inherit from the requested base class
     * @param itemTpl item to check base classes of
     * @param baseClass base class to check for
     * @returns true if item inherits from base class passed in
     */
    public override itemHasBaseClass(itemTpl: string, baseClasses: string[]): boolean
    {
        if (!this.cacheGenerated)
        {
            this.hydrateItemBaseClassCache();
        }

        // No item in cache
        if (!this.itemBaseClassesCache[itemTpl])
        {
            const allDbItems = this.databaseServer.getTables().templates.items;
            if (!allDbItems)
            {
                this.logger.warning(this.localisationService.getText("baseclass-missing_db_no_cache"));
                return false;
            }
            if (!allDbItems[itemTpl])
            {
                this.logger.warning(this.localisationService.getText("baseclass-item_not_found", itemTpl));
                return false;
            }
            // If item exists in db, but not in cache - update cache
            this.hydrateItemBaseClassCache();
        }

        return this.itemBaseClassesCache[itemTpl].some(x => baseClasses.includes(x));
    }
}