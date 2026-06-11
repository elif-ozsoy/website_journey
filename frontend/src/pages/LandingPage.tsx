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
