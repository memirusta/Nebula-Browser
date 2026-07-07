import { useCallback, useState } from 'react'

export function useMenuState() {
  const [isOpen, setIsOpen] = useState(false)
  const [urlInput, setUrlInput] = useState('')

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen((v) => !v), [])

  return { isOpen, urlInput, setUrlInput, open, close, toggle }
}
