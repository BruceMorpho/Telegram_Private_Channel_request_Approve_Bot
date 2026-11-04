import { bot } from "../lib/bot.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("ok");

  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers["x-telegram-bot-api-secret-token"] !== secret) {
    return res.status(401).send("unauthorized");
  }

  try {
    if (!bot.isInited()) await bot.init();
    await bot.handleUpdate(req.body);
  } catch (e) {
    console.error(e);
  }
  res.status(200).send("ok");
}
