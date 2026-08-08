'use client'

/**
 * Phase C (C2/C6) — the "About this property" editor.
 *
 * Built to the sample the owner approved on 2026-08-07, including both overrides: the
 * typeface picker is IN (four faces, no font file ever downloaded for a listing view) and
 * free colour codes are IN, with a live contrast readout that WARNS below 4.5:1 and never
 * blocks. The choice stays the author's.
 *
 * THIS COMPONENT IS A CONVENIENCE, NOT A CONTROL. Everything it produces is re-filtered by
 * `sanitizeDescriptionHtml` on the server before it can be stored. It shares that module's
 * face list, swatches and colour parser precisely so the two cannot disagree about what is
 * allowed — a toolbar that offers something the filter drops is a toolbar that lies.
 *
 * The sample mocked this with `document.execCommand`, which is deprecated and emits
 * `<font>` tags the allowlist would throw away. The real editor is Tiptap, so the markup
 * that reaches the server is already the shape the filter expects.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Color, FontFamily, TextStyle } from '@tiptap/extension-text-style'
import TextAlign from '@tiptap/extension-text-align'
import {
  DESCRIPTION_FACES,
  DESCRIPTION_SWATCHES,
  MAX_DESCRIPTION_TEXT,
  contrastOnWhite,
  parseCssColor,
  toHexColor,
} from '@/lib/listing-description'

type Props = {
  /** Form field carrying the HTML. The plain text is derived server-side, not posted. */
  name: string
  /** Sanitised HTML from the listing, or the echoed value after a failed save. */
  defaultValue: string
  id?: string
}

export function DescriptionEditor({ name, defaultValue, id = 'lf-desc' }: Props) {
  const [html, setHtml] = useState(defaultValue)
  const [textLength, setTextLength] = useState(0)
  const [customOpen, setCustomOpen] = useState(false)
  const [customValue, setCustomValue] = useState('#4A2C7A')

  const editor = useEditor({
    // Next renders this on the server first; without it React reports a hydration mismatch
    // for the editor's own DOM, which it builds imperatively.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // Only what the approved toolbar offers. Link is off because links are a way to
        // send a buyer somewhere else and the server filter drops anchors outright;
        // leaving it on would let someone paste one and watch it vanish on save.
        link: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        heading: { levels: [4] },
      }),
      TextStyle,
      Color,
      FontFamily,
      TextAlign.configure({ types: ['paragraph', 'heading'] }),
    ],
    content: defaultValue,
    editorProps: {
      attributes: {
        class: 'rte-body',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'About this property',
        id,
      },
    },
    onUpdate: ({ editor: e }) => {
      setHtml(e.getHTML())
      setTextLength(e.getText().trim().length)
    },
  })

  useEffect(() => {
    if (editor) setTextLength(editor.getText().trim().length)
  }, [editor])

  if (!editor) {
    // The server pass and the first client frame: a plain box the same height, so the form
    // does not jump when the editor takes over.
    return (
      <>
        <div className="rte rte-loading" aria-hidden="true" />
        <input type="hidden" name={name} value={defaultValue} readOnly />
      </>
    )
  }

  return (
    <>
      <Toolbar
        editor={editor}
        customOpen={customOpen}
        setCustomOpen={setCustomOpen}
        customValue={customValue}
        setCustomValue={setCustomValue}
      />
      <div className="rte">
        <EditorContent editor={editor} />
      </div>
      <div className="rte-count">
        <span>Formatting is saved with the listing.</span>
        <span className={textLength > MAX_DESCRIPTION_TEXT ? 'rte-over' : undefined}>
          {textLength} / {MAX_DESCRIPTION_TEXT}
        </span>
      </div>
      <input type="hidden" name={name} value={html} readOnly />
    </>
  )
}

