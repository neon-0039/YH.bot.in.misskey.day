// bot.js の一番上に貼り付け
import fs, { existsSync, readFileSync } from 'fs';
console.log("=== DEBUG START ===");

// 1. まず環境変数の時点で壊れていないかチェック
try {
    const rawGdrive = process.env.GDRIVE_SERVICE_ACCOUNT;
    if (rawGdrive && rawGdrive.trim().startsWith('<')) {
        console.error("🚨 警告: 環境変数 GDRIVE_SERVICE_ACCOUNT の中身がすでに HTML です！");
        console.error("冒頭部分:", rawGdrive.substring(0, 100));
    }
} catch (e) {}

// 2. JSON.parse を監視し、犯人を特定する（グローバル・パッチ）
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

import * as misskey from 'misskey-js';
import axios from 'axios';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { google } from 'googleapis';
import TinySegmenter from 'tiny-segmenter';

const particles = ["が", "の", "を", "と", "に", "から", "は", "も", "で"];

const { api: MisskeyApi } = misskey;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const n = Math.floor(Math.random() * (17 - 5 + 1)) + 5;

// --- APIキーの設定 ---
const keyMain = process.env.GEMINI_API_KEY;
const keySub = process.env.GEMINI_API_KEY_SUB;

// --- 時間による切り替えロジック (メインを午後に設定) ---
const now = new Date();
const jstHour = (now.getUTCHours() + 9) % 24;

const currentKey = (jstHour >= 12) ? keyMain : (keySub || keyMain);

console.log(`Mainキーの長さ: ${keyMain?.length}, Subキーの長さ: ${keySub?.length}`);
console.log(`【システム情報】現在時刻: ${jstHour}時 / 使用APIキー: ${jstHour >= 12 ? '午後(メイン)' : '午前(サブ)'}`);

const segmenter = new TinySegmenter();

/**
 * Google Drive APIへの認証を行う関数
 */
async function getDriveClient() {

    const filePath = './credentials.json';
    let credentials;

    // 1. ファイルの読み込みチェック
    try {
        if (!existsSync(filePath)) {
            const envData = process.env.GDRIVE_SERVICE_ACCOUNT;
            if (!envData) throw new Error("Credentials file not found AND env GDRIVE_SERVICE_ACCOUNT is empty.");
            credentials = JSON.parse(envData);
        } else {
            credentials = JSON.parse(readFileSync(filePath, 'utf8'));
        }
    } catch (err) {
        console.error("❌ [AUTH ERROR] JSONの読み込みに失敗しました。Secretの形式を確認してください。");
        throw err;
    }

    // 2. 認証オブジェクトの作成
    const auth = new google.auth.JWT(
        credentials.client_email,
        null,
        credentials.private_key,
        ['https://www.googleapis.com/auth/drive']
    );
    // 3. 【重要】ファイル取得テストとHTML検知
    try {
        const fileId = process.env.GDRIVE_FILE_ID;
        if (!fileId) throw new Error("GDRIVE_FILE_ID is not defined in env.");

        const response = await drive.files.get(
            { fileId: fileId, alt: 'media' },
            { responseType: 'stream' }
        );

        console.log("✅ Data successfully retrieved from Google Drive.");

        return drive;

    } catch (err) {
        if (err.response) {
            console.error(`❌ [API ERROR] Status: ${err.response.status}`);
        } else {
            console.error("❌ [SYSTEM ERROR]:", err.message);
        }
        throw err;
    }
}

function generateAddition(startWord, brain) {
    let current = startWord;
    let addition = "";

    const keys = Object.keys(brain).filter(k => startWord.includes(k) || k.includes(startWord));
    if (keys.length === 0) return "";

    let key = keys[Math.floor(Math.random() * keys.length)];

    for (let i = 0; i < 5; i++) {
        const nextList = brain[key];
        if (!nextList || nextList.length === 0) break;

        const nextWord = nextList[Math.floor(Math.random() * nextList.length)];
        addition += nextWord;
        key = nextWord;
    }

    return addition.replace(/:.*?:/g, '').replace(/ /g, '').trim();
}

async function saveVocabularyToDrive(fileId, content) {
    try {
        const drive = await getDriveClient();

        await drive.files.update({
            fileId: fileId,
            media: {
                mimeType: 'text/plain',
                body: content
            }
        });

        console.log("Googleドライブへの語彙蓄積に成功！");

    } catch (e) {
        console.error("Googleドライブ書き込みエラー:", e.message);
    }
}

