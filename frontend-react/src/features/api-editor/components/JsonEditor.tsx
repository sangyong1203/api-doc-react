import { useEffect, useRef } from 'react'
import { basicSetup, EditorView } from 'codemirror'
import { json } from '@codemirror/lang-json'

type JsonEditorProps = {
  initialValue: string
  label: string
}

export function JsonEditor({ initialValue, label }: JsonEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // DOM에 편집기를 연결하고 탭 전환·언마운트 시 이벤트와 DOM을 정리합니다.
  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    const editor = new EditorView({
      doc: initialValue,
      parent: containerRef.current,
      extensions: [
        basicSetup,
        json(),
        EditorView.contentAttributes.of({ 'aria-label': label }),
        EditorView.theme({
          '&': { fontSize: '14px' },
          '.cm-scroller': { overflow: 'auto', minHeight: '180px' },
          '.cm-content': { fontFamily: 'ui-monospace, monospace' },
        }),
      ],
    })

    return () => {
      editor.destroy()
    }
  }, [initialValue, label])

  return <div className="json-editor overflow-hidden rounded-md border" ref={containerRef} />
}
