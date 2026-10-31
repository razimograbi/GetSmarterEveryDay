// Turns world-atlas TopoJSON (https://github.com/topojson/world-atlas) into a single
// country's silhouette as SVG. Used by scripts/fetch-images.js to save the shapes, and
// by the browser as a live fallback. No dependencies.

export const WORLD_ATLAS_URLS = [
  'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json',
  'https://unpkg.com/world-atlas@2/countries-50m.json',
];

const decoded = new WeakMap();

/** Decodes delta-encoded, quantized TopoJSON arcs into [lon, lat] point lists (cached per topology). */
function decodeArcs(topo) {
  if (!decoded.has(topo)) decoded.set(topo, decodeArcsRaw(topo));
  return decoded.get(topo);
}

function decodeArcsRaw(topo) {
  const t = topo.transform;
  return topo.arcs.map((arc) => {
    if (!t) return arc.map((p) => [p[0], p[1]]);
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]];
    });
  });
}

function ring(arcIdxs, arcs) {
  const out = [];
  for (const i of arcIdxs) {
    const src = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
    // Copy the points (they're shared between neighbours) and skip the duplicate joining point.
    const pts = (out.length ? src.slice(1) : src).map((p) => [p[0], p[1]]);
    for (const p of pts) out.push(p);
  }
  return out;
}

function geometryPolygons(geom, arcs) {
  if (geom.type === 'Polygon') return [geom.arcs.map((r) => ring(r, arcs))];
  if (geom.type === 'MultiPolygon') return geom.arcs.map((poly) => poly.map((r) => ring(r, arcs)));
  return [];
}

const bbox = (pts) => {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
};

const area = (pts) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return Math.abs(a / 2);
};

const gap = (a, b) => Math.max(0, a[0] - b[2], b[0] - a[2], a[1] - b[3], b[1] - a[3]);

/**
 * Picks the parts of a country worth drawing: the mainland plus nearby islands. Far,
 * small territories (Easter Island for Chile, the Azores for Portugal) are dropped so the
 * shape stays recognisable.
 */
function mainParts(polygons) {
  // Countries crossing the 180° line (Russia, Fiji) get their western parts moved east.
  const [minLon, , maxLon] = bbox(polygons.flat(2)); // (no Math.max(...big array): it overflows the stack)
  if (maxLon - minLon > 180) {
    for (const poly of polygons) for (const r of poly) for (const p of r) if (p[0] < 0) p[0] += 360;
  }
  const withInfo = polygons.map((poly) => ({ poly, area: area(poly[0]), box: bbox(poly[0]) }));
  const total = withInfo.reduce((s, p) => s + p.area, 0);
  const biggest = withInfo.reduce((a, b) => (b.area > a.area ? b : a));
  return withInfo.filter((p) => p === biggest || gap(p.box, biggest.box) <= 5 || p.area >= total * 0.1).map((p) => p.poly);
}

/** Finds a country by ISO 3166-1 numeric code (as world-atlas ids are), e.g. "076" for Brazil. */
export function findCountry(topo, iso) {
  const objects = topo.objects.countries.geometries;
  return objects.find((g) => String(g.id).padStart(3, '0') === String(iso).padStart(3, '0')) || null;
}

/** SVG markup for one country's silhouette, or null if it isn't in the data. */
export function countrySvg(topo, iso, { fill = '#1F2A5A', size = 1000, label = 'Country outline' } = {}) {
  const geom = findCountry(topo, iso);
  if (!geom) return null;
  const arcs = decodeArcs(topo);
  const polygons = mainParts(geometryPolygons(geom, arcs));
  if (!polygons.length) return null;

  // Simple local projection: longitude squeezed by the cosine of the middle latitude,
  // which keeps shapes true enough for anything that isn't continent-sized.
  const [x0, y0, x1, y1] = bbox(polygons.flat(2));
  const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
  const w = (x1 - x0) * k;
  const h = y1 - y0;
  const pad = 0.06;
  const scale = (size * (1 - 2 * pad)) / Math.max(w, h);
  const ox = (size - w * scale) / 2;
  const oy = (size - h * scale) / 2;
  const project = ([lon, lat]) => [ox + (lon - x0) * k * scale, oy + (y1 - lat) * scale];

  let d = '';
  for (const poly of polygons) {
    for (const r of poly) {
      let last = null;
      let part = '';
      let count = 0;
      for (const p of r) {
        const [x, y] = project(p);
        if (last && Math.abs(x - last[0]) < 0.8 && Math.abs(y - last[1]) < 0.8) continue; // drop sub-pixel detail
        part += `${count ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
        last = [x, y];
        count++;
      }
      if (count >= 3) d += part + 'Z';
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}"><path d="${d}" fill="${fill}" fill-rule="evenodd" stroke="${fill}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}
