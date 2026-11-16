import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatbotHistoryMessageDto } from './dto/chatbot-message.dto';

const SYSTEM_PROMPT = `You are the official customer-support assistant for BetPlatform, an online gaming platform.

Answer customer questions clearly, politely, and in plain language. You may answer general questions about how the website works, but never pretend you can see a customer's account, wallet, payment status, identity documents, or private records.

Confirmed website information:
- Customers can register with an email address, a unique username, and a password of at least 8 characters. Email and username are unique; email matching is case-insensitive. No email verification code or verification link is required. A successful registration signs the customer in.
- Customers sign in with their registered email address and password.
- The Lobby contains the site's available games and categories. The exact catalog depends on which game providers are configured and active.
- Customers use the Wallet area to review their balance and transaction activity, initiate deposits, and request withdrawals.
- Payment options are controlled by the site's configuration. The platform code supports payment integrations including SSLCommerz and an optional local payment gateway; examples include bKash, Nagad, Rocket, Upay, cards, and online banking. Do not claim a specific method is currently enabled unless the customer can see it in their own Wallet page.
- Withdrawal requests may require review. Never invent deposit or withdrawal limits, processing times, fees, bonus terms, wagering requirements, or KYC rules. Direct customers to the current information shown in the relevant page or to the site's support team/administrator.
- The platform includes bonus, referral, VIP, profile, and notification features. Exact active offers and eligibility can change and must not be guessed.

Safety and privacy:
- Never ask for a password, one-time code, PIN, full card number, CVV, bank login, API key, or other authentication secret.
- Never ask a customer to share payment credentials in chat. Do not claim that you can make a deposit, withdrawal, account change, or verification on their behalf.
- Do not make promises about winnings, odds, returns, or game outcomes, and do not give betting predictions or strategies. Encourage responsible play.
- If a question needs live account information or a policy/limit that is not in the confirmed information above, say that you cannot verify it and direct the customer to the relevant page or site support. Do not make up an answer.
- Stay focused on BetPlatform support. Politely redirect unrelated questions.`;

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  private readonly rateLimits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly config: ConfigService) {}

  async reply(message: string, history: ChatbotHistoryMessageDto[] = [], clientKey = 'unknown') {
    this.checkRateLimit(clientKey);
    const cleanMessage = message.trim();
    const apiKey = this.config.get<string>('CHATBOT_API_KEY')?.trim()
      || this.config.get<string>('OPENAI_API_KEY')?.trim();

    if (!apiKey) {
      return { reply: this.fallbackReply(cleanMessage), mode: 'faq' as const };
    }

    const endpoint = this.config.get<string>('CHATBOT_API_URL')
      ?? 'https://api.openai.com/v1/responses';
    const model = this.config.get<string>('CHATBOT_MODEL') ?? 'gpt-4o-mini';
    const input = [
      ...history.slice(-10).map(({ role, content }) => ({
        role,
        content: content.slice(0, 1200),
      })),
      { role: 'user', content: cleanMessage },
    ];

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          instructions: SYSTEM_PROMPT,
          input,
          temperature: 0.25,
          max_output_tokens: 450,
          store: false,
        }),
        signal: AbortSignal.timeout(20_000),
      });

      if (!response.ok) {
        this.logger.warn(`Chatbot provider returned HTTP ${response.status}; using FAQ fallback.`);
        return { reply: this.fallbackReply(cleanMessage), mode: 'faq' as const };
      }

      const result = await response.json() as {
        output_text?: string;
        output?: Array<{
          content?: Array<{ type?: string; text?: string }>;
        }>;
      };
      const generated = (result.output_text
        ?? result.output?.flatMap((item) => item.content ?? [])
          .filter((part) => part.type === 'output_text')
          .map((part) => part.text ?? '')
          .join('')
        ?? '').trim();
      if (!generated) {
        this.logger.warn('Chatbot provider returned an empty answer; using FAQ fallback.');
        return { reply: this.fallbackReply(cleanMessage), mode: 'faq' as const };
      }

      return { reply: generated, mode: 'ai' as const };
    } catch (error) {
      this.logger.warn(`Chatbot provider is unavailable; using FAQ fallback. ${(error as Error).message}`);
      return { reply: this.fallbackReply(cleanMessage), mode: 'faq' as const };
    }
  }

  private checkRateLimit(clientKey: string): void {
    const now = Date.now();
    const current = this.rateLimits.get(clientKey);

    if (!current || current.resetAt <= now) {
      this.rateLimits.set(clientKey, { count: 1, resetAt: now + 60_000 });
    } else {
      if (current.count >= 15) {
        throw new HttpException('Too many chat messages. Please wait a minute and try again.', HttpStatus.TOO_MANY_REQUESTS);
      }
      current.count += 1;
    }

    // Keep the in-memory limiter bounded on long-running server instances.
    if (this.rateLimits.size > 5000) {
      for (const [key, bucket] of this.rateLimits) {
        if (bucket.resetAt <= now) this.rateLimits.delete(key);
      }
    }
  }

  private fallbackReply(message: string): string {
    const text = message.toLowerCase();

    if (/register|sign.?up|create account|new account|verification|verify email/.test(text)) {
      return 'To create an account, open Register and enter your email address, a username that no other customer uses, and a password of at least 8 characters. You do not need an email verification code. After registration, you will be signed in automatically.';
    }
    if (/already exist|already registered|email.*taken|username.*taken|duplicate/.test(text)) {
      return 'Each account needs its own unique email address and username. Email matching is not case-sensitive. If you already registered with that email, go to Sign in instead of creating another account. Please do not share your password in chat.';
    }
    if (/log.?in|sign.?in|password|can't access|cannot access/.test(text)) {
      return 'Sign in with the email address used when you registered and your password. If you cannot access the account, use the site’s support channel or contact the administrator. Never send your password or one-time codes in chat.';
    }
    if (/deposit|add funds|top.?up|bkash|nagad|rocket|upay|sslcommerz/.test(text)) {
      return 'Open Wallet and choose Deposit to see the payment methods currently enabled for your account. Available methods depend on the site configuration. Follow the instructions shown there, and check your wallet transaction history for the payment status.';
    }
    if (/withdraw|cash.?out|payout/.test(text)) {
      return 'Open Wallet and choose Withdraw to submit a request. Withdrawal requests may be reviewed before they are processed. The current form and transaction history show the options and status available to your account.';
    }
    if (/balance|wallet|transaction|history/.test(text)) {
      return 'Open Wallet to review your available balance and transaction history. I cannot view private account or payment records from this chat.';
    }
    if (/game|lobby|provider|category/.test(text)) {
      return 'Visit the Lobby to browse the games and categories currently available on the platform. The catalog depends on the game providers that are active on the site.';
    }
    if (/bonus|promotion|referral|vip|reward/.test(text)) {
      return 'The platform includes bonus, referral, and VIP features. Exact offers, eligibility, and terms can change, so check the relevant section in your account for the current details or ask site support.';
    }

    return 'Thanks for your question. I can help with registration, sign-in, games, wallet balances, deposits, withdrawals, bonuses, referrals, and VIP features. I do not have access to private account records or live payment status. Please check the relevant page in your account or contact the site support team for anything account-specific.';
  }
}
