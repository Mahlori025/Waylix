/**
 * Web-preview stand-in for @maplibre/maplibre-react-native.
 *
 * MapLibre Native has no web build, so `npm run web:preview` aliases the
 * package to this file (see metro.config.js). It renders the app's REAL
 * GeoJSON sources and evaluates their REAL layer style expressions onto an
 * SVG in Web-Mercator — only the basemap tiles are missing (a plain grid is
 * drawn instead). It exists for UI review, screenshots and CI, not for users.
 */
import { createContext, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

type LngLat = [number, number];
type Bounds = [number, number, number, number];
interface Viewport { center: LngLat; zoom: number }
interface LayerSpec { id: string; type: string; filter?: unknown; paint?: Record<string, unknown>; layout?: Record<string, unknown>; minzoom?: number }
interface SourceEntry { id: string; data: GeoJSON.FeatureCollection; layers: LayerSpec[]; onPress?: (e: unknown) => void }

const TILE = 256;
const worldSize = (z: number) => TILE * 2 ** z;
const project = ([lon, lat]: LngLat, z: number): [number, number] => {
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * worldSize(z), (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldSize(z)];
};
const unproject = ([x, y]: [number, number], z: number): LngLat => {
  const W = worldSize(z);
  const lon = (x / W) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / W;
  return [lon, (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))];
};

// ── Minimal MapLibre expression evaluator (the subset Waylix's layers use) ──
function ev(e: unknown, p: Record<string, unknown>, z: number): unknown {
  if (!Array.isArray(e) || typeof e[0] !== 'string') return e;
  const [op, ...a] = e as [string, ...unknown[]];
  const n = (x: unknown) => Number(ev(x, p, z));
  switch (op) {
    case 'get': return p[a[0] as string];
    case 'zoom': return z;
    case '+': return a.reduce<number>((s, x) => s + n(x), 0);
    case '*': return a.reduce<number>((s, x) => s * n(x), 1);
    case '/': return n(a[0]) / n(a[1]);
    case '==': return ev(a[0], p, z) === ev(a[1], p, z);
    case 'case': {
      for (let i = 0; i + 1 < a.length; i += 2) if (ev(a[i], p, z)) return ev(a[i + 1], p, z);
      return ev(a[a.length - 1], p, z);
    }
    case 'interpolate': {
      const [kind, input, ...stops] = a as [unknown[], unknown, ...unknown[]];
      const x = n(input);
      const base = kind[0] === 'exponential' ? Number(kind[1]) : 1;
      for (let i = 0; i + 3 < stops.length + 1; i += 2) {
        const x0 = Number(stops[i]), x1 = Number(stops[i + 2]);
        if (stops[i + 2] === undefined || x <= x1) {
          if (stops[i + 2] === undefined || x <= x0) return n(stops[i + 1]);
          const t = base === 1 ? (x - x0) / (x1 - x0) : (base ** (x - x0) - 1) / (base ** (x1 - x0) - 1);
          return n(stops[i + 1]) + t * (n(stops[i + 3]) - n(stops[i + 1]));
        }
      }
      return n(stops[stops.length - 1]);
    }
    default: return undefined;
  }
}

const MapCtx = createContext<{
  vp: Viewport; setVp: (v: Viewport) => void; size: { w: number; h: number };
  register: (s: SourceEntry) => void; unregister: (id: string) => void; user: LngLat | undefined; setShowUser: (b: boolean) => void;
} | null>(null);
const SourceCtx = createContext<{ add: (l: LayerSpec) => void; remove: (id: string) => void } | null>(null);

