import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatDistance, formatDuration, type RankedRoute, type Route } from '@waylix/engine';
import { taxonomy } from '../services/waylix';
import { colors, radius, shadow } from '../theme';

/** Route options ranked by time + hazard risk, with what each passes. */
export function RoutePreview({
  routes,
  selected,
  onSelect,
  onStart,
  onCancel,
}: {
  routes: RankedRoute<Route>[];
  selected: number;
  onSelect: (i: number) => void;
  onStart: () => void;
  onCancel: () => void;
}) {
  const r = routes[selected];
  if (!r) return null;
  const fastest = Math.min(...routes.map((x) => x.route.durationS));
  return (
    <View style={[s.card, shadow]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {routes.map((x, i) => (
          <Pressable key={i} onPress={() => onSelect(i)} style={[s.opt, i === selected && s.optActive]}>
            <Text style={[s.optTime, i === selected && { color: '#fff' }]}>{formatDuration(x.route.durationS)}</Text>
            <Text style={[s.optSub, i === selected && { color: '#E0E7FF' }]}>
              {i === 0 ? 'Safest balance' : x.route.durationS === fastest ? 'Fastest' : `Option ${i + 1}`} · {x.risk.hits.length} ⚠️
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <Text style={s.summary}>
        {formatDistance(r.route.distanceM)} · {r.route.mode === 'walk' ? 'walking' : 'driving'}
        {r.route.offline ? ' · offline' : ''}
        {r.route.provider === 'direct' ? ' · straight-line estimate (no routing data offline)' : ''}
      </Text>
      {r.risk.hits.length ? (
        <Text style={s.hazards} numberOfLines={2}>
          Passes:{' '}
          {Object.entries(r.risk.countsByType)
            .map(([t, n]) => `${n}× ${taxonomy.get(t)?.label.toLowerCase() ?? t}`)
            .join(', ')}
        </Text>
      ) : (
        <Text style={s.hazards}>No known hazards on this route</Text>
      )}
      <View style={s.actions}>
        <Pressable style={s.cancel} onPress={onCancel}>
          <Text style={s.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable style={s.start} onPress={onStart}>
          <Text style={s.startText}>Start</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14 },
  opt: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  optActive: { backgroundColor: colors.brand },
  optTime: { fontWeight: '800', fontSize: 17, color: colors.ink },
  optSub: { fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  summary: { marginTop: 12, color: colors.ink, fontWeight: '600' },
  hazards: { marginTop: 4, color: colors.inkSoft },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  cancel: { flex: 1, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.surfaceAlt },
  cancelText: { fontWeight: '700', color: colors.ink },
  start: { flex: 2, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.brand },
  startText: { fontWeight: '800', color: '#fff', fontSize: 16 },
});
