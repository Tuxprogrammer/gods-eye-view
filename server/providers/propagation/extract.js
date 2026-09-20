/**
 * Pull the filled heatmap and its numeric colour scale out of a prop.kc2g.com
 * rendered SVG. The site publishes no gridded data, so the render is the only
 * filled source: a matplotlib figure whose map axes embed one raster PNG and
 * whose colour-bar axes carry a second PNG plus tick marks labelled with
 * glyph-outline text (`DejaVuSans-35` is "5").
 *
 * Every assumption about that layout is checked here and a miss throws, so a
 * change upstream surfaces as an unavailable layer rather than a mis-registered
 * or mis-scaled overlay.
 */

/**
 * The map axes span the whole globe: 2:1 image, lon -180..180, lat -90..90.
 * Verified against the site's own contour GeoJSON (colour is constant along
 * each isoline only under exactly this registration).
 */
export const PROPAGATION_BOUNDS = Object.freeze({
  west: -180,
  south: -90,
  east: 180,
  north: 90,
});

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const MAX_PNG_BYTES = 2 * 1024 * 1024;
const IMAGE_PATTERN =
  /<image\b([^>]*?)xlink:href="data:image\/png;base64,\s*([A-Za-z0-9+/=\s]+)"([^>]*)>/g;

function fail(message) {
  throw new Error(`Unrecognised propagation render: ${message}`);
}

function attribute(text, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(text);
  return match ? match[1] : null;
}

function decodePng(base64, label) {
  const png = Buffer.from(base64.replace(/\s+/g, ''), 'base64');
  if (png.length < 33 || png.length > MAX_PNG_BYTES)
    fail(`${label} image has an implausible size`);
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE))
    fail(`${label} image is not a PNG`);
  return { png, width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function glyphText(block) {
  let text = '';
  for (const match of block.matchAll(/xlink:href="#DejaVuSans-([0-9a-f]+)"/g)) {
    const code = Number.parseInt(match[1], 16);
    text += code === 0x2212 ? '-' : String.fromCodePoint(code);
  }
  return text;
}

/**
 * Least-squares line of colour-bar position against ln(value). The upstream
 * colour scale is logarithmic, so equal positions are equal value RATIOS.
 * Returns the value at each end of the bar and the worst position residual.
 */
function fitLogScale(ticks) {
  const n = ticks.length;
  const xs = ticks.map((tick) => Math.log(tick.value));
  const meanX = xs.reduce((sum, x) => sum + x, 0) / n;
  const meanY = ticks.reduce((sum, tick) => sum + tick.position, 0) / n;
  let sxx = 0;
  let sxy = 0;
  ticks.forEach((tick, i) => {
    sxx += (xs[i] - meanX) ** 2;
    sxy += (xs[i] - meanX) * (tick.position - meanY);
  });
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  if (!(slope > 0)) return null;
  const intercept = meanY - slope * meanX;
  let worst = 0;
  ticks.forEach((tick, i) => {
    worst = Math.max(
      worst,
      Math.abs(intercept + slope * xs[i] - tick.position),
    );
  });
  return {
    min: Math.exp(-intercept / slope),
    max: Math.exp((1 - intercept) / slope),
    worst,
  };
}

/**
 * @param {string} svg Rendered SVG document text.
 * @returns {{heatmap: Buffer, colorbar: Buffer, bounds: object,
 *   southUp: boolean, // PNG row 0 is the south edge
 *   scale: 'log', range: {min: number, max: number},
 *   ticks: Array<{position: number, value: number, label: string}>}}
 */
export function extractPropagationMap(svg) {
  if (typeof svg !== 'string' || !svg.includes('<svg'))
    fail('not an SVG document');
  const split = svg.indexOf('id="axes_2"');
  if (split < 0) fail('colour-bar axes not found');
  const mapPart = svg.slice(0, split);
  const barPart = svg.slice(split);

  const mapImages = [...mapPart.matchAll(IMAGE_PATTERN)];
  const barImages = [...barPart.matchAll(IMAGE_PATTERN)];
  if (mapImages.length !== 1 || barImages.length !== 1)
    fail(
      `expected one image per axes, found ${mapImages.length}/${barImages.length}`,
    );

  const mapAttrs = `${mapImages[0][1]} ${mapImages[0][3]}`;
  const heat = decodePng(mapImages[0][2], 'heatmap');
  const bar = decodePng(barImages[0][2], 'colour-bar');
  if (heat.width !== heat.height * 2)
    fail(`heatmap is ${heat.width}x${heat.height}, not a 2:1 global raster`);
  if (bar.width < 64 || bar.height < 1) fail('colour-bar image is too small');

  // The raster must fill the map axes exactly, or the bounds constant is wrong.
  const axesPatch =
    /<path id="patch_\d+" d="M([\d.]+) ([\d.]+)v(-?[\d.]+)h([\d.]+)v/.exec(
      mapPart,
    );
  const imageWidth = Number(attribute(mapAttrs, 'width'));
  const imageHeight = Number(attribute(mapAttrs, 'height'));
  if (!axesPatch) fail('map axes patch not found');
  // matplotlib stores the raster bottom-up and un-flips it with a transform; the
  // PNG's first row is therefore the SOUTH edge. Anything else is unrecognised.
  const transform = attribute(mapAttrs, 'transform');
  let southUp;
  if (transform === null) southUp = false;
  else if (/^matrix\(1 0 0 -1 0 [\d.]+\)$/.test(transform)) southUp = true;
  else fail(`unexpected heatmap transform "${transform}"`);
  const axesHeight = Math.abs(Number(axesPatch[3]));
  const axesWidth = Number(axesPatch[4]);
  if (
    !(Math.abs(imageWidth - axesWidth) < 0.5) ||
    !(Math.abs(imageHeight - axesHeight) < 0.5)
  )
    fail('heatmap does not fill the map axes');

  const barPatch = /<path id="patch_\d+" d="M([\d.]+) [\d.]+h([\d.]+)v/.exec(
    barPart,
  );
  if (!barPatch) fail('colour-bar axes patch not found');
  const barLeft = Number(barPatch[1]);
  const barWidth = Number(barPatch[2]);
  if (!(barWidth > 0)) fail('colour-bar has no width');

  const ticks = [];
  for (const block of barPart.matchAll(
    /<g id="xtick_\d+">([\s\S]*?)<\/g><\/g>/g,
  )) {
    const at = /<use\b[^>]*\bx="(-?[\d.]+)"/.exec(block[1]);
    const label = glyphText(block[1]);
    const value = Number(label);
    if (!at || label === '' || !Number.isFinite(value) || value <= 0) continue;
    const position = (Number(at[1]) - barLeft) / barWidth;
    if (position < -0.001 || position > 1.001) continue;
    ticks.push({ position, value, label });
  }
  if (ticks.length < 2) fail('colour-bar tick labels not found');

  const fit = fitLogScale(ticks);
  if (!fit || !(fit.max > fit.min)) fail('colour-bar scale is degenerate');
  // Tick labels carry one decimal, so allow a little slack; real drift is larger.
  if (fit.worst > 0.01) fail('colour-bar ticks do not fit a log scale');

  return {
    heatmap: heat.png,
    colorbar: bar.png,
    bounds: PROPAGATION_BOUNDS,
    southUp,
    scale: 'log',
    range: { min: fit.min, max: fit.max },
    ticks,
  };
}
