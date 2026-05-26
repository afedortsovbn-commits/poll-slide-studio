import { type CSSProperties, type TouchEvent, useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  ArrowLeft,
  Check,
  Circle,
  Copy,
  Download,
  Eye,
  FolderInput,
  GripVertical,
  ImagePlus,
  Lock,
  Music,
  Pencil,
  Plus,
  QrCode,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react'
import {
  firebaseEnabled,
  incrementRemoteVote,
  readRemotePresentation,
  readRemotePollSession,
  resetRemoteVotes,
  saveRemoteOpenPolls,
  saveRemotePollSession,
  saveRemotePresentation,
  readRemoteVotes,
  subscribeRemoteOpenPolls,
  subscribeRemoteVotes,
  type RemotePollSession,
  type RemoteOpenPolls,
} from './realtime'
import './App.css'

type Transition = 'fade' | 'slide' | 'zoom' | 'none'

type PollOption = {
  id: string
  text: string
}

type Poll = {
  question: string
  options: PollOption[]
  correctOptionId?: string
  correctOptionIds?: string[]
  theme?: 'light' | 'dark'
  questionScale: number
  optionScale: number
  questionX: number
  questionY: number
  optionsX: number
  optionsY: number
}

type Slide = {
  id: string
  title: string
  image?: string
  imageTone?: number
  transition: Transition
  poll?: Poll
}

type Presentation = {
  title: string
  slides: Slide[]
}

type PresentationRecord = {
  id: string
  title: string
  ownerEmail: string
  editorEmails: string[]
  presentation: Presentation
}

type PresentationAudio = {
  name: string
  data: string
}

type VoteStore = Record<string, Record<string, number>>

type PollUrlData = {
  s: string
  n?: string
  q?: string
  o?: [string, string][]
  c?: string | string[]
}

type ShortPollUrlData = {
  s: string
  n: string
}

type AuthState = {
  email: string
  password: string
}

type AuthStore = {
  users: AuthState[]
}

type PollNumberField = keyof Pick<Poll, 'questionScale' | 'optionScale' | 'questionX' | 'questionY' | 'optionsX' | 'optionsY'>

const AUTH_KEY = 'poll-slide-studio.auth'
const AUTH_USERS_KEY = 'poll-slide-studio.auth-users'
const SESSION_KEY = 'poll-slide-studio.session'
const PRESENTATION_KEY = 'poll-slide-studio.presentation'
const PRESENTATION_RECORDS_KEY = 'poll-slide-studio.presentation-records'
const PRESENTATION_CACHE_KEY = 'poll-slide-studio.presentation-cache'
const PRESENTATION_AUDIO_KEY = 'poll-slide-studio.presentation-audio'
const SERVER_AUDIO: PresentationAudio = {
  name: 'Серверный трек',
  data: `${import.meta.env.BASE_URL}audio/presentation-track.mp3`,
}
const VOTES_KEY = 'poll-slide-studio.votes'
const OPEN_POLLS_KEY = 'poll-slide-studio.open-polls'
const SAMPLE_POLL_SLIDE_ID = 'sample-poll-slide'
const DEFAULT_USER_ID = 'default'

const createId = () => crypto.randomUUID()

const starterPresentation = (): Presentation => ({
  title: 'Студия интерактивных слайдов',
  slides: [
    {
      id: 'intro-slide',
      title: 'Вступление',
      transition: 'fade',
    },
    {
      id: SAMPLE_POLL_SLIDE_ID,
      title: 'Опрос аудитории',
      transition: 'slide',
      poll: {
        question: 'Какой формат лучше удерживает внимание аудитории?',
        options: [
          { id: 'sample-answer-1', text: 'Короткие живые опросы' },
          { id: 'sample-answer-2', text: 'Открытое обсуждение' },
          { id: 'sample-answer-3', text: 'Визуальные примеры' },
        ],
        correctOptionId: 'sample-answer-1',
        questionScale: 100,
        optionScale: 100,
        questionX: 7,
        questionY: 10,
        optionsX: 7,
        optionsY: 38,
      },
    },
  ],
})

const starterPoll = (): Poll => ({
  question: 'Ваш вопрос',
  options: [
    { id: createId(), text: 'Первый вариант ответа' },
    { id: createId(), text: 'Второй вариант ответа' },
  ],
  questionScale: 100,
  optionScale: 100,
  questionX: 8,
  questionY: 12,
  optionsX: 8,
  optionsY: 36,
  theme: 'light',
})

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    window.dispatchEvent(new Event('poll-slide-studio-storage'))
    return true
  } catch {
    return false
  }
}

const readAuthStore = (): AuthStore => {
  const stored = readJson<AuthStore>(AUTH_USERS_KEY, { users: [] })
  if (stored.users.length) return stored
  const legacy = readJson<AuthState | null>(AUTH_KEY, null)
  return legacy ? { users: [legacy] } : { users: [] }
}

const writeAuthStore = (store: AuthStore) => {
  writeJson(AUTH_USERS_KEY, store)
}

const userIdFromEmail = (email: string) => toBase64Url(email.trim().toLowerCase()).slice(0, 48) || DEFAULT_USER_ID

const presentationKeyForUser = (userId: string) => `${PRESENTATION_KEY}.${userId}`
const presentationCacheKeyForUser = (userId: string) => `${PRESENTATION_CACHE_KEY}.${userId}`
const votesKeyForUser = (userId: string) => `${VOTES_KEY}.${userId}`
const openPollsKeyForUser = (userId: string) => `${OPEN_POLLS_KEY}.${userId}`
const presentationScope = (presentationId: string) => presentationId || DEFAULT_USER_ID

const canEditPresentation = (record: PresentationRecord, email: string) =>
  record.ownerEmail === email || record.editorEmails.includes(email)

const readPresentationRecords = (email: string): PresentationRecord[] => {
  const stored = readJson<PresentationRecord[]>(PRESENTATION_RECORDS_KEY, [])
  if (stored.length) return stored
  const userId = userIdFromEmail(email)
  const migrated = readJson(presentationKeyForUser(userId), readJson(PRESENTATION_KEY, starterPresentation()))
  const record: PresentationRecord = {
    id: createId(),
    title: migrated.title || 'Основная презентация',
    ownerEmail: email,
    editorEmails: [email],
    presentation: migrated,
  }
  writeJson(PRESENTATION_RECORDS_KEY, [record])
  return [record]
}

const writePresentationRecords = (records: PresentationRecord[]) => {
  return writeJson(PRESENTATION_RECORDS_KEY, records)
}

const readAllPresentationRecords = () => readJson<PresentationRecord[]>(PRESENTATION_RECORDS_KEY, [])

const toBase64Url = (value: string) => {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
}

const encodePollUrlData = (value: PollUrlData) => toBase64Url(JSON.stringify(value))

const decodePollUrlData = (value: string | null): PollUrlData | null => {
  if (!value) return null
  try {
    return JSON.parse(fromBase64Url(value)) as PollUrlData
  } catch {
    return null
  }
}

const getCorrectOptionIds = (poll: Poll) => poll.correctOptionIds ?? (poll.correctOptionId ? [poll.correctOptionId] : [])

const pollFromUrlData = (data: PollUrlData): Poll => ({
  question: data.q ?? '',
  options: (data.o ?? []).map(([id, text]) => ({ id, text })),
  correctOptionId: Array.isArray(data.c) ? data.c[0] : data.c,
  correctOptionIds: Array.isArray(data.c) ? data.c : data.c ? [data.c] : undefined,
  questionScale: 100,
  optionScale: 100,
  questionX: 8,
  questionY: 12,
  optionsX: 8,
  optionsY: 36,
})

