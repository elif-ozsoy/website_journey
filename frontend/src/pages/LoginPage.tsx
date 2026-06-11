import { storageKeys } from '../lib/storage'
import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import * as api from '../lib/api'
import HowItWorksDiagram from '../components/HowItWorksDiagram'
import '../index.css' 

export const USER_STORAGE_KEY = storageKeys.user

export interface AppUser { name: string; email: string; id: string }

export function getUser(): AppUser | null {
  try {
    const u = JSON.parse(localStorage.getItem(USER_STORAGE_KEY) ?? 'null')
    return u?.id ? u : null
  } catch { return null }
}
export function saveUser(u: AppUser) { localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(u)) }
export function clearUser() {
  localStorage.removeItem(USER_STORAGE_KEY)
  localStorage.removeItem(storageKeys.token)
}

export default function LoginPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email.trim()) { setError('Please fill in both fields.'); return }
    if (!email.includes('@')) { setError('Enter a valid email address.'); return }
    setLoading(true)
    setError('')
    try {
      const resp = await api.identify(name.trim(), email.trim())
      localStorage.setItem(storageKeys.token, resp.access_token)
      saveUser({ name: name.trim(), email: email.trim(), id: resp.user.id })
      navigate('/home')
    } catch {
      setError('Could not connect. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-left">
        <div className="login-left-inner">
          <div className="login-logo">CipherCorgi</div>
          <h1 className="login-headline">
            UX research,<br />
            <span className="login-headline-accent">supercharged by AI.</span>
          </h1>
          {/* <p className="login-tagline">
            Deploy web agents and real testers side-by-side. Capture journeys,
            compare behaviour, and get actionable feedback — all in one platform.
          </p> */}
          <HowItWorksDiagram />
        </div>
      </div>

      <div className="login-right">
        <div className="login-form-wrap">
          <h2 className="login-form-title">Get started</h2>
          {/* <p className="login-form-sub">
            Enter your details to continue. No password needed.
          </p> */}

          <form onSubmit={handleSubmit} className="login-form">
            <div className="login-field">
              <label className="login-label">Name</label>
              <input
                className="login-input"
                placeholder="Jane Smith"
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="login-field">
              <label className="login-label">Email</label>
              <input
                className="login-input"
                type="email"
                placeholder="jane@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            {error && <p className="login-error">{error}</p>}
            <button className="login-submit" type="submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Continue'}
              <span className="login-submit-arrow">→</span>
            </button>
          </form>

          
        </div>
      </div>
    </div>
  )
}<p className="login-disclaimer">
            We'll create a free account using your email so your projects are saved.
          </p>