import { bot } from "../lib/bot.js";

export default async function handler(req, res) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret || req.query.key !== secret) return res.status(401).send("unauthorized");

  const url = `https://${req.headers.host}/api/webhook`;
  await bot.api.setWebhook(url, {
    secret_token: secret,
    allowed_updates: ["message", "chat_join_request"],
    drop_pending_updates: true,
  });
  res.status(200).send(`Webhook set: ${url}`);
}
