import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { SyncStatus } from '@waylix/engine';
import { DEFAULTS } from '../config';
import { updateSettings, useSettings, type Settings } from '../services/settings';
import { colors, radius } from '../theme';
import { Sheet } from './Sheet';

type UrlKey = 'apiUrl' | 'styleUrl' | 'driveRoutingUrl' | 'walkRoutingUrl' | 'geocoderUrl';
const URL_FIELDS: Array<[UrlKey, string]> = [
  ['apiUrl', 'Waylix API'],
  ['styleUrl', 'Map style (MapLibre JSON)'],
  ['driveRoutingUrl', 'Driving router (OSRM)'],
  ['walkRoutingUrl', 'Walking router (OSRM)'],
  ['geocoderUrl', 'Search (Photon)'],
];

export function SettingsSheet({ visible, onClose, status, onOffline }: { visible: boolean; onClose: () => void; status: SyncStatus; onOffline: () => void }) {
  const st = useSettings();
  const [draft, setDraft] = useState<Pick<Settings, UrlKey>>(st);
  useEffect(() => {
    if (visible) setDraft(st);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const toggle = (k: 'voice' | 'autoDetectPotholes' | 'avoidHazards', label: string, help: string) => (
    <View style={s.toggle}>
      <View style={{ flex: 1 }}>
        <Text style={s.label}>{label}</Text>
        <Text style={s.help}>{help}</Text>
      </View>
      <Switch value={st[k]} onValueChange={(v) => void updateSettings({ [k]: v })} />
    </View>
  );

  return (
    <Sheet visible={visible} title="Waylix" onClose={onClose}>
      <Pressable style={s.offline} onPress={onOffline}>
        <Text style={s.offlineText}>⬇  Offline maps</Text>
      </Pressable>
      <Text style={s.status}>
        {status.online ? '● Online' : '○ Offline'} · {status.pending} report{status.pending === 1 ? '' : 's'} waiting to sync
        {status.lastError ? `\n${status.lastError}` : ''}
      </Text>
      {toggle('voice', 'Voice guidance', 'Spoken turns and hazard warnings')}
      {toggle('avoidHazards', 'Prefer safer routes', 'Rank alternatives by time and known hazards')}
      {toggle('autoDetectPotholes', 'Auto-detect potholes (beta)', 'Uses the motion sensor while driving. Mount your phone; works best above 15 km/h.')}
      <Text style={s.section}>Servers</Text>
      {URL_FIELDS.map(([k, label]) => (
        <View key={k} style={{ marginBottom: 10 }}>
          <Text style={s.label}>{label}</Text>
          <TextInput
            value={draft[k]}
            onChangeText={(v) => setDraft((d) => ({ ...d, [k]: v }))}
            onEndEditing={() => void updateSettings({ [k]: draft[k].trim() || DEFAULTS[k] })}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={s.input}
          />
        </View>
      ))}
      <Pressable onPress={() => void updateSettings({ apiUrl: DEFAULTS.apiUrl, styleUrl: DEFAULTS.styleUrl, driveRoutingUrl: DEFAULTS.driveRoutingUrl, walkRoutingUrl: DEFAULTS.walkRoutingUrl, geocoderUrl: DEFAULTS.geocoderUrl }).then(() => setDraft({ ...DEFAULTS }))}>
        <Text style={s.reset}>Reset servers to defaults</Text>
      </Pressable>
      <Text style={s.footer}>
        Waylix v0.1 · an AIDotLix product{'\n'}Map data © OpenStreetMap contributors · Tiles: OpenFreeMap · Routing: OSRM / FOSSGIS{'\n'}Anonymous ID: {st.reporterId.slice(0, 13)}…
      </Text>
    </Sheet>
  );
}

const s = StyleSheet.create({
  offline: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: 14 },
  offlineText: { fontWeight: '700', color: colors.ink, fontSize: 16 },
  status: { color: colors.inkSoft, marginVertical: 12 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  label: { fontWeight: '600', color: colors.ink, marginBottom: 4 },
  help: { color: colors.inkSoft, fontSize: 13 },
  section: { fontWeight: '700', fontSize: 15, marginTop: 20, marginBottom: 8, color: colors.ink },
  input: { borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.sm, padding: 10, color: colors.ink, fontSize: 13 },
  reset: { color: colors.brand, fontWeight: '600', marginTop: 4 },
  footer: { color: colors.inkSoft, fontSize: 12, marginTop: 20, lineHeight: 18 },
});