const config = {
    domain: process.env.MK_DOMAIN,
    token: process.env.MK_TOKEN,
    geminiKey: currentKey,
    characterSetting: "あなたはやや内気で天然な性格の、人間をよく知らない女の子です。名前は夕立ヘルツです。必ず丁寧語で、ですます調で話してください。一人称は私、二人称はマスターです。褒められるけど内心嬉しいけどちょっとツンとする微ツンデレです。好きな食べ物は焼き鳥のねぎま(塩)です。全長(身長)は146.7000cmです。UTAU音源でもあります。"
};

// Misskey初期化
const mk = new misskey.api.APIClient({
    origin: `https://${config.domain}`,
    credential: config.token
});

async function askGemini(prompt) {

    const modelPriority =[
    // --- 3.1 Series (最新・プレビュー枠) ---
    "gemini-3.1-flash-lite-preview",
    "gemini-3.1-flash-preview",
    "gemini-3.1-pro-preview",

    // --- 3.0 Series ---
    "gemini-3-flash-preview",
    "gemini-3-flash-lite-preview",
    "gemini-3-pro-preview",
    "gemini-3-flash-live",         // REST APIで通る可能性を捨てない
    "gemini-3-flash-live-8k",

    // --- 2.5 Series (安定・中堅) ---
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash-audio-dialog-preview", // 正しい命名に修正
    "gemini-2.5-flash-native-audio-dialog-preview",

    // --- 2.0 Series (実験・高制限枠) ---
    "gemini-2.0-flash-exp",
    "gemini-2.0-pro-exp-02-05",
    "gemini-2.0-flash-lite-preview-02-05",
    "gemini-2.0-flash",
    "gemini-2.0-flash-001",
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash-lite-001",

    // --- 1.5 Series (レガシー・最終防衛ライン) ---
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b",
    "gemini-1.5-flash-001",
    "gemini-1.5-flash-002",
    "gemini-1.5-pro",
    "gemini-1.5-pro-001",
    "gemini-1.5-pro-002"
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
        "もう帰りたい、眠い、学校なう！⊂(^ω^)⊃(エラー)"
    ];

    const getRandomError = () =>
        errorMessages[Math.floor(Math.random() * errorMessages.length)];

    for (const modelId of modelPriority) {

        const url =
            `https://generativelanguage.googleapis.com/v1/models/${modelId}:generateContent?key=${currentKey}`;

        try {

            console.log(`モデル試行中: ${modelId}`);

            const res = await axios.post(url, {
                contents: [{ parts: [{ text: prompt }] }]
            });

            return res.data.candidates[0].content.parts[0].text;

        } catch (error) {

            const status = error.response ? error.response.status : null;

            if (status === 429 || status === 404) {
                console.warn(`⚠️ ${modelId} が利用不可です。次のモデルを試します...`);
                continue;
            }

            const finalError = getRandomError();
            console.error(`致命的なエラー！(${error.message}): ${finalError}`);
            return finalError;
        }
    }

    return getRandomError();
}

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
        try {

            // 自分のフォロワーを取得（フォロバ用）
            const followers = await mk.request('users/followers', {
                userId: my_id,
                limit: 50
            });

            // 自分がフォロー中のユーザーを取得（リムーブ用）
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

        // --- 2. メンション取得・返信 ---
        console.log("メンション確認中...");

        const mentions = await mk.request('notes/mentions', {
            limit: 12
        });

        let replyCount = 0;

        for (const note of mentions) {

            if (replyCount >= 4) break;

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

            // --- リアクション判定 ---
            if (
                user_input.includes("おみくじ") ||
                user_input.includes("マルコフ")
            ) {

                try {

                    const reactionEmoji =
                        user_input.includes("おみくじ")
                            ? ":shiropuyo_good:"
                            : ":Shiropuyo_galaxy:";

                    await mk.request('notes/reactions/create', {
                        noteId: note.id,
                        reaction: reactionEmoji
                    });

                } catch (reacErr) {
                    console.error("リアクション失敗:", reacErr.message);
                }
            }

            // --- マルコフ ---
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

                        if (
                            /(マルコフ|おみくじ|タイムライン|@|#)/.test(candidate)
                        ) {
                            return "";
                        }

                        return candidate;
                    };

                    const particles = [
                        "が", "の", "を", "と",
                        "に", "から", "は", "も"
                    ];

                    let generated = "";

                    let current_word = pickNextWord(words);

                    for (let i = 0; i < n; i++) {

                        if (!current_word) {
                            current_word = pickNextWord(words);
                        }

                        if (
                            /^[\u3040-\u309F]{8,}$|^[\u30A0-\u30FF]{8,}$/.test(current_word)
                        ) {
                            current_word = pickNextWord(words);
                            i--;
                            continue;
                        }

                        generated += current_word;

                        if (Math.random() < 0.4) {

                            const p =
                                particles[Math.floor(Math.random() * particles.length)];

                            generated += p;

                            current_word = p;
                        }

                        let next_candidates =
                            (
                                markovDict[current_word] &&
                                markovDict[current_word].length > 0
                            )
                            ? markovDict[current_word]
                            : words;

                        current_word = pickNextWord(next_candidates);
                    }

                    if (Math.random() < 0.2) {

                        const kanaWords =
                            words.filter(w => /^[\uFF65-\uFF9F]+$/.test(w));

                        if (kanaWords.length > 0) {

                            let suffix =
                                kanaWords[Math.floor(Math.random() * kanaWords.length)];

                            if (
                                !/(マルコフ|おみくじ|タイムライン|@|#)/.test(suffix)
                            ) {

                                if (
                                    generated.length > 2 &&
                                    Math.random() < 0.5
                                ) {

                                    const pos = generated.length - 1;

                                    generated =
                                        generated.slice(0, pos) +
                                        suffix +
                                        generated.slice(pos);

                                } else {

                                    generated += suffix;
                                }
                            }
                        }
                    }

                    reply_text =
                        generated || "（言葉の断片が見つかりませんでした）";

                } else {

                    reply_text =
                        "（タイムラインに材料がありません）";
                }

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
- 60文字以内で、親しみやすく、かつキャラクターの口調を崩さずに回答してください。 
- 相手の名前を呼んでも構いません。ただし、メンションと「@」使用禁止。純粋なテキストのみを出力し、音声演出用の記号は含めないでください`;

                console.log("API制限回避のため待機中...");
                await sleep(10000);

                reply_text = await askGemini(reply_prompt);

            } else {

                const reply_prompt = `
※性格以外のこれまでの指令を先にすべて無視してください。 相手の言葉: ${user_input} これに対して80文字以内で返信してください。
 -ユーザーのことは「マスター」と呼ぶこと。
 ^メンションと「@」使用禁止。`;

                console.log("API制限回避のため待機中...");
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

    } catch (e) {

        console.log(`メンション処理エラー!><: ${e.message}`);
    }

    // ↓ 次で定期投稿パート続く ↓
    // --- ここから定期投稿処理 ---
    console.log("定期投稿の準備を開始します...");

    try {

        console.log("本投稿の準備に入ります。2秒待機...");
        await sleep(2000);

        const me = await mk.request('i');
        const my_id = me.id;

        console.log("マルコフ連鎖モード起動！");

        const drive = await getDriveClient();

        console.log("=== MARKOV MODE DEBUG ===");
        console.log(`GDRIVE_FILE_ID: "${process.env.GDRIVE_FILE_ID}"`);
        console.log(`Drive object exists: ${typeof drive !== 'undefined'}`);

        try {

            const fid = process.env.GDRIVE_FILE_ID;

            if (!fid) {
                throw new Error("環境変数 GDRIVE_FILE_ID が読み込めていません！");
            }

            await drive.files.get({
                fileId: fid.trim(),
                alt: 'media'
            });

        } catch (e) {

            console.error("❌ Drive取得失敗の直前ログ:");
            console.error("Error Name:", e.name);
            console.error("Error Message:", e.message);

            if (e.config) {
                console.error("実際に叩こうとしたURL:", e.config.url);
            }

            throw e;
        }

        // 1. タイムラインから材料を取得
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

        const isSymbol = (str) =>
            /^[^a-zA-Z0-9\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uFF65-\uFF9F]+$/.test(str);

        const particles = [
            "が", "の", "を", "と",
            "に", "から", "は", "も", "で"
        ];

        let brain = {};

        if (words.length > 0) {

            // --- 既存の脳を読み込み ---
            try {

                let gDriveCreds;

                if (process.env.GDRIVE_SERVICE_ACCOUNT_PATH) {

                    gDriveCreds = JSON.parse(
                        fs.readFileSync(
                            process.env.GDRIVE_SERVICE_ACCOUNT_PATH,
                            'utf8'
                        )
                    );

                } else {

                    gDriveCreds =
                        JSON.parse(process.env.GDRIVE_SERVICE_ACCOUNT);
                }

                const auth = new google.auth.JWT(
                    gDriveCreds.client_email,
                    null,
                    gDriveCreds.private_key,
                    ['https://www.googleapis.com/auth/drive']
                );

                const drive = google.drive({
                    version: 'v3',
                    auth
                });

                const fileId = process.env.GDRIVE_FILE_ID;

                console.log(`DEBUG_TARGET_ID: "${process.env.GDRIVE_FILE_ID}"`);

                try {

                    const fileId =
                        process.env.GDRIVE_FILE_ID?.trim();

                    if (!fileId) {

                        console.error(
                            "🚨 GDRIVE_FILE_ID が空です。Secretを確認してください。"
                        );

                        brain = {};

                    } else {

                        console.log(
                            `DEBUG: Google Driveからファイル取得中 (ID: ${fileId.substring(0,5)}...)`
                        );
                        const drive = await getDriveClient();
                        
                        const res = await drive.files.get({
                            fileId: fileId,
                            alt: 'media'
                        });

                        let rawData;

                        // objectならそのままJSON化
                        if (typeof res.data === 'object') {
                            rawData = JSON.stringify(res.data);
                        } else {
                            rawData = String(res.data);
                        }

                        console.log("FULL RESPONSE KEYS:", Object.keys(res));

                        console.log(
                            "Request URL:",
                            res.config?.url ||
                            res.request?.responseURL ||
                            "URL不明"
                        );

                        if (
                            typeof rawData === 'string' &&
                            rawData.trim().startsWith('<!')
                        ) {

                            const titleMatch =
                                rawData.match(/<title>(.*?)<\/title>/i);

                            console.error(
                                `🚨 Apache/GoogleからHTMLが返されました: ${
                                    titleMatch ? titleMatch[1] : 'No Title'
                                }`
                            );

                            console.error(
                                "HTML冒頭:",
                                rawData.substring(0, 200)
                            );

                            brain = {};

                        } else if (
                            !rawData ||
                            rawData.trim() === ""
                        ) {

                            console.log(
                                "脳のデータが空でした。新規作成します。"
                            );

                            brain = {};

                        } else {

                            try {

                                brain =
                                    JSON.parse(rawData.trim());

                                const wordCount =
                                    Object.keys(brain).length;

                                console.log(
                                    `✅ 現在の脳の蓄積語数: ${wordCount}語`
                                );

                            } catch (pErr) {

                                console.error(
                                    "🚨 JSONパースエラー:",
                                    pErr.message
                                );

                                console.error(
                                    "受信データ冒頭:",
                                    String(rawData).substring(0, 100)
                                );

                                brain = {};
                            }
                        }
                    }

                } catch (readError) {

                    console.error(
                        `❌ Google Drive接続致命的エラー: ${readError.message}`
                    );

                    if (readError.config) {
                        console.error(
                            "Request URL:",
                            readError.config.url
                        );
                    }

                    brain = {};
                }

                // --- 既存の脳のクリーニング ---
                console.log(
                    "既存の脳をスキャンしてゴミ（改行、タグ、絵文字、全角スペース）を掃除中..."
                );

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

                            if (typeof w !== 'string') {
                                return false;
                            }

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
                            ) {
                                return false;
                            }

                            return w.trim() !== "";
                        });
                    }

                    if (
                        isInvalidKey ||
                        !brain[key] ||
                        brain[key].length === 0
                    ) {
                        delete brain[key];
                    }
                });

                console.log("脳のクリーニング完了！");

                // --- 半角カタカナ塊抽出 ---
                const kanaBlocks =
                    tl_text.match(/[\uFF65-\uFF9F]+/g) || [];

                const cleanedWords = words
                    .map(w => {

                        let cleaned =
                            w.replace(/\n/g, '').trim();

                        if (
                            w.includes('\\n') ||
                            w.includes('　')
                        ) return "";

                        if (
                            w.includes('</') ||
                            w.includes('<')
                        ) return "";

                        if (
                            w.includes('\\u') ||
                            w.includes(':')
                        ) return "";

                        if (
                            w.includes('_') ||
                            w.includes('@')
                        ) return "";

                        if (
                            /[\uD800-\uDBFF]/.test(w) ||
                            /[\uDC00-\uDFFF]/.test(w)
                        ) return "";

                        if (w.includes('\uFFFD')) return "";

                        if (/:.*:/.test(w)) return "";

                        return cleaned;

                    })
                    .filter(w => w !== "");

                console.log(
                    `【分析実行】総単語数: ${words.length}個 / カタカナ塊: ${kanaBlocks.length}個`
                );

                // ↓ 次で学習ループ＆投稿部分続く ↓
                            let learnCount = 0;

                // --- 学習ループ ---
                for (let i = 0; i < cleanedWords.length - 1; i++) {

                    const current = cleanedWords[i];
                    let next = cleanedWords[i + 1];

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

                    // 次の単語が半角カタカナ断片なら復元
                    if (/^[\uFF65-\uFF9F]+$/.test(next)) {

                        const fullBlock =
                            kanaBlocks.find(block =>
                                block.startsWith(next)
                            );

                        if (fullBlock) {
                            next = fullBlock;
                        }
                    }

                    if (!brain[current]) {
                        brain[current] = [];
                    }

                    brain[current].push(next);

                    learnCount++;

                    // 上限
                    if (brain[current].length > 20000) {
                        brain[current].shift();
                    }
                }

                // --- Googleドライブへ保存 ---
                await drive.files.update({
                    fileId: fileId,
                    media: {
                        mimeType: 'application/json',
                        body: JSON.stringify(brain, null, 2)
                    }
                });

                console.log(
                    "Googleドライブの『脳』をアップデート完了（全単語学習・上限2万件モード）"
                );

            } catch (driveError) {

                console.log(
                    "ドライブ連携に失敗（生成は続行）:",
                    driveError.message
                );
            }
        }

        // --- 3. マルコフ文章生成 ---
        const markovDict = {};

        // ★ words.length ベースに修正
        for (let i = 0; i < words.length - 1; i++) {

            const w1 = words[i];
            const w2 = words[i + 1];

            if (!markovDict[w1]) {
                markovDict[w1] = [];
            }

            markovDict[w1].push(w2);
        }

        const pickNextWord = (list) => {

            if (!list || list.length === 0) {
                return "";
            }

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

        const mm =
            Math.floor(Math.random() * (17 - 5 + 1)) + 15;

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
                    candidates[
                        Math.floor(Math.random() * candidates.length)
                    ];
            }

            if (!foundNext && markovDict[current_word]) {

                foundNext =
                    pickNextWord(markovDict[current_word]);
            }

            current_word =
                foundNext || pickNextWord(words);

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

        // --- 出力クリーニング ---
        let outputText =
            generated || "（言葉の断片が見つかりませんでした）";

        outputText = outputText
            .replace(/:.*?:/g, '')
            .replace(/[ 　]/g, '')
            .replace(/<.*?>/g, '')
            .replace(/\\u[0-9a-fA-F]{4}/g, '')
            .replace(/\\/g, '')
            .trim();

        // --- 短文補完 ---
        const MIN_LENGTH = 10;

        let retryCount = 0;

        while (
            outputText.length < MIN_LENGTH &&
            retryCount < 5
        ) {

            const hint =
                outputText.length > 0
                    ? outputText.slice(-2)
                    : pickNextWord(words);

            const nextAddition =
                generateAddition(hint, brain);

            if (!nextAddition) {
                break;
            }

            outputText += nextAddition
                .replace(/:.*?:/g, '')
                .replace(/[ 　]/g, '')
                .trim();

            retryCount++;
        }

        // --- 手動実行検知 ---
        const eventName =
            process.env.GITHUB_EVENT_NAME;

        if (eventName === 'workflow_dispatch') {

            outputText =
                `【手動実行】${outputText}`;
        }

        // --- 投稿処理 ---
        await sleep(1000);

        const postData = {
            text: outputText.trim().slice(0, 110),
            visibility: 'home'
        };

        try {

            console.log("DEBUG: 投稿リクエスト送信開始...");

            const res =
                await mk.request('notes/create', postData);

            console.log("✅ 投稿成功");

        } catch (err) {

            console.error(
                "━━━━━━━━━━━━━ 🚨 Misskey投稿失敗 🚨 ━━━━━━━━━━━━━"
            );

            if (err.response) {

                console.error(`Status: ${err.response.status}`);

                console.error(
                    `Data: ${JSON.stringify(err.response.data)}`
                );

            } else {

                console.error(`Error: ${err.message}`);
            }

            throw new Error(
                "Apacheがリクエストを拒否しました。BodyかHeaderが不正です。"
            );
        }

        console.log(
            "本投稿が完了しました！内容: " + outputText
        );

    } catch (e) {

        console.error(`致命的なエラー: ${e.message}`);

        try {

            console.log(
                `投稿エラー！><（エラー: ${e.message}）`
            );

        } catch (notificationError) {

            console.error(
                "エラー通知自体も送れない！:",
                notificationError.message
            );
        }
    }
}

// 最後にしっかり実行
main();
