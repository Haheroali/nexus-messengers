import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import argon2 from 'argon2';
import { PrismaClient, Prisma, ChatType, MessageType } from '@prisma/client';
import { z } from 'zod';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand, CreateBucketCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomBytes, randomUUID } from 'node:crypto';

process.on('uncaughtException', (err) => console.error('FATAL UNCAUGHT EXCEPTION:', err));
process.on('unhandledRejection', (reason) => console.error('FATAL UNHANDLED REJECTION:', reason));

const env = (key: string, fallback?: string) => process.env[key] ?? fallback;
const jwtSecret = env('JWT_SECRET')?.trim() || randomBytes(32).toString('hex');
const jwtRefreshSecret = env('JWT_REFRESH_SECRET')?.trim() || randomBytes(32).toString('hex');
if (!env('JWT_SECRET')?.trim()) console.warn('JWT_SECRET is missing; using a process-local random fallback. Set a stable secret to preserve sessions across restarts.');
if (!env('JWT_REFRESH_SECRET')?.trim()) console.warn('JWT_REFRESH_SECRET is missing; using a process-local random fallback. Set a stable secret to preserve sessions across restarts.');
const prisma = new PrismaClient();
const app = Fastify({ logger: true, bodyLimit: 2_000_000, trustProxy: true });
const redisUrl = env('REDIS_URL');
const redisConfigured = Boolean(redisUrl || env('REDIS_HOST') || env('REDIS_PORT') || env('REDIS_PASSWORD'));
let redisWarningLogged = false;
const warnRedisUnavailable = (source: string, error?: unknown) => {
  if (redisWarningLogged) return;
  redisWarningLogged = true;
  app.log.warn({ source, err: error }, 'Redis is unavailable; using process-local fallbacks where possible');
};
const redisOptions = { host: env('REDIS_HOST', 'localhost'), port: Number(env('REDIS_PORT', '6379')), password: env('REDIS_PASSWORD'), lazyConnect: true as const };
const redis = redisUrl
  ? new Redis(redisUrl, { ...redisOptions, maxRetriesPerRequest: 2 })
  : new Redis({ ...redisOptions, maxRetriesPerRequest: 2 });
const pub = redisUrl ? new Redis(redisUrl, redisOptions) : new Redis(redisOptions);
const sub = pub.duplicate();
for (const [name, client] of [['redis', redis], ['redis publisher', pub], ['redis subscriber', sub]] as const) {
  client.on('error', error => warnRedisUnavailable(name, error));
}
const redisCommand = async <T>(source: string, command: () => Promise<T>, fallback: T): Promise<T> => {
  if (!redisConfigured) {
    warnRedisUnavailable(source);
    return fallback;
  }
  try { return await command(); } catch (error) { warnRedisUnavailable(source, error); return fallback; }
};
const webOrigins = (env('WEB_ORIGIN', 'http://localhost:3000') ?? '').split(',').map(origin => origin.trim()).filter(Boolean);
const io = new Server({ cors: { origin: webOrigins, credentials: true }, pingInterval: 10_000, pingTimeout: 20_000 });
const s3 = new S3Client({ region: 'us-east-1', endpoint: env('S3_ENDPOINT', 'http://localhost:9000')!, forcePathStyle: true, credentials: { accessKeyId: env('S3_ACCESS_KEY', 'nexus_minio_user')!, secretAccessKey: env('S3_SECRET_KEY', 'nexus_minio_password_2026')! } });
const publicS3 = new S3Client({ region: 'us-east-1', endpoint: env('S3_PUBLIC_ENDPOINT', 'http://localhost:9000')!, forcePathStyle: true, credentials: { accessKeyId: env('S3_ACCESS_KEY', 'nexus_minio_user')!, secretAccessKey: env('S3_SECRET_KEY', 'nexus_minio_password_2026')! } });
let bucketSetup: Promise<void> | undefined;
const ensureMediaBucket = async () => { if (!bucketSetup) bucketSetup = (async () => { const Bucket = env('S3_BUCKET', 'nexus-media')!; try { await s3.send(new HeadBucketCommand({ Bucket })); } catch { await s3.send(new CreateBucketCommand({ Bucket })); } await s3.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules: [{ AllowedOrigins: webOrigins, AllowedMethods: ['GET', 'PUT', 'HEAD'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 }] } })); })(); try { await bucketSetup; } catch (error) { bucketSetup = undefined; throw error; } };

