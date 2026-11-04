import { Bot, InputFile } from "grammy";
import { Redis } from "@upstash/redis";

export const bot = new Bot(process.env.BOT_TOKEN);

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});

const ADMINS = new Set(
  (process.env.ADMIN_IDS || "").split(",").map((s) => Number(s.trim())).filter(Boolean)
);

const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getUser = (id) => redis.hget("spidey_approval_users", String(id));
const setUser = (id, data) => redis.hset("spidey_approval_users", { [id]: data });
const allUsers = async () =>
  Object.entries((await redis.hgetall("spidey_approval_users")) || {}).map(([id, u]) => ({ id: Number(id), ...u }));

bot.on("chat_join_request", async (ctx) => {
  const { from: user, chat, user_chat_id } = ctx.chatJoinRequest;
  const old = await getUser(user.id);

  if (old?.banned) {
    await ctx.api.declineChatJoinRequest(chat.id, user.id);
    return;
  }

  await ctx.api.approveChatJoinRequest(chat.id, user.id);
  await setUser(user.id, {
    name: user.first_name || "",
    username: user.username || "",
    chatId: chat.id,
    chatTitle: chat.title || "",
    banned: false,
    joinedAt: old?.joinedAt || new Date().toISOString(),
  });

  try {
    await ctx.api.sendMessage(
      user_chat_id,
      `👋 Hi <b>${esc(user.first_name || "there")}</b>!\n\n<b>${esc(chat.title || "Channel")}</b> channel ku welcome! 🎉\nUn request approve aagiduchu ✅`,
      { parse_mode: "HTML" }
    );
  } catch {}
});

bot.command("start", (ctx) => ctx.reply("Bot running ✅"));

const admin = bot.filter((ctx) => ADMINS.has(ctx.from?.id) && ctx.chat?.type === "private");

admin.command("ban", async (ctx) => {
  const id = parseInt(ctx.match);
  if (!id) return ctx.reply("Usage: /ban <user_id>");
  const u = (await getUser(id)) || {};
  await setUser(id, { ...u, banned: true });
  if (u.chatId) {
    try { await ctx.api.banChatMember(u.chatId, id); } catch {}
  }
  await ctx.reply(`🚫 ${id} banned`);
});

admin.command("unban", async (ctx) => {
  const id = parseInt(ctx.match);
  if (!id) return ctx.reply("Usage: /unban <user_id>");
  const u = (await getUser(id)) || {};
  await setUser(id, { ...u, banned: false });
  if (u.chatId) {
    try { await ctx.api.unbanChatMember(u.chatId, id, { only_if_banned: true }); } catch {}
  }
  await ctx.reply(`✅ ${id} unbanned`);
});

admin.command("users", async (ctx) => {
  const list = await allUsers();
  const banned = list.filter((u) => u.banned).length;
  const txt =
    list
      .map((u) => `${u.id} | ${u.name} | @${u.username} | ${u.chatTitle} | ${u.banned ? "BANNED" : "active"}`)
      .join("\n") || "No users";
  await ctx.replyWithDocument(new InputFile(Buffer.from(txt), "users.txt"), {
    caption: `Total: ${list.length}\nBanned: ${banned}\nActive: ${list.length - banned}`,
  });
});

admin.command("broadcast", async (ctx) => {
  const reply = ctx.msg.reply_to_message;
  const text = ctx.match;
  if (!reply && !text) return ctx.reply("Usage: /broadcast <text>\nor reply to any message with /broadcast");

  const ids = (await allUsers()).filter((u) => !u.banned).map((u) => u.id);
  await ctx.reply(`Broadcasting to ${ids.length} users...`);

  let ok = 0, fail = 0, i = 0;
  const start = Date.now();

  const send = async (id) => {
    try {
      if (reply) await ctx.api.copyMessage(id, ctx.chat.id, reply.message_id);
      else await ctx.api.sendMessage(id, text);
      ok++;
    } catch (e) {
      if (e.error_code === 429) {
        await sleep((e.parameters?.retry_after || 1) * 1000);
        return send(id);
      }
      fail++;
    }
  };

  for (; i < ids.length && Date.now() - start < 45000; i += 20) {
    await Promise.all(ids.slice(i, i + 20).map(send));
    await sleep(800);
  }

  const left = Math.max(0, ids.length - i);
  await ctx.reply(`📢 Done\n✅ Sent: ${ok}\n❌ Failed: ${fail}` + (left ? `\n⏱ Not reached (time limit): ${left}` : ""));
});
