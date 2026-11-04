import { Bot, InputFile } from "grammy";
import { Redis } from "@upstash/redis";

export const bot = new Bot(process.env.BOT_TOKEN);

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});

const USERS = "spidey_approval_users";
const BC = "spidey_approval_broadcasts";
const WELCOME = "spidey_approval_welcome";
const DEFAULT_WELCOME =
  "👋 Hi {name}!\n\n**{channel}** channel ku welcome! 🎉\nUn request approve aagiduchu ✅";

const ADMINS = new Set(
  (process.env.ADMIN_IDS || "").split(",").map((s) => Number(s.trim())).filter(Boolean)
);

const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (s) =>
  esc(s)
    .replace(/\*\*\*(.+?)\*\*\*/gs, "<b><i>$1</i></b>")
    .replace(/\*\*(.+?)\*\*/gs, "<b>$1</b>")
    .replace(/__(.+?)__/gs, "<i>$1</i>");

const safe = async (fn, fallback = null) => {
  try {
    return await fn();
  } catch (e) {
    console.error("redis error:", e?.message);
    return fallback;
  }
};

const getUser = (id) => redis.hget(USERS, String(id));
const setUser = (id, data) => redis.hset(USERS, { [id]: data });
const allUsers = async () =>
  Object.entries((await redis.hgetall(USERS)) || {}).map(([id, u]) => ({ id: Number(id), ...u }));
const line = (u) =>
  `${u.id} | ${u.name} | @${u.username} | ${u.chatTitle} | ${u.banned ? "BANNED" : "active"}`;

bot.catch((err) => {
  console.error("bot error:", err?.error?.message || err?.message);
});

