import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { OfflineManager, type OfflinePack } from '@maplibre/maplibre-react-native';
import { haversine, type BBox } from '@waylix/engine';
import { OFFLINE } from '../config';
import { colors, radius } from '../theme';
import { Sheet } from './Sheet';

interface PackRow {
  id: string;
  name: string;
  percentage: number;
  sizeMb: number;
  state: string;
}

function areaKm2(b: BBox): number {
  const w = haversine([b[0], (b[1] + b[3]) / 2], [b[2], (b[1] + b[3]) / 2]);
  const h = haversine([b[0], b[1]], [b[0], b[3]]);
  return (w * h) / 1e6;
}

async function rowOf(p: OfflinePack): Promise<PackRow> {
  const st = await p.status();
  return {
    id: p.id,
    name: typeof p.metadata?.name === 'string' ? p.metadata.name : 'Offline area',
    percentage: Math.round(st.percentage),
    sizeMb: Math.round((st.completedResourceSize / 1e6) * 10) / 10,
    state: st.state,
  };
}

/**
 * Download the visible map area for offline use (MapLibre offline packs) and
 * pre-fetch its hazards so alerts and the hazard map work with no signal.
 */
export function OfflineSheet({
  visible,
  onClose,
  viewport,
  styleUrl,
  onCacheHazards,
}: {
  visible: boolean;
  onClose: () => void;
  viewport: BBox | undefined;
  styleUrl: string;
  onCacheHazards: (bbox: BBox) => Promise<void>;
}) {
  const [packs, setPacks] = useState<PackRow[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const all = await OfflineManager.getPacks();
      setPacks(await Promise.all(all.map(rowOf)));
    } catch {
      setPacks([]);
    }
  }, []);

  useEffect(() => {
    if (visible) void reload();
  }, [visible, reload]);

  const download = async () => {
    if (!viewport) return;
    const km2 = areaKm2(viewport);
    if (km2 > OFFLINE.maxAreaKm2) {
      Alert.alert('Area too large', `Zoom in a bit — offline areas are limited to ${OFFLINE.maxAreaKm2} km² (this is ${Math.round(km2)} km²).`);
      return;
    }
    setBusy(true);
    try {
      const label = name.trim() || `Area ${new Date().toLocaleDateString()}`;
      await OfflineManager.createPack(
        { mapStyle: styleUrl, bounds: viewport, minZoom: OFFLINE.minZoom, maxZoom: OFFLINE.maxZoom, metadata: { name: label, createdAt: Date.now() } },
        (pack, status) => {
          setPacks((prev) => {
            const row: PackRow = { id: pack.id, name: label, percentage: Math.round(status.percentage), sizeMb: Math.round((status.completedResourceSize / 1e6) * 10) / 10, state: status.state };
            return prev.some((p) => p.id === pack.id) ? prev.map((p) => (p.id === pack.id ? row : p)) : [...prev, row];
          });
        },
        (_pack, err) => Alert.alert('Download failed', err.message),
      );
      await onCacheHazards(viewport);
      setName('');
    } catch (e) {
      Alert.alert('Download failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await OfflineManager.deletePack(id);
    await reload();
  };

  return (
    <Sheet visible={visible} title="Offline maps" onClose={onClose}>
      <Text style={s.help}>
        Saves the area currently on screen (zoom {OFFLINE.minZoom}–{OFFLINE.maxZoom}) plus its known hazards. Maps, hazard alerts and any route you planned keep working without signal.
      </Text>
      <TextInput value={name} onChangeText={setName} placeholder="Name this area (e.g. Soweto)" placeholderTextColor={colors.inkSoft} style={s.input} />
      <Pressable style={[s.btn, (!viewport || busy) && { opacity: 0.5 }]} disabled={!viewport || busy} onPress={download}>
        <Text style={s.btnText}>{busy ? 'Starting…' : `Download visible area${viewport ? ` (~${Math.round(areaKm2(viewport))} km²)` : ''}`}</Text>
      </Pressable>
      <Text style={s.section}>Saved areas</Text>
      {packs.length === 0 ? <Text style={s.help}>None yet.</Text> : null}
      {packs.map((p) => (
        <View key={p.id} style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{p.name}</Text>
            <Text style={s.meta}>
              {p.state === 'complete' ? 'Ready' : `${p.percentage}%`} · {p.sizeMb} MB
            </Text>
          </View>
          <Pressable onPress={() => remove(p.id)} hitSlop={10}>
            <Text style={s.del}>Delete</Text>
          </Pressable>
        </View>
      ))}
    </Sheet>
  );
}

const s = StyleSheet.create({
  help: { color: colors.inkSoft, marginBottom: 10, lineHeight: 20 },
  input: { borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.sm, padding: 12, color: colors.ink },
  btn: { backgroundColor: colors.brand, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  btnText: { color: '#fff', fontWeight: '700' },
  section: { fontWeight: '700', fontSize: 15, marginTop: 20, marginBottom: 8, color: colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  name: { fontWeight: '600', color: colors.ink },
  meta: { color: colors.inkSoft, fontSize: 13 },
  del: { color: colors.danger, fontWeight: '600' },
});
