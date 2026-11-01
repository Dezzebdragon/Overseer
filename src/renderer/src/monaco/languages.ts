import * as monaco from 'monaco-editor'

/** Resolve a Monaco language id from a filename using Monaco's registry. */
export function languageForPath(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : ''

  for (const lang of monaco.languages.getLanguages()) {
    if (ext && lang.extensions?.some((e) => e.toLowerCase() === ext)) {
      return lang.id
    }
    if (lang.filenames?.some((f) => f.toLowerCase() === name.toLowerCase())) {
      return lang.id
    }
  }
  return 'plaintext'
}
