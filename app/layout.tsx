import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Ubizo Tour Translation App',
  description: 'Created by VirtualAIWorkforce.com',
  generator: 'Created by VirtualAIWorkforce.com',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
