import { Inter } from 'next/font/google'
import './globals.css'
import Navbarr from '@/components/navbarr'
import { Providers } from './providers'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'FMC — Recipe Cost Calculator',
  description: 'Know exactly what your recipes cost to make',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className='dark'>
      <body className={inter.className}>
        <Providers>
          <Navbarr />
          <main className='max-w-6xl mx-auto px-4 py-8'>
            {children}
          </main>
        </Providers>
      </body>
    </html>
  )
}
