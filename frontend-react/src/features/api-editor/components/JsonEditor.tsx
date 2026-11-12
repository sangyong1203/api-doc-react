import { useEffect, useRef } from 'react'
import { basicSetup, EditorView } from 'codemirror'
import { json } from '@codemirror/lang-json'

type JsonEditorProps = {
  initialValue: string
  label: string
  onChange?: (value: string) => void
}

export function JsonEditor({ initialValue, label, onChange }: JsonEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorView | null>(null)
  const changeRef = useRef(onChange)

  useEffect(() => {
    changeRef.current = onChange
  }, [onChange])

  // DOM에 편집기를 연결하고 탭 전환·언마운트 시 이벤트와 DOM을 정리합니다.
  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    const editor = new EditorView({
      doc: '',
      parent: containerRef.current,
      extensions: [
        basicSetup,
        json(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            changeRef.current?.(update.state.doc.toString())
          }
        }),
        EditorView.contentAttributes.of({ 'aria-label': label }),
        EditorView.theme({
          '&': { fontSize: 'inherit' },
          '.cm-scroller': { overflow: 'auto', minHeight: '180px' },
          '.cm-content': { fontFamily: 'ui-monospace, monospace' },
        }),
      ],
    })

    editorRef.current = editor
    return () => {
      editor.destroy()
      editorRef.current = null
    }
  }, [label])

  // 외부 값이 달라졌을 때만 동기화하여 일반 입력 중 커서 위치를 유지합니다.
  useEffect(() => {
    const editor = editorRef.current
    if (editor && editor.state.doc.toString() !== initialValue) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: initialValue } })
    }
  }, [initialValue])

  return <div className="json-editor overflow-hidden" ref={containerRef} />
}
