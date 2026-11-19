import * as Crypto from 'expo-crypto';
import { registerRootComponent } from 'expo';

// Give the engine a CSPRNG for UUIDs on Hermes.
const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
if (!g.crypto?.getRandomValues) {
  g.crypto = { ...(g.crypto ?? {}), getRandomValues: (a: Uint8Array) => Crypto.getRandomValues(a) };
}

import App from './src/App';

registerRootComponent(App);
