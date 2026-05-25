import { Link } from 'react-router-dom'

const CARDS = [
  { top: '8%', left: '4%', rotate: '-6deg', delay: '0s' },
  { top: '12%', right: '3%', rotate: '5deg', delay: '1.5s' },
  { top: '52%', left: '2%', rotate: '4deg', delay: '3s' },
  { top: '55%', right: '4%', rotate: '-7deg', delay: '2s' },
]

const STEPS = [
  {
    num: 'Step 01',
    title: 'Deploy the tracker',
    desc: 'Add one script tag to your site. CipherCorgi starts recording real user sessions and routing AI agents immediately.',
    img: 'https://stories.freepiklabs.com/storage/6208/Mobile-testing_Mesa-de-trabajo-1.svg',
  },
  {
    num: 'Step 02',
    title: 'AI agents explore your UI',
    desc: 'Autonomous agents attempt your defined tasks, navigating your site exactly as a user would — and reporting every friction point.',
    img: 'https://stories.freepiklabs.com/storage/1932/3-Artificial-intelligence_Mesa-de-trabajo-1.svg',
  },
  {
    num: 'Step 03',
    title: 'Get actionable insights',
    desc: 'One unified dashboard shows flow diagrams, task completion rates, and AI-generated recommendations.',
    img: 'https://stories.freepiklabs.com/storage/35730/Business-Analytics-(2)-amico_Mesa-de-trabajo-1.svg',
  },
]

const AI_BULLETS = [
  {
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg>,
    title: 'Autonomous navigation', desc: 'The agent browses your site step by step, attempting real tasks without any scripting.',
  },
  {
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>,
    title: 'Instant & repeatable', desc: 'Run hundreds of test sessions in minutes. Re-run after every deploy automatically.',
  },
  {
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
    title: 'Structured reports', desc: 'Every run produces a click-by-click trace, success/failure verdict, and friction annotations.',
  },
]

const USER_BULLETS = [
  {
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>,
    title: 'Session recordings', desc: "Full replays of every tester's journey — mouse movements, clicks, scrolls, and hesitations.",
  },
  {
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
    title: 'Task completion tracking', desc: 'Measure whether real users actually finish each task and where they give up.',
  },
  {
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
    title: 'In-context feedback', desc: 'Testers rate difficulty and leave comments at the moment of experience, not after the fact.',
  },
]

const COMPARE_ROWS = [
  { label: 'Speed', ai: 'Seconds per run', human: 'Hours to recruit & run' },
  { label: 'Scale', ai: 'Unlimited parallel runs', human: 'Handful of testers' },
  { label: 'Consistency', ai: 'Identical each time', human: 'Varies by tester' },
  { label: 'Empathy & nuance', ai: 'Limited', human: 'Rich emotional signal' },
  { label: 'Edge case discovery', ai: 'Systematic', human: 'Serendipitous' },
  { label: 'Cost', ai: 'Near zero per run', human: 'Incentives + time' },
]

function MockCard({ style }: { style: React.CSSProperties }) {
  return (
    <div className="landing-card" style={style}>
      <div className="landing-card-chrome">
        <div className="landing-card-dot" />
        <div className="landing-card-dot" />
        <div className="landing-card-dot" />
        <div className="landing-card-bar" />
      </div>
      <div className="landing-card-body">
        <div className="landing-card-nav" />
        <div className="landing-card-hero" />
        <div className="landing-card-text" />
        <div className="landing-card-text short" />
        <div className="landing-card-btn-mock" />
      </div>
    </div>
  )
}

export default function LandingPage() {
  return (
    <div className="landing-page">
      {CARDS.map((c, i) => (
        <MockCard
          key={i}
          style={{
            top: c.top,
            left: c.left,
            right: (c as any).right,
            '--rotate': c.rotate,
            animationDelay: c.delay,
          } as React.CSSProperties}
        />
      ))}

      {/* Hero */}
      <div className="landing-center">
        <span className="landing-eyebrow">AI-powered UX research</span>
        <h1 className="landing-headline">
          Test your UI —<br />with AI and real users.
        </h1>
        <p className="landing-sub">
          CipherCorgi runs AI agents and records human testers on your website.<br />
          One dashboard, all the insights.
        </p>
        <Link to="/login" className="landing-cta">Get started</Link>
        <p className="landing-signin">
          Already have an account?{' '}
          <Link to="/login" className="landing-signin-link">Sign in</Link>
        </p>
      </div>

      {/* How it works */}
      <section className="landing-how">
        <div className="landing-how-inner">
          <div className="landing-how-label">How it works</div>
          <h2 className="landing-how-title">Three steps to better UX</h2>
          <div className="landing-steps">
            {STEPS.map((s) => (
              <div key={s.num} className="landing-step">
                <span className="landing-step-num">{s.num}</span>
                <img className="landing-step-illustration landing-illus" src={s.img} alt={s.title} loading="lazy" />
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Deep-dive dark section */}
      <section className="landing-deep">
        <div className="landing-deep-inner">

          {/* AI agent */}
          <div className="landing-deep-row">
            <div className="landing-deep-text">
              <div className="landing-deep-label">Explain & Improve</div>
              <h2 className="landing-deep-title">Understand AI agents and optimize for everyone</h2>
              <p className="landing-deep-intro">
                CipherCorgi helps you understand what on your website works well and where you can improve — for humans and machines alike. We collect and compare real user journeys and AI agent journeys to surface the best insights, visualized interactively in one dashboard.
              </p>

            </div>
                      <img
            className="login-illustration"
            src="https://stories.freepiklabs.com/storage/6220/Usability-Testing_Mesa-de-trabajo-1.svg"
            alt="Usability testing illustration"
            loading="eager"
          />
          </div>

        </div>
      </section>

      <p className="landing-attribution">
        Illustrations by <a href="https://storyset.com" target="_blank" rel="noopener">Storyset</a>
      </p>
    </div>
  )
}
