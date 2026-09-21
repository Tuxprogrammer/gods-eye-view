/**
 * Non-page module owned by the cockpit agent. installMobileUi() calls install()
 * (mobile mode only, inside try/catch) after the sheet exists. Builds the
 * cockpit control cluster and drawer; see ../cockpit-drawer.js.
 */
import { installCockpitDrawer } from '../cockpit-drawer.js';

export function install() {
  installCockpitDrawer(document, window);
}
