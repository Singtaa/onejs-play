/**
 * A cart's page folder: the store page's text and pictures, kept in the
 * cart's repository beside the game and never part of it. The site renders
 * the page from it at each build; ojplay leaves it out of a Unity copy of the
 * game's files, as it leaves `.oj/`.
 *
 * The one place the folder is named, for both: the site's page builder
 * imports it from here, as it imports the starter, so naming the folder
 * again is one edit. Nothing here reads a disk, so the site's Worker can
 * import it.
 */

/** The folder at a cart's root that holds its page. */
export const PAGE_FOLDER = "page"
