const express = require("express");
const multer = require("multer");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const BOT_TOKEN = process.env.BOT_TOKEN;

// টেলিগ্রাম ফাইল পাথ থেকে আসল ছবি/লোগোর লিংক বের করা
async function getFileDownloadUrl(fileId) {
    if (!fileId || !BOT_TOKEN) return null;
    try {
        const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
        const data = await res.json();
        if (data.ok && data.result.file_path) {
            return `https://api.telegram.org/file/bot${BOT_TOKEN}/${data.result.file_path}`;
        }
    } catch (e) {
        return null;
    }
    return null;
}

// ১. বট ইনফো ও বটের প্রোফাইল লোগো এপিআই
app.get("/api/bot-info", async (req, res) => {
    if (!BOT_TOKEN) {
        return res.status(400).json({ ok: false, error: "BOT_TOKEN Environment Variable is not set in Vercel!" });
    }

    try {
        const meRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
        const meData = await meRes.json();
        if (!meData.ok) {
            return res.status(400).json({ ok: false, error: meData.description });
        }

        const botUser = meData.result;
        let photoUrl = null;

        // বটের প্রোফাইল ছবি সংগ্রহ
        const photosRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUserProfilePhotos?user_id=${botUser.id}&limit=1`);
        const photosData = await photosRes.json();
        if (photosData.ok && photosData.result.total_count > 0) {
            const fileId = photosData.result.photos[0][0].file_id;
            photoUrl = await getFileDownloadUrl(fileId);
        }

        res.json({
            ok: true,
            bot: {
                id: botUser.id,
                name: botUser.first_name,
                username: botUser.username,
                photoUrl: photoUrl
            }
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: "Failed to connect to Telegram API" });
    }
});

// ২. চ্যানেল বা গ্রুপ ভেরিফিকেশন এপিআই (লোগো, সাবস্ক্রাইবার ও অ্যাডমিন স্ট্যাটাস)
app.post("/api/verify-chat", async (req, res) => {
    if (!BOT_TOKEN) {
        return res.status(400).json({ ok: false, error: "BOT_TOKEN is not set!" });
    }

    let { chatInput } = req.body;
    if (!chatInput) {
        return res.status(400).json({ ok: false, error: "Please provide channel username, link, or ID!" });
    }

    // লিংক থেকে ইউজারনেম বের করা
    chatInput = chatInput.trim()
        .replace("https://t.me/", "")
        .replace("t.me/", "")
        .replace("/", "");
    if (!chatInput.startsWith("@") && isNaN(chatInput)) {
        chatInput = "@" + chatInput;
    }

    try {
        // বটের নিজের আইডি জানা
        const meRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
        const meData = await meRes.json();
        const botId = meData.result.id;

        // চ্যাট/চ্যানেলের তথ্য সংগ্রহ
        const chatRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getChat?chat_id=${encodeURIComponent(chatInput)}`);
        const chatData = await chatRes.json();

        if (!chatData.ok) {
            return res.status(400).json({ ok: false, error: `Channel/Group not found: ${chatData.description}` });
        }

        const chat = chatData.result;

        // বট অ্যাডমিন কি না যাচাই
        const memberRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(chat.id)}&user_id=${botId}`);
        const memberData = await memberRes.json();

        if (!memberData.ok || (memberData.result.status !== "administrator" && memberData.result.status !== "creator")) {
            return res.status(400).json({
                ok: false,
                error: "Bot is NOT an administrator in this channel/group! Please add the bot as admin first."
            });
        }

        // মেম্বার বা সাবস্ক্রাইবার সংখ্যা
        let memberCount = "Hidden";
        try {
            const countRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getChatMemberCount?chat_id=${encodeURIComponent(chat.id)}`);
            const countData = await countRes.json();
            if (countData.ok) memberCount = countData.result;
        } catch (e) {}

        // চ্যানেলের লোগো
        let chatPhotoUrl = null;
        if (chat.photo && chat.photo.big_file_id) {
            chatPhotoUrl = await getFileDownloadUrl(chat.photo.big_file_id);
        }

        res.json({
            ok: true,
            chat: {
                id: chat.id,
                title: chat.title,
                username: chat.username || "Private",
                type: chat.type,
                memberCount: memberCount,
                photoUrl: chatPhotoUrl,
                isAdmin: true,
                status: memberData.result.status
            }
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: "Error verifying channel on Telegram" });
    }
});

