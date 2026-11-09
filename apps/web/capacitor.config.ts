import type { CapacitorConfig } from '@capacitor/cli';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

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
