// ================================
// 🔰 基本インポート
// ================================
import fs, { existsSync, readFileSync } from 'fs';
import * as misskey from 'misskey-js';
import axios from 'axios';
import { google } from 'googleapis';
import TinySegmenter from 'tiny-segmenter';

console.log("=== DEBUG START ===");

// ================================
// 🧠 JSON.parse 監視（HTML誤爆検知）
// ================================
const nativeParse = JSON.parse;
JSON.parse = function(text, reviver) {
    try {
        return nativeParse(text, reviver);
    } catch (err) {
        if (typeof text === 'string' && text.trim().startsWith('<!')) {
            console.error("━━━━━━━━━━━━ 🚨 JSON.parse 失敗検知 🚨 ━━━━━━━━━━━━");
            console.error("HTMLをパースしようとしました。内容のタイトル:");
            const title = text.match(/<title>(.*?)<\/title>/i);
            console.error(`PAGE TITLE: ${title ? title[1] : "不明"}`);
            console.error("内容(冒頭):", text.substring(0, 1000));
            console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        }
        throw err;
    }
};

// ================================
// 🔐 環境変数チェック（HTML混入検知）
// ================================
try {
    const rawGdrive = process.env.GDRIVE_SERVICE_ACCOUNT;
    if (rawGdrive && rawGdrive.trim().startsWith('<')) {
        console.error("🚨 警告: 環境変数 GDRIVE_SERVICE_ACCOUNT の中身がすでに HTML です！");
        console.error("冒頭部分:", rawGdrive.substring(0, 100));
    }
} catch (e) {}

// ================================
// 🧩 共通ユーティリティ
// ================================
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const segmenter = new TinySegmenter();

const particles = ["が", "の", "を", "と", "に", "から", "は", "も", "で"];

// ================================
// 🔑 APIキー管理（時間切替）
// ================================
const keyMain = process.env.GEMINI_API_KEY;
const keySub = process.env.GEMINI_API_KEY_SUB;

const now = new Date();
const jstHour = (now.getUTCHours() + 9) % 24;

const currentKey = (jstHour >= 12) ? keyMain : (keySub || keyMain);

console.log(`Mainキーの長さ: ${keyMain?.length}, Subキーの長さ: ${keySub?.length}`);
console.log(`【システム情報】現在時刻: ${jstHour}時 / 使用APIキー: ${jstHour >= 12 ? '午後(メイン)' : '午前(サブ)'}`);

// ================================
// 🤖 Misskey初期化
// ================================
const config = {
    domain: process.env.MK_DOMAIN,
    token: process.env.MK_TOKEN,
    geminiKey: currentKey,
    characterSetting: "ひみつ"
};

const mk = new misskey.api.APIClient({
    origin: `https://${config.domain}`,
    credential: config.token
});

