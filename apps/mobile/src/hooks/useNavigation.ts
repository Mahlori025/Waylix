import { useCallback, useRef, useState } from 'react';
import {
  NavigationSession,
  hazardAwareRoute,
  type Hazard,
  type HazardAlert,
  type HazardAlertManager,
  type LngLat,
  type NavigationState,
  type PositionFix,
  type RankedRoute,
  type Route,
  type RoutingProvider,
  type TravelMode,
} from '@waylix/engine';
import { taxonomy } from '../services/waylix';

export type Phase = 'browse' | 'preview' | 'navigate';

interface Deps {
  router: RoutingProvider;
  alerts: HazardAlertManager;
  avoidHazards: boolean;
  say: (text: string, urgent?: boolean) => void;
  onAlert: (a: HazardAlert) => void;
}

/**
 * Route planning + turn-by-turn state for the map screen. All decisions
 * (announcements, reroutes, arrival) come from the engine's NavigationSession;
 * this hook only holds React state and performs the side effects.
 */
export function useNavigation({ router, alerts, avoidHazards, say, onAlert }: Deps) {
  const [phase, setPhase] = useState<Phase>('browse');
  const [routes, setRoutes] = useState<RankedRoute<Route>[]>([]);
  const [selected, setSelected] = useState(0);
  const [nav, setNav] = useState<NavigationState>();
  const [routing, setRouting] = useState(false);
  const session = useRef<NavigationSession | undefined>(undefined);
  const destination = useRef<{ position: LngLat; mode: TravelMode } | undefined>(undefined);
  const rerouting = useRef(false);

  const plan = useCallback(
    async (from: LngLat, to: LngLat, mode: TravelMode, hazards: readonly Hazard[]): Promise<RankedRoute<Route>[]> => {
      destination.current = { position: to, mode };
      setRouting(true);
      try {
        const ranked = await hazardAwareRoute(router, { from, to, mode }, hazards, avoidHazards ? 6 : 0);
        setRoutes(ranked);
        setSelected(0);
        setPhase('preview');
        return ranked;
      } finally {
        setRouting(false);
      }
    },
    [router, avoidHazards],
  );

  const end = useCallback(() => {
    session.current = undefined;
    destination.current = undefined;
    setPhase('browse');
    setRoutes([]);
    setNav(undefined);
  }, []);

  const apply = useCallback(
    (u: ReturnType<NavigationSession['update']>) => {
      setNav(u.state);
      u.speak.forEach((line, i) => say(line, i === 0 && u.alerts.length > 0 && line === u.alerts[0]?.message));
      if (u.alerts[0]) onAlert(u.alerts[0]);
    },
    [say, onAlert],
  );

  const start = useCallback(
    (fix: PositionFix | undefined, hazards: readonly Hazard[]) => {
      const r = routes[selected]?.route;
      if (!r) return;
      session.current = new NavigationSession(r, { taxonomy, alerts });
      setPhase('navigate');
      apply(session.current.start(fix, hazards));
    },
    [routes, selected, alerts, apply],
  );

  /** Feed a GPS fix while navigating. Returns true when the trip ended. */
  const onFix = useCallback(
    (fix: PositionFix, hazards: readonly Hazard[]): boolean => {
      const s = session.current;
      if (!s) return false;
      const u = s.update(fix, hazards);
      apply(u);
      if (u.arrived) {
        end();
        return true;
      }
      const dest = destination.current;
      if (u.reroute && dest && !rerouting.current) {
        rerouting.current = true;
        hazardAwareRoute(router, { from: fix.position, to: dest.position, mode: dest.mode }, hazards, avoidHazards ? 6 : 0)
          .then((ranked) => {
            if (!ranked[0] || session.current !== s) return;
            setRoutes(ranked);
            setSelected(0);
            s.replaceRoute(ranked[0].route);
          })
          .catch(() => undefined)
          .finally(() => (rerouting.current = false));
      }
      return false;
    },
    [apply, end, router, avoidHazards],
  );

  return {
    phase,
    routes,
    selected,
    setSelected,
    nav,
    routing,
    activeRoute: session.current?.route ?? routes[selected]?.route,
    hasDestination: () => destination.current !== undefined,
    destinationOf: () => destination.current,
    plan,
    start,
    end,
    onFix,
  };
}
