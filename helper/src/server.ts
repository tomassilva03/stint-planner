// The local connection the planner page talks to: ws://localhost:47100
import { WebSocketServer, type WebSocket } from 'ws';
import type { HelperMessage } from '../../src/live/protocol.ts';

/** Pages allowed to read the live data. Other websites open in the browser are refused. */
export const DEFAULT_ORIGINS = ['https://stint-planner-three.vercel.app', 'http://localhost:5173', 'http://localhost:4173', 'http://127.0.0.1:5173'];

export function startServer(port: number, origins: string[], onConnect: (send: (m: HelperMessage) => void) => void) {
  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port,
    verifyClient: ({ origin }: { origin?: string }) => !origin || origins.includes(origin) || origin.startsWith('file://') || origin === 'null',
  });
  const clients = new Set<WebSocket>();
  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    onConnect((m) => ws.send(JSON.stringify(m)));
  });
  return {
    wss,
    broadcast(m: HelperMessage) {
      const text = JSON.stringify(m);
      for (const c of clients) if (c.readyState === c.OPEN) c.send(text);
    },
    clientCount: () => clients.size,
  };
}