await app.register(cors, { origin: webOrigins, credentials: true });
await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] } } });
await app.register(sensible);
await app.register(rateLimit, { max: 120, timeWindow: '1 minute', ...(redisConfigured ? { redis } : {}) });
await app.register(jwt, { secret: jwtSecret });
app.setErrorHandler((error, request, reply) => { if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid request', issues: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) }); const code = typeof error === 'object' && error !== null && 'statusCode' in error ? (error as { statusCode?: unknown }).statusCode : undefined; const status = typeof code === 'number' && code < 500 ? code : 500; if (status >= 500) request.log.error(error); return reply.code(status).send({ error: status === 500 ? 'Internal server error' : error instanceof Error ? error.message : 'Request failed' }); });
app.decorate('authenticate', async (request: any) => { try { await request.jwtVerify(); } catch { throw app.httpErrors.unauthorized(); } });
const auth = { preHandler: (app as any).authenticate };
const tokenFor = (user: { id: string; username: string }) => app.jwt.sign({ sub: user.id, username: user.username }, { expiresIn: '15m' });
const issueSession = async (user: { id: string; username: string }) => { const sid = randomUUID(); const refreshToken = app.jwt.sign({ sub: user.id, kind: 'refresh', sid }, { key: jwtRefreshSecret, expiresIn: '30d' }); await prisma.refreshToken.create({ data: { id: sid, userId: user.id, tokenHash: await argon2.hash(refreshToken, { type: argon2.argon2id }), expiresAt: new Date(Date.now() + 30 * 24 * 3600_000) } }); return { accessToken: tokenFor(user), refreshToken }; };
const userId = (req: any) => req.user.sub as string;
const handle = z.string().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/);

app.get('/health', async () => ({ ok: true, service: 'nexus-api', time: new Date().toISOString() }));
app.post('/auth/register', async (req, reply) => {
  const input = z.object({ username: handle, displayName: z.string().min(1).max(80), email: z.string().email().optional(), phoneNumber: z.string().min(7).max(24).optional(), password: z.string().min(12).max(128), publicKey: z.string().min(16).max(2048) }).refine(v => v.email || v.phoneNumber).parse(req.body);
  const user = await prisma.user.create({ data: { username: input.username.toLowerCase(), displayName: input.displayName, email: input.email?.toLowerCase(), phoneNumber: input.phoneNumber, passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }), publicKey: input.publicKey } });
  return reply.code(201).send({ user: { id: user.id, username: user.username, displayName: user.displayName, publicKey: user.publicKey }, ...await issueSession(user) });
});
app.post('/auth/login', async (req, reply) => {
  const input = z.object({ login: z.string().min(3), password: z.string().min(1) }).parse(req.body);
  const user = await prisma.user.findFirst({ where: { OR: [{ email: input.login.toLowerCase() }, { username: input.login.toLowerCase() }, { phoneNumber: input.login }] } });
  if (!user?.passwordHash || !await argon2.verify(user.passwordHash, input.password)) return reply.unauthorized('Invalid credentials');
  return { user: { id: user.id, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl, publicKey: user.publicKey }, ...await issueSession(user) };
});
app.post('/auth/refresh', async (req, reply) => {
  const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
  try { const payload = app.jwt.verify<{sub:string;kind:string;sid:string}>(refreshToken, { key: jwtRefreshSecret }); if (payload.kind !== 'refresh') throw Error(); const session = await prisma.refreshToken.findUnique({ where: { id: payload.sid } }); if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt < new Date() || !await argon2.verify(session.tokenHash, refreshToken)) throw Error(); const claimed = await prisma.refreshToken.updateMany({ where: { id: session.id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date() } }); if (claimed.count !== 1) throw Error(); const user = await prisma.user.findUniqueOrThrow({ where: { id: payload.sub } }); return await issueSession(user); } catch { return reply.unauthorized('Refresh token expired'); }
});
app.post('/auth/logout', auth, async (req: any, reply) => { const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body); try { const payload = app.jwt.verify<{sub:string;kind:string;sid:string}>(refreshToken, { key: jwtRefreshSecret }); if (payload.sub !== userId(req) || payload.kind !== 'refresh') throw Error(); await prisma.refreshToken.updateMany({ where: { id: payload.sid, userId: userId(req), revokedAt: null }, data: { revokedAt: new Date() } }); return { ok: true }; } catch { return reply.unauthorized('Invalid refresh token'); } });
app.get('/me', auth, async req => prisma.user.findUnique({ where: { id: userId(req) }, select: { id: true, username: true, displayName: true, email: true, phoneNumber: true, avatarUrl: true, bio: true, publicKey: true, status: true } }));
app.patch('/me', auth, async req => { const input = z.object({ displayName: z.string().min(1).max(80).optional(), bio: z.string().max(280).optional(), avatarUrl: z.string().url().optional(), username: handle.optional() }).parse(req.body); return prisma.user.update({ where: { id: userId(req) }, data: input, select: { id: true, username: true, displayName: true, avatarUrl: true, bio: true } }); });
app.get('/users', auth, async req => { const query = z.object({ q: z.string().min(1).max(50) }).parse(req.query); return prisma.user.findMany({ where: { OR: [{ username: { contains: query.q, mode: 'insensitive' } }, { displayName: { contains: query.q, mode: 'insensitive' } }] }, take: 20, select: { id: true, username: true, displayName: true, avatarUrl: true, status: true, publicKey: true } }); });

