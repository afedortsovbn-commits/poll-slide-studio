import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  collection,
  deleteDoc,
  doc,
  FieldPath,
  getDocs,
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

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseEnabled = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId,
)

let app: FirebaseApp | null = null
let db: Firestore | null = null

const getDb = () => {
  if (!firebaseEnabled) return null
  if (!app) {
    app = initializeApp(firebaseConfig)
    db = initializeFirestore(app, {
      experimentalForceLongPolling: true,
    })
  }
  return db
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

export const subscribeRemoteVotes = (onChange: (votes: RemoteVoteStore) => void) => {
  if (!firebaseEnabled) return () => undefined
  let previous = ''
  const firestore = getDb()
  if (!firestore) return () => undefined
  return onSnapshot(collection(firestore, 'pollSlideStudioVotes'), (snapshot) => {
    const votes: RemoteVoteStore = {}
    snapshot.forEach((item) => {
      const counts = item.data().counts
      votes[item.id] = counts && typeof counts === 'object' ? (counts as Record<string, number>) : {}
    })
    const next = JSON.stringify(votes)
    if (next !== previous) {
      previous = next
      onChange(votes)
    }
  })
}

export const incrementRemoteVote = async (slideId: string, optionId: string) => {
  const firestore = getDb()
  if (!firestore) return false
  const target = doc(firestore, 'pollSlideStudioVotes', slideId)
  try {
    await updateDoc(target, new FieldPath('counts', optionId), increment(1))
    return true
  } catch {
    try {
      await setDoc(target, { counts: { [optionId]: 1 } }, { merge: true })
      return true
    } catch {
      return false
    }
  }
}

export const resetRemoteVotes = async (slideId?: string) => {
  const firestore = getDb()
  if (!firestore) return
  if (slideId) {
    await deleteDoc(doc(firestore, 'pollSlideStudioVotes', slideId))
    return
  }
  const snapshot = await getDocs(collection(firestore, 'pollSlideStudioVotes'))
  await Promise.all(snapshot.docs.map((item) => deleteDoc(item.ref)))
}
