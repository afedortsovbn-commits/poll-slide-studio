import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Circle,
  Download,
  Eye,
  GripVertical,
  ImagePlus,
  Lock,
  Plus,
  QrCode,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  UserPlus,
} from 'lucide-react'
import {
  firebaseEnabled,
  incrementRemoteVote,
  resetRemoteVotes,
  saveRemoteOpenPolls,
  saveRemotePresentation,
  subscribeRemoteOpenPolls,
  subscribeRemotePresentation,
  subscribeRemoteVotes,
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
  transition: Transition
  poll?: Poll
}

type Presentation = {
  title: string
  slides: Slide[]
}

type VoteStore = Record<string, Record<string, number>>

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
const VOTES_KEY = 'poll-slide-studio.votes'
const OPEN_POLLS_KEY = 'poll-slide-studio.open-polls'
const SAMPLE_POLL_SLIDE_ID = 'sample-poll-slide'

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
  localStorage.setItem(key, JSON.stringify(value))
  window.dispatchEvent(new Event('poll-slide-studio-storage'))
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

const useStoredPresentation = () => {
  const [presentation, setPresentationState] = useState<Presentation>(() =>
    readJson(PRESENTATION_KEY, starterPresentation()),
  )
  const [history, setHistory] = useState<Presentation[]>([])

  const setPresentation = (next: Presentation) => {
    setHistory((items) => [presentation, ...items].slice(0, 3))
    setPresentationState(next)
    writeJson(PRESENTATION_KEY, next)
    void saveRemotePresentation(next)
  }

  const undo = () => {
    const [previous, ...rest] = history
    if (!previous) return
    setHistory(rest)
    setPresentationState(previous)
    writeJson(PRESENTATION_KEY, previous)
    void saveRemotePresentation(previous)
  }

  return { presentation, setPresentation, undo, canUndo: history.length > 0 }
}

const getPollUrl = (slideId: string) => {
  const url = new URL(window.location.href)
  url.hash = `poll/${slideId}`
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

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash.replace(/^#\/?/, '') || 'admin')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (route.startsWith('poll/')) {
    return <ParticipantView slideId={route.split('/')[1]} />
  }

  if (route === 'present') {
    return <SpeakerView />
  }

  return <AdminGate />
}

function AdminGate() {
  const [authStore, setAuthStore] = useState<AuthStore>(() => readAuthStore())
  const [session, setSession] = useState(() => localStorage.getItem(SESSION_KEY) === '1')
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
      localStorage.setItem(SESSION_KEY, '1')
      setAuthStore(nextStore)
      setSession(true)
      return
    }

    if (authStore.users.some((user) => user.email === email && user.password === password)) {
      localStorage.setItem(SESSION_KEY, '1')
      setSession(true)
      return
    }
    setError('Неверный логин или пароль.')
  }

  if (session && hasUsers) return <AdminView />

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

