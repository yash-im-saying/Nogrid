const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const EARTH_RADIUS_M = 6371000;

const SET_ORIGIN_COLUMN_LETTERS = 'ABCDEFGH';
const SET_ORIGIN_ROW_LETTERS = 'ABCDEFGHJKLMNPQRSTUV';
const LAT_BANDS = 'CDEFGHJKLMNPQRSTUVWXX';

function getLatitudeBand(lat: number): string {
  const idx = Math.floor((lat + 80) / 8);
  if (idx < 0) return 'C';
  if (idx >= LAT_BANDS.length) return 'X';
  return LAT_BANDS[idx];
}

function getUtmZone(lat: number, lon: number): number {
  let zone = Math.floor((lon + 180) / 6) + 1;
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) zone = 31;
    else if (lon >= 9 && lon < 21) zone = 33;
    else if (lon >= 21 && lon < 33) zone = 35;
    else if (lon >= 33 && lon < 42) zone = 37;
  }
  return zone;
}

export function latLonToMGRS(lat: number, lon: number, accuracyDigits = 5): string {
  if (lat < -80 || lat > 84) {
    return `POLAR ${lat.toFixed(4)} ${lon.toFixed(4)}`;
  }

  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const e2 = 2 * f - f * f;
  const ePrime2 = e2 / (1 - e2);
  const k0 = 0.9996;

  const zone = getUtmZone(lat, lon);
  const lonOrigin = (zone - 1) * 6 - 180 + 3;
  const lonOriginRad = lonOrigin * DEG_TO_RAD;
  const latRad = lat * DEG_TO_RAD;
  const lonRad = lon * DEG_TO_RAD;

  const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) ** 2);
  const T = Math.tan(latRad) ** 2;
  const C = ePrime2 * Math.cos(latRad) ** 2;
  const A = Math.cos(latRad) * (lonRad - lonOriginRad);

  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * latRad -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * latRad) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * latRad) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * latRad));

  const easting =
    k0 *
      N *
      (A +
        ((1 - T + C) * A ** 3) / 6 +
        ((5 - 18 * T + T ** 2 + 72 * C - 58 * ePrime2) * A ** 5) / 120) +
    500000;

  let northing =
    k0 *
    (M +
      N *
        Math.tan(latRad) *
        (A ** 2 / 2 +
          ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 +
          ((61 - 58 * T + T ** 2 + 600 * C - 330 * ePrime2) * A ** 6) / 720));

  if (lat < 0) {
    northing += 10000000;
  }

  const band = getLatitudeBand(lat);
  const set = zone % 6 || 6;

  const colOrigin = ((set - 1) % 3) * 8;
  const colIdx = Math.floor(easting / 100000) - 1;
  const colLetters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const colLetter = colLetters[(colOrigin + colIdx) % 24];

  const rowOrigin = set % 2 === 0 ? 5 : 0;
  const rowIdx = Math.floor((northing % 2000000) / 100000);
  const rowLetter = SET_ORIGIN_ROW_LETTERS[(rowOrigin + rowIdx) % 20];

  const eStr = Math.floor(easting % 100000)
    .toString()
    .padStart(5, '0')
    .slice(0, accuracyDigits);
  const nStr = Math.floor(northing % 100000)
    .toString()
    .padStart(5, '0')
    .slice(0, accuracyDigits);

  void SET_ORIGIN_COLUMN_LETTERS;
  return `${zone}${band} ${colLetter}${rowLetter} ${eStr} ${nStr}`;
}

export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function calculateBearingDegrees(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const phi1 = lat1 * DEG_TO_RAD;
  const phi2 = lat2 * DEG_TO_RAD;
  const dLambda = (lon2 - lon1) * DEG_TO_RAD;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const brng = Math.atan2(y, x) * RAD_TO_DEG;
  return (brng + 360) % 360;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(2)}km`;
}
