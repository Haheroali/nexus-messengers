'use client';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="ar" dir="rtl"><body style={{ background: '#15171a', color: '#eff0ec', fontFamily: 'sans-serif' }}><main style={{ minHeight: '100vh', display: 'grid', placeContent: 'center', textAlign: 'center', gap: 12 }}><h1>NEXUS</h1><p>حدث خطأ غير متوقع أثناء تحميل التطبيق.</p><button onClick={reset} style={{ justifySelf: 'center', padding: '10px 18px', borderRadius: 8, border: 0, background: '#7cddba', color: '#153729', cursor: 'pointer' }}>إعادة المحاولة</button><a href="/" style={{ color: '#9bd8bb' }}>العودة للرئيسية</a></main></body></html>;
}
