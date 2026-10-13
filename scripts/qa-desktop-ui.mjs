/**
 * Pin a QA page to this fork's desktop UI before the app loads.
 *
 * The fork's mobile-mode bootstrap (public/mobile-bootstrap.js) treats
 * `(hover: none)` as mobile, and headless Chrome on a Linux CI runner has no
 * input devices, so it reports `hover: none` and gets the mobile shell even in
 * a desktop-sized window. The upstream browser gates drive desktop panels, so
 * they set the bootstrap's documented override (localStorage `godsEyeView.ui`)
 * first. Pages that want the mobile UI still pass `?ui=mobile`, which wins.
 * @param {import('puppeteer').Page} page
 */
export async function pinDesktopUi(page) {
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('godsEyeView.ui', 'desktop');
    } catch {
      /* storage blocked: the media query decides */
    }
  });
}
