export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-telegram-bot-api-secret-token",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (!env.BOT_TOKEN) {
      return new Response("BOT_TOKEN缺失!", { status: 500 });
    }

    // অটো সিক্রেট টোকেন তৈরি
    const AUTO_SECRET_TOKEN = await generateSecretToken(env.BOT_TOKEN);

    // -------------------------------------------------------------------
    // ০১. অটো Webhook সেটআপ (/setup)
    // -------------------------------------------------------------------
    if (url.pathname === "/setup") {
      const webhookUrl = `${url.origin}/webhook`;
      const tgRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: AUTO_SECRET_TOKEN,
          drop_pending_updates: true
        })
      });
      const data = await tgRes.json();
      return new Response(JSON.stringify(data), { headers: corsHeaders });
    }

    // -------------------------------------------------------------------
    // ০২. Telegram Bot Webhook (/webhook) - রেফারেল ও বট অ্যাকশন
    // -------------------------------------------------------------------
    if (url.pathname === "/webhook" && request.method === "POST") {
      const secret = request.headers.get("x-telegram-bot-api-secret-token");
      if (secret !== AUTO_SECRET_TOKEN) return new Response("Unauthorized", { status: 403 });

      const update = await request.json();

      // মেসেজ হ্যান্ডলার
      if (update.message) {
        const chatId = update.message.chat.id;
        const text = update.message.text || "";

        // ১. রেফারেল সিস্টেম চেক (/start ref_123456)
        if (text.startsWith("/start")) {
          let user = await getUserData(env.USERS_KV, chatId);
          
          const parts = text.split(" ");
          if (parts.length > 1 && parts[1].startsWith("ref_")) {
            const referrerId = parts[1].replace("ref_", "");
            
            // যদি ইউজার একদম নতুন হয়, তবে রেফারকারীর পয়েন্ট বাড়ানো হবে
            if (!user.registered && referrerId !== String(chatId)) {
              let referrer = await getUserData(env.USERS_KV, referrerId);
              referrer.referrals = (referrer.referrals || 0) + 1;
              await saveUserData(env.USERS_KV, referrerId, referrer);
              await sendMessage(env.BOT_TOKEN, referrerId, `🎉 অভিনন্দন! নতুন ১ জন আপনার রেফারে জয়েন করেছে। মোট রেফার: ${referrer.referrals}`);
            }
          }

          user.registered = true;
          await saveUserData(env.USERS_KV, chatId, user);

          // বট কিবোর্ড মেনু পাঠানো
          const keyboard = {
            inline_keyboard: [
              [{ text: "🚀 ওপেন Mini App (৫ সেকেন্ড থাকুন)", web_app: { url: url.origin } }],
              [{ text: "💰 ডিপোজিট ভেরিফাই", callback_data: "deposit" }, { text: "💳 উইথড্র ভেরিফাই", callback_data: "withdraw" }],
              [{ text: "📺 অ্যাড দেখুন", callback_data: "watch_ad" }],
              [{ text: "📊 ভেরিফিকেশন স্ট্যাটাস চেক", callback_data: "check_status" }]
            ]
          };
          await sendMessageWithKeyboard(env.BOT_TOKEN, chatId, "স্বাগতম! ভেরিফিকেশন সম্পন্ন করতে নিচের কাজগুলো পূরণ করুন:", keyboard);
        }
      }

      // বাটন ক্লিকের হ্যান্ডলার (Callback Query)
      if (update.callback_query) {
        const chatId = update.callback_query.message.chat.id;
        const data = update.callback_query.data;
        let user = await getUserData(env.USERS_KV, chatId);

        if (data === "deposit") {
          user.deposit_done = true;
          await sendMessage(env.BOT_TOKEN, chatId, "✅ ডিপোজিট টাস্ক সফল হয়েছে!");
        } else if (data === "withdraw") {
          user.withdraw_done = true;
          await sendMessage(env.BOT_TOKEN, chatId, "✅ উইথড্র টাস্ক সফল হয়েছে!");
        } else if (data === "watch_ad") {
          user.ad_watched = true;
          await sendMessage(env.BOT_TOKEN, chatId, "✅ বিজ্ঞাপন দেখা সম্পন্ন হয়েছে!");
        } else if (data === "check_status") {
          const isEligible = user.stayed_5_sec && (user.referrals >= 1) && user.ad_watched;
          if (isEligible) {
            user.is_verified = true;
            await sendMessage(env.BOT_TOKEN, chatId, "🎊 অভিনন্দন! আপনি সম্পূর্ণ ভেরিফাইড ইউজার!");
          } else {
            await sendMessage(env.BOT_TOKEN, chatId, `⚠️ ভেরিফিকেশন বাকি:\n- ৫ সেকেন্ড অ্যাপে থাকা: ${user.stayed_5_sec ? '✅' : '❌'}\n- রেফার (কমপক্ষে ১টি): ${user.referrals >= 1 ? '✅ (' + user.referrals + ')' : '❌ (০)'}\n- অ্যাড দেখা: ${user.ad_watched ? '✅' : '❌'}`);
          }
        }

        await saveUserData(env.USERS_KV, chatId, user);
      }

      return new Response("OK", { status: 200 });
    }

    // -------------------------------------------------------------------
    // ০৩. Mini App: ৫ সেকেন্ড থাকার ভেরিফিকেশন API
    // -------------------------------------------------------------------

    // ইউজার যখন অ্যাপে প্রবেশ করবে (Start Timer)
    if (url.pathname === "/api/app-open" && request.method === "POST") {
      const { userId } = await request.json();
      let user = await getUserData(env.USERS_KV, userId);
      user.opened_at = Date.now(); // প্রবেশের সময় নোট করা হলো
      await saveUserData(env.USERS_KV, userId, user);

      return new Response(JSON.stringify({ status: "timer_started" }), { headers: corsHeaders });
    }

    // ৫ সেকেন্ড পর ফ্রন্টএন্ড থেকে এই API কল হবে
    if (url.pathname === "/api/verify-time" && request.method === "POST") {
      const { userId } = await request.json();
      let user = await getUserData(env.USERS_KV, userId);

      const currentTime = Date.now();
      const timeSpent = (currentTime - (user.opened_at || currentTime)) / 1000;

      // ৫ সেকেন্ড বা তার বেশি ছিল কি না যাচাই
      if (timeSpent >= 5) {
        user.stayed_5_sec = true;
        await saveUserData(env.USERS_KV, userId, user);
        return new Response(JSON.stringify({ success: true, message: "৫ সেকেন্ড ভেরিফিকেশন সফল!" }), { headers: corsHeaders });
      } else {
        return new Response(JSON.stringify({ success: false, message: "আপনি ৫ সেকেন্ড অপেক্ষা করেননি!" }), { headers: corsHeaders });
      }
    }

    // ইউজার স্ট্যাটাস চেক API
    if (url.pathname === "/api/user-status" && request.method === "GET") {
      const userId = url.searchParams.get("userId");
      const user = await getUserData(env.USERS_KV, userId);
      return new Response(JSON.stringify(user), { headers: corsHeaders });
    }

    return new Response("Worker is running!", { status: 200 });
  }
};

// -------------------------------------------------------------------
// ডাটাবেজ (Cloudflare KV) হেল্পার ফাংশন
// -------------------------------------------------------------------
async function getUserData(kv, userId) {
  const data = await kv.get(`user_${userId}`);
  return data ? JSON.parse(data) : {
    userId: userId,
    registered: false,
    referrals: 0,
    opened_at: null,
    stayed_5_sec: false,
    ad_watched: false,
    deposit_done: false,
    withdraw_done: false,
    is_verified: false
  };
}

async function saveUserData(kv, userId, data) {
  await kv.put(`user_${userId}`, JSON.stringify(data));
}

// Secret Token হ্যাশ তৈরির হেল্পার
async function generateSecretToken(botToken) {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(botToken + "_auto_salt"));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// মেসেজ পাঠানোর হেল্পার
async function sendMessage(token, chatId, text) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text })
  });
}

async function sendMessageWithKeyboard(token, chatId, text, keyboard) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text, reply_markup: keyboard })
  });
}
