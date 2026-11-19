import type { HTMLAttributes, ReactNode } from 'react';

export function Card({ pad, interactive, className = '', ...rest }: HTMLAttributes<HTMLDivElement> & { pad?: boolean; interactive?: boolean }) {
  return <div className={['ui-card', pad && 'ui-card--pad', interactive && 'ui-card--interactive', className].filter(Boolean).join(' ')} {...rest} />;
}

export function Badge({ tone = 'gray', children }: { tone?: 'blue' | 'green' | 'red' | 'amber' | 'gray'; children: ReactNode }) {
  return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>;
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'danger' | 'success' }) {
  return (
    <div className={`ui-stat ${tone ? `ui-stat--${tone}` : ''}`}>
      <div className="ui-stat__label">{label}</div>
      <div className="ui-stat__value">{value}</div>
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="ui-empty">
      <div className="ui-empty__icon"><i className={`fa-solid ${icon}`} aria-hidden="true" /></div>
      <div className="ui-empty__title">{title}</div>
      {text && <div className="ui-empty__text">{text}</div>}
      {action}
    </div>
  );
}

export interface TabItem<T extends string> { value: T; label: string; count?: number }

export function Tabs<T extends string>({ items, value, onChange, label }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="ui-tabs" role="tablist" aria-label={label}>
      {items.map((t) => (
        <button key={t.value} type="button" role="tab" className="ui-tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}>
          {t.label}{t.count !== undefined && <span className="ui-tab__count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Sahifa: sarlavha qatori + asboblar + aylanadigan kontent */
export function Page({ title, actions, toolbar, children }: { title: string; actions?: ReactNode; toolbar?: ReactNode; children: ReactNode }) {
  return (
    <div className="ui-page">
      <header className="ui-page__head">
        <div className="ui-page__titlerow">
          <h1 className="ui-page__title">{title}</h1>
          {actions && <div className="ui-page__actions">{actions}</div>}
        </div>
        {toolbar}
      </header>
      <main className="ui-page__body">{children}</main>
    </div>
  );
}
