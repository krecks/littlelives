/**
 * Camera layer masks. The game world (the session's lot, street, Sims) and the menus' town
 * overview live in the same scene; the camera's mask picks which one is drawn, so either can be
 * built while the other is on screen. Babylon's default mesh mask (0x0FFFFFFF) is the game world.
 */
export const LAYER_WORLD = 0x0fffffff;
export const LAYER_TOWN = 0x10000000;
/** Drawn in both (sky, and a landscape shared by the overview and the game). */
export const LAYER_ALL = LAYER_WORLD | LAYER_TOWN;
