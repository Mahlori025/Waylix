import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, Map, UserLocation, type CameraRef, type ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Speech from 'expo-speech';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  NavigationTracker,
  analyzeRoute,
  bboxOf,
  hazardAwareRoute,
  uuid,
  type BBox,
  type HazardAlert,
  type LngLat,
  type NavigationState,
  type Observation,
  type Place,
  type RankedRoute,
  type Route,
  type TravelMode,
} from '@waylix/engine';
import { AlertBanner, NavBanner, NavFooter } from '../components/NavBanner';
import { HazardCard } from '../components/HazardCard';
import { HazardLayer } from '../components/HazardLayer';
import { OfflineSheet } from '../components/OfflineSheet';
import { ReportSheet, type ReportDraft } from '../components/ReportSheet';
import { RouteLayer } from '../components/RouteLayer';
import { RoutePreview } from '../components/RoutePreview';
import { SearchPanel } from '../components/SearchPanel';
import { SettingsSheet } from '../components/SettingsSheet';
import { DEFAULTS } from '../config';
import { useBumpDetection } from '../hooks/useBumpDetection';
import { useHazards } from '../hooks/useHazards';
import { useLocation } from '../hooks/useLocation';
import { useSettings } from '../services/settings';
import { services } from '../services/waylix';
import { colors, radius, shadow } from '../theme';

type Phase = 'browse' | 'preview' | 'navigate';

