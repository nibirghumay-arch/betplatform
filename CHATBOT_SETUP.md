# BetPlatform customer-support chatbot

The customer chat widget is included globally in the frontend layout. It sends messages to `POST /api/v1/chatbot/message`.

## Enable AI replies

Set these variables in the backend environment (the project-root `.env` file for Docker Compose, or the backend service's environment variables on your host):

```env
CHATBOT_API_KEY=your-provider-api-key
CHATBOT_API_URL=https://api.openai.com/v1/responses
CHATBOT_MODEL=gpt-4o-mini
```

Keep the API key on the server. Do not expose it through a `NEXT_PUBLIC_` variable or commit a real key to Git. Restart or redeploy the backend after changing environment variables.

When no key is configured, the chatbot uses built-in FAQ answers for common registration, login, lobby, wallet, deposit, withdrawal, bonus, and referral questions. It cannot access private account records or perform account/payment actions; customers should use the relevant account page or contact site support for those requests.

The backend limits requests to 15 messages per client IP per minute per running instance. Chat history is sent to the configured AI provider for answering and is not saved by this application.
