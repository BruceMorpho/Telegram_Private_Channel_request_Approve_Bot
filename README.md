# Telegram join-request bot (Vercel)

Auto-approves join requests, sends a welcome DM, stores users in Upstash Redis, and supports /broadcast, /ban, /unban, /users.

## Env vars (Vercel > Settings > Environment Variables)
- BOT_TOKEN: from @BotFather
- ADMIN_IDS: comma separated Telegram user IDs
- WEBHOOK_SECRET: any random string (letters, digits, _ and -)
- UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (or add Upstash Redis from the Vercel Marketplace, which sets KV_REST_API_URL / KV_REST_API_TOKEN)

## After deploy
Open once: https://YOUR-APP.vercel.app/api/setup?key=WEBHOOK_SECRET
