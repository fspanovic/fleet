import { Skeleton } from '@/components/ui/skeleton'

/**
 * Suspense fallback while a lazily loaded screen's chunk arrives (rarely seen: they are fetched on
 * idle at start, lib/lazy.ts). `pane` = the desktop layout, `screen` = mobile.
 */
export function ScreenFallback({ layout = 'screen' }: { layout?: 'screen' | 'pane' }) {
  const rows = (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2 rounded-[0.875rem] bg-float p-3.5 shadow-float">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  )
  if (layout === 'pane') {
    return (
      <div data-tauri-drag-region aria-busy="true" aria-label="Loading" className="flex h-full min-w-0 flex-1 flex-col bg-background px-6 pt-14">
        <div className="w-full max-w-md">{rows}</div>
      </div>
    )
  }
  return (
    <div aria-busy="true" aria-label="Loading" className="flex min-h-app flex-col bg-background pt-safe">
      <div className="mx-auto w-full max-w-lg space-y-5 px-gutter pt-4 md:max-w-2xl">
        <Skeleton className="h-7 w-40" />
        {rows}
      </div>
    </div>
  )
}