function Toolbar({
  editor,
  customOpen,
  setCustomOpen,
  customValue,
  setCustomValue,
}: {
  editor: Editor
  customOpen: boolean
  setCustomOpen: (open: boolean) => void
  customValue: string
  setCustomValue: (value: string) => void
}) {
  /* mousedown default is what steals the selection from the editor before the click lands */
  const hold = useCallback((event: React.MouseEvent) => event.preventDefault(), [])

  const currentFace = editor.getAttributes('textStyle').fontFamily ?? ''
  const faceId =
    DESCRIPTION_FACES.find((face) => face.stack !== '' && face.stack === currentFace)?.id ?? ''

  return (
    <div className="rte-tb" role="toolbar" aria-label="Formatting">
      <div className="rte-grp">
        <Mark editor={editor} mark="bold" label="Bold" hold={hold}>
          <b>B</b>
        </Mark>
        <Mark editor={editor} mark="italic" label="Italic" hold={hold}>
          <i>I</i>
        </Mark>
        <Mark editor={editor} mark="underline" label="Underline" hold={hold}>
          <u>U</u>
        </Mark>
      </div>

      <span className="rte-sep" />

      <div className="rte-grp">
        <button
          type="button"
          title="Small heading"
          aria-pressed={editor.isActive('heading', { level: 4 })}
          onMouseDown={hold}
          onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
        >
          H
        </button>
        <button
          type="button"
          title="Normal text"
          aria-pressed={editor.isActive('paragraph')}
          onMouseDown={hold}
          onClick={() => editor.chain().focus().setParagraph().run()}
        >
          ¶
        </button>
      </div>

      <span className="rte-sep" />

      <div className="rte-grp">
        <button
          type="button"
          title="Bulleted list"
          aria-pressed={editor.isActive('bulletList')}
          onMouseDown={hold}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          •—
        </button>
        <button
          type="button"
          title="Numbered list"
          aria-pressed={editor.isActive('orderedList')}
          onMouseDown={hold}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1—
        </button>
      </div>

      <span className="rte-sep" />

      <div className="rte-grp">
        {(['left', 'center', 'right'] as const).map((align) => (
          <button
            key={align}
            type="button"
            title={`Align ${align === 'center' ? 'centre' : align}`}
            aria-pressed={editor.isActive({ textAlign: align })}
            onMouseDown={hold}
            onClick={() => editor.chain().focus().setTextAlign(align).run()}
          >
            <span className={`rte-al rte-al-${align}`} aria-hidden="true" />
          </button>
        ))}
      </div>

      <span className="rte-sep" />

      <div className="rte-grp">
        <label className="sr-only" htmlFor="lf-desc-face">
          Typeface
        </label>
        <select
          id="lf-desc-face"
          value={faceId}
          title="Typeface"
          onChange={(event) => {
            const face = DESCRIPTION_FACES.find((f) => f.id === event.target.value)
            if (!face) return
            const chain = editor.chain().focus()
            if (face.stack === '') chain.unsetFontFamily().run()
            else chain.setFontFamily(face.stack).run()
          }}
        >
          {DESCRIPTION_FACES.map((face) => (
            <option key={face.id || 'default'} value={face.id}>
              {face.label}
            </option>
          ))}
        </select>
      </div>

      <span className="rte-sep" />

      <div className="rte-grp">
        {DESCRIPTION_SWATCHES.map((swatch) => (
          <button
            key={swatch.value}
            type="button"
            className="rte-sw"
            style={{ background: swatch.value }}
            title={swatch.label}
            aria-label={`Colour: ${swatch.label}`}
            aria-pressed={editor.isActive('textStyle', { color: swatch.value })}
            onMouseDown={hold}
            onClick={() => editor.chain().focus().setColor(swatch.value).run()}
          />
        ))}
        <button
          type="button"
          className="rte-sw rte-more"
          title="Any other colour"
          aria-label="Any other colour"
          aria-expanded={customOpen}
          onMouseDown={hold}
          onClick={() => setCustomOpen(!customOpen)}
        >
          +
        </button>
      </div>

      {customOpen && (
        <CustomColour
          editor={editor}
          value={customValue}
          setValue={setCustomValue}
          hold={hold}
        />
      )}
    </div>
  )
}

function Mark({
  editor,
  mark,
  label,
  hold,
  children,
}: {
  editor: Editor
  mark: 'bold' | 'italic' | 'underline'
  label: string
  hold: (event: React.MouseEvent) => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={editor.isActive(mark)}
      onMouseDown={hold}
      onClick={() => {
        const chain = editor.chain().focus()
        if (mark === 'bold') chain.toggleBold().run()
        else if (mark === 'italic') chain.toggleItalic().run()
        else chain.toggleUnderline().run()
      }}
    >
      {children}
    </button>
  )
}

/**
 * The owner's second override. It reports readability as you type and never refuses a
 * colour — the warning exists because a colour that reads fine on a desk monitor can be
 * unreadable on a phone in daylight, which is not something the person choosing it can see.
 */
function CustomColour({
  editor,
  value,
  setValue,
  hold,
}: {
  editor: Editor
  value: string
  setValue: (value: string) => void
  hold: (event: React.MouseEvent) => void
}) {
  const reading = useMemo(() => {
    const rgb = parseCssColor(value)
    if (!rgb) {
      return {
        tone: 'fail' as const,
        text: 'Not a colour code. Use #4A2C7A or rgb(74,44,122).',
        hex: null,
      }
    }
    const ratio = contrastOnWhite(rgb)
    const shown = `${ratio.toFixed(2)}:1`
    if (ratio >= 4.5) {
      return { tone: 'pass' as const, text: `Readable on white — ${shown}.`, hex: toHexColor(rgb) }
    }
    if (ratio >= 3) {
      return {
        tone: 'warn' as const,
        text: `Faint — ${shown}. Below the 4.5:1 floor for body text; fine for a large heading only.`,
        hex: toHexColor(rgb),
      }
    }
    return {
      tone: 'fail' as const,
      text: `Too pale to read — ${shown}. Buyers with ordinary eyesight will struggle.`,
      hex: toHexColor(rgb),
    }
  }, [value])

  return (
    <div className="rte-custom">
      <div className="rte-custom-row">
        <input
          type="color"
          value={reading.hex ?? '#4A2C7A'}
          aria-label="Pick a colour"
          onChange={(event) => setValue(event.target.value.toUpperCase())}
        />
        <input
          type="text"
          value={value}
          spellCheck={false}
          aria-label="Colour code"
          placeholder="#4A2C7A or rgb(74,44,122)"
          onChange={(event) => setValue(event.target.value)}
        />
        <button
          type="button"
          className="rte-apply"
          onMouseDown={hold}
          disabled={reading.hex === null}
          onClick={() => {
            if (reading.hex) editor.chain().focus().setColor(reading.hex).run()
          }}
        >
          Apply
        </button>
      </div>
      <p className={`rte-readout rte-${reading.tone}`} role="status">
        <span className="rte-dot" aria-hidden="true" />
        {reading.text}
      </p>
    </div>
  )
}
