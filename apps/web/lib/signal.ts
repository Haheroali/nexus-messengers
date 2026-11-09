type SignalKeyPair = { pubKey: ArrayBuffer; privKey: ArrayBuffer };
type SignalPreKey = { keyId: number; keyPair: SignalKeyPair };
type SignalSignedPreKey = SignalPreKey & { signature: ArrayBuffer };
type SignalMaterial = { identityKeyPair: SignalKeyPair; registrationId: number; signedPreKey: SignalSignedPreKey; preKeys: SignalPreKey[] };

type SignalLibrary = {
  KeyHelper: {
    generateIdentityKeyPair(): Promise<SignalKeyPair>;
    generateRegistrationId(): number;
    generateSignedPreKey(pair: SignalKeyPair, id: number): Promise<SignalSignedPreKey>;
    generatePreKey(id: number): Promise<SignalPreKey>;
  };
  SignalProtocolAddress: new (name: string, deviceId: number) => { toString(): string };
  SessionBuilder: new (store: IndexedSignalStore, address: { toString(): string }) => { processPreKey(bundle: unknown): Promise<void> };
  SessionCipher: new (store: IndexedSignalStore, address: { toString(): string }) => {
    encrypt(message: string): Promise<{ type: number; body: string }>;
    decryptWhisperMessage(message: string, encoding: string): Promise<ArrayBuffer>;
    decryptPreKeyWhisperMessage(message: string, encoding: string): Promise<ArrayBuffer>;
  };
};

declare global { interface Window { libsignal?: SignalLibrary } }

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
let libraryLoading: Promise<SignalLibrary> | undefined;

async function signalLibrary(): Promise<SignalLibrary> {
  if (typeof window === 'undefined') throw new Error('Signal Protocol is only available in a browser');
  if (!window.libsignal) {
    libraryLoading ??= new Promise<SignalLibrary>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/signal-library';
      script.async = true;
      script.onload = () => window.libsignal ? resolve(window.libsignal) : reject(new Error('Signal Protocol bundle did not initialize'));
      script.onerror = () => reject(new Error('Unable to load Signal Protocol bundle'));
      document.head.appendChild(script);
    }).catch(error => { libraryLoading = undefined; throw error; });
    return libraryLoading;
  }
  return window.libsignal;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('nexus-signal-state', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open Signal storage'));
  });
}

function toBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value); let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value); const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function equalBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const left = new Uint8Array(a), right = new Uint8Array(b);
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

