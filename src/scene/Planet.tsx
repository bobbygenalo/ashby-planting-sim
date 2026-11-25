import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { cloudColor, cloudLayout, compassMark, groundDropFt, meteorFrame, meteorGapS, patchNoise, planetProfile, spawnMeteor, starDirections, starVisibility, windVector, type Meteor } from '../engine/planet';
import { solarPosition, sunVectorSite } from '../engine/solar';
import { doyToMonthDay, localToUtc } from '../engine/time';
import type { PlanetCfg } from '../engine/types';
import { useApp } from '../store/store';
import { tiledSurface } from './surfaces';

const noHit = { raycast: () => null } as const;

/** The planet's ground as one lathe mesh in site coordinates (z up): the flat plateau under the lot, rolling over into a sphere. Vertex colors give meadow, field and dry patches; the texture is the same dusty grit as the lot. */
export function planetGeometry(cfg: PlanetCfg, cx: number, cy: number): THREE.BufferGeometry {
  const profile = planetProfile(cfg);
  const segs = cfg.segments;
  const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const c = (h: string) => new THREE.Color(h);
  const plateau = c(cfg.colors.plateau), meadow = c(cfg.colors.meadow), field = c(cfg.colors.field), dry = c(cfg.colors.dry);
  const tmp = new THREE.Color();
  for (const [r, z] of profile) {
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      pos.push(x, y, z);
      uv.push(x, y); // in feet: the texture's repeat turns this into tiles
      // The plateau keeps the lot's ground color and fades into the planet's patchwork past its edge.
      const n = patchNoise(x, y, cfg.patchFt), m = patchNoise(y + 300, x - 120, cfg.patchFt * 0.7);
      tmp.copy(meadow).lerp(field, Math.max(0, (n - 0.45) * 2.2)).lerp(dry, Math.max(0, (m - 0.62) * 3));
      const k = Math.min(1, Math.max(0, (r - cfg.plateauFt) / (cfg.plateauFt * 0.6)));
      tmp.lerpColors(plateau, tmp, k * k * (3 - 2 * k));
      col.push(tmp.r, tmp.g, tmp.b);
    }
  }
  for (let i = 0; i < profile.length - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * segs + j, b = i * segs + ((j + 1) % segs), d = (i + 1) * segs + j, e = (i + 1) * segs + ((j + 1) % segs);
      // Faces wind counter-clockwise seen from outside: up on the top of the plateau, outward round the sphere.
      idx.push(a, d, b, b, d, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** The haze round the planet: opacity follows the length of air along each view ray (`airPathFt`'s calculation, in the shader). */
function atmosphereMaterial(cfg: PlanetCfg, cx: number, cy: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide, fog: false,
    uniforms: {
      uCenter: { value: new THREE.Vector3(cx, -cfg.radiusFt, -cy) }, // three.js world coordinates: the planet's middle
      uInner: { value: cfg.radiusFt }, uOuter: { value: cfg.radiusFt + cfg.atmosphere.thicknessFt }, uScale: { value: cfg.atmosphere.scaleFt },
      uOpacity: { value: cfg.atmosphere.opacity }, uColor: { value: new THREE.Color(cfg.atmosphere.color) },
    },
    vertexShader: `varying vec3 vWorld;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uCenter; uniform float uInner; uniform float uOuter; uniform float uScale; uniform float uOpacity; uniform vec3 uColor;
varying vec3 vWorld;
void main() {
  vec3 o = cameraPosition - uCenter;
  vec3 d = normalize(vWorld - cameraPosition);
  float b = dot(o, d), oo = dot(o, o);
  float disc = b * b - (oo - uOuter * uOuter);
  if (disc <= 0.0) discard;
  float s = sqrt(disc);
  float t0 = max(0.0, -b - s), t1 = -b + s;
  float len = t1 - t0;
  float di = b * b - (oo - uInner * uInner);
  if (di > 0.0) { float si = sqrt(di); if (-b + si > 0.0) len = max(0.0, min(t1, max(t0, -b - si)) - t0); }
  float a = uOpacity * (1.0 - exp(-len / uScale));
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`,
  });
}

/** The ground beyond the lot as a tiny planet, in site coordinates (draw inside the site group), with a thin glow of air. */
export function PlanetGround() {
  const site = useApp((s) => s.site);
  const base = useApp((s) => s.engine.planet);
  const radius = useApp((s) => s.skySettings.planetRadiusFt);
  const cfg = useMemo(() => ({ ...base, radiusFt: radius }), [base, radius]);
  const cx = site.lot.width / 2, cy = site.lot.depth / 2;
  const geo = useMemo(() => planetGeometry(cfg, cx, cy), [cfg, cx, cy]);
  const tex = useMemo(() => tiledSurface('granular', 6), []);
  // The air: a haze that thickens with the length of air a view passes through, so it thins out at its edge instead of ending at a line.
  const haze = useMemo(() => atmosphereMaterial(cfg, cx, cy), [cfg, cx, cy]);
  const engine = useApp((s) => s.engine);
  const doy = useApp((s) => s.doy);
  const minutes = useApp((s) => s.minutes);
  const [month, day] = doyToMonthDay(doy);
  const elev = solarPosition(localToUtc(site.timeZone, engine.referenceYear, month, day, 0, minutes), site.latitude, site.longitude, engine.sun.refraction).elevationDeg;
  useEffect(() => {
    const a = cfg.atmosphere, bright = Math.min(1, Math.max(0, (elev + 6) / 14));
    haze.uniforms.uOpacity.value = a.opacity * (a.nightShare + (1 - a.nightShare) * bright);
  }, [haze, elev, cfg.atmosphere]);
  useEffect(() => () => { geo.dispose(); tex?.dispose(); haze.dispose(); }, [geo, tex, haze]);
  return (
    <group>
      {/* Just under the lot's own ground, as the old flat ground was. */}
      <mesh geometry={geo} position={[0, 0, -0.05]} receiveShadow {...noHit}>
        <meshStandardMaterial vertexColors map={tex} bumpMap={tex} bumpScale={0.5} roughness={1} />
      </mesh>
      <mesh position={[cx, cy, -cfg.radiusFt]} renderOrder={2} {...noHit}>
        <sphereGeometry args={[cfg.radiusFt + cfg.atmosphere.thicknessFt, 96, 48]} />
        <primitive object={haze} attach="material" />
      </mesh>
    </group>
  );
}

/** A soft round glow, drawn once on a canvas, for the sun's halo. */
function glowTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,244,200,1)');
  grad.addColorStop(0.25, 'rgba(255,230,160,0.55)');
  grad.addColorStop(1, 'rgba(255,220,140,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Sun, stars, clouds and meteors, in three.js world coordinates (y up). Hidden in the straight-down Plan view. */
export function SkyBodies() {
  const site = useApp((s) => s.site);
  const engine = useApp((s) => s.engine);
  const base = engine.planet;
  const sky = useApp((s) => s.skySettings);
  const cfg = useMemo(() => ({ ...base, radiusFt: sky.planetRadiusFt }), [base, sky.planetRadiusFt]);
  const doy = useApp((s) => s.doy);
  const minutes = useApp((s) => s.minutes);
  const plan = useApp((s) => s.site.views.find((v) => v.id === s.view)?.kind === 'plan');
  const [month, day] = doyToMonthDay(doy);
  const sun = solarPosition(localToUtc(site.timeZone, engine.referenceYear, month, day, 0, minutes), site.latitude, site.longitude, engine.sun.refraction);
  const v = sunVectorSite(site.rearBearingDeg, site.driveSide, sun.azimuthDeg, sun.elevationDeg);
  const sunDir = useMemo(() => new THREE.Vector3(v[0], v[2], -v[1]).normalize(), [v[0], v[1], v[2]]); // eslint-disable-line react-hooks/exhaustive-deps

  // The wind: the compass direction it blows toward, as a horizontal unit vector in the world (site y is world -z).
  const wind = useMemo(() => {
    const w = sunVectorSite(site.rearBearingDeg, site.driveSide, (sky.windFromDeg + 180) % 360, 0);
    return windVector(w[0], -w[1]);
  }, [site.rearBearingDeg, site.driveSide, sky.windFromDeg]);

  const follow = useRef<THREE.Group>(null);
  const shell = useRef<THREE.Group>(null);
  const kind = base.clouds.types[sky.cloudType];
  const clouds = useMemo(() => cloudLayout(base.clouds, sky.cloudType, sky.cloudCover, wind), [base.clouds, sky.cloudType, sky.cloudCover, wind]);
  const cx = site.lot.width / 2, cy = site.lot.depth / 2;
  // The cloud shell starts level again when the wind changes direction, so streaks lie along the new wind.
  useEffect(() => { shell.current?.quaternion.identity(); }, [wind]);

  // Stars: one Points object, brighter and dimmer by star.
  const stars = useMemo(() => {
    const dirs = starDirections(cfg.stars.count, cfg.stars.seed);
    const p = new Float32Array(dirs.length * 3), c = new Float32Array(dirs.length * 3);
    dirs.forEach((d, i) => {
      p.set([d[0] * cfg.stars.distanceFt, d[1] * cfg.stars.distanceFt, d[2] * cfg.stars.distanceFt], i * 3);
      const b = 0.45 + 0.55 * ((i * 2654435761) % 1000) / 1000;
      c.set([b, b, b * (0.9 + 0.1 * (i % 3) / 2)], i * 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  }, [cfg.stars]);
  const starMat = useRef<THREE.PointsMaterial>(null);
  const glow = useMemo(() => glowTexture(), []);

  // Meteors: a pool of line segments (a bright head fading to nothing at the tail), spawned at the chosen rate on dark nights.
  const maxLive = cfg.meteors.maxLive;
  const meteorGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxLive * 6), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(maxLive * 6), 3));
    return g;
  }, [maxLive]);
  const meteors = useRef<{ m: Meteor; age: number }[]>([]);
  const nextMeteor = useRef(2);
  const meteorColor = useMemo(() => new THREE.Color(cfg.meteors.color), [cfg.meteors.color]);

  // Clouds: one instanced mesh of flattened puffs, each cloud laid on the shell round the planet.
  const puffCount = useMemo(() => clouds.reduce((t, c) => t + c.puffs.length, 0), [clouds]);
  const puffs = useRef<THREE.InstancedMesh>(null);
  const cloudMat = useRef<THREE.MeshStandardMaterial>(null);
  useEffect(() => {
    const m = puffs.current;
    if (!m) return;
    const up = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), at = new THREE.Vector3();
    const basis = new THREE.Matrix4(), mat = new THREE.Matrix4(), scale = new THREE.Matrix4();
    let i = 0;
    for (const cl of clouds) {
      up.set(cl.dir[0], cl.dir[1], cl.dir[2]).normalize();
      t1.set(cl.along[0], cl.along[1], cl.along[2]).normalize();
      t2.crossVectors(up, t1).normalize();
      basis.makeBasis(t1, up, t2);
      const R = cfg.radiusFt + cl.altitudeFt;
      for (const p of cl.puffs) {
        at.copy(up).multiplyScalar(R).addScaledVector(t1, p.dx).addScaledVector(t2, p.dy).addScaledVector(up, p.dz);
        // wider along the wind for streaks, flat for sheets, tall for storm heads
        scale.makeScale(p.size * Math.sqrt(kind.stretch), p.size * kind.flatten, p.size / Math.sqrt(kind.stretch));
        mat.copy(basis).multiply(scale).setPosition(at);
        m.setMatrixAt(i++, mat);
      }
    }
    m.instanceMatrix.needsUpdate = true;
  }, [clouds, cfg.radiusFt, kind.stretch, kind.flatten]);

  const sunMesh = useRef<THREE.Mesh>(null);
  const sunGlow = useRef<THREE.Sprite>(null);
  const axis = useMemo(() => new THREE.Vector3(), []);
  const turn = useMemo(() => new THREE.Quaternion(), []);
  useFrame(({ camera }, dt) => {
    const step = Math.min(dt, 0.1);
    // Sun and stars are far beyond the planet: they stay put on the sky as the camera moves.
    follow.current?.position.copy(camera.position);
    const sunUp = sun.elevationDeg > -2;
    if (sunMesh.current) sunMesh.current.visible = sunUp;
    if (sunGlow.current) sunGlow.current.visible = sunUp && !!glow;
    const dark = starVisibility(sun.elevationDeg, cfg.stars);
    if (starMat.current) starMat.current.opacity = dark;
    if (cloudMat.current) {
      const col = new THREE.Color(cloudColor(sun.elevationDeg, base.clouds.colors, engine.sky)).multiplyScalar(kind.shade);
      cloudMat.current.color.copy(col);
      cloudMat.current.emissive.copy(col).multiplyScalar(sun.elevationDeg > 0 ? 0.25 : 0.45);
    }
    // The shell turns about a horizontal axis (up crossed with the wind) through the planet's middle: clouds sail along the wind.
    if (shell.current && wind) {
      axis.set(wind[2], 0, -wind[0]);
      turn.setFromAxisAngle(axis, (sky.windFtPerS / cfg.radiusFt) * step);
      shell.current.quaternion.premultiply(turn);
    }
    // Meteors: a Poisson stream, only when the sky is dark, each a streak with a fading trail.
    const live = meteors.current;
    nextMeteor.current -= step;
    if (nextMeteor.current <= 0) {
      if (live.length < maxLive && dark > 0.4) live.push({ m: spawnMeteor(Math.random, cfg.meteors), age: 0 });
      nextMeteor.current = Math.min(meteorGapS(sky.meteorsPerMin * dark, Math.random), 5);
    }
    const pos = meteorGeo.getAttribute('position') as THREE.BufferAttribute, col = meteorGeo.getAttribute('color') as THREE.BufferAttribute;
    const D = cfg.stars.distanceFt * 0.97;
    let n = 0;
    for (let i = live.length - 1; i >= 0; i--) {
      live[i].age += step;
      if (live[i].age >= live[i].m.lifeS) live.splice(i, 1);
    }
    for (const e of live) {
      const f = meteorFrame(e.m, e.age);
      if (!f) continue;
      pos.setXYZ(n * 2, f.head[0] * D, f.head[1] * D, f.head[2] * D);
      pos.setXYZ(n * 2 + 1, f.tail[0] * D, f.tail[1] * D, f.tail[2] * D);
      col.setXYZ(n * 2, meteorColor.r * f.brightness, meteorColor.g * f.brightness, meteorColor.b * f.brightness);
      col.setXYZ(n * 2 + 1, 0, 0, 0); // the tail fades to nothing (additive blending)
      n++;
    }
    meteorGeo.setDrawRange(0, n * 2);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });
  if (plan) return null;
  return (
    <>
      <group ref={follow}>
        <points geometry={stars} frustumCulled={false} {...noHit}>
          <pointsMaterial ref={starMat} vertexColors size={cfg.stars.sizeFt} sizeAttenuation transparent opacity={0} depthWrite={false} fog={false} />
        </points>
        <lineSegments geometry={meteorGeo} frustumCulled={false} {...noHit}>
          <lineBasicMaterial vertexColors transparent blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
        </lineSegments>
        <mesh ref={sunMesh} position={sunDir.clone().multiplyScalar(cfg.sun.distanceFt)} {...noHit}>
          <sphereGeometry args={[cfg.sun.radiusFt, 32, 16]} />
          <meshBasicMaterial color={cfg.sun.color} toneMapped={false} fog={false} />
        </mesh>
        {glow && (
          <sprite ref={sunGlow} position={sunDir.clone().multiplyScalar(cfg.sun.distanceFt - 20)} scale={[cfg.sun.radiusFt * cfg.sun.glowScale * 2, cfg.sun.radiusFt * cfg.sun.glowScale * 2, 1]} {...noHit}>
            <spriteMaterial map={glow} transparent opacity={cfg.sun.glowOpacity} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} />
          </sprite>
        )}
      </group>
      <group position={[cx, -cfg.radiusFt, -cy]}>
        <group ref={shell}>
          <instancedMesh key={`${sky.cloudType}-${puffCount}`} ref={puffs} args={[undefined, undefined, Math.max(1, puffCount)]} count={puffCount} frustumCulled={false} {...noHit}>
            <icosahedronGeometry args={[1, 3]} />
            <meshStandardMaterial ref={cloudMat} roughness={1} transparent={kind.opacity < 1} opacity={kind.opacity} depthWrite={kind.opacity >= 1} />
          </instancedMesh>
        </group>
      </group>
    </>
  );
}