const shortPollDataFromParam = (value: string | null): ShortPollUrlData | null => {
  const decoded = decodePollUrlData(value)
  if (!decoded?.s || !decoded.n || decoded.q) return null
  return { s: decoded.s, n: decoded.n }
}

const createPollSession = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const getPollUrl = (slide: Slide, pollSession?: string, userId = DEFAULT_USER_ID) => {
  const poll = slide.poll ?? starterPoll()
  const url = new URL(window.location.href)
  url.searchParams.set('u', userId)
  url.searchParams.set(
    'poll',
    pollSession
      ? encodePollUrlData({ s: slide.id, n: pollSession })
      : encodePollUrlData({
          s: slide.id,
          q: poll.question,
          o: poll.options.map((option) => [option.id, option.text]),
          c: getCorrectOptionIds(poll),
        }),
  )
  url.hash = `poll/${slide.id}`
  return url.toString()
}

const moveItem = <T,>(items: T[], from: number, to: number) => {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

const fitPollOptions = (poll: Poll): Poll => {
  const rows = Math.max(poll.options.length, 1)
  const optionScale = Math.min(poll.optionScale, Math.max(45, Math.floor(118 - rows * 5)))
  const optionsY = Math.min(poll.optionsY, rows > 7 ? 30 : poll.optionsY)
  return { ...poll, optionScale, optionsY }
}

const createSlide = (): Slide => ({
  id: createId(),
  title: 'Новый слайд',
  imageTone: 0,
  transition: 'fade',
})

function NumericControl({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <label className="numeric-control">
      {label}
      <div>
        <input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />
        <input type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      </div>
    </label>
  )
}

function App() {
  const hash = window.location.hash.replace(/^#\/?/, '')
  const [route, setRoute] = useState(hash || 'admin')
  const [runtimeError, setRuntimeError] = useState('')

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash.replace(/^#\/?/, '') || 'admin')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const onError = (event: ErrorEvent) => setRuntimeError(event.message || 'Не удалось открыть приложение.')
    const onRejection = (event: PromiseRejectionEvent) => setRuntimeError(String(event.reason || 'Не удалось выполнить действие.'))
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  if (runtimeError) {
    return (
      <main className="auth-screen">
        <section className="auth-panel">
          <h1>Приложение не загрузилось</h1>
          <p>{runtimeError}</p>
          <button type="button" onClick={() => window.location.reload()}>
            Обновить страницу
          </button>
        </section>
      </main>
    )
  }

  if (route.startsWith('poll/')) {
    return <ParticipantView slideId={route.split('/')[1].split('?')[0]} />
  }

  if (route === 'present' || route.startsWith('present/')) {
    return <SpeakerView userId={route.split('/')[1] || DEFAULT_USER_ID} />
  }

  return <AdminGate />
}

function AdminGate() {
  const [authStore, setAuthStore] = useState<AuthStore>(() => readAuthStore())
  const [sessionEmail, setSessionEmail] = useState(() => localStorage.getItem(SESSION_KEY) ?? '')
  const [mode, setMode] = useState<'login' | 'register'>(() => (readAuthStore().users.length ? 'login' : 'register'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const hasUsers = authStore.users.length > 0

  const submit = () => {
    setError('')
    if (mode === 'register') {
      if (!email || !password || password !== confirm) {
        setError('Проверьте логин и подтверждение пароля.')
        return
      }
      if (authStore.users.some((user) => user.email === email)) {
        setError('Пользователь с таким логином уже существует.')
        return
      }
      const next = { email, password }
      const nextStore = { users: [...authStore.users, next] }
      writeAuthStore(nextStore)
      localStorage.setItem(SESSION_KEY, email)
      setAuthStore(nextStore)
      setSessionEmail(email)
      return
    }

    if (authStore.users.some((user) => user.email === email && user.password === password)) {
      localStorage.setItem(SESSION_KEY, email)
      setSessionEmail(email)
      return
    }
    setError('Неверный логин или пароль.')
  }

  const currentUser = authStore.users.find((user) => user.email === sessionEmail)
  if (currentUser) {
    return (
      <AdminView
        user={currentUser}
        authStore={authStore}
        setAuthStore={setAuthStore}
        onSwitchAccount={() => {
          localStorage.removeItem(SESSION_KEY)
          setSessionEmail('')
        }}
      />
    )
  }

  return (
    <main className="auth-screen">
      <section className="auth-panel">
        <div className="brand-mark">
          <QrCode size={30} />
        </div>
        <h1>Студия интерактивных слайдов</h1>
        <p>{mode === 'login' ? 'Войдите, чтобы управлять презентацией.' : 'Создайте нового пользователя админки.'}</p>
        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} type="button" onClick={() => setMode('login')} disabled={!hasUsers}>
            <Lock size={16} />
            Вход
          </button>
          <button className={mode === 'register' ? 'active' : ''} type="button" onClick={() => setMode('register')}>
            <UserPlus size={16} />
            Новый пользователь
          </button>
        </div>
        <label>
          Логин
          <input
            name="admin-login"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="электронная почта"
          />
        </label>
        <label>
          Пароль
          <input
            type="password"
            name="admin-password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="пароль"
          />
        </label>
        {mode === 'register' && (
          <label>
            Подтверждение пароля
            <input
              type="password"
              name="admin-password-confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="повторите пароль"
            />
          </label>
        )}
        {error && <p className="form-error">{error}</p>}
        <button className="primary" type="button" onClick={submit}>
          <Lock size={18} />
          {mode === 'login' ? 'Войти' : 'Создать пользователя'}
        </button>
      </section>
    </main>
  )
}

function AdminView({
  user,
  authStore,
  setAuthStore,
  onSwitchAccount,
}: {
  user: AuthState
  authStore: AuthStore
  setAuthStore: (store: AuthStore) => void
  onSwitchAccount: () => void
}) {
  const [presentationRecords, setPresentationRecords] = useState(() => readPresentationRecords(user.email))
  const availableRecords = presentationRecords.filter((record) => canEditPresentation(record, user.email))
  const [activePresentationId, setActivePresentationId] = useState(availableRecords[0]?.id ?? '')
  const activeRecord = availableRecords.find((record) => record.id === activePresentationId) ?? availableRecords[0]
  const scope = presentationScope(activeRecord?.id ?? DEFAULT_USER_ID)
  const presentationKey = `${PRESENTATION_KEY}.record.${scope}`
  const votesKey = votesKeyForUser(scope)
  const showHref = `#present/${scope}`
  const [presentation, setPresentationState] = useState(activeRecord?.presentation ?? starterPresentation())
  const [presentationBase, setPresentationBase] = useState(activeRecord?.presentation ?? starterPresentation())
  const [history, setHistory] = useState<Presentation[]>([])
  const [selectedId, setSelectedId] = useState(presentation.slides[0]?.id)
  const [selectedSlideIds, setSelectedSlideIds] = useState<string[]>([])
  const [audioName, setAudioName] = useState(() => readJson<PresentationAudio | null>(PRESENTATION_AUDIO_KEY, null)?.name ?? '')
  const [draggedSlideId, setDraggedSlideId] = useState<string | null>(null)
  const [publishStatus, setPublishStatus] = useState('')
  const [saveStatus, setSaveStatus] = useState('')
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [newPresentationTitle, setNewPresentationTitle] = useState('')
  const [newPresentationEditors, setNewPresentationEditors] = useState<string[]>([user.email])
  const [presentationDialog, setPresentationDialog] = useState<'create' | 'edit' | null>(null)
  const [editingPresentationId, setEditingPresentationId] = useState('')
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const selected = presentation.slides.find((slide) => slide.id === selectedId) ?? presentation.slides[0]
  const fileInput = useRef<HTMLInputElement>(null)
  const audioInput = useRef<HTMLInputElement>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const slideListRef = useRef<HTMLDivElement>(null)
  const loadedRecordId = useRef(activeRecord?.id ?? '')
  const isOwner = authStore.users[0]?.email === user.email
  const activeRecordId = activeRecord?.id ?? ''
  const canUndo = history.length > 0
  const closeMenus = () => setOpenMenu(null)
  const isDirty = JSON.stringify(presentation) !== JSON.stringify(presentationBase)

  useEffect(() => {
    const closeOnPointer = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return
      if (!event.target.closest('.presentation-menu, .workspace-menu, .action-menu, .presentation-dialog')) closeMenus()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenus()
    }
    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  useEffect(() => {
    if (!activeRecord || loadedRecordId.current === activeRecord.id) return
    loadedRecordId.current = activeRecord.id
    setPresentationBase(activeRecord.presentation)
    setPresentationState(activeRecord.presentation)
    setSelectedId(activeRecord.presentation.slides[0]?.id ?? '')
    setSelectedSlideIds([])
    setHistory([])
  }, [activeRecord])

  useEffect(() => {
    if (!firebaseEnabled || !activeRecordId) return undefined
    let cancelled = false
    void readRemotePresentation(scope)
      .then((remotePresentation) => {
        if (cancelled) return
        if (remotePresentation) {
          const nextPresentation = remotePresentation as Presentation
          const latestRecords = readAllPresentationRecords()
          if (!latestRecords.length) return
          const records = latestRecords.map((record) =>
            record.id === activeRecordId
              ? { ...record, title: nextPresentation.title || record.title, presentation: nextPresentation }
              : record,
          )
          setPresentationRecords(records)
          writePresentationRecords(records)
          writeJson(presentationKey, nextPresentation)
          setPresentationBase(nextPresentation)
          setPresentationState(nextPresentation)
          setSelectedId(nextPresentation.slides[0]?.id ?? '')
        }
        setSaveStatus('')
      })
      .catch(() => {
        if (!cancelled) setSaveStatus('')
      })
    return () => {
      cancelled = true
    }
  }, [activeRecordId, presentationKey, scope])

  const persistRecords = (records: PresentationRecord[]) => {
    setPresentationRecords(records)
    return writePresentationRecords(records)
  }

  const persistActivePresentation = (next: Presentation) => {
    const recordId = activeRecord?.id ?? scope
    const latestRecords = readAllPresentationRecords()
    const sourceRecords = latestRecords.length ? latestRecords : presentationRecords
    const records = sourceRecords.map((record) =>
      record.id === recordId ? { ...record, title: next.title, presentation: next } : record,
    )
    const recordsSaved = persistRecords(records)
    const presentationSaved = writeJson(presentationKey, next)
    return recordsSaved && presentationSaved
  }

  const setPresentation = (next: Presentation, remember = true) => {
    if (remember) setHistory((items) => [presentation, ...items].slice(0, 3))
    setPresentationState(next)
    setPresentationBase(next)
    const savedLocally = persistActivePresentation(next)
    if (!savedLocally) {
      setSaveStatus('Локальный кэш переполнен. Нажмите «Сохранить», чтобы записать изменения в базу.')
    }
  }

  const savePresentation = async (next: Presentation) => {
    setPresentationState(next)
    setPresentationBase(next)
    const savedLocally = persistActivePresentation(next)
    setSaveStatus(savedLocally ? 'Сохраняем в базу...' : 'Локальный кэш переполнен. Сохраняем в базу...')
    const savedRemotely = firebaseEnabled ? await saveRemotePresentation(next, scope) : true
    setSaveStatus(
      savedRemotely
        ? savedLocally
          ? 'Сохранено'
          : 'Сохранено в базе. Локальный кэш браузера переполнен.'
        : 'Не удалось сохранить в базу. Проверьте подключение и правила Realtime Database.',
    )
    window.setTimeout(() => {
      setSaveStatus((current) => (current === 'Сохранено' ? '' : current))
    }, 2500)
    return savedLocally && savedRemotely
  }

  const undo = () => {
    const [previous, ...rest] = history
    if (!previous) return
    setHistory(rest)
    setPresentation(previous, false)
  }

  const updateSlide = (slideId: string, updater: (slide: Slide) => Slide) => {
    setPresentation({
      ...presentation,
      slides: presentation.slides.map((slide) => (slide.id === slideId ? updater(slide) : slide)),
    })
  }

  const createUser = () => {
    if (!isOwner || !newUserEmail || !newUserPassword || authStore.users.some((item) => item.email === newUserEmail)) return
    const nextStore = { users: [...authStore.users, { email: newUserEmail, password: newUserPassword }] }
    writeAuthStore(nextStore)
    setAuthStore(nextStore)
    setNewUserEmail('')
    setNewUserPassword('')
  }

  const deleteUser = (email: string) => {
    if (!isOwner || email === user.email || email === authStore.users[0]?.email) return
    const nextStore = { users: authStore.users.filter((item) => item.email !== email) }
    const records = presentationRecords.map((record) => ({
      ...record,
      editorEmails: record.editorEmails.filter((editor) => editor !== email),
    }))
    writeAuthStore(nextStore)
    setAuthStore(nextStore)
    persistRecords(records)
  }

  const openCreatePresentationDialog = () => {
    setNewPresentationTitle('')
    setNewPresentationEditors([user.email])
    setEditingPresentationId('')
    setPresentationDialog('create')
  }

  const openEditPresentationDialog = (record: PresentationRecord) => {
    setNewPresentationTitle(record.title)
    setNewPresentationEditors(record.editorEmails.length ? record.editorEmails : [record.ownerEmail])
    setEditingPresentationId(record.id)
    setPresentationDialog('edit')
  }

  const createPresentationRecord = () => {
    const title = newPresentationTitle.trim() || 'Новая презентация'
    const editors = Array.from(new Set([user.email, ...newPresentationEditors]))
    const nextPresentation = { ...starterPresentation(), title }
    const record: PresentationRecord = {
      id: createId(),
      title,
      ownerEmail: user.email,
      editorEmails: editors,
      presentation: nextPresentation,
    }
    const latestRecords = readAllPresentationRecords()
    persistRecords([...(latestRecords.length ? latestRecords : presentationRecords), record])
    writeJson(`${PRESENTATION_KEY}.record.${record.id}`, nextPresentation)
    loadedRecordId.current = record.id
    setActivePresentationId(record.id)
    setPresentationState(nextPresentation)
    setPresentationBase(nextPresentation)
    setSelectedId(nextPresentation.slides[0]?.id ?? '')
    setNewPresentationTitle('')
    setNewPresentationEditors([user.email])
    setPresentationDialog(null)
    closeMenus()
  }

  const savePresentationRecordSettings = () => {
    if (!editingPresentationId) return
    const title = newPresentationTitle.trim() || 'Новая презентация'
    const editors = Array.from(new Set([user.email, ...newPresentationEditors]))
    const latestRecords = readAllPresentationRecords()
    const sourceRecords = latestRecords.length ? latestRecords : presentationRecords
    const nextActivePresentation = editingPresentationId === activeRecord?.id ? { ...presentation, title } : null
    const records = sourceRecords.map((record) =>
      record.id === editingPresentationId
        ? { ...record, title, editorEmails: editors, presentation: nextActivePresentation ?? { ...record.presentation, title } }
        : record,
    )
    persistRecords(records)
    if (nextActivePresentation) {
      setPresentationState(nextActivePresentation)
      setPresentationBase(nextActivePresentation)
      writeJson(presentationKey, nextActivePresentation)
      void saveRemotePresentation(nextActivePresentation, scope).then((saved) => {
        setSaveStatus(saved ? 'Сохранено' : 'Не удалось сохранить название в базу.')
      })
    }
    setPresentationDialog(null)
    closeMenus()
  }

  const togglePresentationEditor = (email: string) => {
    setNewPresentationEditors((items) => (items.includes(email) ? items.filter((item) => item !== email) : [...items, email]))
  }

  const addSlide = () => {
    const slide = createSlide()
    const activeIndex = presentation.slides.findIndex((item) => item.id === selected?.id)
    const insertIndex = activeIndex >= 0 ? activeIndex + 1 : presentation.slides.length
    const slides = [...presentation.slides]
    slides.splice(insertIndex, 0, slide)
    setPresentation({ ...presentation, slides })
    setSelectedId(slide.id)
    window.setTimeout(() => {
      slideListRef.current?.querySelector(`[data-slide-id="${slide.id}"]`)?.scrollIntoView({ block: 'center' })
    }, 0)
  }

  const copySlide = (slideId: string) => {
    const index = presentation.slides.findIndex((slide) => slide.id === slideId)
    const source = presentation.slides[index]
    if (!source) return
    const optionIdMap = new Map(source.poll?.options.map((option) => [option.id, createId()]) ?? [])
    const copy: Slide = {
      ...source,
      id: createId(),
      title: `${source.title} - копия`,
      poll: source.poll
        ? {
            ...source.poll,
            options: source.poll.options.map((option) => ({ ...option, id: optionIdMap.get(option.id) ?? createId() })),
            correctOptionId: source.poll.correctOptionId ? optionIdMap.get(source.poll.correctOptionId) : undefined,
            correctOptionIds: getCorrectOptionIds(source.poll).reduce<string[]>((items, id) => {
              const nextId = optionIdMap.get(id)
              if (nextId) items.push(nextId)
              return items
            }, []),
          }
        : undefined,
    }
    const slides = [...presentation.slides]
    slides.splice(index + 1, 0, copy)
    setPresentation({ ...presentation, slides })
    setSelectedId(copy.id)
  }

  const deleteSlide = (slideId: string) => {
    const slides = presentation.slides.filter((slide) => slide.id !== slideId)
    if (!slides.length) return
    setPresentation({ ...presentation, slides })
    setSelectedId(slides[0].id)
  }

  const deleteSelectedSlides = () => {
    if (!selectedSlideIds.length || selectedSlideIds.length >= presentation.slides.length) return
    const slides = presentation.slides.filter((slide) => !selectedSlideIds.includes(slide.id))
    setPresentation({ ...presentation, slides })
    setSelectedSlideIds([])
    setSelectedId(slides.find((slide) => slide.id === selectedId)?.id ?? slides[0].id)
  }

  const toggleSelectedSlide = (slideId: string) => {
    setSelectedSlideIds((ids) => (ids.includes(slideId) ? ids.filter((id) => id !== slideId) : [...ids, slideId]))
  }

  const onImage = (file?: File) => {
    if (!file || !selected) return
    const reader = new FileReader()
    reader.onload = () => {
      updateSlide(selected.id, (slide) => ({ ...slide, image: String(reader.result) }))
    }
    reader.readAsDataURL(file)
  }

  const onAudio = (file?: File) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      writeJson(PRESENTATION_AUDIO_KEY, { name: file.name, data: String(reader.result) })
      setAudioName(file.name)
    }
    reader.readAsDataURL(file)
  }

  const updatePoll = (next: Poll) => {
    if (!selected) return
    updateSlide(selected.id, (slide) => ({ ...slide, poll: next }))
  }

  const togglePoll = (enabled: boolean) => {
    if (!selected) return
    updateSlide(selected.id, (slide) => ({ ...slide, poll: enabled ? fitPollOptions(slide.poll ?? starterPoll()) : undefined }))
  }

  const reorderSlide = (targetId: string) => {
    if (!draggedSlideId || draggedSlideId === targetId) return
    const from = presentation.slides.findIndex((slide) => slide.id === draggedSlideId)
    const to = presentation.slides.findIndex((slide) => slide.id === targetId)
    setPresentation({ ...presentation, slides: moveItem(presentation.slides, from, to) })
  }

  const resetVotes = (slideId?: string) => {
    const votes = readJson<VoteStore>(votesKey, {})
    if (slideId) delete votes[slideId]
    else Object.keys(votes).forEach((key) => delete votes[key])
    writeJson(votesKey, votes)
    void resetRemoteVotes(slideId, scope)
  }

  const exportPresentation = () => {
    const blob = new Blob([JSON.stringify(presentation, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'poll-slide-studio.json'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const exportPowerPoint = async () => {
    const { default: pptxgen } = await import('pptxgenjs')
    const pptx = new pptxgen()
    pptx.layout = 'LAYOUT_WIDE'
    pptx.author = user.email
    pptx.subject = presentation.title
    pptx.title = presentation.title
    pptx.company = 'Студия интерактивных слайдов'
    pptx.theme = {
      headFontFace: 'Arial',
      bodyFontFace: 'Arial',
    }

    presentation.slides.forEach((item, index) => {
      const pptSlide = pptx.addSlide()
      pptSlide.background = { color: 'F7F8F6' }
      if (item.image) {
        pptSlide.addImage({ data: item.image, x: 0, y: 0, w: 13.333, h: 7.5 })
      }
      if (!item.image && !item.poll) {
        pptSlide.addText(item.title || `Слайд ${index + 1}`, {
          x: 0.8,
          y: 0.8,
          w: 11.7,
          h: 1,
          fontFace: 'Arial',
          fontSize: 34,
          bold: true,
          color: '12211B',
          fit: 'shrink',
        })
      }
      if (item.poll) {
        pptSlide.addText(item.poll.question, {
          x: 0.8,
          y: 0.65,
          w: 8.8,
          h: 0.9,
          fontFace: 'Arial',
          fontSize: 30,
          bold: true,
          color: '12211B',
          fit: 'shrink',
        })
        item.poll.options.forEach((option, optionIndex) => {
          pptSlide.addShape(pptx.ShapeType.roundRect, {
            x: 0.9,
            y: 2 + optionIndex * 0.62,
            w: 8.4,
            h: 0.46,
            rectRadius: 0.06,
            fill: { color: 'FFFFFF', transparency: 8 },
            line: { color: 'D1DBD5', width: 1 },
          })
          pptSlide.addText(option.text, {
            x: 1.08,
            y: 2.07 + optionIndex * 0.62,
            w: 8,
            h: 0.28,
            fontFace: 'Arial',
            fontSize: 16,
            color: '12211B',
            fit: 'shrink',
          })
        })
      }
    })

    await pptx.writeFile({ fileName: `${presentation.title || 'presentation'}.pptx` })
  }

  const importPresentation = (file?: File) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const next = JSON.parse(String(reader.result)) as Presentation
      setPresentation(next)
      setSelectedId(next.slides[0]?.id ?? '')
    }
    reader.readAsText(file)
  }

  const publishPresentation = async () => {
    const nextPresentation = { ...presentation, title: presentation.title || activeRecord?.title || '' }
    await savePresentation(nextPresentation)
    setPublishStatus('Публикуем презентацию...')
    const saved = await saveRemotePresentation(nextPresentation, scope)
    setPublishStatus(
      saved
        ? 'Презентация опубликована для других устройств.'
        : 'Не удалось опубликовать. Проверьте правила Realtime Database.',
    )
  }

  return (
    <main className="admin-shell">
      <aside className="slide-list">
        <div className="app-title">
          <QrCode />
          <div>
            <strong>Студия интерактивных слайдов</strong>
            <span>1920 x 1080</span>
          </div>
        </div>
        <button className="primary" type="button" onClick={addSlide}>
          <Plus size={17} />
          Добавить слайд
        </button>
        <button type="button" onClick={deleteSelectedSlides} disabled={!selectedSlideIds.length || selectedSlideIds.length >= presentation.slides.length}>
          <Trash2 size={16} />
          Удалить выбранные
        </button>
        <div className="slides" ref={slideListRef}>
          {presentation.slides.map((slide, index) => (
            <div
              className={slide.id === selected?.id ? 'thumb active' : 'thumb'}
              key={slide.id}
              data-slide-id={slide.id}
              role="button"
              tabIndex={0}
              draggable
              onDragStart={() => setDraggedSlideId(slide.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => reorderSlide(slide.id)}
              onDragEnd={() => setDraggedSlideId(null)}
              onClick={() => setSelectedId(slide.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSelectedId(slide.id)
                }
              }}
            >
              <input
                type="checkbox"
                checked={selectedSlideIds.includes(slide.id)}
                onChange={(event) => {
                  event.stopPropagation()
                  toggleSelectedSlide(slide.id)
                }}
                onClick={(event) => event.stopPropagation()}
              />
              <GripVertical className="drag-marker" size={16} />
              <span>{index + 1}</span>
              <strong>{slide.title || 'Без названия'}</strong>
              {slide.poll && <QrCode className="thumb-poll-mark" size={16} />}
            </div>
          ))}
        </div>
      </aside>

      <section className="editor">
        <header className="toolbar">
          <details className="presentation-menu" open={openMenu === 'presentations'} onToggle={(event) => setOpenMenu(event.currentTarget.open ? 'presentations' : null)}>
            <summary>
              <span>{activeRecord?.title ?? presentation.title}</span>
            </summary>
            <div className="presentation-popover">
              <button className="popover-close" type="button" onClick={closeMenus} title="Закрыть"><X size={16} /></button>
              <strong>Презентации</strong>
              <div className="presentation-list">
                {availableRecords.map((record) => (
                  <div className={record.id === activeRecord?.id ? 'presentation-row active' : 'presentation-row'} key={record.id}>
                    <button type="button" onClick={() => setActivePresentationId(record.id)}>
                      {record.title}
                    </button>
                    <button type="button" onClick={() => openEditPresentationDialog(record)} title="Настроить презентацию">
                      <Pencil size={16} />
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={openCreatePresentationDialog}>
                <Plus size={18} />
                Создать презентацию
              </button>
            </div>
          </details>
          <details className="workspace-menu toolbar-menu" open={openMenu === 'accounts'} onToggle={(event) => setOpenMenu(event.currentTarget.open ? 'accounts' : null)}>
            <summary>
              <UserPlus size={18} />
            </summary>
            <div className="workspace-popover accounts-popover toolbar-popover">
              <button className="popover-close" type="button" onClick={closeMenus} title="Закрыть"><X size={16} /></button>
              <strong>{isOwner ? 'Управление аккаунтами' : user.email}</strong>
              {isOwner && (
                <>
                <input value={newUserEmail} onChange={(event) => setNewUserEmail(event.target.value)} placeholder="Логин" />
                <input type="password" value={newUserPassword} onChange={(event) => setNewUserPassword(event.target.value)} placeholder="Пароль" />
                <button type="button" onClick={createUser}>
                  <UserPlus size={18} />
                  Создать аккаунт
                </button>
                <div className="account-strip">
                  {authStore.users.map((account, index) => (
                    <span className="account-chip" key={account.email}>
                      {account.email}
                      {index > 0 && account.email !== user.email && (
                        <button type="button" onClick={() => deleteUser(account.email)} title="Удалить аккаунт">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
                </>
              )}
              <button type="button" onClick={onSwitchAccount}>
                <Lock size={18} />
                Сменить аккаунт
              </button>
            </div>
          </details>
          <div className="toolbar-actions">
            <div className="action-group" aria-label="История и сохранение">
              <button type="button" onClick={undo} disabled={!canUndo} title="Отменить">
                <ArrowLeft size={18} />
              </button>
              <button
                className={isDirty ? 'primary small-primary' : ''}
                type="button"
                onClick={() => void savePresentation(presentation)}
                title={isDirty ? 'Сохранить изменения' : 'Сохранено автоматически'}
              >
                <Save size={18} />
              </button>
              <button className="reset-action" type="button" onClick={() => resetVotes()} title="Обнулить все ответы">
                <RotateCcw size={18} />
              </button>
            </div>
            <button className="primary small-primary" type="button" onClick={() => void publishPresentation()} title="Опубликовать для других устройств">
              <Upload size={18} />
            </button>
            <button className={audioName ? 'icon-on' : ''} type="button" onClick={() => audioInput.current?.click()} title={audioName ? 'Заменить трек' : 'Добавить трек'}>
              <Music size={18} />
            </button>
            <details className="action-menu align-right" open={openMenu === 'files'} onToggle={(event) => setOpenMenu(event.currentTarget.open ? 'files' : null)}>
              <summary>
                <FolderInput size={18} />
              </summary>
              <div className="action-popover">
                <button className="popover-close" type="button" onClick={closeMenus} title="Закрыть"><X size={16} /></button>
                <button type="button" onClick={exportPresentation} title="Экспортировать презентацию в JSON-файл">
                  <Upload size={18} />
                  Экспорт JSON
                </button>
                <button type="button" onClick={() => importInput.current?.click()} title="Импортировать презентацию из JSON-файла">
                  <Download size={18} />
                  Импорт JSON
                </button>
                <button type="button" onClick={() => void exportPowerPoint()} title="Экспортировать презентацию в PowerPoint">
                  PPT
                  Экспорт PowerPoint
                </button>
              </div>
            </details>
            <a className="button-link" href={showHref} target="_blank" rel="noreferrer">
              <Eye size={18} />
              Показ
            </a>
          </div>
          <input
            hidden
            ref={importInput}
            type="file"
            accept="application/json"
            onChange={(event) => importPresentation(event.target.files?.[0])}
          />
          <input hidden ref={audioInput} type="file" accept="audio/*" onChange={(event) => onAudio(event.target.files?.[0])} />
        </header>
        {presentationDialog && (
          <div className="presentation-dialog" role="dialog" aria-modal="true">
            <div className="presentation-dialog-panel">
              <strong>{presentationDialog === 'create' ? 'Новая презентация' : 'Настройка презентации'}</strong>
              <input value={newPresentationTitle} onChange={(event) => setNewPresentationTitle(event.target.value)} placeholder="Название" />
              <div className="access-list compact">
                {authStore.users.map((account) => (
                  <label className="checkbox-row" key={account.email}>
                    <input
                      type="checkbox"
                      checked={newPresentationEditors.includes(account.email)}
                      onChange={() => togglePresentationEditor(account.email)}
                    />
                    {account.email}
                  </label>
                ))}
              </div>
              <div className="dialog-actions">
                <button type="button" onClick={() => setPresentationDialog(null)}>Отмена</button>
                <button className="primary" type="button" onClick={presentationDialog === 'create' ? createPresentationRecord : savePresentationRecordSettings}>
                  {presentationDialog === 'create' ? 'Создать' : 'Сохранить'}
                </button>
              </div>
            </div>
          </div>
        )}
        {saveStatus && <div className="publish-status save-status">{saveStatus}</div>}
        {publishStatus && <div className="publish-status">{publishStatus}</div>}

        {selected && (
          <div className="workbench">
            <section className="canvas-wrap">
              <SlideCanvas slide={selected} mode="edit" votes={{}} />
            </section>
            <aside className="properties">
              <label>
                Название слайда
                <input
                  value={selected.title}
                  name="slide-title"
                  autoComplete="off"
                  onChange={(event) => updateSlide(selected.id, (slide) => ({ ...slide, title: event.target.value }))}
                />
              </label>
              <label>
                Переход
                <select
                  value={selected.transition}
                  onChange={(event) =>
                    updateSlide(selected.id, (slide) => ({ ...slide, transition: event.target.value as Transition }))
                  }
                >
                  <option value="fade">Плавное появление</option>
                  <option value="slide">Сдвиг</option>
                  <option value="zoom">Приближение</option>
                  <option value="none">Без эффекта</option>
                </select>
              </label>
              <button type="button" onClick={() => fileInput.current?.click()}>
                <ImagePlus size={18} />
                Добавить изображение 1920x1080
              </button>
              <input hidden ref={fileInput} type="file" accept="image/*" onChange={(event) => onImage(event.target.files?.[0])} />
              {selected.image && (
                <button type="button" onClick={() => updateSlide(selected.id, (slide) => ({ ...slide, image: undefined }))}>
                  <Trash2 size={18} />
                  Удалить изображение
                </button>
              )}
              <NumericControl
                label="Затемнение / осветление картинки"
                value={selected.imageTone ?? 0}
                min={-100}
                max={100}
                onChange={(value) => updateSlide(selected.id, (slide) => ({ ...slide, imageTone: value }))}
              />
              <label className="checkbox-row">
                <input type="checkbox" checked={Boolean(selected.poll)} onChange={(event) => togglePoll(event.target.checked)} />
                Опрос
              </label>
              {selected.poll && (
                <PollBuilder poll={selected.poll} onChange={updatePoll} onReset={() => resetVotes(selected.id)} />
              )}
              <div className="danger-zone">
                <button type="button" onClick={() => copySlide(selected.id)}>
                  <Copy size={18} />
                  Создать копию слайда
                </button>
                <button className="danger-action" type="button" onClick={() => deleteSlide(selected.id)} disabled={presentation.slides.length < 2}>
                  <Trash2 size={18} />
                  Удалить слайд
                </button>
              </div>
            </aside>
          </div>
        )}
      </section>
    </main>
  )
}

function PollBuilder({ poll, onChange, onReset }: { poll: Poll; onChange: (poll: Poll) => void; onReset: () => void }) {
  const [draggedOptionId, setDraggedOptionId] = useState<string | null>(null)

  const updateNumber = (field: PollNumberField, value: number) => {
    onChange({ ...poll, [field]: value })
  }

  const updateOption = (id: string, text: string) => {
    onChange({ ...poll, options: poll.options.map((option) => (option.id === id ? { ...option, text } : option)) })
  }

  const addOption = () => {
    if (poll.options.length >= 10) return
    onChange(fitPollOptions({ ...poll, options: [...poll.options, { id: createId(), text: `Вариант ответа ${poll.options.length + 1}` }] }))
  }

  const removeOption = (id: string) => {
    if (poll.options.length <= 2) return
    onChange({
      ...poll,
      options: poll.options.filter((option) => option.id !== id),
      correctOptionId: poll.correctOptionId === id ? undefined : poll.correctOptionId,
    })
  }

  const reorderOption = (targetId: string) => {
    if (!draggedOptionId || draggedOptionId === targetId) return
    const from = poll.options.findIndex((option) => option.id === draggedOptionId)
    const to = poll.options.findIndex((option) => option.id === targetId)
    onChange({ ...poll, options: moveItem(poll.options, from, to) })
  }

  return (
    <div className="poll-builder">
      <div className="panel-title">
        <strong>Конструктор опроса</strong>
        <button className="reset-action" type="button" onClick={onReset} title="Обнулить ответы этого опроса">
          <RotateCcw size={16} />
        </button>
      </div>
      <label>
        Вопрос
        <textarea value={poll.question} onChange={(event) => onChange({ ...poll, question: event.target.value })} />
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={poll.theme === 'dark'}
          onChange={(event) => onChange({ ...poll, theme: event.target.checked ? 'dark' : 'light' })}
        />
        Темная тема опроса
      </label>
      <div className="option-list">
        {poll.options.map((option) => (
          <div
            className="option-edit"
            key={option.id}
            draggable
            onDragStart={() => setDraggedOptionId(option.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => reorderOption(option.id)}
            onDragEnd={() => setDraggedOptionId(null)}
          >
            <GripVertical className="drag-marker" size={16} />
            <button
              type="button"
              className={getCorrectOptionIds(poll).includes(option.id) ? 'icon-on' : ''}
              onClick={() => {
                const selected = getCorrectOptionIds(poll)
                const next = selected.includes(option.id) ? selected.filter((id) => id !== option.id) : [...selected, option.id]
                onChange({ ...poll, correctOptionId: next[0], correctOptionIds: next })
              }}
              title="Правильный ответ"
            >
              {getCorrectOptionIds(poll).includes(option.id) ? <Check size={16} /> : <Circle size={16} />}
            </button>
            <input value={option.text} onChange={(event) => updateOption(option.id, event.target.value)} />
            <button type="button" onClick={() => removeOption(option.id)} title="Удалить ответ">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={addOption} disabled={poll.options.length >= 10}>
        <Plus size={16} />
        Добавить ответ
      </button>
      <details className="range-details">
        <summary>Размеры и расположение</summary>
        <div className="range-grid">
          <fieldset>
            <legend>Вопрос</legend>
            <NumericControl label="Размер" value={poll.questionScale} min={55} max={160} onChange={(value) => updateNumber('questionScale', value)} />
            <NumericControl label="Смещение X" value={poll.questionX} min={0} max={70} onChange={(value) => updateNumber('questionX', value)} />
            <NumericControl label="Смещение Y" value={poll.questionY} min={0} max={75} onChange={(value) => updateNumber('questionY', value)} />
          </fieldset>
          <fieldset>
            <legend>Ответы</legend>
            <NumericControl label="Размер" value={poll.optionScale} min={35} max={160} onChange={(value) => updateNumber('optionScale', value)} />
            <NumericControl label="Смещение X" value={poll.optionsX} min={0} max={70} onChange={(value) => updateNumber('optionsX', value)} />
            <NumericControl label="Смещение Y" value={poll.optionsY} min={12} max={82} onChange={(value) => updateNumber('optionsY', value)} />
          </fieldset>
        </div>
      </details>
    </div>
  )
}

function SpeakerView({ userId = DEFAULT_USER_ID }: { userId?: string }) {
  const presentationKey = presentationKeyForUser(userId)
  const presentationCacheKey = presentationCacheKeyForUser(userId)
  const votesKey = votesKeyForUser(userId)
  const openPollsKey = openPollsKeyForUser(userId)
  const [presentation, setPresentation] = useState(() => readJson(presentationCacheKey, readJson(presentationKey, starterPresentation())))
  const [votes, setVotes] = useState(() => readJson<VoteStore>(votesKey, {}))
  const [remotePresentationReady, setRemotePresentationReady] = useState(() => Boolean(readJson<Presentation | null>(presentationCacheKey, null)) || !firebaseEnabled)
  const [remotePresentationError, setRemotePresentationError] = useState(false)
  const [pollSessions, setPollSessions] = useState<Record<string, string>>({})
  const [audio, setAudio] = useState(() => readJson<PresentationAudio | null>(PRESENTATION_AUDIO_KEY, null) ?? SERVER_AUDIO)
  const [musicPlaying, setMusicPlaying] = useState(false)
  const [index, setIndex] = useState(0)
  const [showResults, setShowResults] = useState(false)
  const previousOpenPollKey = useRef('')
  const audioRef = useRef<HTMLAudioElement>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const slide = presentation.slides[index]

  useEffect(() => {
    const sync = () => {
      setVotes(readJson(votesKey, {}))
      setAudio(readJson(PRESENTATION_AUDIO_KEY, null) ?? SERVER_AUDIO)
    }
    window.addEventListener('storage', sync)
    window.addEventListener('poll-slide-studio-storage', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('poll-slide-studio-storage', sync)
    }
  }, [votesKey])

  useEffect(() => {
    if (!firebaseEnabled) return undefined
    let active = true
    void readRemotePresentation(userId)
      .then((remotePresentation) => {
        if (!active) return
        if (remotePresentation) {
          setPresentation(remotePresentation as Presentation)
          writeJson(presentationCacheKey, remotePresentation)
        }
        setRemotePresentationReady(true)
      })
      .catch(() => {
        if (!active) return
        setRemotePresentationError(true)
        setRemotePresentationReady(true)
      })
    const unsubscribeVotes = subscribeRemoteVotes((remoteVotes) => {
      setVotes(remoteVotes)
      writeJson(votesKey, remoteVotes)
    }, userId)
    return () => {
      active = false
      unsubscribeVotes()
    }
  }, [presentationCacheKey, userId, votesKey])

  useEffect(() => {
    const openPollKey = slide?.poll && !showResults ? slide.id : ''
    if (openPollKey && previousOpenPollKey.current !== openPollKey) {
      setPollSessions((items) => ({ ...items, [openPollKey]: createPollSession() }))
    }
    previousOpenPollKey.current = openPollKey
  }, [slide?.id, slide?.poll, showResults])

  useEffect(() => {
    if (!remotePresentationReady) return
    const openPolls: RemoteOpenPolls = {}
    presentation.slides.forEach((item) => {
      if (item.poll) openPolls[item.id] = false
    })
    if (slide?.poll) {
      openPolls[slide.id] = {
        isOpen: !showResults,
        title: slide.title,
        poll: slide.poll,
      }
      const sessionId = pollSessions[slide.id]
      if (sessionId) {
        void saveRemotePollSession(sessionId, {
          slideId: slide.id,
          poll: slide.poll,
          isOpen: !showResults,
        })
      }
    }
    writeJson(openPollsKey, openPolls)
    void saveRemoteOpenPolls(openPolls, userId)
  }, [openPollsKey, pollSessions, presentation.slides, remotePresentationReady, slide?.id, slide?.poll, slide?.title, showResults, userId])

  const next = () => {
    if (slide?.poll && !showResults) {
      setShowResults(true)
      void readRemoteVotes(userId).then((remoteVotes) => {
        if (remoteVotes) {
          setVotes(remoteVotes)
          writeJson(votesKey, remoteVotes)
        }
      })
      return
    }
    setShowResults(false)
    setIndex((value) => Math.min(value + 1, presentation.slides.length - 1))
  }

  const previous = () => {
    setShowResults(false)
    setIndex((value) => Math.max(value - 1, 0))
  }

  const onTouchStart = (event: TouchEvent<HTMLElement>) => {
    const touch = event.changedTouches[0]
    if (!touch) return
    touchStartRef.current = { x: touch.clientX, y: touch.clientY }
  }

  const onTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const start = touchStartRef.current
    const touch = event.changedTouches[0]
    touchStartRef.current = null
    if (!start || !touch) return
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (Math.abs(deltaX) < 45 || Math.abs(deltaX) < Math.abs(deltaY) * 1.3) return
    if (deltaX < 0) next()
    else previous()
  }

  const toggleMusic = () => {
    const player = audioRef.current
    if (!player || !audio) return
    if (musicPlaying) {
      player.pause()
      player.currentTime = 0
      setMusicPlaying(false)
      return
    }
    player.currentTime = 0
    void player.play().then(() => setMusicPlaying(true)).catch(() => setMusicPlaying(false))
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(event.key)) {
        event.preventDefault()
        next()
      }
      if (['ArrowLeft', 'PageUp', 'Backspace'].includes(event.key)) {
        event.preventDefault()
        previous()
      }
      if (['b', 'B', '.', 'MediaPlayPause'].includes(event.key)) {
        event.preventDefault()
        toggleMusic()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!remotePresentationReady) {
    return (
      <main className="presenter-screen">
        <section className="presenter-message">
          <h1>Загрузка презентации</h1>
          <p>Получаем опубликованную версию из базы.</p>
        </section>
      </main>
    )
  }

  if (remotePresentationError) {
    return (
      <main className="presenter-screen">
        <section className="presenter-message">
          <h1>Не удалось загрузить презентацию</h1>
          <p>Проверьте подключение и правила Realtime Database.</p>
        </section>
      </main>
    )
  }

  if (!slide) return null

  return (
    <main className="presenter-screen" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <SlideCanvas
        key={`${slide.id}-${showResults}`}
        slide={slide}
        mode={showResults ? 'results' : 'present'}
        votes={votes[slide.id] ?? {}}
        pollSession={pollSessions[slide.id]}
        userId={userId}
      />
      <div className="presenter-controls compact">
        <span>{index + 1}</span>
      </div>
      {audio && <audio ref={audioRef} src={audio.data} onEnded={() => setMusicPlaying(false)} />}
    </main>
  )
}

function SlideCanvas({
  slide,
  mode,
  votes,
  pollSession,
  userId = DEFAULT_USER_ID,
}: {
  slide: Slide
  mode: 'edit' | 'present' | 'results'
  votes: Record<string, number>
  pollSession?: string
  userId?: string
}) {
  const sortedOptions = useMemo(() => {
    if (!slide.poll) return []
    const options = [...slide.poll.options]
    if (mode === 'results') options.sort((a, b) => (votes[b.id] ?? 0) - (votes[a.id] ?? 0))
    return options
  }, [mode, slide.poll, votes])

  const total = Object.values(votes).reduce((sum, count) => sum + count, 0)

  return (
    <div className={`slide-canvas transition-${slide.transition} mode-${mode} ${slide.poll?.theme === 'dark' ? 'poll-dark' : ''}`}>
      {slide.image ? <img className="slide-bg" src={slide.image} alt="" /> : <div className="slide-bg placeholder-bg" />}
      {Boolean(slide.imageTone) && (
        <div
          className="image-tone"
          style={{
            background: (slide.imageTone ?? 0) > 0 ? '#ffffff' : '#000000',
            opacity: Math.abs(slide.imageTone ?? 0) / 100,
          }}
        />
      )}
      {slide.poll && (
        <>
          <div
            className="question-block"
            style={{
              left: `${slide.poll.questionX}%`,
              top: `${slide.poll.questionY}%`,
              '--question-scale': slide.poll.questionScale / 100,
            } as CSSProperties}
          >
            {slide.poll.question}
          </div>
          <div
            className="answers-block"
            style={{
              left: `${slide.poll.optionsX}%`,
              top: `${slide.poll.optionsY}%`,
              '--option-scale': slide.poll.optionScale / 100,
            } as CSSProperties}
          >
            {sortedOptions.map((option) => {
              const count = votes[option.id] ?? 0
              const percent = total ? Math.round((count / total) * 100) : 0
              const correct = slide.poll ? getCorrectOptionIds(slide.poll).includes(option.id) : false
              const originalIndex = slide.poll?.options.findIndex((item) => item.id === option.id) ?? 0
              const sortedIndex = sortedOptions.findIndex((item) => item.id === option.id)
              return (
                <div
                  className={correct && mode === 'results' ? 'answer-row correct' : 'answer-row'}
                  key={option.id}
                  style={
                    {
                      '--result-offset': `${(originalIndex - sortedIndex) * 112}%`,
                      '--result-delay': `${sortedIndex * 70}ms`,
                    } as CSSProperties
                  }
                >
                  <span>{option.text}</span>
                  {mode === 'results' && (
                    <strong>
                      {count} / {percent}%
                    </strong>
                  )}
                </div>
              )
            })}
          </div>
          {mode !== 'results' && (
            <div className="qr-box">
              <QRCodeSVG value={getPollUrl(slide, pollSession, userId)} size={240} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ParticipantView({ slideId }: { slideId: string }) {
  const pollParam = new URLSearchParams(window.location.search).get('poll')
  const userId = new URLSearchParams(window.location.search).get('u') || DEFAULT_USER_ID
  const presentationKey = presentationKeyForUser(userId)
  const votesKey = votesKeyForUser(userId)
  const openPollsKey = openPollsKeyForUser(userId)
  const [presentation, setPresentation] = useState(() => readJson(presentationKey, readJson(PRESENTATION_KEY, starterPresentation())))
  const [openPolls, setOpenPolls] = useState(() => readJson<RemoteOpenPolls>(openPollsKey, {}))
  const [remotePresentationReady, setRemotePresentationReady] = useState(!firebaseEnabled)
  const [remoteOpenPollsReady, setRemoteOpenPollsReady] = useState(!firebaseEnabled)
  const [remotePresentationError, setRemotePresentationError] = useState(false)
  const answerKey = `poll-slide-studio.answer.${userId}.${slideId}.${pollParam ?? 'live'}`
  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem(answerKey))
  const [answerError, setAnswerError] = useState('')
  const [remotePollSession, setRemotePollSession] = useState<RemotePollSession | null>(null)
  const [scanError, setScanError] = useState('')
  const shortPollData = useMemo(() => shortPollDataFromParam(pollParam), [pollParam])
  const pollFromUrl = useMemo(() => {
    const decoded = decodePollUrlData(pollParam)
    return decoded?.s === slideId && decoded.q ? pollFromUrlData(decoded) : undefined
  }, [pollParam, slideId])
  const slide = presentation.slides.find((item) => item.id === slideId)
  const openPoll = openPolls[slideId]
  const openPollPayload = openPoll && typeof openPoll === 'object' ? openPoll : null
  const openPollSlidePoll = openPollPayload?.poll as Poll | undefined
  const sessionPoll = remotePollSession?.slideId === slideId ? (remotePollSession.poll as Poll) : undefined
  const poll = sessionPoll ?? slide?.poll ?? openPollSlidePoll ?? pollFromUrl
  const isOpen = Boolean(
    (remotePollSession?.slideId === slideId && remotePollSession.isOpen) ||
    openPoll === true ||
      (openPollPayload && openPollPayload.isOpen) ||
      pollFromUrl,
  )

  useEffect(() => {
    const sync = () => {
      setPresentation(readJson(presentationKey, starterPresentation()))
      setOpenPolls(readJson(openPollsKey, {}))
    }
    window.addEventListener('storage', sync)
    window.addEventListener('poll-slide-studio-storage', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('poll-slide-studio-storage', sync)
    }
  }, [openPollsKey, presentationKey])

  useEffect(() => {
    if (!shortPollData || shortPollData.s !== slideId) return undefined
    let active = true
    void readRemotePollSession(shortPollData.n).then((session) => {
      if (active) setRemotePollSession(session)
    })
    return () => {
      active = false
    }
  }, [shortPollData, slideId])

  useEffect(() => {
    if (!firebaseEnabled) return undefined
    let active = true
    void readRemotePresentation(userId)
      .then((remotePresentation) => {
        if (!active) return
        if (remotePresentation) {
          setPresentation(remotePresentation as Presentation)
          writeJson(presentationKey, remotePresentation)
        }
        setRemotePresentationReady(true)
      })
      .catch(() => {
        if (!active) return
        setRemotePresentationError(true)
        setRemotePresentationReady(true)
      })
    const unsubscribeOpenPolls = subscribeRemoteOpenPolls(
      (remoteOpenPolls) => {
        setOpenPolls(remoteOpenPolls)
        writeJson(openPollsKey, remoteOpenPolls)
        setRemoteOpenPollsReady(true)
      },
      () => setRemoteOpenPollsReady(true),
      userId,
    )
    return () => {
      active = false
      unsubscribeOpenPolls()
    }
  }, [openPollsKey, presentationKey, userId])

  const startQrScan = async () => {
    setScanError('')
    const detectorConstructor = (window as unknown as { BarcodeDetector?: new (options?: { formats?: string[] }) => { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector
    if (!detectorConstructor || !navigator.mediaDevices?.getUserMedia) {
      setScanError('Браузер не поддерживает сканирование QR-кода с этой страницы. Откройте камеру телефона и наведите ее на следующий QR-код.')
      return
    }
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      const video = document.createElement('video')
      video.srcObject = stream
      video.muted = true
      video.playsInline = true
      await video.play()
      const detector = new detectorConstructor({ formats: ['qr_code'] })
      const startedAt = Date.now()
      const scan = async (): Promise<void> => {
        const codes = await detector.detect(video)
        const code = codes[0]?.rawValue
        if (code) {
          stream?.getTracks().forEach((track) => track.stop())
          window.location.href = code
          return
        }
        if (Date.now() - startedAt > 12000) {
          stream?.getTracks().forEach((track) => track.stop())
          setScanError('QR-код не найден. Попробуйте открыть камеру телефона и отсканировать код обычным способом.')
          return
        }
        window.setTimeout(() => void scan(), 300)
      }
      await scan()
    } catch {
      stream?.getTracks().forEach((track) => track.stop())
      setScanError('Не удалось открыть камеру. Проверьте разрешение браузера на доступ к камере.')
    }
  }

  const answer = async (optionId: string) => {
    if (!poll || selected || !isOpen) return
    const votes = readJson<VoteStore>(votesKey, {})
    votes[slideId] = votes[slideId] ?? {}
    votes[slideId][optionId] = (votes[slideId][optionId] ?? 0) + 1
    writeJson(votesKey, votes)
    localStorage.setItem(answerKey, optionId)
    setSelected(optionId)
    const saved = await incrementRemoteVote(slideId, optionId, userId)
    if (!saved && firebaseEnabled) {
      setAnswerError('Не удалось отправить ответ. Обновите страницу и попробуйте еще раз.')
      return
    }
  }

  if (!pollFromUrl && !remotePollSession && (!remotePresentationReady || !remoteOpenPollsReady)) {
    return (
      <main className="participant-screen">
        <section className="participant-panel">
          <h1>Загрузка опроса</h1>
          <p>Подключаемся к презентации.</p>
        </section>
      </main>
    )
  }

  if (remotePresentationError && !pollFromUrl && !remotePollSession) {
    return (
      <main className="participant-screen">
        <section className="participant-panel">
          <h1>Опрос недоступен</h1>
          <p>Не удалось загрузить опубликованную презентацию.</p>
        </section>
      </main>
    )
  }

  if (!poll) {
    return (
      <main className="participant-screen">
        <section className="participant-panel">
          <h1>Опрос недоступен</h1>
        </section>
      </main>
    )
  }

  const correctAnswers = getCorrectOptionIds(poll)
    .map((id) => poll.options.find((option) => option.id === id)?.text)
    .filter(Boolean)
    .join(', ')

  return (
    <main className="participant-screen">
      <section className="participant-panel">
        {!selected && isOpen ? (
          <>
            <h1>{poll.question}</h1>
            <div className="mobile-options">
              {poll.options.map((option) => (
                <button type="button" key={option.id} onClick={() => void answer(option.id)}>
                  {option.text}
                </button>
              ))}
            </div>
            {answerError && <p className="form-error">{answerError}</p>}
          </>
        ) : selected ? (
          <>
            <h1>Спасибо!</h1>
            {correctAnswers && <p>Правильный ответ: {correctAnswers}</p>}
            <button type="button" onClick={() => void startQrScan()}>
              <QrCode size={18} />
              Сканировать QR-код
            </button>
            {scanError && <p className="form-error">{scanError}</p>}
            {answerError && <p className="form-error">{answerError}</p>}
          </>
        ) : (
          <>
            <h1>Голосование закрыто</h1>
            <p>Спикер еще не открыл этот опрос или уже показал результаты.</p>
          </>
        )}
      </section>
    </main>
  )
}

export default App