app.get('/chats', auth, async req => prisma.chat.findMany({
  where: { members: { some: { userId: userId(req) } } },
  include: { members: { include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true, status: true, lastSeen: true } } } } },
  orderBy: { updatedAt: 'desc' },
}));
app.post('/chats', auth, async (req, reply) => {
  const input = z.object({ memberIds: z.array(z.string().uuid()).min(1).max(99), type: z.nativeEnum(ChatType).default(ChatType.DIRECT), title: z.string().max(80).optional() }).parse(req.body);
  const uid = userId(req); const ids = [...new Set([uid, ...input.memberIds])];
  if (input.type === ChatType.DIRECT && ids.length === 2) { const existing = await prisma.chat.findFirst({ where: { type: ChatType.DIRECT, AND: ids.map(id => ({ members: { some: { userId: id } } })) } }); if (existing) return existing; }
  const channelSlug = (input.title ?? 'channel').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'channel';
  const chat = await prisma.chat.create({ data: { type: input.type, title: input.title, members: { create: ids.map(id => ({ userId: id, role: id === uid ? 'OWNER' : 'MEMBER' })) }, ...(input.type === ChatType.CHANNEL ? { channel: { create: { public: true, slug: `${channelSlug}-${randomUUID().slice(0,8).toLowerCase()}` } } } : {}) }, include: { channel: true, members: { include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true, status: true } } } } } });
  if (!chat) return reply.internalServerError(); return reply.code(201).send(chat);
});
app.get('/chats/:id/messages', auth, async (req: any, reply) => { const uid = userId(req); const { id } = req.params; if (!await prisma.chatMember.findUnique({ where: { chatId_userId: { chatId: id, userId: uid } } })) return reply.forbidden(); const q = z.object({ before: z.string().datetime().optional(), take: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query); return prisma.message.findMany({ where: { chatId: id, ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}) }, include: { sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } }, reactions: true }, orderBy: { createdAt: 'desc' }, take: q.take }); });
app.post('/chats/:id/messages', auth, async (req: any, reply) => { const uid = userId(req); const { id } = req.params; const member = await prisma.chatMember.findUnique({ where: { chatId_userId: { chatId: id, userId: uid } }, include: { chat: { select: { type: true } } } }); if (!member) return reply.forbidden(); if (member.chat.type === 'CHANNEL' && !['OWNER','ADMIN'].includes(member.role)) return reply.forbidden('Only channel admins can post'); const input = z.object({ content: z.string().max(100_000).optional(), type: z.nativeEnum(MessageType).default(MessageType.TEXT), mediaUrl: z.string().url().optional(), mediaMetadata: z.record(z.unknown()).optional(), replyToId: z.string().uuid().optional() }).refine(v => v.content || v.mediaUrl).parse(req.body); const message = await prisma.message.create({ data: { ...input, mediaMetadata: input.mediaMetadata as Prisma.InputJsonObject | undefined, chatId: id, senderId: uid }, include: { sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } } } }); await prisma.chat.update({ where: { id }, data: { updatedAt: new Date() } }); io.to(`chat:${id}`).emit('message:new', message); return reply.code(201).send(message); });
app.post('/chats/:id/read', auth, async (req: any, reply) => { const uid = userId(req); const { id } = req.params; const { messageId } = z.object({ messageId: z.string().uuid() }).parse(req.body); if (!await prisma.chatMember.findUnique({ where: { chatId_userId: { chatId: id, userId: uid } } })) return reply.forbidden(); const through = await prisma.message.findFirst({ where: { id: messageId, chatId: id }, select: { createdAt: true } }); if (!through) return reply.notFound('Message is not in this chat'); await prisma.$transaction([prisma.chatMember.update({ where: { chatId_userId: { chatId: id, userId: uid } }, data: { lastReadMessageId: messageId } }), prisma.message.updateMany({ where: { chatId: id, senderId: { not: uid }, createdAt: { lte: through.createdAt } }, data: { status: 'READ' } })]); io.to(`chat:${id}`).emit('message:read', { chatId: id, messageId, userId: uid }); return { ok: true }; });
app.post('/messages/:id/reactions', auth, async (req: any, reply) => { const uid = userId(req); const { id } = req.params; const { emoji } = z.object({ emoji: z.string().min(1).max(16) }).parse(req.body); const message = await prisma.message.findUnique({ where: { id }, select: { chatId: true } }); if (!message || !await prisma.chatMember.findUnique({ where: { chatId_userId: { chatId: message.chatId, userId: uid } } })) return reply.notFound(); const reaction = await prisma.reaction.upsert({ where: { messageId_userId_emoji: { messageId: id, userId: uid, emoji } }, create: { messageId: id, userId: uid, emoji }, update: {} }); io.to(`chat:${message.chatId}`).emit('message:reaction', reaction); return reaction; });
app.delete('/messages/:id', auth, async (req: any, reply) => { const m = await prisma.message.findUnique({ where: { id: req.params.id } }); if (!m || m.senderId !== userId(req) || Date.now() - m.createdAt.getTime() > 48 * 3600_000) return reply.forbidden(); await prisma.message.delete({ where: { id: m.id } }); io.to(`chat:${m.chatId}`).emit('message:deleted', { id: m.id, chatId: m.chatId }); return { ok: true }; });

