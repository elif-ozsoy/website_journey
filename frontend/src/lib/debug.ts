/**
 * Dev-only console logging. All tracing (e.g. the [CC:ann]/[CC:sel] queue
 * logs) goes through these so production builds stay silent.
 */

const noop = () => {}

export const debug: typeof console.log = import.meta.env.DEV ? console.log.bind(console) : noop
export const debugWarn: typeof console.warn = import.meta.env.DEV ? console.warn.bind(console) : noop
export const debugError: typeof console.error = import.meta.env.DEV ? console.error.bind(console) : noop
