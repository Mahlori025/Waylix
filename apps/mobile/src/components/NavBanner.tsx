import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDistance, formatDuration, type HazardAlert, type NavigationState } from '@waylix/engine';
import { colors, radius, shadow } from '../theme';

const ARROWS: Record<string, string> = {
  left: '⬅', right: '➡', 'slight left': '↖', 'slight right': '↗', 'sharp left': '↙', 'sharp right': '↘', straight: '⬆', uturn: '↩',
};

function arrow(maneuver?: string): string {
  if (!maneuver) return '⬆';
  if (maneuver.startsWith('arrive')) return '🏁';
  if (maneuver.startsWith('roundabout') || maneuver.startsWith('rotary')) return '⟳';
  const mod = maneuver.split(':')[1];
  return (mod && ARROWS[mod]) || '⬆';
}

/** Turn-by-turn instruction (top) during navigation. */
export function NavBanner({ state, offline }: { state: NavigationState; offline: boolean }) {
  const step = state.nextStep;
  return (
    <View style={[s.top, shadow]}>
      <Text style={s.arrow}>{arrow(step?.maneuver)}</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.dist}>{formatDistance(state.distanceToNextStepM)}</Text>
        <Text style={s.instr} numberOfLines={2}>
          {state.offRoute ? 'Off route — recalculating…' : step?.instruction ?? 'Continue'}
        </Text>
        {offline ? <Text style={s.offline}>Offline route · hazard alerts still active</Text> : null}
      </View>
    </View>
  );
}

/** ETA strip (bottom) during navigation. */
export function NavFooter({ state, hazardsAhead, onStop }: { state: NavigationState; hazardsAhead: number; onStop: () => void }) {
  const eta = new Date(Date.now() + state.remainingS * 1000);
  return (
    <View style={[s.bottom, shadow]}>
      <View style={{ flex: 1 }}>
        <Text style={s.eta}>
          {formatDuration(state.remainingS)} · {formatDistance(state.remainingM)}
        </Text>
        <Text style={s.sub}>
          Arrive {eta.getHours().toString().padStart(2, '0')}:{eta.getMinutes().toString().padStart(2, '0')}
          {hazardsAhead ? ` · ${hazardsAhead} hazard${hazardsAhead === 1 ? '' : 's'} on route` : ' · no known hazards'}
        </Text>
      </View>
      <Pressable style={s.stop} onPress={onStop} accessibilityRole="button">
        <Text style={s.stopText}>End</Text>
      </Pressable>
    </View>
  );
}

/** Transient hazard warning. */
export function AlertBanner({ alert }: { alert: HazardAlert }) {
  const warn = alert.level === 'warning';
  return (
    <View style={[s.alert, shadow, { backgroundColor: warn ? colors.danger : colors.warning }]} accessibilityLiveRegion="assertive">
      <Text style={s.alertText}>⚠️  {alert.message}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.brandDark, borderRadius: radius.lg, padding: 16 },
  arrow: { fontSize: 40, color: '#fff' },
  dist: { color: '#fff', fontSize: 26, fontWeight: '800' },
  instr: { color: '#E0E7FF', fontSize: 17, marginTop: 2 },
  offline: { color: '#FDE68A', fontSize: 12, marginTop: 4 },
  bottom: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16 },
  eta: { fontSize: 20, fontWeight: '800', color: colors.ink },
  sub: { color: colors.inkSoft, marginTop: 2 },
  stop: { backgroundColor: colors.danger, borderRadius: radius.pill, paddingHorizontal: 22, paddingVertical: 12 },
  stopText: { color: '#fff', fontWeight: '800' },
  alert: { borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 16 },
  alertText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