class IndexedSignalStore {
  readonly Direction = { SENDING: 1, RECEIVING: 2 };
  private readonly scope: string;
  private db?: Promise<IDBDatabase>;
  constructor(userId: string) { this.scope = `${userId}:`; }
  private database() { this.db ??= openDatabase(); return this.db; }
  async get<T>(key: string): Promise<T | undefined> {
    const db = await this.database();
    return new Promise((resolve, reject) => { const request = db.transaction('records', 'readonly').objectStore('records').get(this.scope + key); request.onsuccess = () => resolve(request.result as T | undefined); request.onerror = () => reject(request.error); });
  }
  async put(key: string, value: unknown): Promise<void> {
    const db = await this.database();
    return new Promise((resolve, reject) => { const transaction = db.transaction('records', 'readwrite'); transaction.objectStore('records').put(value, this.scope + key); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });
  }
  async putMany(records: [string, unknown][]): Promise<void> {
    const db = await this.database();
    return new Promise((resolve, reject) => { const transaction = db.transaction('records', 'readwrite'); const objectStore = transaction.objectStore('records'); for (const [key, value] of records) objectStore.put(value, this.scope + key); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });
  }
  async remove(key: string): Promise<void> {
    const db = await this.database();
    return new Promise((resolve, reject) => { const transaction = db.transaction('records', 'readwrite'); transaction.objectStore('records').delete(this.scope + key); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });
  }
  async list<T>(prefix: string): Promise<{ key: string; value: T }[]> {
    const db = await this.database(); const values: { key: string; value: T }[] = [];
    return new Promise((resolve, reject) => { const request = db.transaction('records', 'readonly').objectStore('records').openCursor(); request.onsuccess = () => { const cursor = request.result; if (!cursor) { resolve(values); return; } const key = String(cursor.key); const localKey = key.startsWith(this.scope) ? key.slice(this.scope.length) : ''; if (localKey.startsWith(prefix)) values.push({ key: localKey, value: cursor.value as T }); cursor.continue(); }; request.onerror = () => reject(request.error); });
  }
  async getIdentityKeyPair() { const pair = await this.get<SignalKeyPair>('identity'); if (!pair) throw new Error('Local Signal identity is missing'); return pair; }
  async getLocalRegistrationId() { const id = await this.get<number>('registrationId'); if (!id) throw new Error('Local Signal registration ID is missing'); return id; }
  async isTrustedIdentity(identifier: string, identityKey: ArrayBuffer) { const name = identifier.replace(/\.\d+$/, ''); const trusted = await this.get<ArrayBuffer>(`trusted:${name}`); return !trusted || equalBytes(trusted, identityKey); }
  async saveIdentity(identifier: string, identityKey: ArrayBuffer) { const name = identifier.replace(/\.\d+$/, ''); const trusted = await this.get<ArrayBuffer>(`trusted:${name}`); if (trusted && !equalBytes(trusted, identityKey)) return false; if (!trusted) await this.put(`trusted:${name}`, identityKey); return true; }
  async loadPreKey(keyId: number) { return this.get<SignalKeyPair>(`prekey:${keyId}`); }
  async storePreKey(keyId: number, pair: SignalKeyPair) { return this.put(`prekey:${keyId}`, pair); }
  async removePreKey(keyId: number) { return this.remove(`prekey:${keyId}`); }
  async loadSignedPreKey(keyId: number) { return this.get<SignalKeyPair>(`signed:${keyId}`); }
  async storeSignedPreKey(keyId: number, pair: SignalKeyPair) { return this.put(`signed:${keyId}`, pair); }
  async loadSession(identifier: string) { return this.get<string>(`session:${identifier}`); }
  async storeSession(identifier: string, session: string) { return this.put(`session:${identifier}`, session); }
  async removeSession(identifier: string) { return this.remove(`session:${identifier}`); }
  async markPublished(ids: number[]) { const current = await this.get<number[]>('publishedPreKeys') ?? []; await this.put('publishedPreKeys', [...new Set([...current, ...ids])]); }
}

export async function generateSignalMaterial(): Promise<SignalMaterial> {
  const signal = await signalLibrary();
  const identityKeyPair = await signal.KeyHelper.generateIdentityKeyPair();
  const registrationId = signal.KeyHelper.generateRegistrationId();
  const firstId = Math.floor(Date.now() % 1_000_000);
  const signedPreKey = await signal.KeyHelper.generateSignedPreKey(identityKeyPair, firstId);
  const preKeys = await Promise.all(Array.from({ length: 5 }, (_, index) => signal.KeyHelper.generatePreKey(firstId + index + 1)));
  return { identityKeyPair, registrationId, signedPreKey, preKeys };
}

export function signalPublicKey(material: SignalMaterial): string { return toBase64(material.identityKeyPair.pubKey); }

