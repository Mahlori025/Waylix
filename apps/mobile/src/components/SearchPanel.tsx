import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { LngLat, PhotonGeocoder, Place, TravelMode } from '@waylix/engine';
import { colors, radius, shadow } from '../theme';

/** Destination search (Photon/OSM) with a drive/walk toggle. */
export function SearchPanel({
  geocoder,
  near,
  mode,
  onMode,
  onPick,
  onMenu,
}: {
  geocoder: PhotonGeocoder;
  near?: LngLat;
  mode: TravelMode;
  onMode: (m: TravelMode) => void;
  onPick: (p: Place) => void;
  onMenu: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 3) {
      setResults([]);
      setError(undefined);
      return;
    }
    const id = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await geocoder.search(query, near ? { near, limit: 6 } : { limit: 6 });
        if (id === seq.current) {
          setResults(r);
          setError(r.length ? undefined : 'No places found');
        }
      } catch {
        if (id === seq.current) setError('Search needs a connection');
      } finally {
        if (id === seq.current) setBusy(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q, geocoder, near?.[0], near?.[1]]);

  return (
    <View style={[s.wrap, shadow]}>
      <View style={s.row}>
        <Pressable onPress={onMenu} hitSlop={10} accessibilityLabel="Menu" style={s.menu}>
          <Text style={s.menuText}>☰</Text>
        </Pressable>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Where to?"
          placeholderTextColor={colors.inkSoft}
          style={s.input}
          returnKeyType="search"
          autoCorrect={false}
        />
        {busy ? <ActivityIndicator /> : q ? (
          <Pressable onPress={() => setQ('')} hitSlop={10}>
            <Text style={s.clear}>✕</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={s.modes}>
        {(['drive', 'walk'] as TravelMode[]).map((m) => (
          <Pressable key={m} onPress={() => onMode(m)} style={[s.mode, mode === m && s.modeActive]} accessibilityState={{ selected: mode === m }}>
            <Text style={[s.modeText, mode === m && { color: '#fff' }]}>{m === 'drive' ? '🚗  Drive' : '🚶  Walk'}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text style={s.error}>{error}</Text> : null}
      {results.length > 0 && (
        <FlatList
          data={results}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(p, i) => `${p.position.join(',')}-${i}`}
          style={{ maxHeight: 280 }}
          renderItem={({ item }) => (
            <Pressable
              style={s.result}
              onPress={() => {
                setQ(item.name);
                setResults([]);
                onPick(item);
              }}
            >
              <Text style={s.name}>{item.name}</Text>
              {item.label ? <Text style={s.label}>{item.label}</Text> : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  menu: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  menuText: { fontSize: 22, color: colors.ink },
  input: { flex: 1, fontSize: 17, paddingVertical: 8, color: colors.ink },
  clear: { fontSize: 16, color: colors.inkSoft, paddingHorizontal: 6 },
  modes: { flexDirection: 'row', gap: 8, marginTop: 8 },
  mode: { flex: 1, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center' },
  modeActive: { backgroundColor: colors.brand },
  modeText: { fontWeight: '600', color: colors.ink },
  error: { color: colors.inkSoft, padding: 8 },
  result: { paddingVertical: 10, paddingHorizontal: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  name: { fontSize: 16, color: colors.ink, fontWeight: '600' },
  label: { fontSize: 13, color: colors.inkSoft, marginTop: 2 },
});
