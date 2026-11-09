import { test, expect, type APIRequestContext } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import { randomBytes, randomUUID } from 'node:crypto';

const api = process.env.NEXUS_API_URL ?? 'http://localhost:4000';
const password = 'Nexus-Playwright-2026!';
async function register(request: APIRequestContext, label: string) {
  const tag = randomUUID().replaceAll('-', '').slice(0, 12);
  const response = await request.post(`${api}/auth/register`, { data: { username: `${label}${tag}`.slice(0, 24), displayName: `Test ${label}`, email: `${label}.${tag}@example.test`, password, publicKey: randomBytes(32).toString('base64') } });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<{ user: { id: string }; accessToken: string; refreshToken: string }>;
}
async function createDirectChat(request: APIRequestContext, first: Awaited<ReturnType<typeof register>>, second: Awaited<ReturnType<typeof register>>) {
  const response = await request.post(`${api}/chats`, { headers: { authorization: `Bearer ${first.accessToken}` }, data: { memberIds: [second.user.id], type: 'DIRECT' } });
  expect(response.ok()).toBeTruthy(); return response.json() as Promise<{ id: string }>;
}

async function putS3FromContainer(request: APIRequestContext, signedUrl: string, data: Buffer, contentType: string) {
  const target = new URL(signedUrl); const signedHost = target.host; target.hostname = 'minio';
  return request.put(target.toString(), { data, headers: { 'content-type': contentType, host: signedHost } });
}
async function routeBrowserS3ThroughDocker(page: import('@playwright/test').Page, request: APIRequestContext) {
  await page.route(/^http:\/\/localhost:9000\//, async route => {
    const target = new URL(route.request().url()); const signedHost = target.host; target.hostname = 'minio';
    const response = await request.fetch(target.toString(), { method: route.request().method(), headers: { ...route.request().headers(), host: signedHost, origin: 'http://localhost:3000' }, data: route.request().postDataBuffer() ?? undefined });
    await route.fulfill({ response });
  });
}
test('Arabic RTL client renders', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByText('NEXUS', { exact: true }).first()).toBeVisible();
});

