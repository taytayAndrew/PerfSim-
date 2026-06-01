/**
 * HistoryStore — IndexedDB wrapper
 * Persists up to MAX_RECORDS simulate results, ordered by timestamp desc.
 * Used by ReportTab to render the latest report.
 */

export interface HistoryRecord {
  id?: number
  timestamp: number
  url: string
  simulateResult: unknown
  analyzeResult: unknown
}

const DB_NAME = 'perfsim'
const STORE_NAME = 'history'
const DB_VERSION = 1
const MAX_RECORDS = 10

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
        store.createIndex('timestamp', 'timestamp', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveRecord(record: Omit<HistoryRecord, 'id'>): Promise<number> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)

    // Add new record
    const addReq = store.add(record)
    addReq.onsuccess = () => {
      const newId = addReq.result as number

      // Trim old records: keep only latest MAX_RECORDS
      const idx = store.index('timestamp')
      const cursorReq = idx.openCursor(null, 'prev')
      let count = 0
      const toDelete: number[] = []

      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (cursor) {
          count++
          if (count > MAX_RECORDS) {
            toDelete.push(cursor.primaryKey as number)
          }
          cursor.continue()
        } else {
          for (const id of toDelete) {
            store.delete(id)
          }
        }
      }

      tx.oncomplete = () => resolve(newId)
      tx.onerror = () => reject(tx.error)
    }
    addReq.onerror = () => reject(addReq.error)
  })
}

export async function getLatestRecord(): Promise<HistoryRecord | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const idx = store.index('timestamp')
    const req = idx.openCursor(null, 'prev')
    req.onsuccess = () => {
      const cursor = req.result
      resolve(cursor ? (cursor.value as HistoryRecord) : null)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function getAllRecords(): Promise<HistoryRecord[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const idx = store.index('timestamp')
    const req = idx.openCursor(null, 'prev')
    const records: HistoryRecord[] = []
    req.onsuccess = () => {
      const cursor = req.result
      if (cursor) {
        records.push(cursor.value as HistoryRecord)
        cursor.continue()
      } else {
        resolve(records)
      }
    }
    req.onerror = () => reject(req.error)
  })
}
