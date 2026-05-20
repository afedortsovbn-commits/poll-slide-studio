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

const saveRemoteJson = async (name: string, value: unknown) => {
  const target = stateDoc(name)
  if (!target) return
  await setDoc(target, { json: JSON.stringify(value), updatedAt: Date.now() })
}

const subscribeRemoteJson = <T,>(name: string, fallback: T, onChange: (value: T) => void) => {
  if (!firebaseEnabled) return () => undefined
  let previous = ''
  const target = stateDoc(name)
  if (!target) return () => undefined
  return onSnapshot(target, (snapshot) => {
    try {
      const data = snapshot.data()
      const json = data?.json
      const storedValue =
        typeof json === 'string'
          ? (JSON.parse(json) as T)
          : data?.value && typeof data.value === 'object'
            ? (data.value as T)
            : fallback
      const value = snapshot.exists() ? storedValue : fallback
      const next = JSON.stringify(value)
      if (next !== previous) {
        previous = next
        onChange(value)
      }
    } catch {
      if (!previous) onChange(fallback)
    }
  })
}

export const saveRemotePresentation = async (presentation: RemotePresentation) => {
  await saveRemoteJson('presentation', presentation)
}

export const subscribeRemotePresentation = (onChange: (presentation: RemotePresentation | null) => void) =>
  subscribeRemoteJson<RemotePresentation | null>('presentation', null, onChange)

export const saveRemoteOpenPolls = async (openPolls: RemoteOpenPolls) => {
  await saveRemoteJson('openPolls', openPolls)
}

export const subscribeRemoteOpenPolls = (onChange: (openPolls: RemoteOpenPolls) => void) =>
  subscribeRemoteJson<RemoteOpenPolls>('openPolls', {}, onChange)

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

export const subscribeRemoteVotes = (onChange: (votes: RemoteVoteStore) => void) => {
  const realtime = getRealtimeDb()
  if (realtime) {
    let previous = ''
    return onValue(ref(realtime, 'pollSlideStudioVotes'), (snapshot) => {
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

export const incrementRemoteVote = async (slideId: string, optionId: string) => {
  const realtime = getRealtimeDb()
  if (realtime) {
    try {
      await runTransaction(ref(realtime, `pollSlideStudioVotes/${slideId}/${optionId}`), (current) =>
        typeof current === 'number' ? current + 1 : 1,
      )
      return true
    } catch {
      return false
    }
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

export const resetRemoteVotes = async (slideId?: string) => {
  const realtime = getRealtimeDb()
  if (realtime) {
    await remove(ref(realtime, slideId ? `pollSlideStudioVotes/${slideId}` : 'pollSlideStudioVotes'))
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
