import { useEffect, useState } from 'react'
import { useTemplateStore } from '../templateStore'
import { languageForPath } from '../monaco/languages'
import { useHint } from '../hint'
import { ipc } from '../ipc'
import { FileList, type FileListItem } from './FileList'
import { EditorPane } from './EditorPane'
import { InputDialog, type DialogState } from './InputDialog'
import { ViewSettingsMenu } from './ViewSettingsMenu'

function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

function ScaffoldToggle({
  relPath,
  checked,
  onChange
}: {
  relPath: string
  checked: boolean
  onChange: (next: boolean) => void
}): JSX.Element {
  const hint = useHint(
    checked ? 'Scaffolded into new projects' : 'Not scaffolded into new projects'
  )
  return (
    <span {...hint}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={`Scaffold ${relPath}`}
      />
    </span>
  )
}

export function TemplateView(): JSX.Element {
  const {
    templates,
    activeName,
    selectedName,
    selectedFile,
    fileContent,
    openMode,
    load,
    setActive,
    openFile,
    saveFile,
    createTemplate,
    duplicateTemplate,
    deleteActiveTemplate,
    addFile,
    deleteFile,
    toggleFile
  } = useTemplateStore()

  const [selectorOpen, setSelectorOpen] = useState(false)
  const [dialog, setDialog] = useState<DialogState | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  const active = templates.find((t) => t.name === activeName) ?? null
  const isBuiltIn = active?.isDefault ?? false
  const disabled = new Set(active?.disabled ?? [])

  const items: FileListItem[] = (active?.files ?? []).map((f) => ({
    id: f.relPath,
    name: baseName(f.relPath),
    relPath: f.relPath,
    sizeBytes: f.sizeBytes
  }))

  const isMarkdown = selectedFile?.toLowerCase().endsWith('.md') ?? false

  // Currently selected template always appears first in the dropdown.
  const orderedTemplates = [...templates].sort(
    (a, b) => (b.name === selectedName ? 1 : 0) - (a.name === selectedName ? 1 : 0)
  )

  return (
    <div className="view view-template">
      <div className="template-header">
        <div className="header-left">
          <span className="template-label">Templates</span>
          <ViewSettingsMenu sectionId="templates" label="Template view settings" />
        </div>

        <div className="header-right">
          <div className="template-selector">
            <button
              className="selector-button"
              onClick={() => setSelectorOpen((v) => !v)}
              aria-expanded={selectorOpen}
            >
              <span className="selector-name">{activeName}</span>
              <span className="selector-caret">{selectorOpen ? '▴' : '▾'}</span>
            </button>
            {selectorOpen && (
              <>
                <div className="selector-backdrop" onClick={() => setSelectorOpen(false)} />
                <div className="selector-menu">
                  {orderedTemplates.map((t) => (
                    <button
                      key={t.name}
                      className={`selector-item${t.name === activeName ? ' active' : ''}`}
                      onClick={() => {
                        setSelectorOpen(false)
                        void setActive(t.name)
                      }}
                    >
                      <span className="selector-item-name">{t.name}</span>
                      {t.name === selectedName && (
                        <span className="selector-current">current</span>
                      )}
                      {t.isDefault && <span className="selector-badge">built in</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="template-actions">
            <button
              className="btn"
              onClick={() =>
                setDialog({
                  title: 'New template name',
                  defaultValue: '',
                  confirmLabel: 'Create',
                  onConfirm: (name) => void createTemplate(name)
                })
              }
            >
              Create
            </button>
            <button
              className="btn btn-ghost"
              onClick={() =>
                setDialog({
                  title: `Duplicate "${activeName}" as`,
                  defaultValue: '',
                  confirmLabel: 'Duplicate',
                  onConfirm: (name) => void duplicateTemplate(name)
                })
              }
            >
              Duplicate
            </button>
            <button
              className="btn btn-ghost btn-danger"
              disabled={isBuiltIn}
              onClick={() => {
                if (window.confirm(`Delete template "${activeName}"? This cannot be undone.`)) {
                  void deleteActiveTemplate()
                }
              }}
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      <div className="template-body">
        <aside className="template-files">
          <div className="template-files-head">
            <span>Files</span>
            <button
              className="btn btn-ghost btn-sm"
              disabled={isBuiltIn}
              title={isBuiltIn ? 'The built-in template cannot be modified.' : undefined}
              onClick={() =>
                setDialog({
                  title: 'New file (relative path)',
                  defaultValue: '',
                  placeholder: 'Documentation/notes.md',
                  confirmLabel: 'Add',
                  onConfirm: (rel) => void addFile(rel)
                })
              }
            >
              Add file
            </button>
          </div>
          <FileList
            items={items}
            selectedId={selectedFile}
            onSelect={(id) => void openFile(id)}
            onReveal={(item) => void ipc.revealTemplateFile(activeName, item.relPath)}
            emptyMessage="This template has no files."
            renderLeading={(item) => (
              <ScaffoldToggle
                relPath={item.relPath}
                checked={!disabled.has(item.relPath)}
                onChange={(next) => void toggleFile(item.relPath, next)}
              />
            )}
          />
        </aside>

        <main className="template-editor">
          <EditorPane
            hasFile={!!selectedFile}
            title={selectedFile}
            badge={selectedFile && isBuiltIn ? '(BUILT IN)' : null}
            content={fileContent}
            sourceKey={`${activeName}:${selectedFile ?? ''}`}
            language={selectedFile ? languageForPath(selectedFile) : 'plaintext'}
            readOnly={isBuiltIn}
            canPreview={isMarkdown}
            defaultMode={openMode ?? undefined}
            emptyMessage="Choose a template file to view or edit."
            onSave={(value) => saveFile(value)}
            headerExtras={
              selectedFile && !isBuiltIn ? (
                <button
                  className="btn btn-ghost btn-danger"
                  onClick={() => {
                    if (window.confirm(`Delete ${selectedFile} from "${activeName}"?`)) {
                      void deleteFile(selectedFile)
                    }
                  }}
                >
                  Delete file
                </button>
              ) : null
            }
          />
        </main>
      </div>

      {dialog && <InputDialog dialog={dialog} onClose={() => setDialog(null)} />}
    </div>
  )
}
