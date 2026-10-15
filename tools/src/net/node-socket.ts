/**
 * A `SocketLike` over Node's `ws`, for the AI harness: the room's client
 * (`WsTransport`) takes a socket factory, and the browser hands it
 * `new WebSocket(url)`. Node has no Origin of its own, and the room refuses
 * an upgrade without one (#566), so this sends the server's own origin
 * (decision D9): the Origin check guards a browser against a cross-site page,
 * and the seat ticket, in the first message, is the authentication.
 */
import WebSocket, { type RawData } from 'ws';
import type { SocketLike } from '@lions/net';

/** `ws` hands text frames over as a Buffer (or fragments, or an ArrayBuffer). */
function text(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

export function nodeSocket(wsUrl: string, origin: string): SocketLike {
  const ws = new WebSocket(wsUrl, { origin });
  const s: SocketLike = {
    onopen: null,
    onmessage: null,
    onclose: null,
    send: (data) => { ws.send(data); },
    close: () => { ws.close(); },
  };
  ws.on('open', () => s.onopen?.({}));
  ws.on('message', (data: RawData) => s.onmessage?.({ data: text(data) }));
  ws.on('close', (code: number) => s.onclose?.({ code }));
  // A failed connect is an `error` and then a `close`: the close is what the
  // transport reconnects on. Without a listener `ws` would throw it instead.
  ws.on('error', () => {});
  return s;
}