function AdminView() {
  const {
    presentation: savedPresentation,
    setPresentation: savePresentation,
    undo,
    canUndo,
  } = useStoredPresentation()
  const [presentation, setPresentation] = useState(savedPresentation)
  const [presentationBase, setPresentationBase] = useState(savedPresentation)
  const [selectedId, setSelectedId] = useState(presentation.slides[0]?.id)
  const [draggedSlideId, setDraggedSlideId] = useState<string | null>(null)
  const selected = presentation.slides.find((slide) => slide.id === selectedId) ?? presentation.slides[0]
  const fileInput = useRef<HTMLInputElement>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const isDirty = JSON.stringify(presentation) !== JSON.stringify(savedPresentation)

  if (presentationBase !== savedPresentation) {
    setPresentationBase(savedPresentation)
    setPresentation(savedPresentation)
  }

  const updateSlide = (slideId: string, updater: (slide: Slide) => Slide) => {
    setPresentation({
      ...presentation,
      slides: presentation.slides.map((slide) => (slide.id === slideId ? updater(slide) : slide)),
    })
  }

  const addSlide = () => {
    const slide = createSlide()
    setPresentation({ ...presentation, slides: [...presentation.slides, slide] })
    setSelectedId(slide.id)
  }

  const deleteSlide = (slideId: string) => {
    const slides = presentation.slides.filter((slide) => slide.id !== slideId)
    if (!slides.length) return
    setPresentation({ ...presentation, slides })
    setSelectedId(slides[0].id)
  }

  const onImage = (file?: File) => {
    if (!file || !selected) return
    const reader = new FileReader()
    reader.onload = () => {
      updateSlide(selected.id, (slide) => ({ ...slide, image: String(reader.result) }))
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
    const votes = readJson<VoteStore>(VOTES_KEY, {})
    if (slideId) delete votes[slideId]
    else Object.keys(votes).forEach((key) => delete votes[key])
    writeJson(VOTES_KEY, votes)
    void resetRemoteVotes(slideId)
  }

  const exportPresentation = () => {
    const blob = new Blob([JSON.stringify(presentation, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'poll-slide-studio.json'
    link.click()
    URL.revokeObjectURL(link.href)
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
        <div className="slides">
          {presentation.slides.map((slide, index) => (
            <button
              className={slide.id === selected?.id ? 'thumb active' : 'thumb'}
              key={slide.id}
              type="button"
              draggable
              onDragStart={() => setDraggedSlideId(slide.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => reorderSlide(slide.id)}
              onDragEnd={() => setDraggedSlideId(null)}
              onClick={() => setSelectedId(slide.id)}
            >
              <GripVertical className="drag-marker" size={16} />
              <span>{index + 1}</span>
              <strong>{slide.title || 'Без названия'}</strong>
              <small>{slide.poll ? 'Опрос включен' : 'Без опроса'}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="editor">
        <header className="toolbar">
          <input
            className="title-input"
            name="presentation-title"
            autoComplete="off"
            value={presentation.title}
            onChange={(event) => setPresentation({ ...presentation, title: event.target.value })}
          />
          <div className="toolbar-actions">
            <button type="button" onClick={undo} disabled={!canUndo} title="Отменить">
              <RotateCcw size={18} />
            </button>
            <button
              className={isDirty ? 'primary small-primary' : ''}
              type="button"
              onClick={() => savePresentation(presentation)}
              disabled={!isDirty}
              title="Сохранить"
            >
              <Save size={18} />
            </button>
            <button className="reset-action" type="button" onClick={() => resetVotes()} title="Обнулить все ответы">
              <RotateCcw size={18} />
            </button>
            <button type="button" onClick={exportPresentation} title="Экспорт">
              <Upload size={18} />
            </button>
            <button type="button" onClick={() => importInput.current?.click()} title="Импорт">
              <Download size={18} />
            </button>
            <a className="button-link" href="#present">
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
        </header>

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
              <label className="checkbox-row">
                <input type="checkbox" checked={Boolean(selected.poll)} onChange={(event) => togglePoll(event.target.checked)} />
                Опрос
              </label>
              <button type="button" onClick={() => deleteSlide(selected.id)} disabled={presentation.slides.length < 2}>
                <Trash2 size={18} />
                Удалить слайд
              </button>
              {selected.poll && (
                <PollBuilder poll={selected.poll} onChange={updatePoll} onReset={() => resetVotes(selected.id)} />
              )}
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
              className={poll.correctOptionId === option.id ? 'icon-on' : ''}
              onClick={() => onChange({ ...poll, correctOptionId: poll.correctOptionId === option.id ? undefined : option.id })}
              title="Правильный ответ"
            >
              {poll.correctOptionId === option.id ? <Check size={16} /> : <Circle size={16} />}
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
    </div>
  )
}

function SpeakerView() {
  const [presentation, setPresentation] = useState(() => readJson(PRESENTATION_KEY, starterPresentation()))
  const [votes, setVotes] = useState(() => readJson<VoteStore>(VOTES_KEY, {}))
  const [remotePresentationReady, setRemotePresentationReady] = useState(!firebaseEnabled)
  const [index, setIndex] = useState(0)
  const [showResults, setShowResults] = useState(false)
  const slide = presentation.slides[index]

  useEffect(() => {
    const sync = () => {
      setPresentation(readJson(PRESENTATION_KEY, starterPresentation()))
      setVotes(readJson(VOTES_KEY, {}))
    }
    window.addEventListener('storage', sync)
    window.addEventListener('poll-slide-studio-storage', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('poll-slide-studio-storage', sync)
    }
  }, [])

  useEffect(() => {
    if (!firebaseEnabled) return undefined
    const unsubscribePresentation = subscribeRemotePresentation((remotePresentation) => {
      if (remotePresentation) setPresentation(remotePresentation as Presentation)
      setRemotePresentationReady(true)
    })
    const unsubscribeVotes = subscribeRemoteVotes((remoteVotes) => {
      setVotes(remoteVotes)
      writeJson(VOTES_KEY, remoteVotes)
    })
    return () => {
      unsubscribePresentation()
      unsubscribeVotes()
    }
  }, [])

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
    }
    writeJson(OPEN_POLLS_KEY, openPolls)
    void saveRemoteOpenPolls(openPolls)
  }, [presentation.slides, remotePresentationReady, slide?.id, slide?.poll, slide?.title, showResults])

  const next = () => {
    if (slide?.poll && !showResults) {
      setShowResults(true)
      return
    }
    setShowResults(false)
    setIndex((value) => Math.min(value + 1, presentation.slides.length - 1))
  }

  const previous = () => {
    setShowResults(false)
    setIndex((value) => Math.max(value - 1, 0))
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
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!slide) return null

  return (
    <main className="presenter-screen">
      <SlideCanvas key={`${slide.id}-${showResults}`} slide={slide} mode={showResults ? 'results' : 'present'} votes={votes[slide.id] ?? {}} />
      <div className="presenter-controls">
        <button type="button" onClick={previous}>
          <ArrowLeft size={20} />
        </button>
        <span>
          {index + 1} / {presentation.slides.length}
        </span>
        <button type="button" onClick={next}>
          <ArrowRight size={20} />
        </button>
      </div>
    </main>
  )
}

function SlideCanvas({ slide, mode, votes }: { slide: Slide; mode: 'edit' | 'present' | 'results'; votes: Record<string, number> }) {
  const sortedOptions = useMemo(() => {
    if (!slide.poll) return []
    const options = [...slide.poll.options]
    if (mode === 'results') options.sort((a, b) => (votes[b.id] ?? 0) - (votes[a.id] ?? 0))
    return options
  }, [mode, slide.poll, votes])

  const total = Object.values(votes).reduce((sum, count) => sum + count, 0)

  return (
    <div className={`slide-canvas transition-${slide.transition}`}>
      {slide.image ? <img className="slide-bg" src={slide.image} alt="" /> : <div className="slide-bg placeholder-bg" />}
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
              const correct = slide.poll?.correctOptionId === option.id
              return (
                <div className={correct && mode === 'results' ? 'answer-row correct' : 'answer-row'} key={option.id}>
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
              <QRCodeSVG value={getPollUrl(slide.id)} size={168} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ParticipantView({ slideId }: { slideId: string }) {
  const [presentation, setPresentation] = useState(() => readJson(PRESENTATION_KEY, starterPresentation()))
  const [openPolls, setOpenPolls] = useState(() => readJson<RemoteOpenPolls>(OPEN_POLLS_KEY, {}))
  const [remotePresentationReady, setRemotePresentationReady] = useState(!firebaseEnabled)
  const [remoteOpenPollsReady, setRemoteOpenPollsReady] = useState(!firebaseEnabled)
  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem(`poll-slide-studio.answer.${slideId}`))
  const slide = presentation.slides.find((item) => item.id === slideId)
  const openPoll = openPolls[slideId]
  const openPollPayload = openPoll && typeof openPoll === 'object' ? openPoll : null
  const openPollSlidePoll = openPollPayload?.poll as Poll | undefined
  const poll = slide?.poll ?? openPollSlidePoll
  const isOpen = Boolean(
    openPoll === true ||
      (openPollPayload && openPollPayload.isOpen),
  )

  useEffect(() => {
    const sync = () => {
      setPresentation(readJson(PRESENTATION_KEY, starterPresentation()))
      setOpenPolls(readJson(OPEN_POLLS_KEY, {}))
    }
    window.addEventListener('storage', sync)
    window.addEventListener('poll-slide-studio-storage', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('poll-slide-studio-storage', sync)
    }
  }, [])

  useEffect(() => {
    if (!firebaseEnabled) return undefined
    const unsubscribePresentation = subscribeRemotePresentation((remotePresentation) => {
      if (remotePresentation) setPresentation(remotePresentation as Presentation)
      setRemotePresentationReady(true)
    })
    const unsubscribeOpenPolls = subscribeRemoteOpenPolls((remoteOpenPolls) => {
      setOpenPolls(remoteOpenPolls)
      writeJson(OPEN_POLLS_KEY, remoteOpenPolls)
      setRemoteOpenPollsReady(true)
    })
    return () => {
      unsubscribePresentation()
      unsubscribeOpenPolls()
    }
  }, [])

  const answer = (optionId: string) => {
    if (!poll || selected || !isOpen) return
    const votes = readJson<VoteStore>(VOTES_KEY, {})
    votes[slideId] = votes[slideId] ?? {}
    votes[slideId][optionId] = (votes[slideId][optionId] ?? 0) + 1
    writeJson(VOTES_KEY, votes)
    void incrementRemoteVote(slideId, optionId)
    localStorage.setItem(`poll-slide-studio.answer.${slideId}`, optionId)
    setSelected(optionId)
  }

  if (!remotePresentationReady || !remoteOpenPollsReady) {
    return (
      <main className="participant-screen">
        <section className="participant-panel">
          <h1>Загрузка опроса</h1>
          <p>Подключаемся к презентации.</p>
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

  const correct = poll.correctOptionId ? poll.options.find((option) => option.id === poll.correctOptionId)?.text : ''

  return (
    <main className="participant-screen">
      <section className="participant-panel">
        {!selected && isOpen ? (
          <>
            <h1>{poll.question}</h1>
            <div className="mobile-options">
              {poll.options.map((option) => (
                <button type="button" key={option.id} onClick={() => answer(option.id)}>
                  {option.text}
                </button>
              ))}
            </div>
          </>
        ) : selected ? (
          <>
            <h1>Спасибо!</h1>
            {correct && <p>Правильный ответ: {correct}</p>}
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