bot.on("chat_join_request", async (ctx) => {
  const { from: user, chat, user_chat_id } = ctx.chatJoinRequest;
  const old = await safe(() => getUser(user.id));

  if (old?.banned) {
    await ctx.api.declineChatJoinRequest(chat.id, user.id);
    return;
  }

  await ctx.api.approveChatJoinRequest(chat.id, user.id);

  await safe(() =>
    setUser(user.id, {
      name: user.first_name || "",
      username: user.username || "",
      chatId: chat.id,
      chatTitle: chat.title || "",
      banned: false,
      joinedAt: old?.joinedAt || new Date().toISOString(),
    })
  );

  const tpl = (await safe(() => redis.get(WELCOME))) || DEFAULT_WELCOME;
  const html = fmt(tpl)
    .replaceAll("{name}", esc(user.first_name || "there"))
    .replaceAll("{channel}", esc(chat.title || "Channel"));
  try {
    await ctx.api.sendMessage(user_chat_id, html, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  } catch {}
});

bot.command("start", (ctx) => ctx.reply("Bot running ✅"));

const admin = bot.filter((ctx) => ADMINS.has(ctx.from?.id) && ctx.chat?.type === "private");

admin.command("ban", async (ctx) => {
  const id = parseInt(ctx.match);
  if (!id) return ctx.reply("Usage: /ban <user_id>");
  const u = (await safe(() => getUser(id))) || {};
  await setUser(id, { ...u, banned: true });
  if (u.chatId) {
    try { await ctx.api.banChatMember(u.chatId, id); } catch {}
  }
  await ctx.reply(`🚫 ${id} banned`);
});

admin.command("unban", async (ctx) => {
  const id = parseInt(ctx.match);
  if (!id) return ctx.reply("Usage: /unban <user_id>");
  const u = (await safe(() => getUser(id))) || {};
  await setUser(id, { ...u, banned: false });
  if (u.chatId) {
    try { await ctx.api.unbanChatMember(u.chatId, id, { only_if_banned: true }); } catch {}
  }
  await ctx.reply(`✅ ${id} unbanned`);
});

admin.command(["users", "userlist"], async (ctx) => {
  const list = await allUsers();
  const banned = list.filter((u) => u.banned).length;
  const txt = list.map(line).join("\n") || "No users";
  await ctx.replyWithDocument(new InputFile(Buffer.from(txt), "users.txt"), {
    caption: `Total: ${list.length}\nBanned: ${banned}\nActive: ${list.length - banned}`,
  });
});

admin.command("bans", async (ctx) => {
  const list = (await allUsers()).filter((u) => u.banned);
  if (!list.length) return ctx.reply("No banned users");
  if (list.length <= 40) return ctx.reply(list.map(line).join("\n"));
  await ctx.replyWithDocument(new InputFile(Buffer.from(list.map(line).join("\n")), "banned.txt"), {
    caption: `Banned: ${list.length}`,
  });
});

admin.command("broadcast", async (ctx) => {
  const reply = ctx.msg.reply_to_message;
  const text = ctx.match;
  if (!reply && !text) return ctx.reply("Usage: /broadcast <text>\nor reply to any message with /broadcast");

  const ids = (await allUsers()).filter((u) => !u.banned).map((u) => u.id);
  await ctx.reply(`Broadcasting to ${ids.length} users...`);

  const sent = [];
  let fail = 0, i = 0;
  const start = Date.now();

  const send = async (id) => {
    try {
      const r = reply
        ? await ctx.api.copyMessage(id, ctx.chat.id, reply.message_id)
        : await ctx.api.sendMessage(id, text);
      sent.push([id, r.message_id]);
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

  const bid = Date.now().toString(36);
  if (sent.length) await safe(() => redis.hset(BC, { [bid]: sent }));

  const left = Math.max(0, ids.length - i);
  await ctx.reply(
    `📢 Done\n✅ Sent: ${sent.length}\n❌ Failed: ${fail}` +
      (left ? `\n⏱ Not reached (time limit): ${left}` : "") +
      (sent.length ? `\n\n🆔 ${bid}\nUndo: /delete ${bid}` : "")
  );
});

admin.command("delete", async (ctx) => {
  const bid = ctx.match.trim();
  if (!bid) return ctx.reply("Usage: /delete <broadcast_id>");
  const items = await safe(() => redis.hget(BC, bid));
  if (!items || !items.length) return ctx.reply("Broadcast ID not found");

  let ok = 0, fail = 0, i = 0;
  const start = Date.now();

  for (; i < items.length && Date.now() - start < 45000; i += 20) {
    await Promise.all(
      items.slice(i, i + 20).map(async ([chatId, msgId]) => {
        try {
          await ctx.api.deleteMessage(chatId, msgId);
          ok++;
        } catch {
          fail++;
        }
      })
    );
    await sleep(800);
  }

  const rest = items.slice(i);
  if (rest.length) await safe(() => redis.hset(BC, { [bid]: rest }));
  else await safe(() => redis.hdel(BC, bid));

  await ctx.reply(`🗑 Deleted: ${ok}\n❌ Failed: ${fail}` + (rest.length ? `\n⏱ Remaining: ${rest.length}, run /delete ${bid} again` : ""));
});

admin.command("post", async (ctx) => {
  const r = ctx.msg.reply_to_message;
  if (!r) return ctx.reply("Reply to a message with /post");
  const chats = [...new Set((await allUsers()).map((u) => u.chatId).filter(Boolean))];
  for (const c of chats) {
    try { await ctx.api.copyMessage(c, ctx.chat.id, r.message_id); } catch {}
  }
  await ctx.reply(`📣 Posted to ${chats.length} channel(s)`);
});

admin.command("setwelcome", async (ctx) => {
  const t = ctx.match.trim();
  if (!t) {
    const cur = (await safe(() => redis.get(WELCOME))) || DEFAULT_WELCOME;
    return ctx.reply(`Current welcome:\n\n${cur}\n\nChange: /setwelcome <text>\nReset: /setwelcome reset`);
  }
  if (t === "reset") {
    await redis.del(WELCOME);
    return ctx.reply("Reset ✅");
  }
  await redis.set(WELCOME, t);
  await ctx.reply("Welcome message saved ✅");
});
