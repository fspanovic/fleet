import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/** Sticky, translucent (blurred) top bar with safe-area padding — its hairline shows once the page scrolls under it; content is centred at max-w-3xl. */
export function ScreenHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <header
      className={cn(
        'sticky top-0 z-20 scroll-edge bg-background/72 pt-safe px-safe backdrop-blur-2xl backdrop-saturate-[1.8]',
        className,
      )}
    >
      <div className="mx-auto w-full max-w-3xl px-gutter pt-3 pb-2.5">{children}</div>
    </header>
  )
}
