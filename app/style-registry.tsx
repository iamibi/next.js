'use client'

import { useState, type ReactNode } from 'react'
import { useServerInsertedHTML } from 'next/navigation'

// A dependency-free stand-in for a CSS-in-JS style registry. It has the same
// shape as the styled-jsx registry in the Next.js CSS-in-JS guide
// (docs/01-app/02-guides/css-in-js.mdx): collect the styles, return them from
// useServerInsertedHTML, then flush. After the first flush nothing is pending,
// so the callback returns <>{[]}</>, which renders no HTML.
//
// styled-jsx, styled-components (>= 6.1.12) and emotion/MUI registries return
// the same kind of empty result (an empty array, or null) once their styles
// have been flushed.
function createStyleRegistry() {
  let pending: string[] = []
  return {
    add(css: string) {
      pending.push(css)
    },
    styles() {
      return pending.map((css, index) => <style key={index}>{css}</style>)
    },
    flush() {
      pending = []
    },
  }
}

export default function StyleRegistry({ children }: { children: ReactNode }) {
  const [registry] = useState(() => {
    const created = createStyleRegistry()
    // Stands in for the styles that components register while rendering.
    created.add('body{font-family:system-ui,sans-serif}')
    return created
  })

  useServerInsertedHTML(() => {
    const styles = registry.styles()
    registry.flush()
    return <>{styles}</>
  })

  return <>{children}</>
}
