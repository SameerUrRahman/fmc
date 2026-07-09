import { Inter } from 'next/font/google'
import './globals.css'
import Navbarr from '@/components/navbarr'
import { Providers } from './providers'

// import { Providers } from './providers'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'FMC — Recipe Cost Calculator',
  description: 'Know exactly what your recipes cost to make',
}

export default function RootLayout({ children }) {
  return (
    
      <html lang="en" className='dark'  >
      <body className={inter.className}>
        <Providers>
        <div className='max-w-5xl mx-auto p-4'>
          <Navbarr></Navbarr>
        <div className='mt-4'>
          {children}
          </div>
        </div>
        </Providers>
        </body>
    </html>
   
  )
}
