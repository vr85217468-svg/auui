// Netlify Function — comments.js
// يجلب التعليقات الجديدة فقط باستخدام continuation token محفوظ

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

// ─── Supabase helpers ────────────────────────────────────────

// قراءة continuation المحفوظ
async function getStoredCont() {
  const r = await go(
    `${SUPA_URL}/rest/v1/chat_state?key=eq.continuation&select=value`,
    { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0]?.value || null;
}

// حفظ continuation الجديد
async function saveContToken(token) {
  await go(`${SUPA_URL}/rest/v1/chat_state`, {
    method: "POST",
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ key: "continuation", value: token }),
  }).catch(() => { });
}

// حفظ التعليقات
async function saveMessages(rows) {
  if (!rows.length) return "empty";
  const r = await go(`${SUPA_URL}/rest/v1/comments`, {
    method: "POST",
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  return `${r.status}`;
}

// ─── YouTube ─────────────────────────────────────────────────

// جلب continuation أولي من صفحة يوتيوب
async function getInitialCont() {
  const page = await go(`https://www.youtube.com/watch?v=${VIDEO_ID}`, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
  });
  const html = await page.text();

  const ytKey = (html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/) || [])[1] || "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
  const clientVer = (html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/) || [])[1] || "2.20240201.00.00";
  const visitorId = (html.match(/"visitorData"\s*:\s*"([^"]+)"/) || [])[1] || "";

  const patterns = [
    /"invalidationContinuationData"\s*:\s*\{[^}]{0,100}"continuation"\s*:\s*"([^"]+)"/,
    /"timedContinuationData"\s*:\s*\{[^}]{0,100}"continuation"\s*:\s*"([^"]+)"/,
    /"reloadContinuationData"\s*:\s*\{"continuation"\s*:\s*"([^"]+)"/,
    /liveChatRenderer[\s\S]{0,2000}?"continuation"\s*:\s*"([^"]{20,})"/,
  ];

  let cont = null;
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]?.length > 20) { cont = m[1]; break; }
  }

  return { cont, ytKey, clientVer, visitorId };
}

// جلب التعليقات الجديدة باستخدام continuation
async function fetchChat(cont, ytKey, clientVer, visitorId) {
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
  const liveCon = data?.continuationContents?.liveChatContinuation;
  const actions = liveCon?.actions || [];

  // استخراج continuation الجديد من الرد (يشير للرسائل التالية)
  const conts = liveCon?.continuations || [];
  const nextCont =
    conts[0]?.invalidationContinuationData?.continuation ||
    conts[0]?.timedContinuationData?.continuation ||
    conts[0]?.reloadContinuationData?.continuation || null;

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

  return { msgs, nextCont };
}

// ─── Handler ─────────────────────────────────────────────────
exports.handler = async function () {
  const debug = {};
  let messages = [];

  try {
    // 1. هل لدينا continuation محفوظ من آخر مرة؟
    let storedCont = await getStoredCont();

    // 2. جلب معلومات يوتيوب
    const { cont: freshCont, ytKey, clientVer, visitorId } = await getInitialCont();

    // استخدم المحفوظ أو الجديد
    const useCont = storedCont || freshCont;
    debug.usedStored = !!storedCont;
    debug.hasCont = !!useCont;

    if (!useCont) {
      debug.reason = "البث غير نشط";
      return respond([], debug);
    }

    // 3. جلب التعليقات
    const { msgs, nextCont } = await fetchChat(useCont, ytKey, clientVer, visitorId);
    messages = msgs;
    debug.fetched = msgs.length;

    // 4. حفظ continuation الجديد (للاستدعاء التالي يجلب رسائل جديدة)
    if (nextCont) {
      await saveContToken(nextCont);
      debug.nextContSaved = true;
    }

    // 5. حفظ الرسائل في Supabase
    debug.saveResult = await saveMessages(msgs);

  } catch (e) {
    debug.error = e.message;
  }

  return respond(messages, debug);
};

function respond(messages, debug) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ messages, count: messages.length, debug }),
  };
}