// ================================
// ☁️ Google Driveクライアント（統一版）
// ================================
async function getDriveAuth() {
    const envData = process.env.GDRIVE_SERVICE_ACCOUNT;

    if (!envData) {
        throw new Error("Credentials env is empty.");
    }

    const credentials = JSON.parse(envData);

    console.log("PRIVATE_KEY CHECK:", credentials.private_key.slice(0, 50));

    credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');

    const auth = new google.auth.JWT(
        credentials.client_email,
        null,
        credentials.private_key,
        ['https://www.googleapis.com/auth/drive']
    );

    await auth.authorize();

    const getToken = async () => {
        const token = await auth.getAccessToken();
        return token?.token || token;
    };

    return {
        files: {
            get: async ({ fileId, alt = 'media' }) => {
                const token = await getToken();

                const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`;

                const res = await axios.get(url, {
                    params: {
                        alt,
                        supportsAllDrives: true
                    },
                    headers: {
                        Authorization: `Bearer ${token}`
                    },
                    responseType: 'text',
                    validateStatus: () => true
                });

                if (res.status < 200 || res.status >= 300) {
                    const err = new Error(`Drive GET failed: ${res.status}`);
                    err.response = res;
                    throw err;
                }

                return res;
            },

            update: async ({ fileId, media }) => {
                const token = await getToken();

                const url = `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}`;

                const res = await axios.patch(url, media.body, {
                    params: {
                        uploadType: 'media',
                        supportsAllDrives: true
                    },
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': media.mimeType || 'application/json; charset=utf-8'
                    },
                    responseType: 'text',
                    validateStatus: () => true
                });

                if (res.status < 200 || res.status >= 300) {
                    const err = new Error(`Drive UPDATE failed: ${res.status}`);
                    err.response = res;
                    throw err;
                }

                return res;
            }
        }
    };
}
// ================================
// 🤖 Gemini問い合わせ（元コード維持）
// ================================
async function askGemini(prompt) {
     
    const modelPriority = [
        "gemini-3.1-flash-lite-preview",
        "gemini-3.1-flash-preview",
        "gemini-3.1-pro-preview",
        "gemini-3-flash-preview",
        "gemini-3-flash-lite-preview",
        "gemini-3-pro-preview",
        "gemini-3-flash-live",
        "gemini-3-flash-live-8k",
        "gemini-2.5-flash-lite",
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-2.0-flash",
        "gemini-1.5-flash",
        "gemini-1.5-pro"
    ];

    const errorMessages = [
        "民主主義パンチ！！！！！！！！！！！ﾎﾞｺｫ(エラー)",
        "ザンギエフしゅおしゅおびーむ(エラー)",
        "エラー！管理者何とかしろ！",
        "肌荒れと自走砲が！！！！(エラー)",
        "粉消しゴム美味しいよ(エラー)",
        "親から将来の夢無くなりました(エラー)",
        "髪の毛の年越しARねぎま塩(エラー)",
        "枝豆あげるw(エラー)",
        "もう帰りたい、眠い、学校なう！⊂(^ω^)⊃(エラー)"]

    const getRandomError = () =>
        errorMessages[Math.floor(Math.random() * errorMessages.length)];

    for (const modelId of modelPriority) {

        const url = `https://generativelanguage.googleapis.com/v1/models/${modelId}:generateContent?key=${currentKey}`;

        try {

            console.log(`モデル試行中: ${modelId}`);

            const res = await axios.post(url, {
                contents: [
                    {
                        role: "user",
                        parts: [{ text: prompt }]
                    }
                ]
            }, {
                headers: {
                    "Content-Type": "application/json"
                }
            });

            const text =
                res.data?.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!text) {
                console.warn("⚠️ レスポンスが空。次のモデルへ");
                continue;
            }

            return text;

        } catch (error) {

            const status = error.response?.status;
            const data = error.response?.data;

            // 🔥 HTML検知（超重要）
            if (typeof data === "string" && data.startsWith("<!")) {
                console.warn("⚠️ HTMLレスポンス検知 → 次のモデルへ");
                continue;
            }

            // 🔥 スキップ対象拡張
            if ([400, 404, 429].includes(status)) {
                console.warn(`⚠️ ${modelId} スキップ (${status})`);
                continue;
            }

            console.error(`致命的エラー (${modelId}):`, error.message);
            return getRandomError();
        }
    }

    return getRandomError();

}
// ================================
// 🤝 フォロバ & リムバ
// ================================
async function handleFollowControl(my_id) {
console.log("停止中")
}

// ================================
// 💬 メンション処理（完全保持版）
// ================================
async function handleMentions(me) {
console.log("停止中")
}
// ================================
// 🧠 脳データ読み込み（完全安全版）
// ================================
async function loadBrainFromDrive(drive) {

    console.log("=== MARKOV MODE DEBUG ===");
    console.log(`GDRIVE_FILE_ID: "${process.env.GDRIVE_FILE_ID}"`);

    try {

        const fileId = process.env.GDRIVE_FILE_ID?.trim();

        if (!fileId) {
            throw new Error("環境変数 GDRIVE_FILE_ID が読み込めていません！");
        }

        const res = await drive.files.get(
            { fileId, alt: 'media' },
            { responseType: 'text' }
        );

        console.log("RESPONSE DATA TYPE:", typeof res.data);

        let rawData;

        if (typeof res.data === 'object') {
            rawData = JSON.stringify(res.data);
        } else {
            rawData = String(res.data);
        }

        console.log("RESPONSE HEAD:", rawData.substring(0, 300));

        // ============================
        // 🚨 HTML誤爆検知（最重要）
        // ============================
        if (rawData.trim().startsWith('<!')) {

            const titleMatch = rawData.match(/<title>(.*?)<\/title>/i);

            console.error(
                `🚨 Apache/GoogleからHTMLが返されました: ${
                    titleMatch ? titleMatch[1] : 'No Title'
                }`
            );

            console.error("HTML冒頭:", rawData.substring(0, 200));

            return {};
        }

        // ============================
        // 📭 空データ
        // ============================
        if (!rawData || rawData.trim() === "") {

            console.log("脳のデータが空でした。新規作成します。");

            return {};
        }

        // ============================
        // 🧠 JSON復元
        // ============================
        try {

            const brain =
                (typeof rawData === 'string')
                    ? JSON.parse(rawData.trim())
                    : rawData;

            const wordCount = Object.keys(brain).length;

            console.log(`✅ 現在の脳の蓄積語数: ${wordCount}語`);

            return brain;

        } catch (pErr) {

            console.error("🚨 JSONパースエラー:", pErr.message);
            console.error("受信データ冒頭:", rawData.substring(0, 100));

            return {};
        }

    } catch (e) {

        console.error(`❌ Google Drive接続致命的エラー: ${e.message}`);

        if (e.config) {
            console.error("Request URL:", e.config.url);
        }

        return {};
    }
}

