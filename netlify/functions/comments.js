// Netlify Function — comments.js
// يجلب التعليقات ويحفظها — لا ينكسر أبداً

const VIDEO_ID = "6_9ZiuONXt0";
const SUPA_URL = process.env.SUPABASE_URL || "https://amuopyagznrsyojqxaqp.supabase.co";
const SUPA_KEY = process.env.SUPABASE_KEY || "sb_publishable_VEEiRh3zLWxhzIwgJBcvLw_f0hABb0u";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

async function go(url, opts = {}, ms = 8000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(t); }
}

// ─── جلب التعليقات من يوتيوب ─────────────────────────────────
async function getYouTubeChat() {
  const page = await go(`https://www.youtube.com/watch?v=${VIDEO_ID}`, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
  });
  const html = await page.text();

  const ytKey = (html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/) || [])[1] || "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
  const clientVer = (html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/) || [])[1] || "2.20240201.00.00";
  const visitorId = (html.match(/"visitorData"\s*:\s*"([^"]+)"/) || [])[1] || "";

  // نبحث عن invalidation أو timed أولاً (للرسائل الجديدة)
  const patterns = [
    /"invalidationContinuationData"\s*:\s*\{[^}]{0,200}"continuation"\s*:\s*"([^"]+)"/,
    /"timedContinuationData"\s*:\s*\{[^}]{0,200}"continuation"\s*:\s*"([^"]+)"/,
    /"reloadContinuationData"\s*:\s*\{"continuation"\s*:\s*"([^"]+)"/,
    /liveChatRenderer[\s\S]{0,2000}?"continuation"\s*:\s*"([^"]{20,})"/,
  ];

  let cont = null;
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]?.length > 20) { cont = m[1]; break; }
  }
  if (!cont) return [];

  const chatRes = await go(
    `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${ytKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://www.youtube.com",
        "Referer": `https://www.youtube.com/watch?v=${VIDEO_ID}`,
        "X-YouTube-Client-Name": "1",
        "X-YouTube-Client-Version": clientVer,
        "X-Goog-Visitor-Id": visitorId,
      },
      body: JSON.stringify({
        context: { client: { clientName: "WEB", clientVersion: clientVer, visitorData: visitorId } },
        continuation: cont,
      }),
    }
  );

  const data = await chatRes.json();
  const actions = data?.continuationContents?.liveChatContinuation?.actions || [];
  const iraqNow = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

  const msgs = [];
  for (const a of actions) {
    const r = a?.addChatItemAction?.item?.liveChatTextMessageRenderer;
    if (!r) continue;
    const text = (r.message?.runs || []).map(x => x.text || "").join("").trim();
    if (!text) continue;
    msgs.push({
      youtube_id: r.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      author: r.authorName?.simpleText?.trim() || "مجهول",
      message: text,
      created_at: iraqNow,
    });
  }
  return msgs;
}

// ─── Handler ─────────────────────────────────────────────────
exports.handler = async function () {
  let messages = [];
  let saveStatus = null;

  // 1. جلب من يوتيوب — إذا فشل نرجع مصفوفة فارغة
  try {
    messages = await getYouTubeChat();
  } catch (e) {
    messages = [];
  }

  // 2. حفظ في Supabase — ننتظر الاكتمال لكن لا نوقف الدالة إذا فشل
  if (messages.length > 0) {
    try {
      const r = await go(`${SUPA_URL}/rest/v1/comments`, {
        method: "POST",
        headers: {
          apikey: SUPA_KEY,
          Authorization: `Bearer ${SUPA_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=ignore-duplicates,return=minimal",
        },
        body: JSON.stringify(messages),
      });
      saveStatus = r.status;
    } catch (e) {
      saveStatus = "error: " + e.message;
    }
  }

  // 3. الرد — دائماً نرجع التعليقات من يوتيوب مباشرةً
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ messages, count: messages.length, saveStatus }),
  };
};