test('registration, direct chat, Signal delivery, media, and voice recording', async ({ browser, page, request }) => {
  test.setTimeout(240_000);
  const registerInBrowser = async (target: typeof page, label: string) => {
    target.on('pageerror', error => console.log(`[${label}] page error: ${error.stack}`));

    await target.goto('/', { waitUntil: 'domcontentloaded' });
    await target.waitForFunction(() => document.documentElement.dataset.nexusReady === 'true', { timeout: 60_000 });

    await target.getByRole('button', { name: 'محادثة جديدة' }).click({ timeout: 15_000 });
    await target.getByRole('button', { name: 'حساب جديد' }).click({ timeout: 15_000 });
    const email = `${label}.${randomUUID().slice(0, 8)}@example.test`;
    await target.getByPlaceholder('name@example.com').fill(email);
    await target.getByPlaceholder('١٢ حرفاً على الأقل').fill(password);
    const registration = target.waitForResponse(r => r.url().endsWith('/auth/register') && r.request().method() === 'POST', { timeout: 30_000 });
    const published = target.waitForResponse(r => r.url().endsWith('/keys/primary') && r.request().method() === 'PUT', { timeout: 30_000 });
    await target.getByRole('button', { name: 'إنشاء حساب' }).click({ timeout: 15_000 });

    const response = await registration;
    expect(response.ok()).toBeTruthy();
    const account = await response.json();
    expect((await published).ok()).toBeTruthy();
    return account as { user: { id: string; username: string; displayName: string }; accessToken: string; refreshToken: string };
  };

  const otherContext = await browser.newContext({ baseURL: 'http://localhost:3000', viewport: { width: 1280, height: 900 } });
  const otherPage = await otherContext.newPage();
  try {
    await routeBrowserS3ThroughDocker(otherPage, request);
    const recipient = await registerInBrowser(otherPage, 'recipient');
    await registerInBrowser(page, 'sender');
    await page.getByRole('button', { name: 'محادثة جديدة', exact: true }).click();
    await page.getByPlaceholder('مثال: @layan').fill(recipient.user.username);
    const result = page.getByRole('button').filter({ hasText: recipient.user.username });
    await expect(result).toBeVisible();
    const chatCreated = page.waitForResponse(r => r.url().endsWith('/chats') && r.request().method() === 'POST');
    await result.click();
    const chatResponse = await chatCreated;
    expect(chatResponse.ok()).toBeTruthy();
    const chat = await chatResponse.json();
    const message = `NEXUS E2E ${randomUUID()}`;
    const sendRequest = page.waitForRequest(r => r.url().includes(`/chats/${chat.id}/messages`) && r.method() === 'POST', { timeout: 15_000 });
    await page.getByPlaceholder('اكتب رسالة...').fill(message);
    await page.getByTitle('إرسال').click();
    const encryptedRequest = await sendRequest;
    const envelope = JSON.parse(encryptedRequest.postDataJSON().content);
    expect(envelope.protocol).toBe('signal');
    expect(envelope.body).not.toContain(message);
    await expect(page.locator('.bubble-mine').last()).toContainText(message);

    await routeBrowserS3ThroughDocker(page, request);
    const attachmentResponse = page.waitForResponse(r => r.url().includes(`/chats/${chat.id}/messages`) && r.request().method() === 'POST');
    await page.locator('input[type="file"]').setInputFiles({ name: 'NEXUS-guide.pdf', mimeType: 'application/pdf', buffer: Buffer.from('NEXUS file upload') });
    expect((await attachmentResponse).ok()).toBeTruthy();
    await page.context().grantPermissions(['microphone'], { origin: 'http://localhost:3000' });
    const voiceResponse = page.waitForResponse(r => r.url().includes(`/chats/${chat.id}/messages`) && r.request().method() === 'POST');
    await page.getByTitle('تسجيل مقطع صوتي').click();
    await expect(page.getByTitle('إيقاف التسجيل')).toBeVisible({ timeout: 8_000 }).catch(async error => {
      console.log('voice recorder state', await page.evaluate(() => ({ mediaRecorder: typeof MediaRecorder, audioContext: typeof AudioContext, mediaDevices: typeof navigator.mediaDevices, userMedia: typeof navigator.mediaDevices?.getUserMedia })));
      console.log('voice failure toast', await page.locator('[role="status"], .toast').allInnerTexts().catch(() => []));
      throw error;
    });
    await page.waitForTimeout(800);
    await page.getByTitle('إيقاف التسجيل').click();
    expect((await voiceResponse).ok()).toBeTruthy();

    await otherPage.reload();
    await expect(otherPage.locator('.chat-row')).toHaveCount(1);
    await expect(otherPage.getByText(message, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(otherPage.getByText('NEXUS-guide.pdf', { exact: true })).toBeVisible();
    const history = await request.get(`${api}/chats/${chat.id}/messages`, { headers: { authorization: `Bearer ${recipient.accessToken}` } });
    const messages = await history.json();
    const saved = messages.find((item: { type: string }) => item.type === 'TEXT') as { content: string };
    expect(saved.content).not.toContain(message);
    expect(JSON.parse(saved.content).protocol).toBe('signal');
    expect(messages.some((item: { type: string }) => item.type === 'VOICE')).toBeTruthy();
  } finally {
    await otherContext.close();
  }
});
test('voice notes upload to object storage and attach to a message', async ({ request }) => {
  const a = await register(request, 'voice'), b = await register(request, 'listener'), chat = await createDirectChat(request, a, b);
  const audio = Buffer.from('OggS\x00\x02NEXUS E2E audio payload');
  const signed = await request.post(`${api}/media/presign`, { headers: { authorization: `Bearer ${a.accessToken}` }, data: { filename: 'voice-note.webm', contentType: 'audio/webm', size: audio.byteLength } });
  expect(signed.ok()).toBeTruthy(); const urls = await signed.json();
  const upload = await putS3FromContainer(request, urls.uploadUrl, audio, 'audio/webm'); expect(upload.ok()).toBeTruthy();
  const sent = await request.post(`${api}/chats/${chat.id}/messages`, { headers: { authorization: `Bearer ${a.accessToken}` }, data: { type: 'VOICE', mediaUrl: urls.mediaUrl, mediaMetadata: { duration: 1, waveform: [0.1, 0.7, 0.4] } } });
  expect(sent.ok()).toBeTruthy(); expect((await sent.json()).type).toBe('VOICE');
});

test('refresh rotation, public channels, subscriber permissions, and live poll totals', async ({ request, page }) => {
  const owner = await register(request, 'owner'), subscriber = await register(request, 'subscriber');
  const rotated = await request.post(`${api}/auth/refresh`, { data: { refreshToken: owner.refreshToken } });
  expect(rotated.ok()).toBeTruthy();
  const nextSession = await rotated.json();
  expect((await request.post(`${api}/auth/refresh`, { data: { refreshToken: owner.refreshToken } })).status()).toBe(401);

  const created = await request.post(`${api}/chats`, { headers: { authorization: `Bearer ${nextSession.accessToken}` }, data: { memberIds: [owner.user.id], type: 'CHANNEL', title: 'NEXUS Updates' } });
  expect(created.ok()).toBeTruthy();
  const channel = await created.json();
  const publicChannel = await request.get(`${api}/channels/slug/${channel.channel.slug}`);
  expect(publicChannel.ok()).toBeTruthy();
  expect((await publicChannel.json()).subscriberCount).toBe(1);
  expect((await request.post(`${api}/chats/${channel.id}/messages`, { headers: { authorization: `Bearer ${nextSession.accessToken}` }, data: { content: 'Channel announcement' } })).ok()).toBeTruthy();

  const joined = await request.post(`${api}/channels/${channel.id}/join`, { headers: { authorization: `Bearer ${subscriber.accessToken}` } });
  expect(joined.ok()).toBeTruthy();
  expect((await (await request.get(`${api}/channels/slug/${channel.channel.slug}`)).json()).subscriberCount).toBe(2);
  expect((await request.post(`${api}/chats/${channel.id}/messages`, { headers: { authorization: `Bearer ${subscriber.accessToken}` }, data: { content: 'Unauthorized broadcast' } })).status()).toBe(403);
  await page.goto(`/channels/?slug=${encodeURIComponent(channel.channel.slug)}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'NEXUS Updates' })).toBeVisible();

  const postResponse = await request.post(`${api}/feed`, { headers: { authorization: `Bearer ${nextSession.accessToken}` }, data: { content: 'Community poll', poll: { question: 'Choose one', options: ['North', 'South'] } } });
  expect(postResponse.ok()).toBeTruthy();
  const poll = (await postResponse.json()).poll;
  const first = await request.post(`${api}/polls/${poll.id}/vote`, { headers: { authorization: `Bearer ${nextSession.accessToken}` }, data: { optionId: poll.options[0].id } });
  expect(first.ok()).toBeTruthy(); expect((await first.json()).total).toBe(1);
  const listener: Socket = io(api, { auth: { token: subscriber.accessToken }, transports: ['websocket'] });
  try {
    await new Promise<void>((resolve, reject) => { listener.once('connect', resolve); listener.once('connect_error', reject); });
    const update = new Promise<any>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Poll update timed out')), 8_000); listener.once(`poll:${poll.id}:results`, result => { clearTimeout(timer); resolve(result); }); });
    const second = await request.post(`${api}/polls/${poll.id}/vote`, { headers: { authorization: `Bearer ${subscriber.accessToken}` }, data: { optionId: poll.options[1].id } });
    expect(second.ok()).toBeTruthy();
    const live = await update;
    expect(live.total).toBe(2);
    expect(live.options.reduce((sum: number, option: { percentage: number }) => sum + option.percentage, 0)).toBe(100);
    expect((await request.post(`${api}/polls/${poll.id}/vote`, { headers: { authorization: `Bearer ${nextSession.accessToken}` }, data: { optionId: poll.options[1].id } })).status()).toBe(409);
  } finally { listener.disconnect(); }

  const logout = await request.post(`${api}/auth/logout`, { headers: { authorization: `Bearer ${nextSession.accessToken}` }, data: { refreshToken: nextSession.refreshToken } });
  expect(logout.ok()).toBeTruthy();
  expect((await request.post(`${api}/auth/refresh`, { data: { refreshToken: nextSession.refreshToken } })).status()).toBe(401);
});
test('WebRTC offer, answer, ICE candidate, and hangup are relayed to each participant', async ({ request }) => {
  const a = await register(request, 'caller'), b = await register(request, 'callee'); await createDirectChat(request, a, b);
  const caller: Socket = io(api, { auth: { token: a.accessToken }, transports: ['websocket'] });
  const callee: Socket = io(api, { auth: { token: b.accessToken }, transports: ['websocket'] });
  try {
    await Promise.all([new Promise<void>((resolve, reject) => { caller.once('connect', resolve); caller.once('connect_error', reject); }), new Promise<void>((resolve, reject) => { callee.once('connect', resolve); callee.once('connect_error', reject); })]);
    const receiveSignal = (socket: Socket) => new Promise<any>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Call signaling timed out')), 8_000); socket.once('call:signal', payload => { clearTimeout(timer); resolve(payload); }); });
    const offerReceived = receiveSignal(callee);
    caller.emit('call:signal', { to: b.user.id, type: 'offer', payload: { sdp: { type: 'offer', sdp: 'test-sdp' }, video: false } });
    const offer = await offerReceived; expect(offer.from).toBe(a.user.id); expect(offer.type).toBe('offer');
    const answerReceived = receiveSignal(caller);
    callee.emit('call:signal', { to: a.user.id, type: 'answer', payload: { sdp: { type: 'answer', sdp: 'test-answer' } } });
    const answer = await answerReceived; expect(answer.from).toBe(b.user.id); expect(answer.type).toBe('answer');
    const candidateReceived = receiveSignal(caller);
    callee.emit('call:signal', { to: a.user.id, type: 'ice-candidate', payload: { candidate: 'test-candidate' } });
    const candidate = await candidateReceived; expect(candidate.from).toBe(b.user.id); expect(candidate.type).toBe('ice-candidate');
    const hangupReceived = receiveSignal(callee);
    caller.emit('call:signal', { to: b.user.id, type: 'hangup' });
    const hangup = await hangupReceived; expect(hangup.from).toBe(a.user.id); expect(hangup.type).toBe('hangup');
  } finally { caller.disconnect(); callee.disconnect(); }
});
