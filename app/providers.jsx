'use client'

import { HeroUIProvider, ToastProvider } from '@heroui/react'

export function Providers({ children }) {
  return (
    <HeroUIProvider>
      <ToastProvider placement="bottom-right" />
      {children}
    </HeroUIProvider>
  )
}
