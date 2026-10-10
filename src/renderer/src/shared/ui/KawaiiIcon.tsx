/**
 * Kawaii sprite icons from resources/kawaii-icons/set.png (4×2 grid).
 * 0 chat · 1 settings · 2 ai · 3 files · 4 notify · 5 night · 6 ideas · 7 favorites
 */
import type { CSSProperties } from 'react'

export type KawaiiIconName =
  | 'chat'
  | 'settings'
  | 'ai'
  | 'files'
  | 'notify'
  | 'night'
  | 'ideas'
  | 'favorites'
  | 'app'

const INDEX: Record<Exclude<KawaiiIconName, 'app'>, number> = {
  chat: 0,
  settings: 1,
  ai: 2,
  files: 3,
  notify: 4,
  night: 5,
  ideas: 6,
  favorites: 7
}

type Props = {
  name: KawaiiIconName
  size?: number
  className?: string
  title?: string
}

export function KawaiiIcon({ name, size = 20, className = '', title }: Props) {
  if (name === 'app') {
    return (
      <img
        src="/kawaii-icons/app-chat.png"
        width={size}
        height={size}
        alt=""
        title={title}
        className={`inline-block object-contain shrink-0 ${className}`}
        draggable={false}
      />
    )
  }
  const i = INDEX[name]
  const col = i % 4
  const row = Math.floor(i / 4)
  const style: CSSProperties = {
    width: size,
    height: size,
    backgroundImage: 'url(/kawaii-icons/set.png)',
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${size * 4}px ${size * 2}px`,
    backgroundPosition: `-${col * size}px -${row * size}px`,
    display: 'inline-block',
    flexShrink: 0
  }
  return <span role="img" aria-label={title || name} title={title} className={className} style={style} />
}
