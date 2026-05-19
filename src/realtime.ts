import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  increment,
  onSnapshot,
  collection,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore'

type RemotePresentation = {
  title: string
  slides: unknown[]
}

export type RemoteVoteStore = Record<string, Record<string, number>>
export type RemoteOpenPolls = Record<string, boolean>

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
    db = getFirestore(app)
  }
  return db
}

const stateDoc = (name: string) => {
  const firestore = getDb()
  return firestore ? doc(firestore, 'pollSlideStudio', name) : null
}

export const saveRemotePresentation = async (presentation: RemotePresentation) => {
  const target = stateDoc('presentation')
  if (!target) return
  await setDoc(target, { value: presentation, updatedAt: Date.now() })
}

export const subscribeRemotePresentation = (onChange: (presentation: RemotePresentation | null) => void) => {
  const target = stateDoc('presentation')
  if (!target) return () => undefined
  return onSnapshot(target, (snapshot) => {
    const value = snapshot.data()?.value
    onChange(value && typeof value === 'object' ? (value as RemotePresentation) : null)
  })
}

export const saveRemoteOpenPolls = async (openPolls: RemoteOpenPolls) => {
  const target = stateDoc('openPolls')
  if (!target) return
  await setDoc(target, { value: openPolls, updatedAt: Date.now() })
}

export const subscribeRemoteOpenPolls = (onChange: (openPolls: RemoteOpenPolls) => void) => {
  const target = stateDoc('openPolls')
  if (!target) return () => undefined
  return onSnapshot(target, (snapshot) => {
    const value = snapshot.data()?.value
    onChange(value && typeof value === 'object' ? (value as RemoteOpenPolls) : {})
  })
}

export const subscribeRemoteVotes = (onChange: (votes: RemoteVoteStore) => void) => {
  const firestore = getDb()
  if (!firestore) return () => undefined
  return onSnapshot(collection(firestore, 'pollSlideStudioVotes'), (snapshot) => {
    const votes: RemoteVoteStore = {}
    snapshot.forEach((item) => {
      const counts = item.data().counts
      votes[item.id] = counts && typeof counts === 'object' ? (counts as Record<string, number>) : {}
    })
    onChange(votes)
  })
}

export const incrementRemoteVote = async (slideId: string, optionId: string) => {
  const firestore = getDb()
  if (!firestore) return
  const target = doc(firestore, 'pollSlideStudioVotes', slideId)
  try {
    await updateDoc(target, { [`counts.${optionId}`]: increment(1) })
  } catch {
    await setDoc(target, { counts: { [optionId]: 1 } }, { merge: true })
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
