import type { CapacitorConfig } from '@capacitor/cli';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'https://nexus-server-suul.onrender.com';

const config: CapacitorConfig = {
  appId: 'com.nexus.messenger',
  appName: 'NEXUS',
  webDir: 'out',
  server: {
    androidScheme: 'https',
    cleartext: new URL(apiUrl).protocol === 'http:'
  }
};

export default config;
