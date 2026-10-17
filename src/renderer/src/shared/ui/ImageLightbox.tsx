import { useEffect } from 'react'

type Props = {
  src: string
  alt?: string
  onClose: () => void
}

/** Full-screen image viewer — click backdrop or press Escape to close */
export function ImageLightbox({ src, alt, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <img
        src={src}
        alt={alt || 'imagen'}
        className="max-h-[92vh] max-w-[92vw] object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        className="absolute top-4 right-4 rounded-full bg-white/90 px-3 py-1 text-sm font-medium text-gray-800 hover:bg-white"
        onClick={onClose}
      >
        Cerrar (Esc)
      </button>
    </div>
  )
}
