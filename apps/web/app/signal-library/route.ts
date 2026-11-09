import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-static';
const libraryPath = resolve(process.cwd(), '../../node_modules/libsignal-protocol/dist/libsignal-protocol.js');
const longPath = resolve(process.cwd(), '../../node_modules/long/dist/long.js');
const byteBufferPath = resolve(process.cwd(), '../../node_modules/mocha-bytebuffer/dist/bytebuffer.js');
const protobufPath = resolve(process.cwd(), '../../node_modules/protobufjs/dist/protobuf.js');

export async function GET() {
  const [longSource, byteBufferSource, protobufSource, signalSource] = await Promise.all([
    readFile(longPath, 'utf8'), readFile(byteBufferPath, 'utf8'), readFile(protobufPath, 'utf8'), readFile(libraryPath, 'utf8'),
  ]);
  const browserSignalSource = signalSource
    .replace(/^import LongRq from 'long'\r?\n/, 'var LongRq = window.dcodeIO.Long;\n')
    .replace("var ProtoBuf = require('protobufjs')", 'var ProtoBuf = window.dcodeIO.ProtoBuf')
    .replace("var ByteBuffer = require('mocha-bytebuffer')", 'var ByteBuffer = window.dcodeIO.ByteBuffer');
  const source = `${longSource}\n${byteBufferSource}\n${protobufSource}\n${browserSignalSource}`;
  return new Response(source, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  });
}