export function Map(props: {
  style?: unknown; children?: ReactNode; mapStyle?: unknown;
  onRegionDidChange?: (e: { nativeEvent: unknown }) => void;
  onPress?: (e: { nativeEvent: unknown }) => void; onLongPress?: (e: { nativeEvent: unknown }) => void;
  [k: string]: unknown;
}) {
  const [vp, setVp] = useState<Viewport>({ center: [28.0473, -26.2041], zoom: 12 });
  const [size, setSize] = useState({ w: 390, h: 844 });
  const [sources, setSources] = useState<globalThis.Map<string, SourceEntry>>(new globalThis.Map());
  const [user, setUser] = useState<LngLat>();
  const [showUser, setShowUser] = useState(false);

  useEffect(() => {
    const geo = (globalThis as { navigator?: { geolocation?: Geolocation } }).navigator?.geolocation;
    if (!geo) return;
    const id = geo.watchPosition((p) => setUser([p.coords.longitude, p.coords.latitude]), () => undefined, { enableHighAccuracy: true });
    return () => geo.clearWatch(id);
  }, []);

  const toScreen = (ll: LngLat): [number, number] => {
    const [cx, cy] = project(vp.center, vp.zoom);
    const [x, y] = project(ll, vp.zoom);
    return [x - cx + size.w / 2, y - cy + size.h / 2];
  };
  const toLngLat = (sx: number, sy: number): LngLat => {
    const [cx, cy] = project(vp.center, vp.zoom);
    return unproject([cx + sx - size.w / 2, cy + sy - size.h / 2], vp.zoom);
  };
  const bounds = (): Bounds => {
    const sw = toLngLat(0, size.h), ne = toLngLat(size.w, 0);
    return [sw[0], sw[1], ne[0], ne[1]];
  };

  useEffect(() => {
    props.onRegionDidChange?.({ nativeEvent: { center: vp.center, zoom: vp.zoom, bearing: 0, pitch: 0, bounds: bounds(), animated: false, userInteraction: false } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vp.center[0], vp.center[1], vp.zoom, size.w, size.h]);

  const ctx = useMemo(() => ({
    vp, setVp, size, user, setShowUser,
    register: (s: SourceEntry) => setSources((m) => new globalThis.Map(m).set(s.id, s)),
    unregister: (id: string) => setSources((m) => { const n = new globalThis.Map(m); n.delete(id); return n; }),
  }), [vp, size, user]);

  const grid: ReactNode[] = [];
  const step = 2 ** Math.round(Math.log2(400 / worldSize(vp.zoom) * 360)) ; // ~400 px in degrees
  const [w0, s0, e0, n0] = bounds();
  for (let lon = Math.floor(w0 / step) * step; lon <= e0; lon += step) { const [x] = toScreen([lon, 0]); grid.push(<line key={`x${lon}`} x1={x} x2={x} y1={0} y2={size.h} stroke="#E6E1D6" strokeWidth={1} />); }
  for (let lat = Math.floor(s0 / step) * step; lat <= n0; lat += step) { const [, y] = toScreen([vp.center[0], lat]); grid.push(<line key={`y${lat}`} y1={y} y2={y} x1={0} x2={size.w} stroke="#E6E1D6" strokeWidth={1} />); }

  const drawn: ReactNode[] = [];
  for (const src of sources.values()) {
    for (const layer of src.layers) {
      if (layer.minzoom !== undefined && vp.zoom < layer.minzoom) continue;
      for (const [fi, f] of src.data.features.entries()) {
        const props_ = (f.properties ?? {}) as Record<string, unknown>;
        if (layer.filter && !ev(layer.filter, props_, vp.zoom)) continue;
        const paint = layer.paint ?? {};
        const P = (k: string, d: unknown) => (paint[k] === undefined ? d : ev(paint[k], props_, vp.zoom));
        const key = `${src.id}-${layer.id}-${fi}`;
        const press = src.onPress ? (e: { stopPropagation: () => void }) => { e.stopPropagation(); src.onPress!({ nativeEvent: { features: [f], lngLat: (f.geometry as GeoJSON.Point).coordinates, point: [0, 0] } }); } : undefined;
        if (layer.type === 'circle' && f.geometry.type === 'Point') {
          const [x, y] = toScreen(f.geometry.coordinates as LngLat);
          drawn.push(<circle key={key} cx={x} cy={y} r={Number(P('circle-radius', 5))} fill={String(P('circle-color', '#000'))} fillOpacity={Number(P('circle-opacity', 1))}
            stroke={String(P('circle-stroke-color', 'none'))} strokeWidth={Number(P('circle-stroke-width', 0))} strokeOpacity={Number(P('circle-stroke-opacity', 1))}
            onClick={press as never} style={{ cursor: press ? 'pointer' : undefined } as never} data-hazard={String(props_.id ?? '')} />);
        } else if (layer.type === 'line' && f.geometry.type === 'LineString') {
          const pts = (f.geometry.coordinates as LngLat[]).map((c) => toScreen(c).join(',')).join(' ');
          const w = Number(P('line-width', 2));
          const dash = paint['line-dasharray'] as number[] | undefined;
          drawn.push(<polyline key={key} points={pts} fill="none" stroke={String(P('line-color', '#00f'))} strokeOpacity={Number(P('line-opacity', 1))} strokeWidth={w}
            strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash ? dash.map((d) => d * w).join(' ') : undefined} />);
        } else if (layer.type === 'symbol' && f.geometry.type === 'Point') {
          const [x, y] = toScreen(f.geometry.coordinates as LngLat);
          const text = ev(layer.layout?.['text-field'], props_, vp.zoom);
          if (text) drawn.push(<text key={key} x={x} y={y + 22} textAnchor="middle" fontSize={12} fontFamily="sans-serif" fill="#1F2937" stroke="#fff" strokeWidth={3} paintOrder="stroke">{String(text)}</text>);
        }
      }
    }
  }
  if (showUser && user) {
    const [x, y] = toScreen(user);
    drawn.push(<g key="user"><circle cx={x} cy={y} r={14} fill="#0B5FFF" fillOpacity={0.15} /><circle cx={x} cy={y} r={7} fill="#0B5FFF" stroke="#fff" strokeWidth={3} /></g>);
  }

  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  const pointFrom = (e: { clientX: number; clientY: number; currentTarget: { getBoundingClientRect: () => DOMRect } }) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as [number, number];
  };

  return (
    <MapCtx.Provider value={ctx}>
      <View style={props.style as never} onLayout={(e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        <svg width={size.w} height={size.h} style={{ position: 'absolute', inset: 0, background: '#F4F1EA', userSelect: 'none' } as never}
          onClick={(e) => { const [x, y] = pointFrom(e as never); props.onPress?.({ nativeEvent: { lngLat: toLngLat(x, y), point: [x, y] } }); }}
          onContextMenu={(e) => { e.preventDefault(); const [x, y] = pointFrom(e as never); props.onLongPress?.({ nativeEvent: { lngLat: toLngLat(x, y), point: [x, y] } }); }}
          onPointerDown={(e) => { const [x, y] = pointFrom(e as never); holdTimer = setTimeout(() => props.onLongPress?.({ nativeEvent: { lngLat: toLngLat(x, y), point: [x, y] } }), 650); }}
          onPointerUp={() => clearTimeout(holdTimer)}>
          {grid}
          <text x={size.w / 2} y={size.h / 2 + 40} textAnchor="middle" fontSize={11} fill="#B8B0A0" fontFamily="sans-serif">web preview · basemap tiles not loaded</text>
          {drawn}
        </svg>
        {props.children}
      </View>
    </MapCtx.Provider>
  );
}

export interface CameraRef {
  flyTo(o: { center: LngLat; zoom?: number }): void; easeTo(o: { center: LngLat; zoom?: number }): void; jumpTo(o: { center: LngLat; zoom?: number }): void;
  fitBounds(b: Bounds, o?: { padding?: { top?: number; bottom?: number; left?: number; right?: number } }): void; zoomTo(z: number): void; setStop(): Promise<void>;
}

export function Camera(props: { ref?: React.Ref<CameraRef>; initialViewState?: { center?: LngLat; zoom?: number }; trackUserLocation?: string; zoom?: number; [k: string]: unknown }) {
  const m = useContext(MapCtx)!;
  const init = useRef(false);
  useEffect(() => {
    if (init.current) return;
    init.current = true;
    const iv = props.initialViewState;
    if (iv?.center) m.setVp({ center: iv.center, zoom: iv.zoom ?? 12 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (props.trackUserLocation && m.user) m.setVp({ center: m.user, zoom: props.zoom ?? m.vp.zoom });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.trackUserLocation, m.user?.[0], m.user?.[1], props.zoom]);
  useImperativeHandle(props.ref, () => {
    const go = (o: { center: LngLat; zoom?: number }) => m.setVp({ center: o.center, zoom: o.zoom ?? m.vp.zoom });
    return {
      flyTo: go, easeTo: go, jumpTo: go, zoomTo: (z) => m.setVp({ ...m.vp, zoom: z }), setStop: async () => undefined,
      fitBounds: (b, o) => {
        const pad = o?.padding ?? {};
        const w = m.size.w - (pad.left ?? 0) - (pad.right ?? 0), h = m.size.h - (pad.top ?? 0) - (pad.bottom ?? 0);
        let z = 18;
        while (z > 2) {
          const [x0, y0] = project([b[0], b[3]], z), [x1, y1] = project([b[2], b[1]], z);
          if (x1 - x0 <= w && y1 - y0 <= h) break;
          z -= 0.25;
        }
        const [cx0, cy0] = project([b[0], b[3]], z), [cx1, cy1] = project([b[2], b[1]], z);
        const cx = (cx0 + cx1) / 2 - ((pad.right ?? 0) - (pad.left ?? 0)) / 2, cy = (cy0 + cy1) / 2 - ((pad.bottom ?? 0) - (pad.top ?? 0)) / 2;
        m.setVp({ center: unproject([cx, cy], z), zoom: z });
      },
    };
  }, [m]);
  return null;
}

export function GeoJSONSource(props: { id?: string; data: GeoJSON.FeatureCollection; onPress?: (e: unknown) => void; children?: ReactNode; [k: string]: unknown }) {
  const m = useContext(MapCtx)!;
  const [layers, setLayers] = useState<LayerSpec[]>([]);
  const id = props.id ?? 'source';
  const ctx = useMemo(() => ({
    add: (l: LayerSpec) => setLayers((ls) => [...ls.filter((x) => x.id !== l.id), l]),
    remove: (lid: string) => setLayers((ls) => ls.filter((x) => x.id !== lid)),
  }), []);
  useEffect(() => {
    m.register({ id, data: props.data, layers, ...(props.onPress ? { onPress: props.onPress } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.data, layers]);
  useEffect(() => () => m.unregister(id), [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return <SourceCtx.Provider value={ctx}>{props.children}</SourceCtx.Provider>;
}

export function Layer(props: LayerSpec & { [k: string]: unknown }) {
  const s = useContext(SourceCtx)!;
  const spec = JSON.stringify([props.type, props.filter, props.paint, props.layout, props.minzoom]);
  useEffect(() => {
    s.add({ id: props.id, type: props.type, filter: props.filter, ...(props.paint ? { paint: props.paint } : {}), ...(props.layout ? { layout: props.layout } : {}), ...(props.minzoom !== undefined ? { minzoom: props.minzoom } : {}) });
    return () => s.remove(props.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec]);
  return null;
}

export function UserLocation() {
  const m = useContext(MapCtx)!;
  useEffect(() => { m.setShowUser(true); return () => m.setShowUser(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export type OfflinePack = { id: string; metadata: Record<string, unknown>; status(): Promise<{ state: string; percentage: number; completedResourceSize: number }> };
export const OfflineManager = {
  getPacks: async (): Promise<OfflinePack[]> => [],
  createPack: async () => { throw new Error('Offline map packs need the native Android/iOS build'); },
  deletePack: async () => undefined,
  setTileCountLimit: (_n: number) => undefined,
};
export type ViewStateChangeEvent = { center: LngLat; zoom: number; bounds: Bounds };
