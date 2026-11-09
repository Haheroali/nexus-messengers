'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpLeft, Check, Copy, Heart, ImagePlus, MessageCircle, Plus, Radio, Send, ShieldCheck, Sparkles, Users, X } from 'lucide-react';
import type { Socket } from 'socket.io-client';

type Area = 'discover' | 'channels' | 'communities';
type Person = { id: string; username: string; displayName: string; avatarUrl?: string | null };
type Story = { id: string; mediaUrl: string; caption?: string | null; expiresAt: string; user: Person };
type PollOption = { id: string; text: string; _count?: { votes: number }; votes?: number; percentage?: number };
type Poll = { id: string; question: string; options: PollOption[] };
type Post = { id: string; content: string; createdAt: string; author: Person; likes: { userId: string }[]; poll?: Poll | null; comments?: { id: string }[] };
type Channel = { id: string; title?: string; channel: { slug: string }; _count: { members: number }; members: { id: string }[] };

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const initials = (person: Person) => person.displayName?.trim().slice(0, 1) ?? 'ن';

export default function CommunityPanel({ area, token, userId, socket, onAuth, notify }: {
  area: Area; token: string; userId: string; socket: Socket | null; onAuth: () => void; notify: (message: string) => void;
}) {
  const [stories, setStories] = useState<Story[]>([]);
  const [feed, setFeed] = useState<Post[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(false);
  const [postText, setPostText] = useState('');
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [storyFile, setStoryFile] = useState<File | null>(null);
  const [channelTitle, setChannelTitle] = useState('');
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [commentOpen, setCommentOpen] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState<Record<string, { id: string; content: string; author: Person }[]>>({});
  const [busy, setBusy] = useState(false);
  const storyInput = useRef<HTMLInputElement>(null);
  const headers = useCallback(() => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' }), [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [storyResult, feedResult, channelResult] = await Promise.all([
        fetch(`${api}/stories`, { headers: headers() }),
        fetch(`${api}/feed`, { headers: headers() }),
        fetch(`${api}/channels`, { headers: headers() }),
      ]);
      if (!storyResult.ok || !feedResult.ok || !channelResult.ok) throw new Error('تعذر تحميل المجتمع');
      const [nextStories, nextFeed, nextChannels] = await Promise.all([storyResult.json(), feedResult.json(), channelResult.json()]);
      setStories(nextStories); setFeed(nextFeed); setChannels(nextChannels);
    } catch { notify('تعذر تحميل محتوى المجتمع'); }
    finally { setLoading(false); }
  }, [headers, notify, token]);

  useEffect(() => { void load(); }, [load, area]);
  useEffect(() => {
    if (!socket) return;
    const onStory = (story: Story) => setStories(current => [story, ...current.filter(item => item.id !== story.id)]);
    const onPost = (post: Post) => setFeed(current => [post, ...current.filter(item => item.id !== post.id)]);
    const onLike = ({ postId, userId: actor, liked }: { postId: string; userId: string; liked: boolean }) => setFeed(current => current.map(post => post.id !== postId ? post : { ...post, likes: liked ? [...post.likes.filter(item => item.userId !== actor), { userId: actor }] : post.likes.filter(item => item.userId !== actor) }));
    const onComment = ({ postId, comment }: { postId: string; comment: { id: string; content: string; author: Person } }) => { setFeed(current => current.map(post => post.id !== postId ? post : { ...post, comments: [...(post.comments ?? []), { id: comment.id }] })); setComments(current => ({ ...current, [postId]: current[postId] ? [...current[postId], comment] : current[postId] })); };
    const onAny = (event: string, payload: any) => {
      if (!event.startsWith('poll:') || !event.endsWith(':results')) return;
      const pollId = event.slice(5, -8);
      setFeed(current => current.map(post => post.poll?.id !== pollId ? post : { ...post, poll: { ...post.poll, options: payload.options.map((option: any) => ({ id: option.id, text: option.text, votes: option.votes, percentage: option.percentage })) } }));
    };
    socket.on('story:new', onStory); socket.on('feed:new', onPost); socket.on('feed:like', onLike); socket.on('feed:comment', onComment); socket.onAny(onAny);
    return () => { socket.off('story:new', onStory); socket.off('feed:new', onPost); socket.off('feed:like', onLike); socket.off('feed:comment', onComment); socket.offAny(onAny); };
  }, [socket]);

  const upload = async (file: File) => {
    const contentType = file.type || 'application/octet-stream';
    const signed = await fetch(`${api}/media/presign`, { method: 'POST', headers: headers(), body: JSON.stringify({ filename: file.name || 'media', contentType, size: file.size }) });
    if (!signed.ok) throw new Error('تعذر توقيع الملف');
    const target = await signed.json();
    const uploaded = await fetch(target.uploadUrl, { method: 'PUT', headers: { 'content-type': contentType }, body: file });
    if (!uploaded.ok) throw new Error('تعذر رفع الملف');
    return target.mediaUrl as string;
  };

  const addStory = async (file?: File) => {
    if (!token) return onAuth();
    const selectedFile = file ?? storyFile;
    if (!selectedFile) return storyInput.current?.click();
    setBusy(true);
    try { const mediaUrl = await upload(selectedFile); const response = await fetch(`${api}/stories`, { method: 'POST', headers: headers(), body: JSON.stringify({ mediaUrl, caption: selectedFile.name }) }); if (!response.ok) throw new Error(); const story = await response.json(); setStories(current => [story, ...current]); setStoryFile(null); notify('تم نشر لحظتك لمدة ٢٤ ساعة'); }
    catch { notify('تعذر نشر اللحظة'); }
    finally { setBusy(false); }
  };

  const createPost = async (event: React.FormEvent) => {
    event.preventDefault(); if (!token) return onAuth(); if (!postText.trim()) return;
    setBusy(true);
    try { const poll = pollQuestion.trim() ? { question: pollQuestion.trim(), options: pollOptions.map(value => value.trim()).filter(Boolean) } : undefined; if (poll && poll.options.length < 2) throw new Error(); const response = await fetch(`${api}/feed`, { method: 'POST', headers: headers(), body: JSON.stringify({ content: postText.trim(), ...(poll ? { poll } : {}) }) }); if (!response.ok) throw new Error(); const post = await response.json(); setFeed(current => [post, ...current]); setPostText(''); setPollQuestion(''); setPollOptions(['', '']); notify('تم نشر مشاركتك'); }
    catch { notify('اكتب سؤالاً وخيارين على الأقل لإضافة تصويت'); }
    finally { setBusy(false); }
  };

  const toggleLike = async (post: Post) => {
    if (!token) return onAuth();
    try { const response = await fetch(`${api}/feed/${post.id}/like`, { method: 'POST', headers: headers() }); if (!response.ok) throw new Error(); const result = await response.json(); setFeed(current => current.map(item => item.id !== post.id ? item : { ...item, likes: result.liked ? [...item.likes.filter(like => like.userId !== userId), { userId }] : item.likes.filter(like => like.userId !== userId) })); }
    catch { notify('تعذر تحديث الإعجاب'); }
  };

  const vote = async (poll: Poll, optionId: string) => {
    if (!token) return onAuth();
    try { const response = await fetch(`${api}/polls/${poll.id}/vote`, { method: 'POST', headers: headers(), body: JSON.stringify({ optionId }) }); if (!response.ok) throw new Error(); const result = await response.json(); setFeed(current => current.map(post => post.poll?.id !== poll.id ? post : { ...post, poll: { ...poll, options: result.options.map((option: any) => ({ id: option.id, text: option.text, votes: option.votes, percentage: option.percentage })) } })); }
    catch { notify('سبق وصوّت في هذا الاستطلاع أو أن الخيار غير متاح'); }
  };

  const openComments = async (postId: string) => {
    setCommentOpen(postId);
    if (comments[postId]) return;
    try { const response = await fetch(`${api}/feed/${postId}/comments`, { headers: headers() }); if (response.ok) { const result = await response.json(); setComments(current => ({ ...current, [postId]: result })); } }
    catch { notify('تعذر تحميل التعليقات'); }
  };

  const sendComment = async (postId: string, event: React.FormEvent) => {
    event.preventDefault(); if (!token) return onAuth(); if (!commentText.trim()) return;
    try { const response = await fetch(`${api}/feed/${postId}/comments`, { method: 'POST', headers: headers(), body: JSON.stringify({ content: commentText.trim() }) }); if (!response.ok) throw new Error(); const comment = await response.json(); setComments(current => ({ ...current, [postId]: [...(current[postId] ?? []), comment] })); setFeed(current => current.map(post => post.id === postId ? { ...post, comments: [...(post.comments ?? []), { id: comment.id }] } : post)); setCommentText(''); }
    catch { notify('تعذر إرسال التعليق'); }
  };

  const createChannel = async (event: React.FormEvent) => {
    event.preventDefault(); if (!token) return onAuth(); if (!channelTitle.trim()) return;
    try { const response = await fetch(`${api}/chats`, { method: 'POST', headers: headers(), body: JSON.stringify({ memberIds: [userId], type: 'CHANNEL', title: channelTitle.trim() }) }); if (!response.ok) throw new Error(); setChannelTitle(''); await load(); notify('تم إنشاء القناة'); }
    catch { notify('تعذر إنشاء القناة'); }
  };

  const joinChannel = async (channel: Channel) => {
    if (!token) return onAuth();
    try { const response = await fetch(`${api}/channels/${channel.id}/join`, { method: 'POST', headers: headers() }); if (!response.ok) throw new Error(); setChannels(current => current.map(item => item.id === channel.id ? { ...item, members: [{ id: 'member' }], _count: { members: item._count.members + 1 } } : item)); notify('أصبحت مشتركاً في القناة'); }
    catch { notify('تعذر الانضمام إلى القناة'); }
  };

  const viewStory = async (story: Story) => { setSelectedStory(story); if (token && story.user.id !== userId) await fetch(`${api}/stories/${story.id}/view`, { method: 'POST', headers: headers() }).catch(() => undefined); };
  const title = area === 'channels' ? 'قنوات تهمّك' : area === 'communities' ? 'مجتمعاتك المفضلة' : 'اكتشف مساحات جديدة';

  if (!token) return <section className="discovery-view"><div className="discover-hero"><div className="eyebrow">NEXUS COMMUNITY</div><h2>{title}<br/><span>مكانك بين الناس.</span></h2><p>سجّل الدخول لمشاهدة اللحظات والمنشورات والقنوات.</p><button className="primary-btn" onClick={onAuth}>تسجيل الدخول <ArrowUpLeft size={16}/></button><div className="hero-orb orb-a"/><div className="hero-orb orb-b"/></div></section>;

  return <section className="discovery-view community-panel">
    <div className="discover-hero"><div className="eyebrow">NEXUS COMMUNITY</div><h2>{title}<br/><span>مكانك بين الناس.</span></h2><p>لحظات وأفكار ومجتمعات تجمعكم باهتمامات مشتركة.</p><button className="primary-btn" onClick={() => area === 'channels' ? document.querySelector<HTMLInputElement>('.channel-create input')?.focus() : document.querySelector<HTMLTextAreaElement>('.post-compose textarea')?.focus()}>{area === 'channels' ? 'أنشئ قناتك' : 'شارك فكرة'} <ArrowUpLeft size={16}/></button><div className="hero-orb orb-a"/><div className="hero-orb orb-b"/></div>

    {area === 'discover' && <><div className="feed-heading"><div><span className="eyebrow">لحظاتك</span><h3>قصص اليوم</h3></div><button onClick={() => { if (!token) return onAuth(); storyInput.current?.click(); }} disabled={busy}><Plus size={17}/> إضافة لحظة</button></div><input ref={storyInput} type="file" accept="image/*,video/*" hidden onChange={event => { const file = event.target.files?.[0]; setStoryFile(file ?? null); event.target.value = ''; if (file) void addStory(file); }}/><div className="story-strip"><button className="story-upload" onClick={() => { if (!token) return onAuth(); storyInput.current?.click(); }}><span><ImagePlus size={21}/></span><b>{storyFile ? storyFile.name : 'لحظتك'}</b><small>تختفي بعد ٢٤ ساعة</small></button>{stories.map(story => <button className="story-card" key={story.id} onClick={() => void viewStory(story)}><img src={story.mediaUrl} alt=""/><span className="story-avatar">{initials(story.user)}</span><b>{story.user.displayName}</b></button>)}{!stories.length && !loading && <p className="community-empty">لا توجد لحظات جديدة. شارك أول لحظة.</p>}</div></>}

    {area === 'channels' && <><div className="feed-heading"><div><span className="eyebrow">بث ومشاركة</span><h3>القنوات العامة</h3></div></div><form className="channel-create" onSubmit={createChannel}><input value={channelTitle} onChange={event => setChannelTitle(event.target.value)} maxLength={80} placeholder="اسم قناتك الجديدة"/><button className="primary-btn"><Plus size={15}/> إنشاء قناة</button></form><div className="channel-list">{channels.map(channel => <article className="channel-card" key={channel.id}><div className="channel-cover"><Radio size={23}/><span>CHANNEL · PUBLIC</span></div><div><b>{channel.title ?? 'قناة عامة'}</b><p>قناة عامة لمشاركة الأفكار والتحديثات.</p><span>{channel._count.members.toLocaleString('ar')} مشتركاً · @{channel.channel.slug}</span></div><button aria-label="نسخ رابط القناة" onClick={() => { void navigator.clipboard?.writeText(`${location.origin}/channels/?slug=${encodeURIComponent(channel.channel.slug)}`); notify('تم نسخ رابط القناة'); }}><Copy size={14}/></button>{channel.members.length ? <button disabled><Check size={14}/> مشترك</button> : <button onClick={() => void joinChannel(channel)}>انضمّ للقناة</button>}</article>)}{!channels.length && !loading && <p className="community-empty">لا توجد قنوات عامة بعد. أنشئ أول قناة.</p>}</div></>}

    {(area === 'discover' || area === 'communities') && <><div className="feed-heading"><div><span className="eyebrow">من مجتمعك</span><h3>آخر المشاركات</h3></div></div><form className="post-compose" onSubmit={createPost}><textarea value={postText} onChange={event => setPostText(event.target.value)} maxLength={4000} placeholder="وش ودّك تشارك مجتمعك؟" required/><div className="post-compose-tools"><input value={pollQuestion} onChange={event => setPollQuestion(event.target.value)} maxLength={240} placeholder="سؤال تصويت (اختياري)"/><button className="primary-btn" disabled={busy || !postText.trim()}><Send size={14}/> نشر</button></div>{pollQuestion.trim() && <div className="poll-compose">{pollOptions.map((option, index) => <input key={index} value={option} onChange={event => setPollOptions(current => current.map((item, at) => at === index ? event.target.value : item))} maxLength={100} placeholder={`الخيار ${index + 1}`} required/>)}</div>}</form>
      {feed.map(post => { const liked = post.likes.some(like => like.userId === userId); const options = post.poll?.options ?? []; const total = options.reduce((count, option) => count + (option.votes ?? option._count?.votes ?? 0), 0); return <article className="post-card" key={post.id}><div className="post-author"><div className="community-avatar">{initials(post.author)}</div><div><b>{post.author.displayName}</b><span>@{post.author.username} · {new Date(post.createdAt).toLocaleDateString('ar')}</span></div><ShieldCheck size={17}/></div><p>{post.content}</p>{post.poll && <div className="poll"><div className="poll-title"><Sparkles size={16}/> {post.poll.question}<span>تصويت</span></div>{options.map(option => { const votes = option.votes ?? option._count?.votes ?? 0; const percentage = option.percentage ?? (total ? Math.round(votes / total * 100) : 0); return <button key={option.id} onClick={() => void vote(post.poll!, option.id)} className="poll-option"><span>{option.text}</span><div className="poll-progress" style={{ width: `${percentage}%` }}/><small>{percentage}٪</small></button>; })}<span className="poll-votes">{total.toLocaleString('ar')} صوت · اختيار واحد</span></div>}<div className="post-actions"><button className={liked ? 'liked' : ''} onClick={() => void toggleLike(post)}><Heart size={17} fill={liked ? 'currentColor' : 'none'}/> {post.likes.length.toLocaleString('ar')}</button><button onClick={() => void openComments(post.id)}><MessageCircle size={17}/> {(post.comments?.length ?? 0).toLocaleString('ar')} تعليقات</button><button onClick={() => { void navigator.clipboard?.writeText(`${location.origin}/?post=${post.id}`); notify('تم نسخ رابط المنشور'); }}><ArrowUpLeft size={16}/></button></div>{commentOpen === post.id && <div className="comment-box">{(comments[post.id] ?? []).map(comment => <div className="comment-row" key={comment.id}><b>{comment.author.displayName}</b><span>{comment.content}</span></div>)}<form onSubmit={event => void sendComment(post.id, event)}><input value={commentText} onChange={event => setCommentText(event.target.value)} maxLength={1200} placeholder="اكتب تعليقاً..."/><button aria-label="إرسال التعليق"><Send size={15}/></button></form></div>}</article>; })}
      {!feed.length && !loading && <p className="community-empty">لا توجد مشاركات بعد. ابدأ أول نقاش.</p>}</>}
    {loading && <p className="community-loading">جارٍ تحميل المجتمع…</p>}

    {selectedStory && <div className="story-viewer" role="dialog" aria-modal="true" onClick={() => setSelectedStory(null)}><button aria-label="إغلاق" onClick={() => setSelectedStory(null)}><X size={20}/></button><div onClick={event => event.stopPropagation()}>{selectedStory.mediaUrl.match(/\.(mp4|webm|mov)(\?|$)/i) ? <video src={selectedStory.mediaUrl} autoPlay controls playsInline/> : <img src={selectedStory.mediaUrl} alt={selectedStory.caption ?? 'لحظة'}/>}<b>{selectedStory.user.displayName}</b>{selectedStory.caption && <span>{selectedStory.caption}</span>}</div></div>}
  </section>;
}
