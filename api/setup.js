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

  await bot.api.setMyCommands([
    { command: "users", description: "List users" },
    { command: "ban", description: "Ban user" },
    { command: "unban", description: "Unban user" },
    { command: "bans", description: "Banned list" },
    { command: "broadcast", description: "Message everyone" },
    { command: "delete", description: "Delete a sent broadcast" },
    { command: "post", description: "Post to channel" },
    { command: "setwelcome", description: "Set welcome message" },
  ]);

  res.status(200).send(`Webhook + menu set: ${url}`);
}
