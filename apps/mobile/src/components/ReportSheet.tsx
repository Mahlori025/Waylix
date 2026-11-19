import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Domain, HazardTypeDef, Severity } from '@waylix/engine';
import { taxonomy } from '../services/waylix';
import { colors, radius } from '../theme';
import { Sheet } from './Sheet';

export interface ReportDraft {
  type: string;
  severity: Severity;
  note: string;
}

const SEVERITY_LABELS: Record<Severity, string> = { 1: 'Minor', 2: 'Low', 3: 'Moderate', 4: 'High', 5: 'Severe' };

/** One-tap hazard reporting: pick a type, optionally adjust severity, send. */
export function ReportSheet({
  visible,
  domain,
  locationLabel,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  domain: Domain;
  locationLabel: string;
  onClose: () => void;
  onSubmit: (d: ReportDraft) => void;
}) {
  const types = taxonomy.list(domain);
  const [type, setType] = useState<HazardTypeDef | undefined>();
  const [severity, setSeverity] = useState<Severity>(3);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (visible) {
      setType(undefined);
      setNote('');
    }
  }, [visible]);

  return (
    <Sheet visible={visible} title="Report a hazard" onClose={onClose}>
      <Text style={s.sub}>{locationLabel}</Text>
      <View style={s.grid}>
        {types.map((t) => {
          const active = type?.id === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => {
                setType(t);
                setSeverity(t.defaultSeverity);
              }}
              style={[s.tile, active && { borderColor: t.color, backgroundColor: `${t.color}18` }]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={s.icon}>{t.icon}</Text>
              <Text style={s.tileLabel} numberOfLines={2}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {type && (
        <>
          <Text style={s.section}>How bad is it?</Text>
          <View style={s.sevRow}>
            {([1, 2, 3, 4, 5] as Severity[]).map((n) => (
              <Pressable key={n} onPress={() => setSeverity(n)} style={[s.sev, severity === n && s.sevActive]}>
                <Text style={[s.sevText, severity === n && { color: '#fff' }]}>{n}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.sevLabel}>{SEVERITY_LABELS[severity]}</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Optional note (lane, landmark…)"
            placeholderTextColor={colors.inkSoft}
            maxLength={500}
            style={s.input}
          />
          <Pressable
            style={s.submit}
            onPress={() => onSubmit({ type: type.id, severity, note: note.trim() })}
            accessibilityRole="button"
          >
            <Text style={s.submitText}>Send report</Text>
          </Pressable>
          <Text style={s.privacy}>Reports are anonymous. They appear for others once confirmed by more road users.</Text>
        </>
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  sub: { color: colors.inkSoft, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '31.5%', borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.md, padding: 10, alignItems: 'center', minHeight: 86 },
  icon: { fontSize: 26 },
  tileLabel: { fontSize: 12, textAlign: 'center', color: colors.ink, marginTop: 4 },
  section: { fontWeight: '700', fontSize: 15, marginTop: 18, marginBottom: 8, color: colors.ink },
  sevRow: { flexDirection: 'row', gap: 8 },
  sev: { flex: 1, height: 44, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  sevActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  sevText: { fontWeight: '700', fontSize: 16, color: colors.ink },
  sevLabel: { color: colors.inkSoft, marginTop: 6 },
  input: { borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.sm, padding: 12, marginTop: 14, color: colors.ink },
  submit: { backgroundColor: colors.brand, borderRadius: radius.pill, paddingVertical: 15, alignItems: 'center', marginTop: 16 },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  privacy: { color: colors.inkSoft, fontSize: 12, textAlign: 'center', marginTop: 10 },
});
