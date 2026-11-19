import { forwardRef, useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';

interface FieldBase {
  label?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  /** Maydon ichidagi chap ikonka (Font Awesome nomi) */
  icon?: string;
  /** Katta raqamli summa maydoni */
  money?: boolean;
}

export type FieldProps = FieldBase & InputHTMLAttributes<HTMLInputElement>;

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, required, icon, money, className = '', id, ...rest }, ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  const describedBy = error ? `${fid}-err` : hint ? `${fid}-hint` : undefined;
  const cls = ['ui-input', icon && 'ui-input--icon', error && 'ui-input--error', money && 'ui-input--money', className]
    .filter(Boolean).join(' ');
  return (
    <div className="ui-field">
      {label && (
        <label className="ui-field__label" htmlFor={fid}>
          {label}{required && <span className="ui-field__req" aria-hidden="true">*</span>}
        </label>
      )}
      <div className="ui-field__wrap">
        {icon && <i className={`fa-solid ${icon} ui-field__icon`} aria-hidden="true" />}
        <input ref={ref} id={fid} className={cls} aria-invalid={!!error || undefined}
               aria-describedby={describedBy} required={required} {...rest} />
      </div>
      {error ? <span id={`${fid}-err`} className="ui-field__error">{error}</span>
        : hint ? <span id={`${fid}-hint`} className="ui-field__hint">{hint}</span> : null}
    </div>
  );
});

export type TextAreaProps = Omit<FieldBase, 'icon' | 'money'> & TextareaHTMLAttributes<HTMLTextAreaElement>;

export function TextArea({ label, hint, error, required, id, className = '', ...rest }: TextAreaProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className="ui-field">
      {label && <label className="ui-field__label" htmlFor={fid}>{label}{required && <span className="ui-field__req">*</span>}</label>}
      <textarea id={fid} className={`ui-input ${error ? 'ui-input--error' : ''} ${className}`} aria-invalid={!!error || undefined} {...rest} />
      {error ? <span className="ui-field__error">{error}</span> : hint ? <span className="ui-field__hint">{hint}</span> : null}
    </div>
  );
}
