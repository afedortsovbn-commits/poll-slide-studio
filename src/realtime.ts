import { initializeApp, type FirebaseApp } from 'firebase/app'
import { get, getDatabase, onValue, ref, remove, runTransaction, set, type Database } from 'firebase/database'
import {
  deleteDoc,
  deleteField,
  doc,
  FieldPath,
  increment,
  initializeFirestore,
  onSnapshot,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore'

type RemotePresentation = {
  title: string
  slides: unknown[]
}

export type RemoteStoredValue<T> = {
  value: T
  updatedAt: number
}

export type RemoteVoteStore = Record<string, Record<string, number>>
export type RemoteOpenPoll = boolean | {
  isOpen: boolean
  title: string
  poll: unknown
}
export type RemoteOpenPolls = Record<string, RemoteOpenPoll>
export type RemotePollSession = {
  slideId: string
  poll: unknown
  isOpen: boolean
}
type SubscribeOptions = {
  poll?: boolean
}

const scopedName = (name: string, scope = 'default') => `users/${scope}/${name}`

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
}

export const firebaseEnabled = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId,
)

let app: FirebaseApp | null = null
let db: Firestore | null = null
let realtimeDb: Database | null = null
const realtimeStatePaths = (name: string) => [
  `pollSlideStudioState/${name}`,
  `pollSlideStudioSessions/__state/${name}`,
]
const realtimeRestUrl = (path: string) =>
  firebaseConfig.databaseURL ? `${firebaseConfig.databaseURL.replace(/\/$/, '')}/${path}.json` : ''

const getApp = () => {
  if (!firebaseEnabled) return null
  if (!app) app = initializeApp(firebaseConfig)
  return app
}

const getDb = () => {
  if (!firebaseEnabled) return null
  if (!db) {
    const currentApp = getApp()
    if (!currentApp) return null
    db = initializeFirestore(currentApp, {
      experimentalForceLongPolling: true,
    })
  }
  return db
}

const getRealtimeDb = () => {
  if (!firebaseEnabled || !firebaseConfig.databaseURL) return null
  if (!realtimeDb) {
    const currentApp = getApp()
    if (!currentApp) return null
    realtimeDb = getDatabase(currentApp)
  }
  return realtimeDb
}

const stateDoc = (name: string) => {
  const firestore = getDb()
  return firestore ? doc(firestore, 'pollSlideStudio', name) : null
}

const fetchWithTimeout = async (url: string, init?: RequestInit, timeoutMs = 60000) => {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timeout)
  }
}

const parseRemoteJson = <T,>(data: unknown, fallback: T) => {
  if (!data || typeof data !== 'object') return fallback
  const record = data as { json?: unknown; value?: unknown }
  if (typeof record.json === 'string') return JSON.parse(record.json) as T
  if (record.value && typeof record.value === 'object') return record.value as T
  return fallback
}

const parseRemoteRecord = <T,>(data: unknown, fallback: T): RemoteStoredValue<T> | null => {
  if (!data || typeof data !== 'object') return null
  const record = data as { updatedAt?: unknown }
  return {
    value: parseRemoteJson<T>(data, fallback),
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0,
  }
}

const saveRemoteJson = async (name: string, value: unknown) => {
  const realtimeUrls = realtimeStatePaths(name).map(realtimeRestUrl).filter(Boolean)
  if (realtimeUrls.length) {
    let saved = false
    const payload = JSON.stringify({ value, updatedAt: Date.now() })
    for (const realtimeUrl of realtimeUrls) {
      try {
        const response = await fetchWithTimeout(realtimeUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        })
        if (response.ok) saved = true
      } catch {
        // Try the next compatible path before reporting failure.
      }
    }
    return saved
  }

  const target = stateDoc(name)
  if (!target) return false
  try {
    await setDoc(target, { json: JSON.stringify(value), updatedAt: Date.now() })
    return true
  } catch {
    return false
  }
}

const readRemoteStoredJson = async <T,>(name: string, fallback: T) => {
  const realtimeUrls = realtimeStatePaths(name).map(realtimeRestUrl).filter(Boolean)
  let newest: { value: T; updatedAt: number } | null = null
  for (const realtimeUrl of realtimeUrls) {
    try {
      const response = await fetchWithTimeout(realtimeUrl, undefined, 60000)
      if (!response.ok) continue
      const data = await response.json()
      if (!data) continue
      const parsed = parseRemoteRecord<T>(data, fallback)
      if (parsed && (!newest || parsed.updatedAt >= newest.updatedAt)) newest = parsed
    } catch {
      // Try the next compatible path.
    }
  }
  return newest
}

