import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDistance, haversine, type LngLat } from '@waylix/engine';
import type { DisplayHazard } from '../hooks/useHazards';
import { taxonomy } from '../services/waylix';
import { colors, radius, shadow } from '../theme';

const STATUS: Record<string, string> = { candidate: 'Unconfirmed', active: 'Likely', verified: 'Verified', expired: 'Expired', resolved: 'Resolved' };

function ago(ms: number): string {
  const m = Math.round((Date.now() - ms) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** Details for a tapped hazard, with "still there / gone" voting. */
export function HazardCard({
  hazard,
  me,
  onVote,
  onClose,
}: {
  hazard: DisplayHazard;
  me?: LngLat;
  onVote: (kind: 'confirm' | 'dismiss') => void;
  onClose: () => void;
}) {
  const def = taxonomy.get(hazard.type);
  return (
    <View style={[s.card, shadow]}>
      <View style={s.row}>
        <Text style={s.icon}>{def?.icon ?? '⚠️'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{def?.label ?? hazard.type}</Text>
          <Text style={s.meta}>
            {hazard.pending ? 'Waiting to sync' : `${STATUS[hazard.status]} · ${Math.round(hazard.confidence * 100)}% confidence`}
            {me ? ` · ${formatDistance(haversine(me, hazard.position))} away` : ''}
          </Text>
          <Text style={s.meta}>
            Severity {hazard.severity}/5 · {hazard.reporterCount} reporter{hazard.reporterCount === 1 ? '' : 's'} · last seen {ago(hazard.lastSeenAt)}
          </Text>
          {hazard.note ? <Text style={s.note}>“{hazard.note}”</Text> : null}
        </View>
        <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
          <Text style={s.x}>✕</Text>
        </Pressable>
      </View>
      {!hazard.pending && (
        <View style={s.actions}>
          <Pressable style={[s.btn, { backgroundColor: colors.success }]} onPress={() => onVote('confirm')}>
            <Text style={s.btnText}>Still there</Text>
          </Pressable>
          <Pressable style={[s.btn, { backgroundColor: colors.surfaceAlt }]} onPress={() => onVote('dismiss')}>
            <Text style={[s.btnText, { color: colors.ink }]}>It's gone</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  icon: { fontSize: 30 },
  title: { fontSize: 18, fontWeight: '700', color: colors.ink },
  meta: { color: colors.inkSoft, marginTop: 2, fontSize: 13 },
  note: { color: colors.ink, marginTop: 6, fontStyle: 'italic' },
  x: { fontSize: 18, color: colors.inkSoft },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, borderRadius: radius.pill, paddingVertical: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
});
