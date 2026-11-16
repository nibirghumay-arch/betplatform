import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';
import { ChatbotWidget } from '@/components/chatbot/ChatbotWidget';

export const metadata: Metadata = {
  title: 'BetPlatform',
  description: 'Gaming & Betting Platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#0f0f0f] text-white antialiased">
        <Providers>
          {children}
          <ChatbotWidget />
        </Providers>
      </body>
    </html>
  );
}