export async function publishSignalDevice(userId: string, accessToken: string, generated?: SignalMaterial): Promise<void> {
  const signal = await signalLibrary(); const store = new IndexedSignalStore(userId); let material = generated;
  if (!material) {
    const identityKeyPair = await store.get<SignalKeyPair>('identity');
    const registrationId = await store.get<number>('registrationId');
    const signedPreKey = await store.get<SignalSignedPreKey>('currentSignedPreKey');
    if (identityKeyPair && registrationId && signedPreKey) material = { identityKeyPair, registrationId, signedPreKey, preKeys: [] };
    else material = await generateSignalMaterial();
  }
  await store.putMany([['identity', material.identityKeyPair], ['registrationId', material.registrationId], ['currentSignedPreKey', material.signedPreKey], [`signed:${material.signedPreKey.keyId}`, material.signedPreKey.keyPair], ...material.preKeys.map(preKey => [`prekey:${preKey.keyId}`, preKey.keyPair] as [string, unknown])]);

  let status: { oneTimePreKeyCount: number } | null = null;
  const statusResponse = await fetch(`${API}/keys/${userId}/primary/status`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (statusResponse.ok) status = await statusResponse.json();
  const currentKeys = await store.list<SignalKeyPair>('prekey:');
  const published = new Set(await store.get<number[]>('publishedPreKeys') ?? []);
  const pending = currentKeys.filter(item => !published.has(Number(item.key.split(':')[1])));
  if (status && status.oneTimePreKeyCount < 20 && !pending.length) {
    const nextId = await store.get<number>('nextPreKeyId') ?? material.signedPreKey.keyId + 101;
    const replenish = await Promise.all(Array.from({ length: 20 }, (_, index) => signal.KeyHelper.generatePreKey(nextId + index)));
    await store.putMany(replenish.map(preKey => [`prekey:${preKey.keyId}`, preKey.keyPair] as [string, unknown]));
    for (const preKey of replenish) pending.push({ key: `prekey:${preKey.keyId}`, value: preKey.keyPair });
    await store.put('nextPreKeyId', nextId + replenish.length);
  }

  const response = await fetch(`${API}/keys/primary`, { method: 'PUT', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({
    registrationId: material.registrationId,
    identityKey: toBase64(material.identityKeyPair.pubKey),
    signedPreKey: { keyId: material.signedPreKey.keyId, publicKey: toBase64(material.signedPreKey.keyPair.pubKey), signature: toBase64(material.signedPreKey.signature) },
    oneTimePreKeys: pending.map(item => { const key = item.value; const id = Number(item.key.split(':')[1]); return { keyId: id, publicKey: toBase64(key.pubKey) }; }),
  }) });
  if (!response.ok) throw new Error(`Unable to publish Signal prekeys (${response.status})`);
  await store.markPublished(pending.map(item => Number(item.key.split(':')[1])));
}

type Envelope = { protocol: 'signal'; version: 1; type: number; body: string };
const isEnvelope = (value: unknown): value is Envelope => typeof value === 'object' && value !== null && (value as Envelope).protocol === 'signal' && (value as Envelope).version === 1 && typeof (value as Envelope).body === 'string';

export async function encryptSignalMessage(userId: string, accessToken: string, recipientId: string, plaintext: string): Promise<string> {
  const signal = await signalLibrary(); const store = new IndexedSignalStore(userId); const address = new signal.SignalProtocolAddress(recipientId, 1); const addressKey = address.toString();
  if (!await store.loadSession(addressKey)) {
    const response = await fetch(`${API}/keys/${recipientId}/primary`, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error('هذا الحساب لم يسجل مفاتيح التشفير على هذا الجهاز بعد');
    const bundle = await response.json();
    const signed = bundle.signedPreKey as { keyId: number; publicKey: string; signature: string };
    const oneTime = bundle.oneTimePreKey as { keyId: number; publicKey: string } | null;
    const builder = new signal.SessionBuilder(store, address);
    await builder.processPreKey({ registrationId: bundle.registrationId, identityKey: fromBase64(bundle.identityKey), signedPreKey: { keyId: signed.keyId, publicKey: fromBase64(signed.publicKey), signature: fromBase64(signed.signature) }, ...(oneTime ? { preKey: { keyId: oneTime.keyId, publicKey: fromBase64(oneTime.publicKey) } } : {}) });
  }
  const cipher = new signal.SessionCipher(store, address); const encrypted = await cipher.encrypt(plaintext);
  return JSON.stringify({ protocol: 'signal', version: 1, type: encrypted.type, body: encrypted.body } satisfies Envelope);
}

export async function decryptSignalMessage(userId: string, senderId: string, content: string): Promise<string> {
  let envelope: unknown;
  try { envelope = JSON.parse(content); } catch { return content; }
  if (!isEnvelope(envelope)) return content;
  const signal = await signalLibrary(); const store = new IndexedSignalStore(userId); const address = new signal.SignalProtocolAddress(senderId, 1); const cipher = new signal.SessionCipher(store, address);
  const bytes = envelope.type === 3 ? await cipher.decryptPreKeyWhisperMessage(envelope.body, 'binary') : await cipher.decryptWhisperMessage(envelope.body, 'binary');
  return new TextDecoder().decode(bytes);
}

export async function saveLocalMessage(userId: string, messageId: string, text: string): Promise<void> { await new IndexedSignalStore(userId).put(`local-message:${messageId}`, text); }
export async function getLocalMessage(userId: string, messageId: string): Promise<string | undefined> { return new IndexedSignalStore(userId).get<string>(`local-message:${messageId}`); }
