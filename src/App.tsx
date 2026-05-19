import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  Circle,
  Download,
  Eye,
  ImagePlus,
  Lock,
  Plus,
  QrCode,
  RotateCcw,
  Save,
  Trash2,
  Upload,
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

const AUTH_KEY = 'poll-slide-studio.auth'
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

const useStoredPresentation = () => {
  const [presentation, setPresentationState] = useState<Presentation>(() =>
    readJson(PRESENTATION_KEY, starterPresentation()),
  )
  const [history, setHistory] = useState<Presentation[]>([])

  useEffect(() => {
    if (!firebaseEnabled) return undefined
    return subscribeRemotePresentation((remotePresentation) => {
      if (!remotePresentation) return
      const next = remotePresentation as Presentation
      setPresentationState(next)
      writeJson(PRESENTATION_KEY, next)
    })
  }, [])

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
  const [auth, setAuth] = useState<AuthState | null>(() => readJson(AUTH_KEY, null))
  const [session, setSession] = useState(() => localStorage.getItem(SESSION_KEY) === '1')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')

  const submit = () => {
    setError('')
    if (!auth) {
      if (!email || !password || password !== confirm) {
        setError('Проверьте логин и подтверждение пароля.')
        return
      }
      const next = { email, password }
      writeJson(AUTH_KEY, next)
      localStorage.setItem(SESSION_KEY, '1')
      setAuth(next)
      setSession(true)
      return
    }

    if (email === auth.email && password === auth.password) {
      localStorage.setItem(SESSION_KEY, '1')
      setSession(true)
      return
    }
    setError('Неверный логин или пароль.')
  }

  if (session && auth) return <AdminView />

  return (
    <main className="auth-screen">
      <section className="auth-panel">
        <div className="brand-mark">
          <QrCode size={30} />
        </div>
        <h1>Студия интерактивных слайдов</h1>
        <p>{auth ? 'Войдите, чтобы управлять презентацией.' : 'Создайте единственную учетную запись администратора.'}</p>
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
            autoComplete={auth ? 'current-password' : 'new-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="пароль"
          />
        </label>
        {!auth && (
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
          {auth ? 'Войти' : 'Создать аккаунт'}
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

  const addSlide = (withPoll = false) => {
    const slide: Slide = {
      id: createId(),
      title: withPoll ? 'Слайд с опросом' : 'Слайд с изображением',
      transition: 'fade',
      poll: withPoll ? starterPoll() : undefined,
    }
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
        <button className="primary" type="button" onClick={() => addSlide(false)}>
          <Plus size={17} />
          Добавить слайд с изображением
        </button>
        <button className="secondary" type="button" onClick={() => addSlide(true)}>
          <BarChart3 size={17} />
          Добавить слайд с опросом
        </button>
        <div className="slides">
          {presentation.slides.map((slide, index) => (
            <button
              className={slide.id === selected?.id ? 'thumb active' : 'thumb'}
              key={slide.id}
              type="button"
              onClick={() => setSelectedId(slide.id)}
            >
              <span>{index + 1}</span>
              <strong>{slide.title || 'Без названия'}</strong>
              <small>{slide.poll ? 'Опрос' : 'Изображение'}</small>
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
            <button type="button" onClick={() => resetVotes()} title="Обнулить все ответы">
              <Trash2 size={18} />
            </button>
            <button type="button" onClick={exportPresentation} title="Экспорт">
              <Download size={18} />
            </button>
            <button type="button" onClick={() => importInput.current?.click()} title="Импорт">
              <Upload size={18} />
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
                Загрузить изображение 1920x1080
              </button>
              <input hidden ref={fileInput} type="file" accept="image/*" onChange={(event) => onImage(event.target.files?.[0])} />
              <button
                type="button"
                onClick={() =>
                  updateSlide(selected.id, (slide) => ({ ...slide, poll: slide.poll ? undefined : starterPoll() }))
                }
              >
                <BarChart3 size={18} />
                {selected.poll ? 'Удалить опрос' : 'Добавить опрос'}
              </button>
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
  const updateOption = (id: string, text: string) => {
    onChange({ ...poll, options: poll.options.map((option) => (option.id === id ? { ...option, text } : option)) })
  }

  const addOption = () => {
    if (poll.options.length >= 10) return
    onChange({ ...poll, options: [...poll.options, { id: createId(), text: `Вариант ответа ${poll.options.length + 1}` }] })
  }

  const removeOption = (id: string) => {
    if (poll.options.length <= 2) return
    onChange({
      ...poll,
      options: poll.options.filter((option) => option.id !== id),
      correctOptionId: poll.correctOptionId === id ? undefined : poll.correctOptionId,
    })
  }

  return (
    <div className="poll-builder">
      <div className="panel-title">
        <strong>Конструктор опроса</strong>
        <button type="button" onClick={onReset} title="Обнулить ответы этого опроса">
          <RotateCcw size={16} />
        </button>
      </div>
      <label>
        Вопрос
        <textarea value={poll.question} onChange={(event) => onChange({ ...poll, question: event.target.value })} />
      </label>
      <div className="range-grid">
        <label>
          Размер вопроса
          <input
            type="range"
            min="70"
            max="150"
            value={poll.questionScale}
            onChange={(event) => onChange({ ...poll, questionScale: Number(event.target.value) })}
          />
        </label>
        <label>
          Размер ответов
          <input
            type="range"
            min="70"
            max="150"
            value={poll.optionScale}
            onChange={(event) => onChange({ ...poll, optionScale: Number(event.target.value) })}
          />
        </label>
        <label>
          Вопрос по X
          <input type="range" min="0" max="55" value={poll.questionX} onChange={(event) => onChange({ ...poll, questionX: Number(event.target.value) })} />
        </label>
        <label>
          Вопрос по Y
          <input type="range" min="0" max="70" value={poll.questionY} onChange={(event) => onChange({ ...poll, questionY: Number(event.target.value) })} />
        </label>
        <label>
          Ответы по X
          <input type="range" min="0" max="55" value={poll.optionsX} onChange={(event) => onChange({ ...poll, optionsX: Number(event.target.value) })} />
        </label>
        <label>
          Ответы по Y
          <input type="range" min="15" max="80" value={poll.optionsY} onChange={(event) => onChange({ ...poll, optionsY: Number(event.target.value) })} />
        </label>
      </div>
      <div className="option-list">
        {poll.options.map((option) => (
          <div className="option-edit" key={option.id}>
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
    const openPolls = readJson<Record<string, boolean>>(OPEN_POLLS_KEY, {})
    Object.keys(openPolls).forEach((key) => {
      openPolls[key] = false
    })
    if (slide?.poll && !showResults) openPolls[slide.id] = true
    writeJson(OPEN_POLLS_KEY, openPolls)
    void saveRemoteOpenPolls(openPolls)
  }, [slide?.id, slide?.poll, showResults])

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
      {!slide.poll && (
        <div className="slide-empty">
          <strong>{slide.title}</strong>
        </div>
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
              <QRCodeSVG value={getPollUrl(slide.id)} size={128} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ParticipantView({ slideId }: { slideId: string }) {
  const [presentation, setPresentation] = useState(() => readJson(PRESENTATION_KEY, starterPresentation()))
  const [openPolls, setOpenPolls] = useState(() => readJson<Record<string, boolean>>(OPEN_POLLS_KEY, {}))
  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem(`poll-slide-studio.answer.${slideId}`))
  const slide = presentation.slides.find((item) => item.id === slideId)
  const poll = slide?.poll
  const isOpen = Boolean(openPolls[slideId])

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
    })
    const unsubscribeOpenPolls = subscribeRemoteOpenPolls((remoteOpenPolls) => {
      setOpenPolls(remoteOpenPolls)
      writeJson(OPEN_POLLS_KEY, remoteOpenPolls)
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
