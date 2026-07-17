import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import type { Extension } from '@codemirror/state'

export function languageForPath(path: string): Extension[] {
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'ts':
    case 'tsx':
      return [javascript({ jsx: true, typescript: true })]
    case 'js':
    case 'jsx':
    case 'mjs':
      return [javascript({ jsx: true })]
    case 'py':
      return [python()]
    case 'html':
      return [html()]
    case 'css':
      return [css()]
    default:
      return []
  }
}