// ================================
// 🧹 脳クリーニング（元ロジック維持）
// ================================
function cleanBrain(brain) {

    console.log("既存の脳をスキャンしてゴミ掃除中...");

    Object.keys(brain).forEach(key => {

        const isInvalidKey =
            key.includes('\n') ||
            key.includes('\\n') ||
            key.includes('　') ||
            key.includes('<') ||
            key.includes('\\') ||
            key.includes('small') ||
            key.includes('color') ||
            key.includes('\\u') ||
            key.includes(':') ||
            key.includes('@') ||
            /[\uD800-\uDBFF]/.test(key) ||
            /[\uDC00-\uDFFF]/.test(key) ||
            key.includes('_') ||
            /:.*:/.test(key);

        let list = brain[key];

        if (Array.isArray(list)) {

            brain[key] = list.filter(w => {

                if (typeof w !== 'string') return false;

                if (
                    w.includes('\\n') ||
                    w.includes('　') ||
                    w.includes('@') ||
                    w.includes('<') ||
                    w.includes('\\') ||
                    w.includes('small') ||
                    w.includes('color') ||
                    w.includes('\\u') ||
                    w.includes(':') ||
                    w.includes('_') ||
                    /[\uD800-\uDBFF]/.test(w) ||
                    /[\uDC00-\uDFFF]/.test(w)
                ) return false;

                return w.trim() !== "";
            });
        }

        if (isInvalidKey || !brain[key] || brain[key].length === 0) {
            delete brain[key];
        }
    });

    console.log("脳のクリーニング完了！");
    return brain;
}

// ================================
// 📚 学習処理（安全版）
// ================================
function learnBrain(brain, words, tl_text) {
    
    const kanaBlocks = tl_text.match(/[\uFF65-\uFF9F]+/g) || [];

    let learnCount = 0;

    for (let i = 0; i < words.length - 1; i++) {

        const current = words[i];
        let next = words[i + 1];

        if (
            next.includes('\\n') ||
            next.includes('　') ||
            next.includes('<') ||
            next.includes('\\') ||
            next.includes('small') ||
            next.includes('color') ||
            next.includes('\\u') ||
            next.includes(':') ||
            next.includes('_') ||
            next.includes('@') ||
            /[\uD800-\uDBFF]/.test(next) ||
            /[\uDC00-\uDFFF]/.test(next) ||
            next.trim() === ""
        ) {
            continue;
        }

        // 半角カナ補正
        if (/^[\uFF65-\uFF9F]+$/.test(next)) {
            const fullBlock = kanaBlocks.find(b => b.startsWith(next));
            if (fullBlock) next = fullBlock;
        }

        if (!brain[current]) {
            brain[current] = [];
        }

        brain[current].push(next);

        learnCount++;

        if (brain[current].length > 20000) {
            brain[current].shift();
        }
    }

    console.log(`📚 学習完了: ${learnCount}単語追加`);
    return brain;
}