/** A quiet compass rose painted on a canvas: a thin ring with a few ticks, a slim north arrow and a small N, in one muted ink (the plane it is drawn on is mostly see-through, so it reads like marks worn into the ground). */
function roseTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  if (!g) return null;
  g.translate(256, 256);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = '#26311f';
  g.fillStyle = '#26311f';
  g.lineWidth = 3;
  g.beginPath(); g.arc(0, 0, 232, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, long = i % 2 === 0;
    g.lineWidth = long ? 3 : 2;
    g.beginPath(); g.moveTo(Math.sin(a) * (long ? 208 : 220), -Math.cos(a) * (long ? 208 : 220)); g.lineTo(Math.sin(a) * 232, -Math.cos(a) * 232); g.stroke();
  }
  // a slim arrow from the middle to just under the N
  g.lineWidth = 4;
  g.beginPath(); g.moveTo(0, 90); g.lineTo(0, -150); g.stroke();
  g.beginPath(); g.moveTo(-18, -122); g.lineTo(0, -154); g.lineTo(18, -122); g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '600 64px system-ui, sans-serif';
  g.fillText('N', 0, -192);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * The cardinal north marker, painted on the ground just beyond the lot on its north side (it replaces the old "N" label that
 * floated over everything): a small, faint compass rose lying on the planet's surface, turned so that its N points north. Site coordinates.
 */
export function CompassMark() {
  const site = useApp((s) => s.site);
  const cfg = useApp((s) => s.engine.planet);
  const tex = useMemo(() => roseTexture(), []);
  useEffect(() => () => tex?.dispose(), [tex]);
  const n = sunVectorSite(site.rearBearingDeg, site.driveSide, 0, 0);
  const m = compassMark(site.lot, [n[0], n[1]], 20);
  const size = 18;
  if (!tex) return null;
  return (
    <mesh position={[m.x, m.y, -groundDropFt(m.distanceFt, cfg) + 0.04]} rotation={[0, 0, m.angle]} renderOrder={1} {...noHit}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial map={tex} transparent opacity={0.3} depthWrite={false} polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4} toneMapped={false} />
    </mesh>
  );
}
