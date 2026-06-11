import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as api from '../lib/api'
import type { Project } from '../lib/types'
import { PROJECTS_STORAGE_KEY } from '../lib/types'

const WEBSITE_TYPES = [
  'E-commerce', 'SaaS / Web app', 'Marketing site', 'Portfolio',
  'News / Blog', 'Local business', 'Non-profit', 'Other',
]

export default function NewProjectPage() {
  const navigate = useNavigate()
  const [projectName, setProjectName] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [websiteType, setWebsiteType] = useState('')
  // const [goals, setGoals] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const canSubmit = projectName.trim().length > 0 && websiteUrl.trim().length > 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setLoading(true)
    setError('')
    try {
      const result = await api.createProject(websiteUrl.trim(), projectName.trim())
      const project: Project = {
        siteId: result.site_id,
        label: projectName.trim(),
        url: websiteUrl.trim(),
        testerLink: result.tester_link,
        createdAt: new Date().toISOString(),
        websiteType: websiteType || undefined,
        // goals: goals.trim() || undefined,
      }
      const existing: Project[] = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY) ?? '[]')
      localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify([...existing, project]))
      navigate(`/projects/${result.site_id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="np-page fade-in">
      <div className="np-content">
        <button className="np-back" onClick={() => navigate(-1)}>
          <span className="np-back-arrow">←</span>
          Back
        </button>

        <div className="np-header">
          <div className="np-eyebrow">New project</div>
          <h1 className="np-title">Set up a new website to test</h1>
          <p className="np-description">
            Give your project a name and the URL you want to test.
            You can add more context now or fill it in later.
          </p>
        </div>

        <div className="np-layout">
          {/* Left column: form */}
          <form id="np-form" className="np-form" onSubmit={handleSubmit}>
            <div className="np-field">
              <label className="np-label" htmlFor="np-name">
                Project name
                <span className="np-required">*</span>
              </label>
              <input
                id="np-name"
                className="np-input"
                placeholder="e.g. Acme Construction site"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                autoFocus
                required
              />
              <div className="np-field-hint">
                Just for you — to identify the project in your dashboard.
              </div>
            </div>

            <div className="np-field">
              <label className="np-label" htmlFor="np-url">
                Website URL
                <span className="np-required">*</span>
              </label>
              <input
                id="np-url"
                className="np-input"
                placeholder="https://example.com"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                type="url"
                required
              />
              <div className="np-field-hint">
                The page where users will start the task.
              </div>
            </div>

            {/* Collapsible advanced section */}
            <button
              type="button"
              className="np-toggle"
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
            >
              <span className={`np-toggle-icon ${showAdvanced ? 'open' : ''}`}>›</span>
              {showAdvanced ? 'Hide' : 'Add'} more details
              <span className="np-toggle-hint">(optional, but helps AI agents)</span>
            </button>

            {showAdvanced && (
              <div className="np-advanced">
                <div className="np-field">
                  <label className="np-label">Website type</label>
                  <div className="np-chips">
                    {WEBSITE_TYPES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`np-chip ${websiteType === t ? 'is-active' : ''}`}
                        onClick={() => setWebsiteType((prev) => (prev === t ? '' : t))}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Goals & context field removed
                <div className="np-field">
                  <label className="np-label" htmlFor="np-goals">
                    Goals & context
                  </label>
                  <textarea
                    id="np-goals"
                    className="np-input np-textarea"
                    placeholder="e.g. This is the website for my local construction company. I want visitors to find our services and request a quote quickly."
                    value={goals}
                    onChange={(e) => setGoals(e.target.value)}
                    rows={4}
                  />
                  <div className="np-field-hint">
                    Describing your audience and goals helps AI agents act realistically.
                  </div>
                </div>
                */}
              </div>
            )}

            {error && <div className="np-error">{error}</div>}
          </form>

          {/* Right column: help + actions */}
          <aside className="np-sidebar">
            <div className="np-card">
              <h3 className="np-card-title">What happens next</h3>
              <ol className="np-steps">
                <li>
                  <span className="np-step-num">1</span>
                  <div>
                    <strong>Define a task</strong>
                    <p>Write what users should do (e.g. "find a vegetarian recipe under 30 minutes").</p>
                  </div>
                </li>
                <li>
                  <span className="np-step-num">2</span>
                  <div>
                    <strong>Share or run agents</strong>
                    <p>Send a tester link to real users, or configure AI agents.</p>
                  </div>
                </li>
                <li>
                  <span className="np-step-num">3</span>
                  <div>
                    <strong>Compare results</strong>
                    <p>Review journeys side-by-side with clickmaps and reasoning.</p>
                  </div>
                </li>
              </ol>
            </div>

            <div className="np-actions" style={{ borderTop: 'none', paddingTop: 0, marginTop: 0 }}>
              <button
                type="button"
                className="np-btn np-btn-ghost"
                onClick={() => navigate(-1)}
              >
                Cancel
              </button>
              <button
                type="submit"
                form="np-form"
                className="np-btn np-btn-primary"
                disabled={loading || !canSubmit}
              >
                {loading ? 'Creating…' : 'Create project'}
                <span className="np-btn-arrow">→</span>
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

