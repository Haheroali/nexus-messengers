import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'NEXUS — تواصل بلا حدود', description: 'مساحتك الآمنة للمحادثات والمجتمعات واللحظات.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><head><meta httpEquiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: http://localhost:9000; media-src 'self' blob: http://localhost:9000; connect-src 'self' http://localhost:4000 ws://localhost:4000 http://localhost:9000; object-src 'none'; base-uri 'self'; form-action 'self'"/><meta name="referrer" content="strict-origin-when-cross-origin"/></head><body>{children}</body></html>;
}
