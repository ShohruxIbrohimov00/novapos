import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'success' | 'danger' | 'ghost' | 'outline' | 'danger-soft';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  loading?: boolean;
  /** Font Awesome nomi, masalan "fa-plus" */
  icon?: string;
  children?: ReactNode;
}

export function Button({
  variant = 'primary', size = 'md', block, loading, icon, children, className = '', disabled, type = 'button', ...rest
}: ButtonProps) {
  const cls = ['ui-btn', `ui-btn--${variant}`, size !== 'md' && `ui-btn--${size}`, block && 'ui-btn--block', className]
    .filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Spinner /> : icon ? <i className={`fa-solid ${icon}`} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: string;
  /** Ekran o'quvchilar uchun majburiy nom */
  label: string;
}

export function IconButton({ icon, label, className = '', type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} className={`ui-icon-btn ${className}`} aria-label={label} title={label} {...rest}>
      <i className={`fa-solid ${icon}`} aria-hidden="true" />
    </button>
  );
}
