import { useId, useRef, useState } from 'react'

type FieldError = { name: string; label: string; message: string }
type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

function labelText(field: Field) {
  const label = field.labels?.[0]
  if (!label) return field.name
  const copy = label.cloneNode(true) as HTMLLabelElement
  copy.querySelectorAll('.ux-field-error, input, select, textarea').forEach(child => child.remove())
  return copy.textContent?.trim() || field.name
}

export function useFormFeedback() {
  const prefix = useId()
  const [errors, setErrors] = useState<FieldError[]>([])
  const formRef = useRef<HTMLFormElement | null>(null)
  const summaryRef = useRef<HTMLDivElement>(null)

  function validate(form: HTMLFormElement, extra: FieldError[] = []) {
    formRef.current = form
    const fields = Array.from(form.elements).filter((field): field is Field =>
      field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)
    const invalid = fields.filter(field => field.name && field.willValidate && !field.validity.valid).map(field => ({
      name: field.name,
      label: labelText(field),
      message: field.validationMessage,
    }))
    const next = [...invalid, ...extra.filter(error => !invalid.some(field => field.name === error.name))]
    setErrors(next)
    if (next.length) requestAnimationFrame(() => summaryRef.current?.focus())
    return next.length === 0
  }

  function errorId(name: string) { return prefix + '-error-' + name }

  function fieldProps(name: string) {
    const error = errors.find(error => error.name === name)
    return error ? { 'aria-invalid': true as const, 'aria-describedby': errorId(name) } : {}
  }

  function fieldError(name: string) {
    const error = errors.find(error => error.name === name)
    return error && <span className="ux-field-error" id={errorId(name)}>{error.message}</span>
  }

  function clear(name: string) { setErrors(current => current.some(error => error.name === name) ? current.filter(error => error.name !== name) : current) }

  const summary = errors.length > 0 && <div className="ux-error-summary" tabIndex={-1} ref={summaryRef}>
    <p>Check the highlighted fields</p>
    <ul>{errors.map(error => <li key={error.name}><a href={'#' + errorId(error.name)} onClick={event => {
      event.preventDefault()
      const field = formRef.current?.elements.namedItem(error.name)
      if (field instanceof HTMLElement) field.focus()
    }}>{error.label}: {error.message}</a></li>)}</ul>
  </div>

  return { validate, fieldProps, fieldError, summary, clear }
}