// ================================
// 💾 Drive保存（シンプル安定版）
// ================================
async function saveBrainToDrive(drive, brain) {
    const fileId = process.env.GDRIVE_FILE_ID?.trim();

    if (!fileId) {
        console.error("GDRIVE_FILE_ID is empty.");
        return false;
    }

    const payload = JSON.stringify(brain, null, 2);

    console.log("DEBUG: saveBrainToDrive 開始");
    console.log("DEBUG: 保存文字数:", payload.length);

    // 1回目: googleapis で保存
    try {
        await drive.files.update({
            fileId,
            uploadType: 'media',
            media: {
                mimeType: 'application/json',
                body: payload
            },
            fields: 'id'
        });

        console.log("Googleドライブの『脳』をアップデート完了");
        return true;
    } catch (e1) {
        console.error("━━━━━━━━━━━━━ 🚨 Drive保存失敗(1回目) 🚨 ━━━━━━━━━━━━━");
        console.error("Error Name:", e1.name);
        console.error("Error Message:", e1.message);
        if (e1.response) {
            console.error("Status:", e1.response.status);
            console.error(
                "Data:",
                typeof e1.response.data === 'string'
                    ? e1.response.data.substring(0, 500)
                    : JSON.stringify(e1.response.data).substring(0, 500)
            );
        }
        console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

        // 2回目: 直接RESTで保存
        try {
            const auth = await getDriveAuth();
            const token = await auth.getAccessToken();

            const url = `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id`;

            const res = await axios.patch(url, payload, {
                headers: {
                    Authorization: `Bearer ${token.token || token}`,
                    'Content-Type': 'application/json; charset=utf-8'
                },
                validateStatus: () => true
            });

            if (res.status >= 200 && res.status < 300) {
                console.log("Googleドライブの『脳』をRESTでアップデート完了");
                return true;
            }

            console.error("━━━━━━━━━━━━━ 🚨 Drive保存失敗(2回目) 🚨 ━━━━━━━━━━━━━");
            console.error("Status:", res.status);
            console.error(
                "Data:",
                typeof res.data === 'string'
                    ? res.data.substring(0, 500)
                    : JSON.stringify(res.data).substring(0, 500)
            );
            console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            return false;

        } catch (e2) {
            console.error("━━━━━━━━━━━━━ 🚨 Drive保存失敗(2回目例外) 🚨 ━━━━━━━━━━━━━");
            console.error("Error Name:", e2.name);
            console.error("Error Message:", e2.message);
            console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            return false;
        }
    }
}
// ================================
// 🧠 マルコフ生成（進化版）
// ================================
function generateMarkov(words, brain) {

    const isSymbol = (str) =>
        /^[^a-zA-Z0-9\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uFF65-\uFF9F]+$/.test(str);

    const markovDict = {};

    for (let i = 0; i < words.length - 1; i++) {
        const w1 = words[i];
        const w2 = words[i + 1];

        if (!markovDict[w1]) {
            markovDict[w1] = [];
        }

        markovDict[w1].push(w2);
    }

    const pickNextWord = (list) => {

        if (!list || list.length === 0) return "";

        let candidate =
            list[Math.floor(Math.random() * list.length)];

        if (isSymbol(candidate) && Math.random() < 0.6) {
            candidate =
                list[Math.floor(Math.random() * list.length)];
        }

        let attempts = 0;

        while (
            /(マルコフ|おみくじ|タイムライン|@|#)/.test(candidate) &&
            attempts < 5
        ) {
            candidate =
                words[Math.floor(Math.random() * words.length)];
            attempts++;
        }

        return candidate;
    };

    const mm = Math.floor(Math.random() * (17 - 5 + 1)) + 15;

    let generated = "";
    let current_word = pickNextWord(words);

    for (let i = 0; i < mm; i++) {

        if (!current_word) {
            current_word = pickNextWord(words);
        }

        let foundNext = "";

        const useBrain = Math.random() < 0.7;

        if (
            useBrain &&
            particles.includes(current_word) &&
            brain[current_word]
        ) {
            const candidates = brain[current_word];
            foundNext =
                candidates[Math.floor(Math.random() * candidates.length)];
        }

        if (!foundNext && markovDict[current_word]) {
            foundNext = pickNextWord(markovDict[current_word]);
        }

        current_word = foundNext || pickNextWord(words);

        if (
            /^[\u3040-\u309F]{8,}$|^[\u30A0-\u30FF]{8,}$/.test(current_word)
        ) {
            current_word = pickNextWord(words);
            i--;
            continue;
        }

        generated += current_word;

        if (
            ["。", "！", "？", "w", "…"]
                .some(s => current_word.endsWith(s))
        ) {
            break;
        }
    }

    let outputText =
        generated || "（言葉の断片が見つかりませんでした）";

    outputText = outputText
        .replace(/:.*?:/g, '')
        .replace(/[ 　]/g, '')
        .replace(/<.*?>/g, '')
        .replace(/\\u[0-9a-fA-F]{4}/g, '')
        .replace(/\\/g, '')
        .trim();

    return outputText;
}

// ================================
// 🚀 メイン処理
// ================================
async function main() {

    try {

        console.log("=== API Connection Check ===");

        const domain = (process.env.MK_DOMAIN || "").trim();
        const token = (process.env.MK_TOKEN || "").trim();

        if (!domain || !token) {
            throw new Error("MK_DOMAIN または MK_TOKEN が環境変数に設定されていません。");
        }

        const me = await mk.request('i');

        const my_id = me.id;
        const my_username = me.username;

        console.log(`✅ Logged in as: @${my_username} (${my_id})`);

        // ========================
        // 🤝 フォロバ・リムバ
        // ========================
        await handleFollowControl(my_id);

        // ========================
        // 💬 メンション処理
        // ========================
        await handleMentions(me);

        // ========================
        // 📝 定期投稿開始
        // ========================
        console.log("定期投稿の準備を開始します...");

        await sleep(2000);

        const drive = await getDriveAuth();

        // ========================
        // 🧠 脳ロード
        // ========================
        let brain = await loadBrainFromDrive(drive);

        brain = cleanBrain(brain);

        // ========================
        // 📥 タイムライン取得
        // ========================
        const tl = await mk.request('notes/hybrid-timeline', {
            limit: 128
        });

        const tl_text = tl
            .filter(n => n.text && n.user.id !== my_id)
            .map(n =>
                n.text
                    .replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, '')
                    .trim()
            )
            .slice(0, 64)
            .join(" ");

        const words = segmenter.segment(tl_text);

        console.log(`【分析実行】総単語数: ${words.length}`);

        // ========================
        // 📚 学習
        // ========================
        brain = learnBrain(brain, words, tl_text);

        // ========================
        // 💾 保存
        // ========================
        console.log("DEBUG: learnBrain 完了、保存直前");
        await saveBrainToDrive(drive, brain);
        console.log("DEBUG: saveBrainToDrive 後");
        // ========================
        // 🧠 生成
        // ========================
        let outputText = generateMarkov(words, brain);

        // ========================
        // ✨ 短文補完（元仕様）
        // ========================
        const MIN_LENGTH = 10;
        let retryCount = 0;

        while (outputText.length < MIN_LENGTH && retryCount < 5) {

            const hint =
                outputText.length > 0
                    ? outputText.slice(-2)
                    : words[Math.floor(Math.random() * words.length)];

            const addition =
                brain[hint]?.[Math.floor(Math.random() * (brain[hint]?.length || 1))] || "";

            if (!addition) break;

            outputText += addition;
            retryCount++;
        }

        // ========================
        // 🛠 手動実行タグ
        // ========================
        const eventName = process.env.GITHUB_EVENT_NAME;

        if (eventName === 'workflow_dispatch') {
            outputText = `【手動実行】${outputText}`;
        }

        // ========================
        // 📤 投稿
        // ========================
        await sleep(1000);

        try {

            console.log("DEBUG: 投稿リクエスト送信開始...");

            await mk.request('notes/create', {
                text: outputText.trim().slice(0, 110),
                visibility: 'home'
            });

            console.log("✅ 投稿成功");

        } catch (err) {

            console.error("━━━━━━━━━━━━━ 🚨 Misskey投稿失敗 🚨 ━━━━━━━━━━━━━");

            if (err.response) {
                console.error(`Status: ${err.response.status}`);
                console.error(`Data: ${JSON.stringify(err.response.data)}`);
            } else {
                console.error(`Error: ${err.message}`);
            }

            throw new Error("Apacheがリクエストを拒否しました。BodyかHeaderが不正です。");
        }

        console.log("本投稿が完了しました！内容: " + outputText);

    } catch (e) {

        console.error(`致命的なエラー: ${e.message}`);

        try {
            console.log(`投稿エラー！><（エラー: ${e.message}）`);
        } catch {}
    }
}

// ================================
// ▶ 実行
// ================================
main();
