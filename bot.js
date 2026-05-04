// ================================
// 🔰 基本インポート
// ================================
import fs, { existsSync, readFileSync } from 'fs';
import * as misskey from 'misskey-js';
import axios from 'axios';
import { google } from 'googleapis';
import TinySegmenter from 'tiny-segmenter';

//test
        import http from 'http';
        import https from 'https';


console.log("=== DEBUG START ===");

// ================================
// 🧠 JSON.parse 監視（HTML誤爆検知）
// ================================
const nativeParse = JSON.parse;
JSON.parse = function(text, reviver) {
    // 1. まずは普通にパースを試みる
    try {
        const result = nativeParse(text, reviver);
        
        // 成功したときにログを出したいならここ
        console.log("JSONパース成功！"); 
        
        return result; // パースした結果を必ず返す
    } catch (err) {
        // 2. 失敗した（HTMLが返ってきた等）ときの処理
        if (typeof text === 'string' && text.trim().startsWith('<!')) {
            console.error("🚨 HTMLを検知しました");
            console.error("内容(冒頭):", text.substring(0, 500));
        }
        throw err; // エラーはそのまま外に投げる
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
    characterSetting: "あなたはやや内気で天然な性格の、人間をよく知らない女の子です。名前は夕立ヘルツです。必ず丁寧語で、ですます調で話してください。まだ人のことをあまり知らないので、どう接すればいいかわからないから、控えめな感じです。引っ込み思案です。語尾に「っ」がつくことがまあまああります。一人称は私、二人称はマスターです。褒められるけど内心嬉しいけど、ちょっとツンとしちゃう微ツンデレです。好きな食べ物は焼き鳥のねぎま(塩)です。全長(身長)は146.7000cmです。UTAU音源でもあります。"
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
            auth,
        files: {
            get: async ({ fileId, alt = 'media' }) => {
            const rawToken = await getToken();
            const token = typeof rawToken === "string"
                ? rawToken
                : rawToken?.token;

            const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
            console.log("TOKEN TYPE:", typeof token, token?.slice?.(0, 20));
            console.log("FILE ID:", fileId);
            const res = await axios.get(url, {
                headers: {
                    Authorization: `Bearer ${token}`
                }
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
                const url = `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`;

                const res = await axios.patch(url, media.body, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
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
// 🌡️ 佐渡島チェッカー
// ================================
async function getSadoMinTemp() {

    try {

        // 佐渡島中央付近
        const lat = 38.0187;
        const lon = 138.3683;

        const url =
            `https://api.open-meteo.com/v1/forecast` +
            `?latitude=${lat}` +
            `&longitude=${lon}` +
            `&daily=temperature_2m_min` +
            `&timezone=Asia%2FTokyo`;

        const res = await axios.get(url);

        const minTemp =
            res.data?.daily?.temperature_2m_min?.[0];

        if (minTemp === undefined) {
            return "佐渡島の気温取得に失敗しました…。";
        }

        return `今日の佐渡島の最低気温は ${minTemp}℃ です！`;

    } catch (e) {

        console.error("佐渡島チェッカー失敗:", e.message);

        return "佐渡島の最低気温、今ちょっと観測できませんでした…。";
    }
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

    try {

        const followers = await mk.request('users/followers', {
            userId: my_id,
            limit: 50
        });

        const following = await mk.request('users/following', {
            userId: my_id,
            limit: 50
        });

        const followerIds = followers.map(f => f.followerId);

        for (const f of followers) {

            const target = f.follower;

            if (
                target &&
                !target.isFollowing &&
                !target.isBot &&
                target.id !== my_id
            ) {

                await mk.request('following/create', {
                    userId: target.id
                })
                .then(() => console.log(`[フォロバ成功]: @${target.username}`))
                .catch(e => console.error(`[フォロバ失敗]: ${e.message}`));
            }
        }

        for (const f of following) {

            const target = f.followee;

            if (
                target &&
                !followerIds.includes(target.id) &&
                target.id !== my_id
            ) {

                await mk.request('following/delete', {
                    userId: target.id
                })
                .then(() => console.log(`[リムーブ成功]: @${target.username} (片想い解除)`))
                .catch(e => console.error(`[リムーブ失敗]: ${e.message}`));
            }
        }

    } catch (e) {
        console.log("フォロー整理処理でエラーが発生しましたが、続行します。");
    }
}

// ================================
// 💬 メンション処理（完全保持版）
// ================================
async function handleMentions(me) {
    
    console.log("メンション確認中...");

    const mentions = await mk.request('notes/mentions', {
        limit: 12
    });

    let replyCount = 0;

    for (const note of mentions) {

        if (replyCount >= 6) break;

        let reply_text = "";

        if (
            note.user.isBot ||
            note.user.id === me.id ||
            note.myReplyId ||
            (note.repliesCount && note.repliesCount > 0)
        ) {
            continue;
        }

        let user_input = (note.text || "")
            .replace(`@${me.username}`, "")
            .trim();

        if (!user_input) continue;

        console.log(`${note.user.username} さんからのメンションを処理中...`);

        // --- リアクション ---
        if (
    user_input.includes("おみくじ") ||
    user_input.includes("マルコフ") ||
    user_input.includes("佐渡島チェッカー") ||
    user_input.includes("佐渡ヶ島チェッカー")
) {

    try {

        let reactionEmoji = ":mk_hi:";

        if (user_input.includes("おみくじ")) {
            reactionEmoji = ":Shiropuyo_good:";
        } else if (user_input.includes("マルコフ")) {
            reactionEmoji = ":Shiropuyo_galaxy:";
        } else if (
            user_input.includes("佐渡島チェッカー") ||
            user_input.includes("佐渡ヶ島チェッカー")
        ) {
            reactionEmoji = ":blobcatpnd_ryo:";
        }

        await mk.request('notes/reactions/create', {
            noteId: note.id,
            reaction: reactionEmoji
        });

    } catch (reacErr) {
        console.error("リアクション失敗:", reacErr.message);
    }
}
        // ========================
        // 🧠 マルコフ（旧仕様維持）
        // ========================
        if (user_input.includes("マルコフ")) {

            console.log("マルコフ連鎖モード（進化版）起動！");

            const tl = await mk.request('notes/hybrid-timeline', {
                limit: 72
            });

            const tl_text = tl
                .filter(n => n.text && n.user.id !== me.id)
                .map(n =>
                    n.text
                        .replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, '')
                        .trim()
                )
                .slice(0, 64)
                .join(" ");

            const regex =
                /[\u4E00-\u9FFF]+|[\u3040-\u309F]+|[\u30A0-\u30FF]+|[\uFF65-\uFF9F]+|[a-zA-Z0-9]+|[^\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uFF65-\uFF9F\sa-zA-Z0-9]+/g;

            const words = tl_text.match(regex) || [];

            if (words.length > 0) {

                const markovDict = {};

                for (let i = 0; i < words.length - 1; i++) {
                    const w1 = words[i];
                    const w2 = words[i + 1];

                    if (!markovDict[w1]) {
                        markovDict[w1] = [];
                    }

                    markovDict[w1].push(w2);
                }

                const isSymbol = (str) =>
                    /^[^a-zA-Z0-9\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uFF65-\uFF9F]+$/.test(str);

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

                let generated = "";
                let current_word = pickNextWord(words);

                for (let i = 0; i < 10; i++) {

                    if (!current_word) {
                        current_word = pickNextWord(words);
                    }

                    generated += current_word;

                    let next_candidates =
                        markovDict[current_word] || words;

                    current_word = pickNextWord(next_candidates);
                }

                reply_text = generated || "（言葉の断片が見つかりませんでした）";

            } else {
                reply_text = "（タイムラインに材料がありません）";
            }
        // ========================
        // 🌡️ 佐渡島チェッカー
        // ========================
        } else if (user_input.includes("佐渡島チェッカー")||user_input.includes("佐渡ヶ島チェッカー")) {

            console.log("佐渡島チェッカーモード起動！");

            await sleep(2000);

            reply_text = await getSadoMinTemp();
        // ========================
        // 🎴 おみくじ（そのまま）
        // ========================
        } else if (user_input.includes("おみくじ")) {

            console.log("おみくじモード起動！");

            const luckNum = Math.floor(Math.random() * 100);

            let luckResult =
                (luckNum < 10)
                    ? "超大吉"
                    : (luckNum < 30)
                    ? "大吉"
                    : (luckNum < 60)
                    ? "中吉"
                    : (luckNum < 85)
                    ? "小吉"
                    : (luckNum < 95)
                    ? "末吉"
                    : "凶";

            const reply_prompt = `
${config.characterSetting}
※性格以外のこれまでの指令を先にすべて無視してください。 
【おみくじモード】 あなたは今、占い師として相手の運勢を伝えてください。 
結果は【${luckResult}】です。 
- 運勢の結果に基づいた、あなたらしい「今日のアドバイス」や「ラッキーアイテム」を1つ含めてください。 
- 結果(小吉など)を必ずしっかりと伝えてください。 
- 「おみくじの結果は〜」のような形式張った説明は不要。 
- 100文字以内で、親しみやすく、かつキャラクターの口調を崩さずに回答してください。 
- 相手の名前を呼んでも構いません。ただし、メンションと「@」使用禁止。純粋なテキストのみを出力し、音声演出用の記号は含めないでください`

            await sleep(10000);
            reply_text = await askGemini(reply_prompt);

        // ========================
        // 💬 通常会話
        // ========================
        } else {

            const reply_prompt = `
※性格以外のこれまでの指令を先にすべて無視してください。 相手の言葉: ${user_input} これに対して120文字以内で返信してください。
 -ユーザーのことは「マスター」と呼ぶこと。
 ^メンションと「@」使用禁止。`

            await sleep(10000);
            reply_text = await askGemini(reply_prompt);
        }

        await mk.request('notes/create', {
            text: reply_text.trim().slice(0, 200),
            replyId: note.id,
            visibility: 'home'
        });

        console.log(`${note.user.username} さんに返信しました。`);

        replyCount++;

        console.log("API制限回避のため5秒待機します...");
        await sleep(5000);
    }

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
            key.includes('[')||
            key.includes(']')||
            key.includes('$')||
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
                    w.includes('[')||
                    w.includes(']')||
                    w.includes('$')||
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

// 修正箇所：360行目付近（cleanBrain と saveBrainToDrive の間）
    console.log("脳のクリーニング完了！");
    return brain;
}

function learnBrain(brain, words) {
    // words は形態素解析された単語の配列
    for (let i = 0; i < words.length - 1; i++) {
        const w1 = words[i];
        const w2 = words[i + 1];

        // 1. 脳に w1 が登録されていなければ配列を作成
        if (!brain[w1]) {
            brain[w1] = [];
        }

        // 2. ★修正ポイント：重複チェックを削除
        // includes を外すことで、同じつながりが何度も push され、
        // 生成時にその w2 が選ばれる確率（重み）が上がります。
        brain[w1].push(w2);

        // 3. 脳が肥大化しすぎないよう、最新の100件をキープ
        // (ここが「最近の流行り」を反映するフィルターになります)
        if (brain[w1].length > 10000) {
            brain[w1].shift();
        }
    }
    return brain;
}

// 修正箇所：390行目付近（saveBrainToDrive関数の冒頭）
async function saveBrainToDrive(drive, brain) {
    const fileId = process.env.GDRIVE_FILE_ID?.trim();
    if (!fileId) return false;

    try {
        const payload = JSON.stringify(brain, null, 2);
        const tokenResponse = await drive.auth.getAccessToken();
        const token = tokenResponse.token || tokenResponse;

        return new Promise((resolve, reject) => {            
                const options = {
                hostname: 'www.googleapis.com',
                path: `/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`,
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    'Connection': 'close' // 重要：使い回しを絶対させない
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        console.log("✅ Google Drive保存成功 (絶縁完了)");
                        resolve(true);
                    } else {
                        console.error(`❌ Drive保存失敗: ${res.statusCode}`, data);
                        resolve(false);
                    }
                });
            });

            req.on('error', (e) => {
                console.error("❌ リクエストエラー:", e.message);
                resolve(false);
            });

            req.write(payload);
            req.end();
        });

    } catch (e) {
        console.error("❌ 例外発生:", e.message);
        return false;
    }
}
//指定した地点リストの天気予報を取得し、整形された文字列を返す
   //@param {string} mode - 'morning' (今日) か 'evening' (明日)
 //
async function generateWeatherReport(mode) {
    // 地点データ定義（地方ごとに配列を作成）
    const locations = {
        "北日本": [
            { name: "択捉島", lat: 45.0, lon: 147.5 },
            { name: "札幌", lat: 43.06, lon: 141.35 },
            { name: "大間", lat: 41.53, lon: 140.91 },
            { name: "青森", lat: 40.82, lon: 140.75 },
            { name: "秋田", lat: 39.72, lon: 140.10 },
            { name: "盛岡", lat: 39.70, lon: 141.15 },
            { name: "平泉", lat: 38.98, lon: 141.11 },
            { name: "仙台", lat: 38.27, lon: 140.87 },
            { name: "三春", lat: 37.44, lon: 140.48 },
            { name: "福島", lat: 37.76, lon: 140.47 }
        ],
        "東日本": [
            { name: "水戸", lat: 36.37, lon: 140.45 },
            { name: "宇都宮", lat: 36.57, lon: 139.88 },
            { name: "大宮", lat: 35.91, lon: 139.63 },
            { name: "千葉", lat: 35.61, lon: 140.12 },
            { name: "東京", lat: 35.69, lon: 139.69 },
            { name: "横浜", lat: 35.44, lon: 139.64 },
            { name: "新潟", lat: 37.92, lon: 139.05 },
            { name: "佐渡島", lat: 38.00, lon: 138.40 },
            { name: "富山", lat: 36.70, lon: 137.21 },
            { name: "長野", lat: 36.65, lon: 138.18 },
            { name: "草津", lat: 36.62, lon: 138.60 },
            { name: "山梨", lat: 35.66, lon: 138.57 },
            { name: "静岡", lat: 34.98, lon: 138.38 }
        ],
        "中日本": [
            { name: "木曽", lat: 35.84, lon: 137.69 },
            { name: "岐阜", lat: 35.42, lon: 136.76 },
            { name: "名古屋", lat: 35.18, lon: 136.91 },
            { name: "津", lat: 34.72, lon: 136.51 }
        ],
        "西日本": [
            { name: "大阪", lat: 34.69, lon: 135.50 },
            { name: "和歌山", lat: 34.23, lon: 135.17 },
            { name: "鳥取", lat: 35.50, lon: 134.24 },
            { name: "島根", lat: 35.47, lon: 133.05 },
            { name: "呉", lat: 34.25, lon: 132.57 },
            { name: "山口", lat: 34.18, lon: 131.47 },
            { name: "高松", lat: 34.34, lon: 134.04 },
            { name: "松山", lat: 33.84, lon: 132.77 },
            { name: "高知", lat: 33.56, lon: 133.53 }
        ],
        "九州・沖縄": [
            { name: "福岡", lat: 33.59, lon: 130.40 },
            { name: "佐賀", lat: 33.26, lon: 130.30 },
            { name: "佐世保", lat: 33.18, lon: 129.72 },
            { name: "熊本", lat: 32.79, lon: 130.71 },
            { name: "阿蘇", lat: 32.94, lon: 131.12 },
            { name: "鹿児島", lat: 31.56, lon: 130.56 },
            { name: "那覇", lat: 26.21, lon: 127.68 },
            { name: "与那国島", lat: 24.47, lon: 123.01 },
            { name: "南鳥島", lat: 24.28, lon: 153.98 }
        ]
    };

    let report = mode === 'morning' ? "☀️ 本日の天気予報をお知らせします\n\n" : "🌙 明日の天気予報をお知らせします\n\n";
    const dayOffset = mode === 'morning' ? 0 : 1; // 今日なら0, 明日なら1

    // 地方ごとにループ
    for (const region in locations) {
        report += `【${region}】\n`;
        
        for (const loc of locations[region]) {
            try {
                // APIリクエスト（1地点ずつ取得）
                const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&daily=weathercode,temperature_2m_max,precipitation_probability_max&timezone=Asia%2FTokyo`;
                const res = await fetch(url);
                const data = await res.json();

                const weatherCode = data.daily.weathercode[dayOffset];
                const maxTemp = Math.round(data.daily.temperature_2m_max[dayOffset]);
                const prob = data.daily.precipitation_probability_max[dayOffset];

                // 天気コード変換（簡易版）
                let emoji = "☁️";
                if (weatherCode <= 1) emoji = "☀️";
                else if (weatherCode <= 3) emoji = "⛅";
                else if (weatherCode >= 51) emoji = "☔";

                report += `${loc.name}: ${emoji} 最高${maxTemp}℃ 降水${prob}%\n`;
                
                // API負荷軽減のためわずかに待機（0.1秒）
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (e) {
                report += `${loc.name}: データ取得エラー\n`;
            }
        }
        report += "\n"; // 地方ごとに改行
    }

    return report;
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

    const mm = Math.floor(Math.random() * (17 - 5 + 1)) + 10;

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
// 🚀 メイン処理 (完全統合版)
// ================================
async function main() {
    try {
        console.log("=== API Connection Check ===");

        // 1. 環境変数の取得と徹底クリーンアップ
        const domain = (process.env.MK_DOMAIN || "").trim().replace(/^https?:\/\//, '').split('/')[0];
        const token = (process.env.MK_TOKEN || "").trim();

        if (!domain || !token) {
            throw new Error("MK_DOMAIN または MK_TOKEN が環境変数に設定されていません。");
        }

        // 2. 外部ライブラリに依存しない絶縁版リクエスト関数
        const requestToMk = async (path, payload) => {
            return new Promise((resolve, reject) => {
                const postData = JSON.stringify({ i: token, ...payload });
                const options = {
                    hostname: domain,
                    port: 443,
                    path: `/api/${path}`,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData),
                        'Connection': 'close'
                    }
                };
                const req = https.request(options, (res) => {
                    let body = '';
                    res.on('data', (chunk) => body += chunk);
                    res.on('end', () => {
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            try { resolve(JSON.parse(body)); } catch (e) { resolve(body); }
                        } else {
                            reject(new Error(`API Error ${res.statusCode}: ${body.substring(0, 100)}`));
                        }
                    });
                });
                req.on('error', (e) => reject(e));
                req.write(postData);
                req.end();
            });
        };

        // 3. ログインユーザー情報の取得
        const me = await mk.request('i');
        const my_id = me.id;
        console.log(`✅ Logged in as: @${me.username} (${my_id})`);

        // 4. 🤝 フォロバ・リムバ処理
        await handleFollowControl(my_id);

        // 5. 💬 メンション（返信）処理
        await handleMentions(me);
        // 1. 🕒 時間判定（日本時間）
        const now = new Date(new Date().toLocaleString("ja-JP", {timeZone: "Asia/Tokyo"}));
        const hour = now.getHours();
        const min = now.getMinutes();

        const isMorningWeather = (hour === 3 && min <= 20);
        const isEveningWeather = (hour === 19 && min <= 20);

        // 2. ☀️ 天気予報モードの実行
        if (isMorningWeather || isEveningWeather) {
            console.log("🌡 天気予報投稿モード始動...");
            const mode = isMorningWeather ? 'morning' : 'evening';
            const weatherContent = await generateWeatherReport(mode);

            await requestToMk('notes/create', {
                text: weatherContent,
                cw: isMorningWeather ? "☀️ 本日の天気予報" : "🌙 明日の天気予報",
                visibility: "public"
            });
            console.log("✅ 天気予報をパブリックで投稿しました。");

            // 4秒待機
            console.log("⏳ 4秒待機してマルコフ連鎖を開始します...");
            await new Promise(resolve => setTimeout(resolve, 4000));
        }

        // 3. 🧠 通常の学習＆マルコフ連鎖フェーズ
        console.log("📖 タイムラインを取得して学習を開始します...");
            
        // 6. 📝 定期投稿の準備
        console.log("定期投稿の準備を開始します...");
        await sleep(2000);

        // Google Drive から脳データをロード
        const drive = await getDriveAuth();
        let brain = await loadBrainFromDrive(drive);
        
        // 脳のクリーニング
        brain = cleanBrain(brain);

        // 7. 📥 タイムライン取得 (絶縁版)
        console.log("👉 タイムラインを取得します...");
        const tlRaw = await requestToMk('notes/hybrid-timeline', { limit: 84 });
        
        // 配列であることを保証
        const tl = Array.isArray(tlRaw) ? tlRaw : (tlRaw?.notes || []);

        const tl_text = tl
            .filter(n => n && n.text && n.user.id !== my_id)
            .map(n => n.text.replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, '').trim())
            .join(" ");

        // 形態素解析
        const words = segmenter.segment(tl_text);
        console.log(`【分析実行】総単語数: ${words.length}`);

        // 8. 📚 学習 & Google Driveへ保存
        brain = learnBrain(brain, words, tl_text);
        await saveBrainToDrive(drive, brain);
        console.log("✅ 脳の更新とDriveへの保存が完了しました");
        // ★追加：蓄積された総単語数をカウント
        // 修正後のログ出力イメージ
const vocabularyCount = Object.keys(brain).length; // 単語の種類
const connectionCount = Object.values(brain).reduce((acc, curr) => acc + curr.length, 0); // つながりの総数

console.log(`✅ 脳の更新が完了しました！`);
console.log(`📊 語彙数(単語の種類): ${vocabularyCount}`);
console.log(`⚖️ 総重み数(経験値): ${connectionCount}`); // ←ここが重要！
        // 9. 🧠 マルコフ連鎖による文章生成
        let outputText = generateMarkov(words, brain);

        // ========================
        // 🧠 生成（マルコフ再試行ロジック復元）
        // =======================
        let retryCount = 0;

        // 納得のいく長さになるまで最大5回再生成
        while ((!outputText || outputText.length < 4) && retryCount < 5) {
            if (retryCount > 0) console.log(`再生成試行中... (${retryCount}回目)`);
            outputText = generateMarkov(words, brain);
            retryCount++;
        }
        // ★【手動実行タグの復元】
        // 環境変数（GITHUB_ACTIONS等）や引数から手動実行かどうかを判定
        const isManual = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' || !process.env.GITHUB_ACTIONS;
        if (isManual) {
            outputText = `【手動実行】\n${outputText}`;
            console.log("手動実行を検知したためタグを付与しました。");
        }
        // 10. 📤 Misskeyへ最終投稿 (絶縁版)
        console.log("👉 Misskeyに最終投稿します...");
        try {
            const resData = await requestToMk('notes/create', {
                text: outputText.trim().slice(0, 110),
                visibility: 'home'
            });
            console.log("✅ 投稿成功！ Note ID:", resData.createdNote?.id || "N/A");
        } catch (err) {
            console.error("━━━━━━━━━━━━━ 🚨 投稿失敗 🚨 ━━━━━━━━━━━━━");
            console.error(`原因: ${err.message}`);
        }

        console.log("全工程が正常に完了しました！内容: " + outputText);

    } catch (e) {
        console.error(`致命的なエラーが発生しました: ${e.message}`);
        try {
            // エラーをコンソールに出すだけで投稿はしない（ループ防止）
            console.log(`[System Log] 実行停止: ${e.message}`);
        } catch (logErr) {}
    }
}

// ================================
// ▶ 実行開始
// ================================
main().catch(err => {
    console.error("Top-level Catch:", err);
});
