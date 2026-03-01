// Netlify Function — comments.js
// يقرأ التعليقات من Supabase (Python script يجلبها من يوتيوب)

const SUPA_URL = process.env.SUPABASE_URL || "https://amuopyagznrsyojqxaqp.supabase.co";
const SUPA_KEY = process.env.SUPABASE_KEY || "sb_publishable_VEEiRh3zLWxhzIwgJBcvLw_f0hABb0u";

async function go(url, opts = {}, ms = 8000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(t); }
}

exports.handler = async function () {
  try {
    // جلب آخر 200 تعليق مرتبة تصاعدياً (الأحدث في الأسفل)
    const res = await go(
      `${SUPA_URL}/rest/v1/comments?select=id,author,message,created_at&order=created_at.desc&limit=200`,
      { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
    );

    const messages = res.ok ? (await res.json()).reverse() : [];

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ messages, count: messages.length }),
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ messages: [], count: 0, error: e.message }),
    };
  }
};
