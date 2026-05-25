/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Collapse all text-* classes to the 3 standard sizes from index.css.
      // text-xs → labels/captions (12px), text-sm/base/lg → body (15px), text-xl+ → headline (28px).
      fontSize: {
        'xs':   'var(--fs-small)',
        'sm':   'var(--fs-body)',
        'base': 'var(--fs-body)',
        'lg':   'var(--fs-body)',
        'xl':   'var(--fs-headline)',
        '2xl':  'var(--fs-headline)',
        '3xl':  'var(--fs-headline)',
      },
    },
  },
  plugins: [],
}
