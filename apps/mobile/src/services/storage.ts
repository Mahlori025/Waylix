import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KeyValueStore } from '@waylix/engine';

/** AsyncStorage adapter for the engine's KeyValueStore interface. */
export const asyncStore: KeyValueStore = {
  get: (k) => AsyncStorage.getItem(k),
  set: (k, v) => AsyncStorage.setItem(k, v),
  remove: (k) => AsyncStorage.removeItem(k),
};
