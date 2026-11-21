/**
 * Solar position using the NOAA General Solar Position Calculations
 * (Meeus-based). Azimuth is a compass bearing, degrees clockwise from true north.
 */
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

const mod = (a: number, n: number) => ((a % n) + n) % n;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface SolarPosition {
  azimuthDeg: number;
  elevationDeg: number;
  declinationDeg: number;
  equationOfTimeMin: number;
}

function refractionDeg(elevation: number): number {
  if (elevation > 85) return 0;
  const te = Math.tan(elevation * RAD);
  let r: number;
  if (elevation > 5) r = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  else if (elevation > -0.575) r = 1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)));
  else r = -20.774 / te;
  return r / 3600;
}

export function solarPosition(utcMs: number, latDeg: number, lonDeg: number, refraction = true): SolarPosition {
  const jd = utcMs / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = mod(280.46646 + T * (36000.76983 + T * 0.0003032), 360);
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * RAD;
  const C =
    Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * Mr) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan((eps * RAD) / 2) ** 2;
  const L0r = L0 * RAD;
  const eqTime =
    4 *
    DEG *
    (y * Math.sin(2 * L0r) -
      2 * e * Math.sin(Mr) +
      4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
      0.5 * y * y * Math.sin(4 * L0r) -
      1.25 * e * e * Math.sin(2 * Mr));

  const minutesUtc = mod(utcMs, 86400000) / 60000;
  const tst = mod(minutesUtc + eqTime + 4 * lonDeg, 1440);
  let ha = tst / 4 - 180;
  if (ha < -180) ha += 360;

  const lat = latDeg * RAD;
  const cosZen = clamp(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha * RAD), -1, 1);
  const zen = Math.acos(cosZen);
  let elevation = 90 - zen * DEG;

  let azimuth = 0;
  const denom = Math.cos(lat) * Math.sin(zen);
  if (Math.abs(denom) > 0.001) {
    const azRad = clamp((Math.sin(lat) * Math.cos(zen) - Math.sin(decl)) / denom, -1, 1);
    azimuth = 180 - Math.acos(azRad) * DEG;
    if (ha > 0) azimuth = -azimuth;
  } else {
    azimuth = latDeg > 0 ? 180 : 0;
  }
  azimuth = mod(azimuth, 360);

  if (refraction) elevation += refractionDeg(elevation);
  return { azimuthDeg: azimuth, elevationDeg: elevation, declinationDeg: decl * DEG, equationOfTimeMin: eqTime };
}

/**
 * Unit vector pointing toward the sun in site coordinates (x across the lot, y toward the
 * rear, z up). The rear axis bears `rearBearingDeg`; X is 90 degrees clockwise from it when
 * the driveway is on the left facing the house from the street.
 */
export function sunVectorSite(
  rearBearingDeg: number,
  driveSide: 'left' | 'right',
  azimuthDeg: number,
  elevationDeg: number,
): [number, number, number] {
  const az = azimuthDeg * RAD;
  const el = elevationDeg * RAD;
  const east = Math.sin(az) * Math.cos(el);
  const north = Math.cos(az) * Math.cos(el);
  const yb = rearBearingDeg * RAD;
  const xb = (rearBearingDeg + (driveSide === 'left' ? 90 : -90)) * RAD;
  const yUnit = [Math.sin(yb), Math.cos(yb)];
  const xUnit = [Math.sin(xb), Math.cos(xb)];
  return [east * xUnit[0] + north * xUnit[1], east * yUnit[0] + north * yUnit[1], Math.sin(el)];
}
