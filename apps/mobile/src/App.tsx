import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MapScreen } from './screens/MapScreen';
import { loadSettings } from './services/settings';
import { colors } from './theme';

export default function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadSettings().finally(() => setReady(true));
  }, []);
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {ready ? (
        <MapScreen />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      )}
    </SafeAreaProvider>
  );
}
