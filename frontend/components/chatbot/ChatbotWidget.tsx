'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { Bot, LoaderCircle, MessageCircle, Send, X } from 'lucide-react';
import { api } from '@/lib/api';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

const GREETING: Message = {
  role: 'assistant',
  content: 'Hi! I’m the BetPlatform assistant. Ask me about registration, games, your wallet, deposits, withdrawals, bonuses, or referrals.',
};

const QUICK_QUESTIONS = [
  'How do I create an account?',
  'How can I deposit?',
  'How do withdrawals work?',
];

export function ChatbotWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollAreaRef.current?.scrollTo({
      top: scrollAreaRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, isSending, isOpen]);

  const sendMessage = async (value: string) => {
    const message = value.trim();
    if (!message || isSending) return;

    const priorMessages = messages.slice(-8);
    setMessages((current) => [...current, { role: 'user', content: message }]);
    setDraft('');
    setIsSending(true);

    try {
      const response = await api.post('/chatbot/message', {
        message,
        history: priorMessages.map(({ role, content }) => ({ role, content })),
      });
      setMessages((current) => [
        ...current,
        { role: 'assistant', content: response.data.reply ?? 'I could not prepare a reply. Please try again.' },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: 'I’m having trouble connecting right now. Please try again in a moment or contact the site support team.',
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendMessage(draft);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(draft);
    }
  };

  return (
    <div className="fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] right-3 z-[100] flex flex-col items-end gap-3 sm:right-5 md:bottom-5">
      {isOpen && (
        <section
          role="dialog"
          aria-label="BetPlatform customer support chat"
          className="flex h-[min(590px,calc(100dvh-150px))] w-[min(390px,calc(100vw-24px))] flex-col overflow-hidden rounded-3xl border border-violet-300/20 bg-[#111a30] shadow-2xl shadow-violet-950/40 backdrop-blur-2xl"
        >
          <header className="flex items-center justify-between border-b border-white/10 bg-gradient-to-r from-violet-600/25 via-indigo-500/15 to-cyan-400/10 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-400/25 to-cyan-300/15 text-cyan-100 shadow-inner">
                <Bot size={21} />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">BetPlatform Support</p>
                <p className="text-xs text-emerald-400">Online assistant</p>
              </div>
            </div>
            <button
              type="button"
              aria-label="Close chat"
              onClick={() => setIsOpen(false)}
              className="rounded-lg p-2 text-gray-400 transition hover:bg-white/10 hover:text-white"
            >
              <X size={18} />
            </button>
          </header>

          <div ref={scrollAreaRef} className="flex-1 space-y-4 overflow-y-auto px-3 py-4 sm:px-4">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[86%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    message.role === 'user'
                      ? 'rounded-br-md bg-gradient-to-br from-violet-500 to-indigo-500 text-white shadow-lg shadow-violet-950/20'
                      : 'rounded-bl-md border border-white/10 bg-white/[0.06] text-gray-200'
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}
            {isSending && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.06] px-3.5 py-3 text-xs text-gray-400">
                  <LoaderCircle size={14} className="animate-spin" />
                  Preparing a reply...
                </div>
              </div>
            )}
            {messages.length === 1 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {QUICK_QUESTIONS.map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => void sendMessage(question)}
                    className="rounded-full border border-violet-300/25 bg-violet-400/[0.06] px-3 py-2 text-left text-xs text-violet-100 transition hover:border-cyan-300/40 hover:bg-cyan-300/10"
                  >
                    {question}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="border-t border-white/10 bg-[#10172b] p-3">
            <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-black/25 p-2 focus-within:border-cyan-300/60 focus-within:shadow-[0_0_0_3px_rgba(67,224,208,0.09)]">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                maxLength={1200}
                placeholder="Type your question..."
                aria-label="Type your message"
                className="max-h-28 min-h-9 flex-1 resize-y bg-transparent px-1 py-2 text-sm text-white outline-none placeholder:text-gray-500"
              />
              <button
                type="submit"
                disabled={!draft.trim() || isSending}
                aria-label="Send message"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-300 to-teal-400 text-[#07151b] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send size={16} />
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-gray-600">Never share your password, PIN, or verification codes in chat.</p>
          </form>
        </section>
      )}

      <button
        type="button"
        aria-label={isOpen ? 'Close customer support chat' : 'Open customer support chat'}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/25 bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-400 text-white shadow-xl shadow-violet-950/40 transition hover:scale-105 hover:rotate-3 hover:brightness-110 md:h-14 md:w-14 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:ring-offset-2 focus:ring-offset-[#0d1224]"
      >
        {isOpen ? <X size={24} /> : <MessageCircle size={24} />}
      </button>
    </div>
  );
}
