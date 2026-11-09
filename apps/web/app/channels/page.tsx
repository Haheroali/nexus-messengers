'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowUpLeft, Check, Copy, Radio, Users } from 'lucide-react';

type Channel = { id: string; title: string | null; description: string | null; slug: string; subscriberCount: number; members?: { id: string }[] };
type ChannelMembership = { channel: { slug: string }; members?: { id: string }[] };
const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

function PublicChannelContent() {
  const searchParams = useSearchParams();
  const slug = searchParams.get('slug') ?? '';
  const router = useRouter();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let alive = true;
    if (!slug) { setNotice('رابط القناة غير صالح.'); return () => { alive = false; }; }
    fetch(`${api}/channels/slug/${encodeURIComponent(slug)}`).then(response => {
      if (!response.ok) throw new Error('Channel not found');
      return response.json();
    }).then((result: Channel) => { if (alive) setChannel(result); }).catch(() => { if (alive) setNotice('هذه القناة غير متاحة أو أُزيلت.'); });
    const saved = localStorage.getItem('nexus-session');
    if (saved) {
      try {
        const session = JSON.parse(saved);
        void fetch(`${api}/channels`, { headers: { authorization: `Bearer ${session.token}` } }).then(response => response.ok ? response.json() : []).then((channels: ChannelMembership[]) => {
          if (alive) setSubscribed(channels.some(item => item.channel.slug === slug && item.members?.length));
        }).catch(() => undefined);
      } catch { /* Ignore invalid local session data. */ }
    }
    return () => { alive = false; };
  }, [slug]);

  const join = async () => {
    const saved = localStorage.getItem('nexus-session');
    if (!saved) { setNotice('سجّل الدخول أولاً للانضمام إلى القناة.'); return; }
    try {
      const session = JSON.parse(saved);
      const response = await fetch(`${api}/channels/${channel?.id}/join`, { method: 'POST', headers: { authorization: `Bearer ${session.token}` } });
      if (!response.ok) throw new Error();
      const updated = await fetch(`${api}/channels/slug/${encodeURIComponent(slug)}`).then(result => result.json());
      setChannel(updated); setSubscribed(true); setNotice('أصبحت مشتركاً في القناة.');
    } catch { setNotice('تعذر الانضمام. سجّل الدخول من التطبيق ثم أعد المحاولة.'); }
  };

  return <main className="public-channel-page" dir="rtl"><header><a href="/" className="public-brand"><i><Radio size={21}/></i><b>NEXUS</b></a><button onClick={() => router.push('/')}><ArrowUpLeft size={16}/> فتح التطبيق</button></header><section className="public-channel-card"><div className="public-channel-art"><Radio size={38}/></div>{channel ? <><span className="eyebrow">قناة عامة · @{channel.slug}</span><h1>{channel.title}</h1><p>{channel.description || 'قناة عامة لمشاركة الأفكار والتحديثات مع المجتمع.'}</p><div className="public-channel-count"><Users size={16}/>{channel.subscriberCount.toLocaleString('ar')} مشترك</div><div className="public-channel-actions"><button className="primary-btn" onClick={() => void join()} disabled={subscribed}>{subscribed ? <><Check size={16}/> مشترك</> : 'انضم إلى القناة'}</button><button className="channel-share" aria-label="نسخ رابط القناة" onClick={() => { void navigator.clipboard?.writeText(location.href); setNotice('تم نسخ رابط القناة.'); }}><Copy size={16}/></button></div></> : <h1>{notice || 'جارٍ تحميل القناة…'}</h1>}{notice && <small role="status">{notice}</small>}</section></main>;
}

export default function PublicChannelPage() {
  return <Suspense fallback={<main className="public-channel-page" dir="rtl"><h1>NEXUS</h1></main>}><PublicChannelContent/></Suspense>;
}