// ৩. চ্যানেলে সরাসরি পোস্ট / ফটো / ডকুমেন্ট পাবলিশ এপিআই
app.post("/api/publish-post", upload.single("mediaFile"), async (req, res) => {
    if (!BOT_TOKEN) return res.status(400).json({ ok: false, error: "BOT_TOKEN is missing" });

    const { chatId, messageText, btnText, btnUrl, isBold, isItalic } = req.body;
    if (!chatId) return res.status(400).json({ ok: false, error: "Channel ID or username is required!" });

    // টেক্সট ফরম্যাটিং
    let formattedText = (messageText || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    if (isBold === "true") formattedText = `<b>${formattedText}</b>`;
    if (isItalic === "true") formattedText = `<i>${formattedText}</i>`;

    // ইনলাইন বাটন
    let replyMarkup = undefined;
    if (btnText && btnUrl) {
        replyMarkup = {
            inline_keyboard: [[{ text: btnText, url: btnUrl }]]
        };
    }

    try {
        let telegramRes;
        if (req.file) {
            // ফাইল বা ফটো সহ পোস্ট পাঠানো
            const file = req.file;
            const isPhoto = file.mimetype.startsWith("image/");
            const endpoint = isPhoto ? "sendPhoto" : "sendDocument";

            const formData = new FormData();
            formData.append("chat_id", chatId);

            const blob = new Blob([file.buffer], { type: file.mimetype });
            formData.append(isPhoto ? "photo" : "document", blob, file.originalname);

            if (formattedText) {
                formData.append("caption", formattedText);
                formData.append("parse_mode", "HTML");
            }
            if (replyMarkup) {
                formData.append("reply_markup", JSON.stringify(replyMarkup));
            }

            const sendReq = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${endpoint}`, {
                method: "POST",
                body: formData
            });
            telegramRes = await sendReq.json();
        } else {
            // শুধু টেক্সট পোস্ট পাঠানো
            if (!formattedText) return res.status(400).json({ ok: false, error: "Text or media is required!" });

            const payload = {
                chat_id: chatId,
                text: formattedText,
                parse_mode: "HTML"
            };
            if (replyMarkup) payload.reply_markup = replyMarkup;

            const sendReq = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            telegramRes = await sendReq.json();
        }

        if (telegramRes.ok) {
            res.json({ ok: true, messageId: telegramRes.result.message_id });
        } else {
            res.status(400).json({ ok: false, error: telegramRes.description });
        }
    } catch (err) {
        res.status(500).json({ ok: false, error: "Failed to publish post" });
    }
});

// ৪. ফ্রন্টএন্ড UI (হুবহু স্ক্রিনশটের মতো ডার্ক কার্ড ও বাটন)
app.get("/", (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Channel Verification & Publisher</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        body { background: #0c0f17; color: #f8fafc; padding: 16px; display: flex; justify-content: center; min-height: 100vh; }
        .container { width: 100%; max-width: 480px; }

        /* স্ক্রিনশটের হুবহু কার্ড স্টাইল */
        .verification-card {
            background: #171511;
            border: 1px solid #3d2f17;
            border-radius: 20px;
            padding: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.7);
            margin-bottom: 20px;
        }

        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }

        .header-title {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 15px;
            font-weight: 700;
            color: #f59e0b;
        }

        .bot-badge {
            background: #2b200b;
            border: 1px solid #6b4d1b;
            color: #f59e0b;
            font-size: 12px;
            font-weight: 700;
            padding: 4px 10px;
            border-radius: 20px;
            font-family: monospace;
        }

        .card-desc {
            font-size: 13.5px;
            line-height: 1.5;
            color: #d6d3d1;
            margin-bottom: 20px;
        }

        /* স্ক্রিনশটের হুবহু বাটন দুটি */
        .btn-row {
            display: grid;
            grid-template-columns: 1.6fr 1fr;
            gap: 10px;
            margin-bottom: 24px;
        }

        .btn-yellow {
            background: #f59e0b;
            color: #0c0a09;
            font-weight: 800;
            font-size: 14px;
            border: none;
            border-radius: 14px;
            padding: 13px 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            cursor: pointer;
            text-decoration: none;
            box-shadow: 0 4px 14px rgba(245, 158, 11, 0.35);
            transition: 0.15s;
        }
        .btn-yellow:active { transform: scale(0.98); }

        .btn-dark {
            background: #292524;
            color: #f5f5f4;
            font-weight: 700;
            font-size: 13.5px;
            border: 1px solid #44403c;
            border-radius: 14px;
            padding: 13px 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            cursor: pointer;
            transition: 0.15s;
        }
        .btn-dark:active { transform: scale(0.98); }

        .field-label {
            font-size: 13px;
            font-weight: 600;
            color: #94a3b8;
            margin-bottom: 8px;
            display: block;
        }

        /* স্ক্রিনশটের ইনপুট ও ফটো আইকন */
        .input-group {
            position: relative;
            display: flex;
            align-items: center;
        }

        .channel-input {
            width: 100%;
            background: #0d121d;
            border: 1px solid #1e293b;
            border-radius: 14px;
            padding: 14px 50px 14px 16px;
            color: #fff;
            font-size: 14px;
            outline: none;
        }
        .channel-input:focus { border-color: #f59e0b; }

        .media-icon-btn {
            position: absolute;
            right: 10px;
            background: #1e293b;
            border: 1px solid #334155;
            color: #94a3b8;
            border-radius: 10px;
            padding: 7px 10px;
            font-size: 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        /* ভেরিফাই হওয়া চ্যানেল/গ্রুপের প্রিভিউ কার্ড */
        .verified-box {
            background: #111827;
            border: 1px solid #10b981;
            border-radius: 16px;
            padding: 14px;
            margin-top: 16px;
            display: none;
            animation: fadeIn 0.3s ease;
        }

        .verified-header {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .avatar-img {
            width: 52px;
            height: 52px;
            border-radius: 50%;
            object-fit: cover;
            border: 2px solid #10b981;
            background: #1f2937;
        }

        .verified-info h4 { font-size: 15px; color: #fff; margin-bottom: 2px; }
        .verified-info p { font-size: 12px; color: #94a3b8; }
        .verified-tag { font-size: 11px; color: #10b981; font-weight: bold; margin-top: 4px; display: inline-block; }

        /* পোস্ট পাবলিশ সেকশন */
        .publish-panel {
            background: #111827;
            border: 1px solid #1e293b;
            border-radius: 16px;
            padding: 18px;
            margin-top: 20px;
        }

        .panel-title { font-size: 14px; font-weight: 700; color: #38bdf8; margin-bottom: 12px; text-transform: uppercase; }

        .styled-textarea {
            width: 100%;
            background: #090d16;
            border: 1px solid #1e293b;
            border-radius: 12px;
            padding: 12px;
            color: #fff;
            font-size: 13.5px;
            outline: none;
            margin-bottom: 10px;
        }

        .file-status-badge {
            font-size: 12px;
            color: #34d399;
            margin-bottom: 10px;
            display: none;
        }

        .check-row { display: flex; gap: 15px; margin-bottom: 14px; font-size: 13px; color: #cbd5e1; }
        .check-row input { accent-color: #f59e0b; width: 16px; height: 16px; }

        .btn-publish {
            width: 100%;
            background: linear-gradient(180deg, #10b981 0%, #059669 100%);
            color: white;
            font-weight: 800;
            border: none;
            border-radius: 14px;
            padding: 14px;
            font-size: 15px;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4);
        }
        .btn-publish:disabled { background: #374151; cursor: not-allowed; box-shadow: none; }

        .status-msg { margin-top: 12px; font-size: 13px; text-align: center; display: none; }

        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    </style>
</head>
<body>

<div class="container">
    <!-- স্ক্রিনশটের হুবহু কার্ড -->
    <div class="verification-card">
        <div class="card-header">
            <div class="header-title">
                🤖 <span>Channel Verification: Add Bot</span>
            </div>
            <div class="bot-badge" id="botBadge">@Loading...</div>
        </div>

        <p class="card-desc">
            Add our bot as an admin to your channel/group so we can automatically verify user subscriptions.
        </p>

        <!-- স্ক্রিনশটের বাটন দুটি -->
        <div class="btn-row">
            <a href="#" target="_blank" class="btn-yellow" id="btnAddBot">
                🤖 Add Bot to Channel ↗
            </a>
            <button class="btn-dark" onclick="verifyChannelStatus()">
                🔄 Verify Status
            </button>
        </div>

        <!-- ইনপুট ও ফটো আইকন -->
        <label class="field-label">Telegram Channel or Link</label>
        <div class="input-group">
            <input type="text" id="channelInput" class="channel-input" placeholder="@channel, t.me/channel">
            <label class="media-icon-btn" title="Attach Photo or File">
                🖼️
                <input type="file" id="mediaUpload" style="display: none;" onchange="handleFileChosen(this)">
            </label>
        </div>

        <!-- ভেরিফাই হওয়া চ্যানেল কার্ড -->
        <div class="verified-box" id="verifiedBox">
            <div class="verified-header">
                <img src="" id="chatAvatar" class="avatar-img" alt="Logo">
                <div class="verified-info">
                    <h4 id="chatTitle">Channel Name</h4>
                    <p id="chatSubscribers">0 Subscribers • @username</p>
                    <span class="verified-tag">✓ Admin Rights Verified</span>
                </div>
            </div>
        </div>
    </div>

    <!-- পোস্ট পাবলিশার প্যানেল -->
    <div class="publish-panel">
        <div class="panel-title">📢 Publish Post / Media to Channel</div>

        <div class="file-status-badge" id="fileStatusBadge">Attached: None</div>

        <textarea id="postText" class="styled-textarea" rows="3" placeholder="Write post caption or message text..."></textarea>

        <div class="check-row">
            <label><input type="checkbox" id="checkBold"> <b>Bold</b></label>
            <label><input type="checkbox" id="checkItalic"> <i>Italic</i></label>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px;">
            <input type="text" id="btnTitle" class="channel-input" style="padding:10px;" placeholder="Button Title (Optional)">
            <input type="url" id="btnUrl" class="channel-input" style="padding:10px;" placeholder="Button URL (https://...)">
        </div>

        <button class="btn-publish" id="btnPublish" onclick="publishPostToChannel()">
            🚀 Publish Post to Channel
        </button>

        <div class="status-msg" id="statusMessage"></div>
    </div>
</div>

<script>
    let botUsername = "";
    let verifiedChatId = null;

    // পেজ লোড হলেই বটের তথ্য ও অটো-পারমিশন লিংক তৈরি
    window.addEventListener("DOMContentLoaded", async () => {
        try {
            const res = await fetch("/api/bot-info");
            const data = await res.json();
            if (data.ok) {
                botUsername = data.bot.username;
                document.getElementById("botBadge").innerText = "@" + botUsername;

                // ⚡ সমস্ত পারমিশন আগে থেকেই অন করে রাখার লিংক
                const adminPerms = "post_messages+edit_messages+delete_messages+invite_users+manage_chat";
                document.getElementById("btnAddBot").href = 
                    "https://t.me/" + botUsername + "?startchannel=true&admin=" + adminPerms;
            } else {
                document.getElementById("botBadge").innerText = "Token Missing";
                alert(data.error);
            }
        } catch (e) {
            console.error("Bot info fetch error:", e);
        }
    });

    // মিডিয়া ফাইল সিলেক্ট হ্যান্ডলার
    function handleFileChosen(input) {
        const badge = document.getElementById("fileStatusBadge");
        if (input.files && input.files[0]) {
            badge.style.display = "block";
            badge.innerText = "📎 Selected File: " + input.files[0].name;
        } else {
            badge.style.display = "none";
        }
    }

    // চ্যানেল ভেরিফাই করা (লোগো ও মেম্বার কাউন্ট সহ)
    async function verifyChannelStatus() {
        const inputVal = document.getElementById("channelInput").value.trim();
        if (!inputVal) return alert("Please enter @channel username or link first!");

        const box = document.getElementById("verifiedBox");
        const titleEl = document.getElementById("chatTitle");
        const subsEl = document.getElementById("chatSubscribers");
        const avatarEl = document.getElementById("chatAvatar");

        try {
            const res = await fetch("/api/verify-chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chatInput: inputVal })
            });
            const data = await res.json();

            if (data.ok) {
                verifiedChatId = data.chat.id;
                titleEl.innerText = data.chat.title;
                subsEl.innerText = data.chat.memberCount + " Members/Subscribers • @" + data.chat.username;
                avatarEl.src = data.chat.photoUrl || "https://telegram.org/img/t_logo.png";
                box.style.display = "block";
            } else {
                box.style.display = "none";
                alert(data.error);
            }
        } catch (e) {
            alert("Failed to verify status. Check your connection!");
        }
    }

    // পোস্ট ও ফাইল পাবলিশ করা
    async function publishPostToChannel() {
        const chatTarget = verifiedChatId || document.getElementById("channelInput").value.trim();
        if (!chatTarget) return alert("Verify channel or enter channel ID/username first!");

        const text = document.getElementById("postText").value.trim();
        const fileInput = document.getElementById("mediaUpload");
        const isBold = document.getElementById("checkBold").checked;
        const isItalic = document.getElementById("checkItalic").checked;
        const btnText = document.getElementById("btnTitle").value.trim();
        const btnUrl = document.getElementById("btnUrl").value.trim();

        const btnPublish = document.getElementById("btnPublish");
        const statusMsg = document.getElementById("statusMessage");

        const formData = new FormData();
        formData.append("chatId", chatTarget);
        formData.append("messageText", text);
        formData.append("isBold", isBold);
        formData.append("isItalic", isItalic);
        if (btnText && btnUrl) {
            formData.append("btnText", btnText);
            formData.append("btnUrl", btnUrl);
        }
        if (fileInput.files && fileInput.files[0]) {
            formData.append("mediaFile", fileInput.files[0]);
        }

        btnPublish.disabled = true;
        statusMsg.style.display = "block";
        statusMsg.innerText = "⏳ Publishing to Telegram...";
        statusMsg.style.color = "#38bdf8";

        try {
            const res = await fetch("/api/publish-post", {
                method: "POST",
                body: formData
            });
            const data = await res.json();

            if (data.ok) {
                statusMsg.innerText = "✅ Successfully Published to Channel!";
                statusMsg.style.color = "#10b981";
                document.getElementById("postText").value = "";
                document.getElementById("mediaUpload").value = "";
                document.getElementById("fileStatusBadge").style.display = "none";
            } else {
                statusMsg.innerText = "❌ Failed: " + data.error;
                statusMsg.style.color = "#ef4444";
            }
        } catch (e) {
            statusMsg.innerText = "❌ Network connection error!";
            statusMsg.style.color = "#ef4444";
        } finally {
            btnPublish.disabled = false;
        }
    }
</script>

</body>
</html>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;
