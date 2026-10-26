import { ExternalLinkIcon } from 'lucide-react'

/**
 * The "open it elsewhere" icon in a card's top-right corner (a task → Productive, a PR → GitHub). A sibling of
 * the card's main button, so the card root must be `relative` and its header needs `pr-9 lg:pr-7` to clear it.
 */
export function CornerLink({ href, label, title }: { href: string; label: string; title: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      title={title}
      className="absolute top-0.5 right-0.5 flex size-10 items-center justify-center rounded-md text-dimmer outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 lg:top-1.5 lg:right-1.5 lg:size-7"
    >
      <ExternalLinkIcon className="size-3.5" />
    </a>
  )
}
