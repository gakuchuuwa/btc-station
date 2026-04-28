import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface BTCStationDB extends DBSchema {
  candles: {
    key: string;
    value: {
      key: string;
      candles: Candle[];
      lastUpdate: number;
    };
  };
}

const DB_NAME = 'btc-station-cache';
const STORE_NAME = 'candles';

let dbPromise: Promise<IDBPDatabase<BTCStationDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    if (typeof window === 'undefined') return null; // Prevent SSR issues
    dbPromise = openDB<BTCStationDB>(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      },
    });
  }
  return dbPromise;
}

export async function getCachedCandles(market: string, interval: string): Promise<{candles: Candle[], lastUpdate: number} | null> {
  const db = await getDB();
  if (!db) return null;
  const key = `${market}_${interval}`;
  const result = await db.get(STORE_NAME, key);
  if (!result) return null;
  return { candles: result.candles, lastUpdate: result.lastUpdate };
}

export async function setCachedCandles(market: string, interval: string, candles: Candle[]): Promise<void> {
  const db = await getDB();
  if (!db) return;
  const key = `${market}_${interval}`;
  await db.put(STORE_NAME, {
    key,
    candles,
    lastUpdate: Date.now(),
  });
}