app.post('/media/presign', auth, async (req, reply) => { const input = z.object({ filename: z.string().min(1).max(160), contentType: z.string().regex(/^(image|video|audio|application|text)\//), size: z.number().int().positive().max(100 * 1024 * 1024) }).parse(req.body); await ensureMediaBucket(); const key = `${userId(req)}/${randomUUID()}-${input.filename.replace(/[^\w.-]/g,'_')}`; const bucket = env('S3_BUCKET', 'nexus-media')!; const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: input.contentType, ContentLength: input.size }); const readUrl = await getSignedUrl(publicS3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 7 * 24 * 3600 }); return reply.send({ uploadUrl: await getSignedUrl(publicS3, command, { expiresIn: 300 }), key, mediaUrl: readUrl, expiresIn: 300 }); });
app.post('/stories', auth, async (req, reply) => { const input = z.object({ mediaUrl: z.string().url(), caption: z.string().max(500).optional() }).parse(req.body); const story = await prisma.story.create({ data: { ...input, userId: userId(req), expiresAt: new Date(Date.now() + 24 * 3600_000) }, include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } } }); io.emit('story:new', story); return reply.code(201).send(story); });
app.get('/stories', auth, async () => prisma.story.findMany({ where: { expiresAt: { gt: new Date() } }, include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } }, orderBy: { createdAt: 'desc' } }));
app.post('/stories/:id/view', auth, async (req: any, reply) => { const story = await prisma.story.findFirst({ where: { id: req.params.id, expiresAt: { gt: new Date() } }, select: { id: true, userId: true } }); if (!story) return reply.notFound(); if (story.userId === userId(req)) return { viewed: false }; await prisma.storyView.upsert({ where: { storyId_userId: { storyId: story.id, userId: userId(req) } }, create: { storyId: story.id, userId: userId(req) }, update: { viewedAt: new Date() } }); return { viewed: true }; });
app.get('/channels', auth, async req => prisma.chat.findMany({ where: { type: 'CHANNEL', channel: { is: { public: true } } }, include: { channel: true, members: { where: { userId: userId(req) }, select: { id: true } }, _count: { select: { members: true } } }, take: 50, orderBy: { updatedAt: 'desc' } }));
app.get('/channels/slug/:slug', async (req: any, reply) => { const { slug } = z.object({ slug: z.string().min(1).max(120) }).parse(req.params); const channel = await prisma.channel.findFirst({ where: { slug, public: true }, include: { chat: { select: { id: true, title: true, description: true, createdAt: true, _count: { select: { members: true } } } } } }); if (!channel) return reply.notFound(); return { id: channel.chat.id, title: channel.chat.title, description: channel.chat.description, slug: channel.slug, public: channel.public, subscriberCount: channel.chat._count.members, createdAt: channel.chat.createdAt }; });
app.post('/channels/:id/join', auth, async (req: any, reply) => { const channel = await prisma.chat.findUnique({ where: { id: req.params.id }, include: { channel: true } }); if (!channel || channel.type !== 'CHANNEL' || !channel.channel?.public) return reply.notFound(); return prisma.chatMember.upsert({ where: { chatId_userId: { chatId: channel.id, userId: userId(req) } }, create: { chatId: channel.id, userId: userId(req) }, update: {} }); });
app.get('/feed', auth, async () => prisma.post.findMany({ include: { likes: { select: { userId: true } }, comments: { select: { id: true }, take: 100 }, poll: { include: { options: { include: { _count: { select: { votes: true } } } } } }, author: { select: { id: true, username: true, displayName: true, avatarUrl: true } } }, orderBy: { createdAt: 'desc' }, take: 60 }));
app.post('/feed', auth, async (req, reply) => { const input = z.object({ content: z.string().min(1).max(4000), mediaUrls: z.array(z.string().url()).max(8).default([]), poll: z.object({ question: z.string().min(1).max(240), options: z.array(z.string().min(1).max(100)).min(2).max(8) }).optional() }).parse(req.body); const post = await prisma.post.create({ data: { authorId: userId(req), content: input.content, mediaUrls: input.mediaUrls, ...(input.poll ? { poll: { create: { question: input.poll.question, options: { create: input.poll.options.map(text => ({ text })) } } } } : {}) }, include: { likes: { select: { userId: true } }, comments: { select: { id: true } }, poll: { include: { options: { include: { _count: { select: { votes: true } } } } } }, author: { select: { id: true, username: true, displayName: true, avatarUrl: true } } } }); io.emit('feed:new', post); return reply.code(201).send(post); });
app.get('/feed/:id/comments', auth, async (req: any, reply) => { const { id } = req.params; if (!await prisma.post.findUnique({ where: { id }, select: { id: true } })) return reply.notFound(); return prisma.postComment.findMany({ where: { postId: id }, include: { author: { select: { id: true, username: true, displayName: true, avatarUrl: true } } }, orderBy: { createdAt: 'asc' }, take: 100 }); });
app.post('/feed/:id/comments', auth, async (req: any, reply) => { const { id: postId } = req.params; const { content } = z.object({ content: z.string().trim().min(1).max(1200) }).parse(req.body); if (!await prisma.post.findUnique({ where: { id: postId }, select: { id: true } })) return reply.notFound(); const comment = await prisma.postComment.create({ data: { postId, userId: userId(req), content }, include: { author: { select: { id: true, username: true, displayName: true, avatarUrl: true } } } }); io.emit('feed:comment', { postId, comment }); return reply.code(201).send(comment); });
app.post('/feed/:id/like', auth, async (req: any, reply) => { const postId = req.params.id, uid = userId(req); const existing = await prisma.postLike.findUnique({ where: { postId_userId: { postId, userId: uid } } }); const result = existing ? (await prisma.postLike.delete({ where: { id: existing.id } }), { liked: false }) : (await prisma.postLike.create({ data: { postId, userId: uid } }), { liked: true }); io.emit('feed:like', { postId, userId: uid, ...result }); return result; });
app.post('/polls/:id/vote', auth, async (req: any, reply) => { const uid = userId(req), pollId = req.params.id; const { optionId } = z.object({ optionId: z.string().uuid() }).parse(req.body); try { const result = await prisma.$transaction(async tx => { const polls = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Poll" WHERE "id" = ${pollId} FOR UPDATE`; if (!polls.length) throw Error('Invalid poll'); const option = await tx.pollOption.findFirst({ where: { id: optionId, pollId }, select: { id: true } }); if (!option) throw Error('Invalid poll option'); const vote = await tx.pollVote.create({ data: { optionId, pollId, userId: uid } }); const options = await tx.pollOption.findMany({ where: { pollId }, include: { _count: { select: { votes: true } } } }); const total = options.reduce((n,o) => n + o._count.votes, 0); return { vote, total, options: options.map(o => ({ id: o.id, text: o.text, votes: o._count.votes, percentage: total ? Math.round(o._count.votes / total * 100) : 0 })) }; }); io.emit(`poll:${pollId}:results`, { pollId, total: result.total, options: result.options }); return result; } catch { return reply.conflict('Already voted or invalid option'); } });
app.put('/keys/:deviceId', auth, async (req: any) => { const input = z.object({ registrationId: z.number().int().min(1).max(16383), identityKey: z.string().min(40).max(256), signedPreKey: z.object({ keyId: z.number().int().nonnegative(), publicKey: z.string().min(40).max(256), signature: z.string().min(80).max(256) }), oneTimePreKeys: z.array(z.object({ keyId: z.number().int().nonnegative(), publicKey: z.string().min(40).max(256) })).max(100) }).parse(req.body); const signed = input.signedPreKey as Prisma.InputJsonObject; return prisma.$transaction(async tx => { const bundle = await tx.deviceKeyBundle.upsert({ where: { userId_deviceId: { userId: userId(req), deviceId: req.params.deviceId } }, create: { userId: userId(req), deviceId: req.params.deviceId, registrationId: input.registrationId, identityKey: input.identityKey, signedPreKey: signed, oneTimePreKeys: [] }, update: { registrationId: input.registrationId, identityKey: input.identityKey, signedPreKey: signed } }); const rows = await tx.$queryRaw<Array<{ oneTimePreKeys: Prisma.JsonValue }>>`SELECT "oneTimePreKeys" FROM "DeviceKeyBundle" WHERE "id" = ${bundle.id} FOR UPDATE`; const current = Array.isArray(rows[0]?.oneTimePreKeys) ? rows[0].oneTimePreKeys as unknown as { keyId: number; publicKey: string }[] : []; const keys = new Map(current.map(key => [key.keyId, key])); for (const key of input.oneTimePreKeys) if (!keys.has(key.keyId)) keys.set(key.keyId, key); await tx.deviceKeyBundle.update({ where: { id: bundle.id }, data: { oneTimePreKeys: [...keys.values()] as unknown as Prisma.InputJsonArray } }); return { id: bundle.id, deviceId: bundle.deviceId, identityKey: bundle.identityKey, registrationId: bundle.registrationId, signedPreKey: bundle.signedPreKey }; }); });
app.get('/keys/:userId/:deviceId', auth, async (req: any, reply) => { const result = await prisma.$transaction(async tx => { const bundles = await tx.$queryRaw<Array<{ id: string; registrationId: number; identityKey: string; signedPreKey: Prisma.JsonValue; oneTimePreKeys: Prisma.JsonValue }>>`SELECT "id", "registrationId", "identityKey", "signedPreKey", "oneTimePreKeys" FROM "DeviceKeyBundle" WHERE "userId" = ${req.params.userId} AND "deviceId" = ${req.params.deviceId} FOR UPDATE`; const bundle = bundles[0]; if (!bundle) return null; const keys = Array.isArray(bundle.oneTimePreKeys) ? bundle.oneTimePreKeys as unknown as { keyId: number; publicKey: string }[] : []; const oneTimePreKey = keys[0] ?? null; if (oneTimePreKey) await tx.deviceKeyBundle.update({ where: { id: bundle.id }, data: { oneTimePreKeys: keys.slice(1) as unknown as Prisma.InputJsonArray } }); return { registrationId: bundle.registrationId, identityKey: bundle.identityKey, signedPreKey: bundle.signedPreKey, oneTimePreKey }; }); if (!result) return reply.notFound(); return result; });
app.get('/keys/:userId/:deviceId/status', auth, async (req: any, reply) => { const bundle = await prisma.deviceKeyBundle.findUnique({ where: { userId_deviceId: { userId: req.params.userId, deviceId: req.params.deviceId } }, select: { oneTimePreKeys: true } }); if (!bundle) return reply.notFound(); return { oneTimePreKeyCount: Array.isArray(bundle.oneTimePreKeys) ? bundle.oneTimePreKeys.length : 0 }; });

io.use(async (socket, next) => { try { const token = socket.handshake.auth.token as string; const p = app.jwt.verify<{sub:string}>(token); socket.data.userId = p.sub; if (redisConfigured && redis.status === 'wait') await redis.connect().catch(error => warnRedisUnavailable('redis connection', error)); next(); } catch { next(new Error('unauthorized')); } });
const presenceKey = (uid: string) => `presence:${uid}:sockets`;
io.on('connection', socket => {
  const uid = socket.data.userId as string;
  const key = presenceKey(uid);
  socket.join(`user:${uid}`);
  void (async () => {
    const added = await redisCommand('presence registration', () => redis.sadd(key, socket.id), 1);
    await redisCommand('presence expiry', () => redis.expire(key, 45), 0);
    if (added === 1) { await prisma.user.update({ where: { id: uid }, data: { status: 'ONLINE', lastSeen: new Date() } }); io.emit('presence:update', { userId: uid, status: 'ONLINE' }); }
  })().catch(error => app.log.error(error, 'presence registration failed'));
  socket.on('presence:heartbeat', () => { void redisCommand('presence heartbeat', () => redis.expire(key, 45), 0); void prisma.user.updateMany({ where: { id: uid, status: 'ONLINE' }, data: { lastSeen: new Date() } }).catch(error => app.log.error(error, 'presence heartbeat failed')); });
  const canAccessChat = async (chatId: string) => Boolean(await prisma.chatMember.findUnique({ where: { chatId_userId: { chatId, userId: uid } }, select: { id: true } }));
  socket.on('chat:join', async (chatId: string) => { if (await canAccessChat(chatId)) socket.join(`chat:${chatId}`); });
  socket.on('message:delivered', async (messageId: string) => { const msg = await prisma.message.findUnique({ where: { id: messageId }, select: { chatId: true, senderId: true } }); if (msg && msg.senderId !== uid && await canAccessChat(msg.chatId)) { await prisma.message.updateMany({ where: { id: messageId, status: 'SENT' }, data: { status: 'DELIVERED' } }); io.to(`chat:${msg.chatId}`).emit('message:status', { messageId, status: 'DELIVERED' }); } });
  socket.on('typing:start', async (chatId: string) => { if (!await canAccessChat(chatId)) return; await redisCommand('typing state', () => redis.set(`typing:${chatId}:${uid}`, '1', 'EX', 4), 'OK'); const allowed = await redisCommand('typing throttle', () => redis.set(`typing:throttle:${chatId}:${uid}`, '1', 'EX', 1, 'NX'), 'OK'); if (allowed === 'OK') socket.to(`chat:${chatId}`).volatile.emit('typing:update', { chatId, userId: uid, typing: true }); });
  socket.on('typing:stop', async (chatId: string) => { if (!await canAccessChat(chatId)) return; void redisCommand('typing cleanup', () => redis.del(`typing:${chatId}:${uid}`), 0); socket.to(`chat:${chatId}`).emit('typing:update', { chatId, userId: uid, typing: false }); });
  socket.on('call:signal', async (raw: unknown) => { const data = z.object({ to: z.string().uuid(), type: z.enum(['offer','answer','ice-candidate','hangup']), payload: z.unknown().optional() }).safeParse(raw); if (!data.success) return; if (!await prisma.chatMember.findFirst({ where: { userId: uid, chat: { members: { some: { userId: data.data.to } } } }, select: { id: true } })) return; io.to(`user:${data.data.to}`).emit('call:signal', { from: uid, ...data.data }); });
  socket.on('disconnect', () => { void (async () => { await redisCommand('presence cleanup', () => redis.srem(key, socket.id), 1); const remaining = await redisCommand('presence socket count', () => redis.scard(key), 0); if (!remaining) { await redisCommand('presence key cleanup', () => redis.del(key), 0); const changed = await prisma.user.updateMany({ where: { id: uid, status: 'ONLINE' }, data: { status: 'OFFLINE', lastSeen: new Date() } }); if (changed.count) io.emit('presence:update', { userId: uid, status: 'OFFLINE' }); } })().catch(error => app.log.error(error, 'presence cleanup failed')); });
});
const presenceSweep = setInterval(() => { if (!redisConfigured || redis.status !== 'ready') return; void (async () => { const online = await prisma.user.findMany({ where: { status: 'ONLINE' }, select: { id: true } }); for (const account of online) if (!await redisCommand('presence sweep', () => redis.exists(presenceKey(account.id)), 1)) { const changed = await prisma.user.updateMany({ where: { id: account.id, status: 'ONLINE' }, data: { status: 'OFFLINE', lastSeen: new Date() } }); if (changed.count) io.emit('presence:update', { userId: account.id, status: 'OFFLINE' }); } })().catch(error => app.log.error(error, 'presence sweep failed')); }, 30_000);
presenceSweep.unref();

const port = Number.parseInt(process.env.PORT || '3000', 10);
if (redisConfigured) io.adapter(createAdapter(pub, sub));
else app.log.warn('REDIS_URL is not configured; using in-memory Socket.IO and rate-limit adapters');
io.attach(app.server);
app.log.info({ host: '0.0.0.0', port }, 'Starting NEXUS API');
await app.listen({ port, host: '0.0.0.0' });
app.log.info({ host: '0.0.0.0', port }, 'NEXUS API is listening');
const closeRedis = async (client: Redis) => { if (client.status === 'ready') await client.quit(); else client.disconnect(); };
const shutdown = async () => { clearInterval(presenceSweep); await app.close(); io.close(); await prisma.$disconnect(); await Promise.all([closeRedis(redis), closeRedis(pub), closeRedis(sub)]); };
process.on('SIGINT', () => void shutdown()); process.on('SIGTERM', () => void shutdown());