export function MapScreen() {
  const insets = useSafeAreaInsets();
  const settings = useSettings();
  const svc = useMemo(() => services(settings), [settings]);
  const { sync, router, geocoder, alerts } = svc;

  const [mode, setMode] = useState<TravelMode>('drive');
  const [phase, setPhase] = useState<Phase>('browse');
  const [routes, setRoutes] = useState<RankedRoute<Route>[]>([]);
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [nav, setNav] = useState<NavigationState>();
  const [alert, setAlert] = useState<HazardAlert>();
  const [toast, setToast] = useState<string>();
  const [selectedHazard, setSelectedHazard] = useState<string>();
  const [reportAt, setReportAt] = useState<LngLat | 'here' | undefined>();
  const [sheet, setSheet] = useState<'settings' | 'offline' | undefined>();
  const [viewport, setViewport] = useState<BBox>();
  const [routing, setRouting] = useState(false);
  const destination = useRef<Place | undefined>(undefined);

  const { fix, permission } = useLocation(phase === 'navigate' || settings.autoDetectPotholes);
  const { hazards, status, refresh } = useHazards(sync);
  const camera = useRef<CameraRef>(null);
  const tracker = useRef<NavigationTracker | undefined>(undefined);
  const lastSpokenStep = useRef(-1);
  const offRouteCount = useRef(0);
  const lastReroute = useRef(0);

  const say = useCallback((text: string, urgent = false) => {
    if (!settings.voice) return;
    if (urgent) Speech.stop();
    Speech.speak(text, { language: 'en-ZA', rate: 1.0 });
  }, [settings.voice]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? undefined : t)), 3500);
  }, []);

  // ── Sync: pull hazards for the viewport, push the outbox ─────────────────
  useEffect(() => {
    if (!viewport) return;
    const tooBig = viewport[2] - viewport[0] > 4 || viewport[3] - viewport[1] > 4;
    if (tooBig) return;
    const t = setTimeout(() => void refresh(viewport), 700);
    return () => clearTimeout(t);
  }, [viewport, refresh]);

  useEffect(() => {
    const id = setInterval(() => {
      void sync.flush();
      if (viewport) void sync.pull(viewport);
    }, 45_000);
    return () => clearInterval(id);
  }, [sync, viewport]);

  // ── Reporting ────────────────────────────────────────────────────────────
  const submitObservation = useCallback(async (o: Observation, silent = false) => {
    await sync.queueObservation(o);
    await sync.flush();
    if (!silent) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      flash(sync.getStatus().pending ? 'Saved offline — will sync when you have signal' : 'Thanks! Report shared');
    }
  }, [sync, flash]);

  const onReport = useCallback((d: ReportDraft) => {
    const at = reportAt === 'here' ? fix?.position : reportAt;
    setReportAt(undefined);
    if (!at) return;
    void submitObservation({
      id: uuid(),
      type: d.type,
      position: at,
      accuracyM: reportAt === 'here' ? Math.max(3, fix?.accuracyM ?? 15) : 12,
      observedAt: Date.now(),
      reporterId: settings.reporterId,
      platform: mode === 'walk' ? 'pedestrian' : 'vehicle',
      source: 'manual',
      severity: d.severity,
      ...(d.note ? { note: d.note } : {}),
      ...(fix?.headingDeg !== undefined && reportAt === 'here' ? { headingDeg: fix.headingDeg } : {}),
    });
  }, [reportAt, fix, settings.reporterId, mode, submitObservation]);

  useBumpDetection(settings.autoDetectPotholes && mode === 'drive', fix, settings.reporterId, (o) => {
    void submitObservation(o, true);
    flash('Bump logged as a possible pothole');
  });

  const onVote = useCallback(async (hazardId: string, kind: 'confirm' | 'dismiss') => {
    setSelectedHazard(undefined);
    await sync.queueVote({ id: uuid(), hazardId, reporterId: settings.reporterId, kind, at: Date.now(), ...(fix ? { position: fix.position } : {}) });
    await sync.flush();
    void Haptics.selectionAsync();
    flash(kind === 'confirm' ? 'Confirmed — thanks' : 'Marked as gone — thanks');
  }, [sync, settings.reporterId, fix, flash]);

  // ── Routing ──────────────────────────────────────────────────────────────
  const planRoute = useCallback(async (to: LngLat, m: TravelMode) => {
    if (!fix) {
      flash(permission === 'denied' ? 'Allow location access to navigate' : 'Waiting for your location…');
      return;
    }
    setRouting(true);
    try {
      const ranked = await hazardAwareRoute(router, { from: fix.position, to, mode: m }, hazards, settings.avoidHazards ? 6 : 0);
      setRoutes(ranked);
      setSelectedRoute(0);
      setPhase('preview');
      const all = ranked.flatMap((r) => r.route.coordinates);
      if (all.length) camera.current?.fitBounds(bboxOf(all), { padding: { top: 220, bottom: 300, left: 40, right: 40 }, duration: 800 });
    } catch (e) {
      flash(`Couldn't find a route: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setRouting(false);
    }
  }, [fix, router, hazards, settings.avoidHazards, permission, flash]);

  const onPick = useCallback((p: Place) => {
    destination.current = p;
    void planRoute(p.position, mode);
  }, [planRoute, mode]);

  const onMode = useCallback((m: TravelMode) => {
    setMode(m);
    if (phase === 'preview' && destination.current) void planRoute(destination.current.position, m);
  }, [phase, planRoute]);

  const startNav = useCallback(() => {
    const r = routes[selectedRoute]?.route;
    if (!r) return;
    tracker.current = new NavigationTracker(r);
    lastSpokenStep.current = -1;
    alerts.reset();
    setPhase('navigate');
    void activateKeepAwakeAsync('waylix-nav');
    say(r.steps[0]?.instruction ?? 'Starting route');
  }, [routes, selectedRoute, alerts, say]);

  const endNav = useCallback(() => {
    tracker.current = undefined;
    setPhase('browse');
    setRoutes([]);
    setNav(undefined);
    destination.current = undefined;
    deactivateKeepAwake('waylix-nav');
    Speech.stop();
  }, []);

  // ── Per-fix navigation + hazard alerts (runs fully offline) ──────────────
  useEffect(() => {
    if (!fix) return;
    const route = routes[selectedRoute]?.route;
    let progressM: number | undefined;
    if (phase === 'navigate' && tracker.current && route) {
      const st = tracker.current.update(fix.position, fix.accuracyM);
      setNav(st);
      progressM = st.progressM;
      if (st.arrived) {
        say('You have arrived');
        endNav();
        return;
      }
      const near = mode === 'walk' ? 30 : 160;
      if (st.nextStep && st.stepIndex !== lastSpokenStep.current && st.distanceToNextStepM <= near) {
        lastSpokenStep.current = st.stepIndex;
        say(st.nextStep.instruction);
      }
      offRouteCount.current = st.offRoute ? offRouteCount.current + 1 : 0;
      if (offRouteCount.current >= 3 && Date.now() - lastReroute.current > 15_000 && destination.current) {
        lastReroute.current = Date.now();
        offRouteCount.current = 0;
        say('Recalculating');
        void hazardAwareRoute(router, { from: fix.position, to: destination.current.position, mode }, hazards, settings.avoidHazards ? 6 : 0)
          .then((ranked) => {
            if (!ranked[0]) return;
            setRoutes(ranked);
            setSelectedRoute(0);
            tracker.current = new NavigationTracker(ranked[0].route);
            lastSpokenStep.current = -1;
          })
          .catch(() => undefined);
      }
    }
    const moving = (fix.speedMps ?? 0) > (mode === 'walk' ? 0.5 : 3);
    if (phase === 'navigate' || moving) {
      const fresh = alerts.update(
        {
          position: fix.position,
          speedMps: fix.speedMps ?? 0,
          ...(fix.headingDeg !== undefined ? { headingDeg: fix.headingDeg } : {}),
          ...(phase === 'navigate' && route ? { route: route.coordinates, ...(progressM !== undefined ? { progressM } : {}) } : {}),
        },
        hazards,
      );
      const top = fresh[0];
      if (top) {
        setAlert(top);
        say(top.message, true);
        if (top.level === 'warning') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setTimeout(() => setAlert((a) => (a?.hazard.id === top.hazard.id ? undefined : a)), 6000);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix]);

  const activeRoute = routes[selectedRoute]?.route;
  const hazardsAhead = useMemo(() => {
    if (!activeRoute || !nav) return 0;
    return analyzeRoute(activeRoute.coordinates, hazards).hits.filter((h) => h.alongM > nav.progressM).length;
  }, [activeRoute, hazards, nav?.progressM]);
  const selected = selectedHazard ? hazards.find((h) => h.id === selectedHazard) : undefined;

  return (
    <View style={StyleSheet.absoluteFill}>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={settings.styleUrl}
        compass
        compassPosition={{ top: insets.top + 170, right: 12 }}
        attributionPosition={{ bottom: insets.bottom + 4, left: 8 }}
        logo={false}
        onRegionDidChange={(e: { nativeEvent: ViewStateChangeEvent }) => setViewport(e.nativeEvent.bounds as BBox)}
        onPress={() => setSelectedHazard(undefined)}
        onLongPress={(e) => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          setReportAt(e.nativeEvent.lngLat as LngLat);
        }}
      >
        <Camera
          ref={camera}
          initialViewState={{ center: DEFAULTS.initialCenter, zoom: DEFAULTS.initialZoom }}
          {...(phase === 'navigate' ? { trackUserLocation: 'course' as const, zoom: mode === 'walk' ? 17.5 : 16.5, pitch: 45 } : {})}
        />
        <RouteLayer routes={routes.map((r) => r.route.coordinates)} selected={selectedRoute} walking={mode === 'walk'} />
        <HazardLayer hazards={hazards} onSelect={setSelectedHazard} />
        {permission === 'granted' ? <UserLocation heading accuracy /> : null}
      </Map>

      {/* ── Top ── */}
      <View style={[s.top, { top: insets.top + 8 }]} pointerEvents="box-none">
        {phase === 'navigate' && nav ? (
          <NavBanner state={nav} offline={!!activeRoute?.offline} />
        ) : phase === 'browse' ? (
          <SearchPanel geocoder={geocoder} {...(fix ? { near: fix.position } : {})} mode={mode} onMode={onMode} onPick={onPick} onMenu={() => setSheet('settings')} />
        ) : null}
        {alert ? <View style={{ marginTop: 8 }}><AlertBanner alert={alert} /></View> : null}
        {routing ? <Text style={s.chip}>Finding the safest route…</Text> : null}
        {!status.online && phase !== 'navigate' ? <Text style={s.chip}>Offline · showing saved hazards</Text> : null}
      </View>

      {/* ── Right-side buttons ── */}
      <View style={[s.fabs, { bottom: insets.bottom + (phase === 'browse' ? 110 : 190) }]} pointerEvents="box-none">
        <Pressable
          style={[s.round, shadow]}
          accessibilityLabel="Center on me"
          onPress={() => fix && camera.current?.flyTo({ center: fix.position, zoom: 16, duration: 700 })}
        >
          <Text style={s.roundText}>◎</Text>
        </Pressable>
      </View>

      {/* ── Bottom ── */}
      <View style={[s.bottom, { bottom: insets.bottom + 12 }]} pointerEvents="box-none">
        {selected && phase !== 'navigate' ? (
          <HazardCard hazard={selected} {...(fix ? { me: fix.position } : {})} onVote={(k) => void onVote(selected.id, k)} onClose={() => setSelectedHazard(undefined)} />
        ) : phase === 'preview' ? (
          <RoutePreview routes={routes} selected={selectedRoute} onSelect={setSelectedRoute} onStart={startNav} onCancel={endNav} />
        ) : phase === 'navigate' && nav ? (
          <View style={{ gap: 10 }}>
            <Pressable style={[s.reportBtn, shadow]} onPress={() => setReportAt('here')}>
              <Text style={s.reportText}>⚠️  Report hazard here</Text>
            </Pressable>
            <NavFooter state={nav} hazardsAhead={hazardsAhead} onStop={endNav} />
          </View>
        ) : (
          <Pressable style={[s.reportBtn, shadow]} onPress={() => setReportAt('here')} accessibilityHint="Long-press the map to report somewhere else">
            <Text style={s.reportText}>⚠️  Report a hazard</Text>
            <Text style={s.reportSub}>or long-press anywhere on the map</Text>
          </Pressable>
        )}
        {toast ? <Text style={[s.toast, shadow]}>{toast}</Text> : null}
      </View>

      <ReportSheet
        visible={reportAt !== undefined}
        domain={mode === 'walk' ? 'walkway' : 'road'}
        locationLabel={reportAt === 'here' ? (fix ? `At your location (±${Math.round(fix.accuracyM)} m)` : 'Waiting for your location…') : 'At the point you pressed on the map'}
        onClose={() => setReportAt(undefined)}
        onSubmit={onReport}
      />
      <SettingsSheet visible={sheet === 'settings'} onClose={() => setSheet(undefined)} status={status} onOffline={() => setSheet('offline')} />
      <OfflineSheet visible={sheet === 'offline'} onClose={() => setSheet(undefined)} viewport={viewport} styleUrl={settings.styleUrl} onCacheHazards={refresh} />
    </View>
  );
}

const s = StyleSheet.create({
  top: { position: 'absolute', left: 12, right: 12 },
  chip: { alignSelf: 'center', marginTop: 8, backgroundColor: 'rgba(15,23,42,0.8)', color: '#fff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, overflow: 'hidden', fontSize: 13 },
  fabs: { position: 'absolute', right: 12, gap: 10 },
  round: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  roundText: { fontSize: 24, color: colors.brand },
  bottom: { position: 'absolute', left: 12, right: 12 },
  reportBtn: { backgroundColor: colors.danger, borderRadius: radius.lg, paddingVertical: 14, alignItems: 'center' },
  reportText: { color: '#fff', fontWeight: '800', fontSize: 17 },
  reportSub: { color: '#FEE2E2', fontSize: 12, marginTop: 2 },
  toast: { marginTop: 10, alignSelf: 'center', backgroundColor: colors.ink, color: '#fff', paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.pill, overflow: 'hidden' },
});