const readRemoteJson = async <T,>(name: string, fallback: T) => {
  return (await readRemoteStoredJson(name, fallback))?.value ?? fallback
}

const subscribeRemoteJson = <T,>(
  name: string,
  fallback: T,
  onChange: (value: T) => void,
  onError?: () => void,
  options: SubscribeOptions = { poll: true },
) => {
  if (!firebaseEnabled) return () => undefined
  let previous = ''
  const realtimeUrls = realtimeStatePaths(name).map(realtimeRestUrl).filter(Boolean)
  if (realtimeUrls.length) {
    let stopped = false
    const read = async () => {
      let hadReadablePath = false
      let newest: { value: T; updatedAt: number } | null = null
      for (const realtimeUrl of realtimeUrls) {
        try {
          const response = await fetchWithTimeout(realtimeUrl, undefined, 60000)
          if (!response.ok) continue
          hadReadablePath = true
          const data = await response.json()
          if (!data) continue
          const parsed = parseRemoteRecord<T>(data, fallback)
          if (parsed && (!newest || parsed.updatedAt >= newest.updatedAt)) newest = parsed
        } catch {
          // Try the next compatible path before falling back.
        }
      }
      if (newest) {
        const next = JSON.stringify(newest.value)
        if (next !== previous) {
          previous = next
          onChange(newest.value)
        }
        return
      }
      if (hadReadablePath) {
        const next = JSON.stringify(fallback)
        if (next !== previous) {
          previous = next
          onChange(fallback)
        }
        return
      }
      onError?.()
    }
    void read()
    if (!options.poll) {
      return () => {
        stopped = true
      }
    }
    const interval = window.setInterval(() => {
      if (!stopped) void read()
    }, 5000)
    return () => {
      stopped = true
      window.clearInterval(interval)
    }
  }

  const target = stateDoc(name)
  if (!target) return () => undefined
  return onSnapshot(
    target,
    (snapshot) => {
      try {
        const value = snapshot.exists() ? parseRemoteJson<T>(snapshot.data(), fallback) : fallback
        const next = JSON.stringify(value)
        if (next !== previous) {
          previous = next
          onChange(value)
        }
      } catch {
        if (!previous) onChange(fallback)
      }
    },
    () => {
      onError?.()
      if (!previous) onChange(fallback)
    },
  )
}

export const saveRemotePresentation = async (presentation: RemotePresentation, scope = 'default') => {
  return saveRemoteJson(scopedName('presentation', scope), presentation)
}

export const readRemotePresentation = async (scope = 'default') =>
  readRemoteJson<RemotePresentation | null>(scopedName('presentation', scope), null)

export const readRemotePresentationEntry = async (scope = 'default') =>
  readRemoteStoredJson<RemotePresentation | null>(scopedName('presentation', scope), null)

export const subscribeRemotePresentation = (
  onChange: (presentation: RemotePresentation | null) => void,
  onError?: () => void,
  scope = 'default',
) => subscribeRemoteJson<RemotePresentation | null>(scopedName('presentation', scope), null, onChange, onError, { poll: false })

export const saveRemoteOpenPolls = async (openPolls: RemoteOpenPolls, scope = 'default') => {
  return saveRemoteJson(scopedName('openPolls', scope), openPolls)
}

export const subscribeRemoteOpenPolls = (onChange: (openPolls: RemoteOpenPolls) => void, onError?: () => void, scope = 'default') =>
  subscribeRemoteJson<RemoteOpenPolls>(scopedName('openPolls', scope), {}, onChange, onError)

export const saveRemotePollSession = async (sessionId: string, session: RemotePollSession) => {
  const realtime = getRealtimeDb()
  if (!realtime) return false
  try {
    await set(ref(realtime, `pollSlideStudioSessions/${sessionId}`), session)
    return true
  } catch {
    return false
  }
}

