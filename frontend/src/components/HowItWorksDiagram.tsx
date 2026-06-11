import { useEffect, useRef } from 'react'

export default function HowItWorksDiagram() {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
  const svg = svgRef.current
  if (!svg) return

  const groups = svg.querySelectorAll<SVGGElement>('[data-reveal]')
  const step04 = svg.querySelector<SVGGElement>('#step-04')
  const feedbackArrow = svg.querySelector<SVGGElement>('#feedback-arrow')

  // groups already in the viewport on mount, we display them smoothly with staggered timing 
  const viewportHeight = window.innerHeight
  const initiallyVisible: SVGGElement[] = []
  const initiallyHidden: SVGGElement[] = []

  groups.forEach((g) => {
    const rect = g.getBoundingClientRect()
    // visible if any part of the group is in the viewport
    const isInView = rect.top < viewportHeight && rect.bottom > 0
    if (isInView) {
      initiallyVisible.push(g)
    } else {
      initiallyHidden.push(g)
    }
  })

  // auto-play the visible groups with a 500ms stagger
  initiallyVisible.forEach((g, i) => {
    setTimeout(() => g.classList.add('is-visible'), 200 + i * 500)
  })

  // groups that aren't yet visible reveal on scroll
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          if (entry.target.id === 'step-04' && feedbackArrow) {
            setTimeout(() => feedbackArrow.classList.add('is-visible'), 400)
          }
          observer.unobserve(entry.target)
        }
      })
    },
    { threshold: 0.2, rootMargin: '0px 0px -10% 0px' },
  )

  initiallyHidden.forEach((g) => observer.observe(g))

  // step 4 and feedback loop
  if (step04 && initiallyVisible.includes(step04) && feedbackArrow) {
    const step04Index = initiallyVisible.indexOf(step04)
    setTimeout(() => feedbackArrow.classList.add('is-visible'), 200 + step04Index * 500 + 700)
  }

  return () => observer.disconnect()
}, [])
  return (
    <svg
      ref={svgRef}
      className="login-illustration"
      viewBox="0 0 720 940"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="How CipherCorgi works"
      style={{ maxHeight: '69vh', width: 'auto', maxWidth: '100%', display: 'block', margin: '0 auto' }}
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
        <style>{`
          .arr-blue { stroke: #5A9BDC; stroke-width: 2.5; fill: none; }
          .step-blue rect { fill: #FFFFFF; stroke: #85B7EB; stroke-width: 1.5; }
          .step-orange rect { fill: #FFFFFF; stroke: #F0997B; stroke-width: 1.5; }
          .badge-blue { fill: #185FA5; }
          .badge-orange { fill: #D85A30; }
          .badge-text { fill: #FFFFFF; font-size: 20px; font-weight: 600; }
          .hub-circle { fill: #185FA5; }
          .hub-text { fill: #FFFFFF; font-size: 18px; font-weight: 600; }

          .step-content {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 12px 16px;
            box-sizing: border-box;
            font-size: 19px;
            line-height: 1.45;
            color: #444441;
            font-family: inherit;
            text-align: center;
            }
          .step-content strong { font-weight: 700; }
          .step-content .title-blue { color: #185FA5; }
          .step-content .title-orange { color: #D85A30; }
          .step-content .accent { color: #378ADD; font-weight: 600; }

          [data-reveal] {
            opacity: 0;
            transform: translateY(20px);
            transform-box: fill-box;
            transform-origin: center;
            transition: opacity 0.7s ease, transform 0.7s ease;
          }
          [data-reveal].is-visible {
            opacity: 1;
            transform: translateY(0);
          }
          [data-reveal-arrow] {
            opacity: 0;
            transition: opacity 0.5s ease 0.2s;
          }
          [data-reveal-arrow].is-visible { opacity: 1; }

          @media (prefers-reduced-motion: reduce) {
            [data-reveal], [data-reveal-arrow] {
              opacity: 1; transform: none; transition: none;
            }
          }

          @keyframes flow-dash {
            to { stroke-dashoffset: -20; }
            }
            #feedback-arrow {
                opacity: 0;
                transition: opacity 0.6s ease;
                }
            #feedback-arrow.is-visible {
                opacity: 1;
                }
                .arr-flowing {
                stroke-dasharray: 8 4;
                }
            #feedback-arrow.is-visible .arr-flowing {
                animation: flow-dash 1s linear infinite;
            }
         @media (prefers-reduced-motion: reduce) {
            .arr-flowing { animation: none; }
            }
        `}</style>
      </defs>

      /* step 01: define */
      <g data-reveal className="step-blue">
        <rect x="270" y="40" width="360" height="100" rx="14" />
        <circle className="badge-blue" cx="270" cy="90" r="20" />
        <text className="badge-text" x="270" y="90" textAnchor="middle" dominantBaseline="central">1</text>
        <foreignObject x="295" y="50" width="320" height="80">
          <div className="step-content">
            <span><strong className="title-blue">Define:</strong> Drop your URL and set a specific task for users to complete.</span>
          </div>
        </foreignObject>
      </g>

      /* first arrows */
      <g data-reveal data-reveal-arrow>
        <path className="arr-blue" d="M 380 140 L 290 200" markerEnd="url(#arrow)" />
        <path className="arr-blue" d="M 510 140 L 580 200" markerEnd="url(#arrow)" />
      </g>

      /* step 02: execute + AI agents */
      <g data-reveal>
        <g className="step-orange">
          <rect x="130" y="210" width="300" height="120" rx="14" />
          <circle className="badge-orange" cx="130" cy="270" r="20" />
          <text className="badge-text" x="130" y="270" textAnchor="middle" dominantBaseline="central">2</text>
          <foreignObject x="155" y="220" width="265" height="100">
            <div className="step-content">
              <span> Gather real-world data from your <strong className="title-orange">human</strong> testers.</span>
            </div>
          </foreignObject>
        </g>
        <g className="step-orange">
          <rect x="450" y="210" width="300" height="120" rx="14" />
          <foreignObject x="460" y="220" width="280" height="100">
            <div className="step-content">
            <span>Run <span className="accent">AI agents</span> with your preferred model and persona.</span>
            </div>
          </foreignObject>
        </g>
      </g>

      /* arrows into circle */
        <g data-reveal data-reveal-arrow>
        <path className="arr-blue" d="M 320 330 L 385 385" markerEnd="url(#arrow)" />
        <path className="arr-blue" d="M 580 330 L 465 385" markerEnd="url(#arrow)" />

        </g>

      /* results circle */
      <g data-reveal>
        <circle className="hub-circle" cx="425" cy="460" r="80" />
        <text className="hub-text" x="425" y="452" textAnchor="middle">Results in</text>
        <text className="hub-text" x="425" y="478" textAnchor="middle">Dashboard</text>
      </g>

      {/* Hub to Analyze */}
      <g data-reveal data-reveal-arrow>
        <path className="arr-blue" d="M 425 540 L 425 600" markerEnd="url(#arrow)" />
      </g>

      /* step 03: analyze */
      <g data-reveal className="step-blue">
        <rect x="240" y="610" width="370" height="120" rx="14" />
        <circle className="badge-blue" cx="240" cy="670" r="20" />
        <text className="badge-text" x="240" y="670" textAnchor="middle" dominantBaseline="central">3</text>
        <foreignObject x="265" y="620" width="335" height="100">
          <div className="step-content">
            <span><strong className="title-blue">Analyze:</strong> Compare paths side-by-side with Sankey diagrams, clickmaps, and AI reasoning.</span>
          </div>
        </foreignObject>
      </g>

      /* arrow to iterate */
      <g data-reveal data-reveal-arrow>
        <path className="arr-blue" d="M 425 730 L 425 790" markerEnd="url(#arrow)" />
      </g>

      /* step 4: Iterate */
      <g id="step-04" data-reveal className="step-orange">
        <rect x="250" y="800" width="350" height="120" rx="14" />
        <circle className="badge-orange" cx="250" cy="860" r="20" />
        <text className="badge-text" x="250" y="860" textAnchor="middle" dominantBaseline="central">4</text>
        <foreignObject x="275" y="810" width="315" height="100">
          <div className="step-content">
            <span><strong className="title-orange">Iterate:</strong> Use evidence-based feedback to improve your site and test again.</span>
          </div>
        </foreignObject>
      </g>

      {/* Feedback loop arrow */}
     <g id="feedback-arrow">
     <path className="arr-blue arr-flowing" d="M 225 860 L 60 860 L 60 90 L 250 90" markerEnd="url(#arrow)" />
     </g>
    </svg>
  )
}