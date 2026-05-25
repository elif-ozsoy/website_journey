import type { FeedbackItem } from './FeedbackCard'

export interface FeedbackVersion {
  label: string
  summary: string
  cards: FeedbackItem[]
}

function pricingCards(): FeedbackItem[] {
  return [
    { priority: 'high', title: 'Shorten the route to pricing', body: 'The biggest improvement here is a more direct path to the pricing page. If users have to search for it first, the rest of the flow starts with avoidable friction.', evidence: 'Several testers need extra navigation steps before reaching the plan table.' },
    { priority: 'medium', title: 'Make the pricing entry point stand out', body: 'The pricing link exists, but it blends into the surrounding navigation. A stronger visual hierarchy would reduce hesitation before the click.', evidence: 'Users pause briefly before choosing the pricing destination.' },
    { priority: 'positive', title: 'Keep the plan comparison simple', body: 'Once the pricing page opens, the current structure is doing useful work. The comparison cards are scannable and should stay clean.', evidence: 'Most users compare plans without needing to backtrack.' },
  ]
}

function checkoutCards(): FeedbackItem[] {
  return [
    { priority: 'high', title: 'Clarify the field labels', body: 'The checkout path is most likely to break down where inputs feel ambiguous. Tightening labels and hints would make the form easier to trust.', evidence: 'Testers slow down when they reach address and payment fields.' },
    { priority: 'medium', title: 'Show progress more clearly', body: 'A visible step signal would help users feel oriented while they complete the checkout.', evidence: 'Several testers re-read the form before submitting.' },
    { priority: 'positive', title: 'The layout keeps the flow compact', body: 'The checkout design already does a good job of keeping the action visible.', evidence: 'Users reach the submit action without hunting for it.' },
  ]
}

function defaultCards(): FeedbackItem[] {
  return [
    { priority: 'high', title: 'Surface the main action earlier', body: 'The clearest improvement is to make the primary CTA harder to miss.', evidence: 'Users hesitate before committing to the next step.' },
    { priority: 'medium', title: 'Trim competing details near the CTA', body: 'Some supporting content is useful, but it should not compete with the main action.', evidence: 'Testers pause to inspect secondary labels before clicking.' },
    { priority: 'positive', title: 'The page supports a short decision path', body: 'The current structure does a good job of keeping people close to the buying action.', evidence: 'Most users stay on track without backtracking.' },
  ]
}

export function getFeedbackVersions(taskText: string): Record<string, FeedbackVersion> {
  const t = taskText.toLowerCase()
  if (t.includes('pricing')) {
    return {
      current: { label: 'Current', summary: 'Compared with the previous pass, the pricing route is shorter and the CTA is clearer.', cards: pricingCards() },
      previous: { label: 'Previous', summary: 'Earlier feedback focused on finding the pricing page and making the CTA stronger.', cards: [
        { priority: 'high', title: 'Pricing route felt indirect', body: 'The page still relied too much on users finding the pricing area on their own.', evidence: 'Users needed extra steps before reaching pricing.' },
        { priority: 'medium', title: 'Pricing CTA needed more weight', body: 'The pricing link was present but easy to miss.', evidence: 'Users paused before selecting pricing.' },
        { priority: 'positive', title: 'The comparison structure was usable', body: 'The plan cards were still readable.', evidence: 'Once there, users could scan the plans.' },
      ]},
    }
  }
  if (t.includes('checkout')) {
    return {
      current: { label: 'Current', summary: 'Labels are clearer and the flow feels more guided.', cards: checkoutCards() },
      previous: { label: 'Previous', summary: 'Earlier feedback was focused on vague labels and weak progress cues.', cards: [
        { priority: 'high', title: 'Field labels were too vague', body: 'The form needed clearer labels and hints.', evidence: 'Users slowed down on address and payment fields.' },
        { priority: 'medium', title: 'Progress needed more reassurance', body: 'A stronger step indicator would help.', evidence: 'Several testers re-read the page before submitting.' },
        { priority: 'positive', title: 'The checkout stayed compact', body: 'The flow was short.', evidence: 'Users reached the final action.' },
      ]},
    }
  }
  return {
    current: { label: 'Current', summary: 'The main action is more visible and the page feels less crowded.', cards: defaultCards() },
    previous: { label: 'Previous', summary: 'Earlier feedback focused on making the main CTA stand out.', cards: [
      { priority: 'high', title: 'Primary action was easy to miss', body: 'The CTA needed more visual weight.', evidence: 'Users hesitated before moving forward.' },
      { priority: 'medium', title: 'Nearby details competed for attention', body: 'Supporting content pulled attention away.', evidence: 'Testers paused to inspect secondary labels.' },
      { priority: 'positive', title: 'The flow was still fairly short', body: 'The page already kept users close to the action.', evidence: 'Most users stayed on track.' },
    ]},
  }
}

export function getInsights(taskText: string) {
  const t = taskText.toLowerCase()
  const focus = t.includes('pricing')
    ? 'For pricing work, agents help with coverage; humans help with trust and hierarchy.'
    : t.includes('checkout')
      ? 'For checkout work, agents help with repeatable checks; humans help with clarity.'
      : 'Agents help with fast coverage; humans help with friction and real-world understanding.'
  return {
    title: 'Web Agents vs Human Testers',
    agentBullets: ['Fast, repeatable checks', 'Good for broad coverage and regressions', 'Weak on trust, tone, and ambiguity'],
    humanBullets: ['Better for hesitation and perception', 'Good at catching copy and hierarchy issues', 'Slower and harder to repeat at scale'],
    summary: `Best workflow: run agents first for quick signal, then use humans to confirm the parts that depend on perception. ${focus}`,
  }
}
