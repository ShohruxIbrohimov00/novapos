export function Spinner({ label = 'Yuklanmoqda' }: { label?: string }) {
  return <span className="ui-spinner" role="status" aria-label={label} />;
}

export function Skeleton({ height = 64, width = '100%', radius }: { height?: number; width?: number | string; radius?: number }) {
  return <div className="ui-skeleton" style={{ height, width, borderRadius: radius }} aria-hidden="true" />;
}