export const readRemotePollSession = async (sessionId: string) => {
  const realtime = getRealtimeDb()
  if (!realtime) return null
  try {
    const snapshot = await get(ref(realtime, `pollSlideStudioSessions/${sessionId}`))
    return (snapshot.val() ?? null) as RemotePollSession | null
  } catch {
    return null
  }
}

export const readRemoteVotes = async (scope = 'default') => {
  const realtimeVotesUrl = realtimeRestUrl(`pollSlideStudioVotes/${scope}`)
  if (realtimeVotesUrl) {
    try {
      const response = await fetchWithTimeout(realtimeVotesUrl, undefined, 15000)
      if (!response.ok) return null
      return ((await response.json()) ?? {}) as RemoteVoteStore
    } catch {
      return null
    }
  }

  const realtime = getRealtimeDb()
  if (realtime) {
    try {
      const snapshot = await get(ref(realtime, `pollSlideStudioVotes/${scope}`))
      return (snapshot.val() ?? {}) as RemoteVoteStore
    } catch {
      return null
    }
  }

  return null
}

export const subscribeRemoteVotes = (onChange: (votes: RemoteVoteStore) => void, scope = 'default') => {
  const realtimeVotesUrl = realtimeRestUrl(`pollSlideStudioVotes/${scope}`)
  if (realtimeVotesUrl) {
    let stopped = false
    let previous = ''
    const read = async () => {
      try {
        const response = await fetchWithTimeout(realtimeVotesUrl, undefined, 15000)
        if (!response.ok) return
        const votes = ((await response.json()) ?? {}) as RemoteVoteStore
        const next = JSON.stringify(votes)
        if (next !== previous) {
          previous = next
          onChange(votes)
        }
      } catch {
        // The next polling tick will try again.
      }
    }
    void read()
    const interval = window.setInterval(() => {
      if (!stopped) void read()
    }, 1500)
    return () => {
      stopped = true
      window.clearInterval(interval)
    }
  }

  const realtime = getRealtimeDb()
  if (realtime) {
    let previous = ''
    return onValue(ref(realtime, `pollSlideStudioVotes/${scope}`), (snapshot) => {
      const votes = (snapshot.val() ?? {}) as RemoteVoteStore
      const next = JSON.stringify(votes)
      if (next !== previous) {
        previous = next
        onChange(votes)
      }
    })
  }

  if (!firebaseEnabled) return () => undefined
  let previous = ''
  const target = stateDoc('votes')
  if (!target) return () => undefined
  return onSnapshot(target, (snapshot) => {
    const counts = snapshot.data()?.counts
    const votes = counts && typeof counts === 'object' ? (counts as RemoteVoteStore) : {}
    const next = JSON.stringify(votes)
    if (next !== previous) {
      previous = next
      onChange(votes)
    }
  })
}

export const incrementRemoteVote = async (slideId: string, optionId: string, scope = 'default') => {
  const realtime = getRealtimeDb()
  if (realtime) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await runTransaction(ref(realtime, `pollSlideStudioVotes/${scope}/${slideId}/${optionId}`), (current) =>
          typeof current === 'number' ? current + 1 : 1,
        )
        return true
      } catch {
        await new Promise((resolve) => window.setTimeout(resolve, 120 + attempt * 180))
      }
    }
    return false
  }

  const firestore = getDb()
  if (!firestore) return false
  const target = doc(firestore, 'pollSlideStudio', 'votes')
  try {
    await updateDoc(target, new FieldPath('counts', slideId, optionId), increment(1))
    return true
  } catch {
    try {
      await setDoc(target, { counts: { [slideId]: { [optionId]: 1 } } }, { merge: true })
      return true
    } catch {
      return false
    }
  }
}

export const resetRemoteVotes = async (slideId?: string, scope = 'default') => {
  const realtime = getRealtimeDb()
  if (realtime) {
    await remove(ref(realtime, slideId ? `pollSlideStudioVotes/${scope}/${slideId}` : `pollSlideStudioVotes/${scope}`))
    return
  }

  const firestore = getDb()
  if (!firestore) return
  const target = doc(firestore, 'pollSlideStudio', 'votes')
  if (slideId) {
    try {
      await updateDoc(target, new FieldPath('counts', slideId), deleteField())
    } catch {
      // Nothing to reset yet.
    }
    return
  }
  await deleteDoc(target)
}
