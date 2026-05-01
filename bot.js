// bot.js の一番上に貼り付け
import fs from 'fs'; // CommonJSなら const fs = require('fs');

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
import * as misskey from 'misskey-js'; // ここを * as に変更
import axios from 'axios';
import { GoogleGenerativeAI } from "@google/generative-ai";

// Misskey APIの初期化部分がある場合、以下のように書いてみてください
// const api = new misskey.api.api({ ... });
// ファイルの上のほう
const particles = ["が", "の", "を", "と", "に", "から", "は", "も", "で"];
// もしこれまでのコードで misskey.api を使っていたなら、以下のように定義し直すとスムーズです
const { api: MisskeyApi } = misskey;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const n = Math.floor(Math.random() * (17 - 5 + 1)) + 5;

// --- APIキーの設定 ---
const keyMain = process.env.GEMINI_API_KEY;      // プロジェクトA
const keySub = process.env.GEMINI_API_KEY_SUB;   // プロジェクトB

// --- 時間による切り替えロジック (メインを午後に設定) ---
const now = new Date();
const jstHour = (now.getUTCHours() + 9) % 24; // UTCからJSTへ変換

// 12時以降(午後)ならメイン、それ以外(午前)ならサブを使用
const currentKey = (jstHour >= 12) ? keyMain : (keySub || keyMain); 
console.log(`Mainキーの長さ: ${keyMain?.length}, Subキーの長さ: ${keySub?.length}`);
console.log(`【システム情報】現在時刻: ${jstHour}時 / 使用APIキー: ${jstHour >= 12 ? '午後(メイン)' : '午前(サブ)'}`);
// 現在時刻に基づいて使用するキーを決定（日本時間 JST 基準）
import { google } from 'googleapis';
import TinySegmenter from 'tiny-segmenter';

// TinySegmenterのインスタンス化（importした直後などでOK）
const segmenter = new TinySegmenter();
/**
 * Google Drive APIへの認証を行う関数
 */
async function getDriveClient() {
    const fs = require('fs');
    const { google } = require('googleapis'); // ライブラリのインポート確認

    const filePath = './credentials.json';
    let credentials;

    // 1. ファイルの読み込みチェック
    try {
        if (!fs.existsSync(filePath)) {
            const envData = process.env.GDRIVE_SERVICE_ACCOUNT;
            if (!envData) throw new Error("Credentials file not found AND env GDRIVE_SERVICE_ACCOUNT is empty.");
            credentials = JSON.parse(envData);
        } else {
            credentials = JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

    const drive = google.drive({ version: 'v3', auth });

    // 3. 【重要】ファイル取得テストとHTML検知
    try {
        const fileId = process.env.GDRIVE_FILE_ID;
        if (!fileId) throw new Error("GDRIVE_FILE_ID is not defined in env.");

        // alt: 'media' で取得を試みる（ここでHTMLが返ってくることが多い）
        const response = await drive.files.get(
            { fileId: fileId, alt: 'media' },
            { responseType: 'text' } // 一旦テキストで受けて中身を検証
        );

        const rawData = response.data;

        // HTML（<!DOCTYPE）が含まれているかチェック
        if (typeof rawData === 'string' && rawData.toLowerCase().includes('<!doctype')) {
            console.error("━━━━━━━━━━━━━ 🚨 HTML DETECTED 🚨 ━━━━━━━━━━━━━");
            console.error(`Status: ${response.status} ${response.statusText}`);
            
            // HTMLのタイトルを抽出
            const titleMatch = rawData.match(/<title>(.*?)<\/title>/i);
            console.error(`Page Title: ${titleMatch ? titleMatch[1] : "No Title"}`);
            
            // 中身の冒頭を出力（これで原因がわかります）
            console.error("Content Snippet:");
            console.error(rawData.substring(0, 1000)); 
            console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            
            throw new Error(`Google Drive API returned HTML instead of JSON. Check the logs above.`);
        }

        // HTMLでなければ、それが本来のJSONデータ
        console.log("✅ Data successfully retrieved from Google Drive.");
        
        // 既存のbotコードがこのdriveオブジェクトを必要としているはずなので、
        // 最後にdriveを返しますが、検証済みのデータをどこかに保存しておくと楽です
        // 必要に応じて JSON.parse(rawData) して使ってください
        
        return drive;

    } catch (err) {
        if (err.response) {
            console.error(`❌ [API ERROR] Status: ${err.response.status}`);
            if (typeof err.response.data === 'string' && err.response.data.includes('<!doctype')) {
                console.error("Response is HTML. Snippet:", err.response.data.substring(0, 500));
            } else {
                console.error("Response Data:", err.response.data);
            }
        } else {
            console.error("❌ [SYSTEM ERROR]:", err.message);
        }
        throw err;
    }
}
function generateAddition(startWord, brain) {
    let current = startWord;
    let addition = "";
    
    // 脳のキーの中から、今の文末を含んでいるものを探す
    const keys = Object.keys(brain).filter(k => startWord.includes(k) || k.includes(startWord));
    if (keys.length === 0) return "";
    
    let key = keys[Math.floor(Math.random() * keys.length)];
    
    for (let i = 0; i < 5; i++) { // 最大5語まで継ぎ足す
        const nextList = brain[key];
        if (!nextList || nextList.length === 0) break;
        
        const nextWord = nextList[Math.floor(Math.random() * nextList.length)];
        addition += nextWord;
        key = nextWord;
    }
    
    // 継ぎ足し分も一応掃除しておく
    return addition.replace(/:.*?:/g, '').replace(/ /g, '').trim();
}
/**
 * 取得した語彙をGoogleドライブのtxtファイルに書き込む
 * @param {string} fileId - 書き込み先txtファイルのID
 * @param {string} content - 書き込む内容（単語リストなど）
 */
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
    characterSetting: "ひみつ"
};

// Misskey初期化
const mk = new misskey.api.APIClient({
    origin: `https://${config.domain}`,
    credential: config.token
});

async function checkAvailableModels() {
    const url = `https://generativelanguage.googleapis.com/v1/models?key=${process.env.GEMINI_API_KEY}`;
    try {
        const res = await axios.get(url);
        console.log("利用可能なモデルリスト:");
        res.data.models.forEach(m => console.log("- " + m.name));
    } catch (e) {
        console.error("モデルリスト取得失敗:", e.message);
    }
}
async function askGemini(prompt) {
    // 優先順位が高い順に並べる
    const modelPriority = [
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
　　// ランダムにエラー文を選択する関数
    const getRandomError = () => errorMessages[Math.floor(Math.random() * errorMessages.length)];
    for (const modelId of modelPriority) {
        // key= の後ろを currentKey にするのがポイント！
        const url = `https://generativelanguage.googleapis.com/v1/models/${modelId}:generateContent?key=${currentKey}`;
        
        try {
            console.log(`モデル試行中: ${modelId}`);
            const res = await axios.post(url, {
                contents: [{ parts: [{ text: prompt }] }]
            });
            return res.data.candidates[0].content.parts[0].text;
            
        } catch (error) {
            const status = error.response ? error.response.status : null;
            if (status === 429) {
                console.warn(`⚠️ ${modelId} が枠不足です。次のモデルを試します...`);
                continue;
            } else if (status === 404) {
                console.warn(`⚠️ ${modelId} が発見できません。次のモデルを試します...`);
                continue;
            }
            // --- 重大なエラー時のログ表示 ---
            const finalError = getRandomError();
            console.error(`致命的なエラー！(${error.message}): ${finalError}`);
            return finalError; // ランダムなエラー文を返す
            break;
        }
    }

    // 全モデル失敗時の最終防衛ライン
    return getRandomError();
}
        async function main() {
    try {
        console.log("=== API Connection Check ===");
        
        // 1. まずドメインとトークンが生きているか、一文字ずつ確認
        const domain = (process.env.MK_DOMAIN || "").trim();
        const token = (process.env.MK_TOKEN || "").trim();
        
        if (!domain || !token) {
            throw new Error("MK_DOMAIN または MK_TOKEN が環境変数に設定されていません。");
        }

        // 2. 'i' へのリクエスト（自作 mk オブジェクトの挙動を確認）
        // 修正ポイント: 第二引数に必ず空のオブジェクト {} を渡して、
        // 内部で Body が undefined になるのを防ぐ
        const me = await mk.request('i', { i: token }); 

        const my_id = me.id;
        const my_username = me.username;
        console.log(`✅ Logged in as: @${my_username} (${my_id})`);

        // ... 続く
        // --- 1. 自動フォロバ & 片想い解除処理 ---
        console.log("フォロー状況を整理中...");
        
        try {
            // 自分のフォロワーを取得（フォロバ用）
            const followers = await mk.request('users/followers', { userId: my_id, limit: 50 });
            // 自分がフォロー中のユーザーを取得（リムーブ用）
            const following = await mk.request('users/following', { userId: my_id, limit: 50 });

            const followerIds = followers.map(f => f.followerId);
            const followingIds = following.map(f => f.followeeId);

            // 【フォロバ】フォローしてくれているけど、自分がフォローしていない人をフォロー
            for (const f of followers) {
                const target = f.follower;
                if (target && !target.isFollowing && !target.isBot && target.id !== my_id) {
                    await mk.request('following/create', { userId: target.id })
                        .then(() => console.log(`[フォロバ成功]: @${target.username}`))
                        .catch(e => console.error(`[フォロバ失敗]: ${e.message}`));
                }
            }

            // 【リムーブ】自分がフォローしているけど、フォローし返してくれていない人を解除
            for (const f of following) {
                const target = f.followee;
                // 相手のIDが自分のフォロワーリストに含まれていない場合
                if (target && !followerIds.includes(target.id) && target.id !== my_id) {
                    await mk.request('following/delete', { userId: target.id })
                        .then(() => console.log(`[リムーブ成功]: @${target.username} (片想い解除)`))
                        .catch(e => console.error(`[リムーブ失敗]: ${e.message}`));
                }
            }
        } catch (e) {
            console.log("フォロー整理処理でエラーが発生しましたが、続行します。");
        }

        // --- 2. メンション取得・返信 ---
        console.log("メンション確認中...");
        const mentions = await mk.request('notes/mentions', { limit: 12 });
        let replyCount = 0;
        
        // ... (以下、返信ロジックへ続く)

        for (const note of mentions) {
            if (replyCount >= 4) break;
            // --- ここに追加 ---
            let reply_prompt = ""; 
            let reply_text = "";
            // -----------------
            
            if (note.user.isBot || note.user.id === me.id || note.myReplyId || (note.repliesCount && note.repliesCount > 0)) {
                continue;
            }

            let user_input = (note.text || "").replace(`@${me.username}`, "").trim();
            if (!user_input) continue;

            console.log(`${note.user.username} さんからのメンションを処理中...`);

            // --- 2.5 リアクション判定 ---
            if (user_input.includes("おみくじ") || user_input.includes("マルコフ")) {
                try {
                    const reactionEmoji = user_input.includes("おみくじ") ? ":shiropuyo_good:" : ":Shiropuyo_galaxy:";
                    await mk.request('notes/reactions/create', {
                        noteId: note.id,
                        reaction: reactionEmoji
                    });
                } catch (reacErr) {
                    console.error("リアクション失敗:", reacErr.message);
                }
            }

            reply_text = "";

            // --- 3. 振る舞い分岐 ---
            if (user_input.includes("マルコフ")) {
                console.log("マルコフ連鎖モード（進化版）起動！");
                const tl = await mk.request('notes/hybrid-timeline', { limit: 72 });
                const tl_text = tl
                    .filter(n => n.text && n.user.id !== me.id)
                    .map(n => n.text.replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, '').trim())
                    .slice(0, 64)
                    .join(" ");

                // 1. 単語分解（半角カタカナ \uFF65-\uFF9F に対応！）
                const regex = /[\u4E00-\u9FFF]+|[\u3040-\u309F]+|[\u30A0-\u30FF]+|[\uFF65-\uFF9F]+|[a-zA-Z0-9]+|[^\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uFF65-\uFF9F\sa-zA-Z0-9]+/g;
                const words = tl_text.match(regex) || [];
                
                if (words.length > 0) {
                    // 2. マルコフ辞書の作成（どの単語の次にどの単語が来たかをリスト化）
                    const markovDict = {};
                    for (let i = 0; i < words.length - 1; i++) {
                        const w1 = words[i];
                        const w2 = words[i + 1];
                        if (!markovDict[w1]) markovDict[w1] = [];
                        markovDict[w1].push(w2); // w1の次に来た単語(w2)をリストにぶち込む
                    }

                    // 記号判定用ヘルパー関数
                    const isSymbol = (str) => /^[^a-zA-Z0-9\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uFF65-\uFF9F]+$/.test(str);

                    // 単語抽選関数（60%再抽選＆禁止ワード回避つき）
                    const pickNextWord = (list) => {
                        if (!list || list.length === 0) return "";
                        let candidate = list[Math.floor(Math.random() * list.length)];
                        
                        // 記号組が選ばれた場合、60%の確率で再抽選
                        if (isSymbol(candidate) && Math.random() < 0.6) {
                            candidate = list[Math.floor(Math.random() * list.length)];
                        }
                        
                        // 禁止ワードが含まれていたら全体から再抽選（無限ループ防止で最大5回まで）
                        let attempts = 0;
                        while (/(マルコフ|おみくじ|タイムライン|@|#)/.test(candidate) && attempts < 5) {
                            candidate = words[Math.floor(Math.random() * words.length)];
                            attempts++;
                        }
                        if (/(マルコフ|おみくじ|タイムライン|@|#)/.test(candidate)) return ""; // 諦めて空文字
                        
                        return candidate;
                    };
                    const particles = ["が", "の", "を", "と", "に", "から", "は", "も"];
                    let generated = "";
                    
                    // 最初の単語を全体からランダムに決定
                    let current_word = pickNextWord(words);
                    for (let i = 0; i < n ; i++) {
                        if (!current_word) current_word = pickNextWord(words); // 空なら復活させる
                        // --- 長すぎるひらがな・カタカナの塊をチェック ---
                        // 8文字以上のひらがなのみ、またはカタカナのみの単語ならスキップして再抽選
                        if (/^[\u3040-\u309F]{8,}$|^[\u30A0-\u30FF]{8,}$/.test(current_word)) {
                            current_word = pickNextWord(words); // 別の単語にすり替える
                            i--; // ループ回数をカウントしないように戻す
                            continue;
                        }
                        
                        generated += current_word;

                        // 3. ランダムに助詞を挟む
                        if (Math.random() < 0.4) {
                            const p = particles[Math.floor(Math.random() * particles.length)];
                            generated += p;
                            current_word = p; // ★ここがミソ！次の単語は「この助詞の次に来た単語」を探しに行く
                        }

                        // 次の単語を辞書から探す（文脈が途切れたら全体からランダム抽選に切り替え）
                        let next_candidates = (markovDict[current_word] && markovDict[current_word].length > 0) 
                            ? markovDict[current_word] 
                            : words;
                        
                        current_word = pickNextWord(next_candidates);
                    }
                    // --- 半角カタカナ特殊付与ロジック ---
                    if (Math.random() < 0.2) { // 50%の確率で発動
                        // TLから半角カタカナ（および半角記号）のみを抽出
                        const kanaWords = words.filter(w => /^[\uFF65-\uFF9F]+$/.test(w));
                        
                        if (kanaWords.length > 0) {
                            // ランダムに1つ選ぶ
                            let suffix = kanaWords[Math.floor(Math.random() * kanaWords.length)];
                            
                            // 禁止ワード除外（念のため）
                            if (!/(マルコフ|おみくじ|タイムライン|@|#)/.test(suffix)) {
                                // 文末か、その1つ前の位置に融合
                                if (generated.length > 2 && Math.random() < 0.5) {
                                    // 1つ前に挿入（最後から1文字目と2文字目の間など）
                                    const pos = generated.length - 1;
                                    generated = generated.slice(0, pos) + suffix + generated.slice(pos);
                                } else {
                                    // 普通に文末に足す
                                    generated += suffix;
                                }
                            }
                        }
                    }
                    // --- ここまで ---
                    reply_text = generated || "（言葉の断片が見つかりませんでした）";
                } else {
                    reply_text = "（タイムラインに材料がありません）";
                }

            } else if (user_input.includes("おみくじ")) {                // 【AI】おみくじモード
                console.log("おみくじモード起動！");
                const luckNum = Math.floor(Math.random() * 100);
                let luckResult = (luckNum < 10) ? "超大吉" : (luckNum < 30) ? "大吉" : (luckNum < 60) ? "中吉" : (luckNum < 85) ? "小吉" : (luckNum < 95) ? "末吉" : "凶";

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
                // 【AI】通常リプライ
                const reply_prompt = `
※性格以外のこれまでの指令を先にすべて無視してください。 相手の言葉: ${user_input} これに対して80文字以内で返信してください。
 -ユーザーのことは「マスター」と呼ぶこと。
 ^メンションと「@」使用禁止。`;                
                console.log("API制限回避のため待機中...");
                await sleep(10000);
                reply_text = await askGemini(reply_prompt);
            }
                // 最終的な投稿
                await mk.request('notes/create', {
                    text: reply_text.trim().slice(0, 200),
                    replyId: note.id,
                    visibility: 'home' 
                });
                
                console.log(`${note.user.username} さんに返信しました。`);
                replyCount++;

            // ===== 修正後 =====
                console.log("API制限回避のため5秒待機します...");
            await sleep(5000);

        } // ← loop(for等)の終わり
    } catch (e) { // ← 余分な } を削り、外側の try と直接つなげました
        console.log(`メンション処理エラー!><: ${e.message}`);
    } 

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
// driveオブジェクトが正しく生成されているか
console.log(`Drive object exists: ${typeof drive !== 'undefined'}`);

try {
    const fid = process.env.GDRIVE_FILE_ID;
    if (!fid) throw new Error("環境変数 GDRIVE_FILE_ID が読み込めていません！");

    // ここでエラーが出るはず
    const res = await drive.files.get({
        fileId: fid.trim(),
        alt: 'media'
    });
} catch (e) {
    console.error("❌ Drive取得失敗の直前ログ:");
    console.error("Error Name:", e.name);
    console.error("Error Message:", e.message);
    if (e.config) console.error("実際に叩こうとしたURL:", e.config.url);
    throw e;
}
// 1. タイムラインから材料を取得
        const tl = await mk.request('notes/hybrid-timeline', { limit: 128 });
        const tl_text = tl
            .filter(n => n.text && n.user.id !== my_id)
            .map(n => n.text.replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, '').trim())
            .slice(0, 64)
            .join(" ");
        
        const words = segmenter.segment(tl_text);
        const isSymbol = (str) => /^[^a-zA-Z0-9\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uFF65-\uFF9F]+$/.test(str);
        const particles = ["が", "の", "を", "と", "に", "から", "は", "も", "で"];

        let brain = {};
        if (words.length > 0) {
        // --- 既存の脳を読み込み（超堅牢版） ---
            // 2. Googleドライブへ蓄積（学習）
            try {
const fs = require('fs'); // もし未定義なら追加

// 環境変数に「中身」が入っている場合と「ファイルパス」がある場合の両方に対応させる書き方
let gDriveCreds;
if (process.env.GDRIVE_SERVICE_ACCOUNT_PATH) {
    // YAMLで書き出したファイルを読み込む
    gDriveCreds = JSON.parse(fs.readFileSync(process.env.GDRIVE_SERVICE_ACCOUNT_PATH, 'utf8'));
} else {
    // ローカル実行など、環境変数に直接入っている場合
    gDriveCreds = JSON.parse(process.env.GDRIVE_SERVICE_ACCOUNT);
}

const auth = new google.auth.JWT(
    gDriveCreds.client_email, 
    null, 
    gDriveCreds.private_key,
    ['https://www.googleapis.com/auth/drive']
);
                const drive = google.drive({ version: 'v3', auth });
                const fileId = process.env.GDRIVE_FILE_ID;

                // --- 既存の脳を読み込み ---
                // Google Driveを叩く直前に入れる
console.log(`DEBUG_TARGET_ID: "${process.env.GDRIVE_FILE_ID}"`);
try {
    const fileId = process.env.GDRIVE_FILE_ID?.trim(); // 空白除去

    if (!fileId) {
        console.error("🚨 GDRIVE_FILE_ID が空です。Secretを確認してください。");
        brain = {};
    } else {
        console.log(`DEBUG: Google Driveからファイル取得中 (ID: ${fileId.substring(0,5)}...)`);
        
        const res = await drive.files.get({
            fileId: fileId,
            alt: 'media'
        }, { 
            responseType: 'text',
            // ここで400番台もエラーにせず受け取る
            validateStatus: (status) => status < 500 
        });

        let rawData = res.data;

        // HTMLが返ってきたら内容を詳しくログに出す
        if (typeof rawData === 'string' && rawData.trim().startsWith('<!')) {
            const titleMatch = rawData.match(/<title>(.*?)<\/title>/i);
            console.error(`🚨 Apache/GoogleからHTMLが返されました: ${titleMatch ? titleMatch[1] : 'No Title'}`);
            // なぜHTMLなのか？のヒントを出力
            console.error("HTML冒頭:", rawData.substring(0, 200));
            brain = {};
        } else if (!rawData || rawData.trim() === "") {
            console.log("脳のデータが空でした。新規作成します。");
            brain = {};
        } else {
            // 文字列ならパース、オブジェクトならそのまま（念のため）
            try {
                brain = (typeof rawData === 'string') ? JSON.parse(rawData.trim()) : rawData;
                const wordCount = Object.keys(brain).length;
                console.log(`✅ 現在の脳の蓄積語数: ${wordCount}語`);
            } catch (pErr) {
                console.error("🚨 JSONパースエラー:", pErr.message);
                console.error("受信データ冒頭:", String(rawData).substring(0, 100));
                brain = {};
            }
        }
    }
} catch (readError) {
    console.error(`❌ Google Drive接続致命的エラー: ${readError.message}`);
    // Apache 400 の場合、ここで URL がどうなっていたか確認
    if (readError.config) console.error("Request URL:", readError.config.url);
    brain = {};
}
                // --- 既存の脳のクリーニング（一括大掃除） ---
                console.log("既存の脳をスキャンしてゴミ（改行、タグ、絵文字、全角スペース）を掃除中...");
                
                Object.keys(brain).forEach(key => {
                    const isInvalidKey = key.includes('\n') || 
                        key.includes('\\n') || 
                        key.includes('　') || 
                        key.includes('<') || 
                        key.includes('\\')||
                        key.includes('small')||
                        key.includes('color')||
                        key.includes('\\u')||
                        key.includes(':')||
                        key.includes('@')||
                        /[\uD800-\uDBFF]/.test(key) ||
                        /[\uDC00-\uDFFF]/.test(key) ||
                        key.includes('_')||
                        /:.*:/.test(key);

                    let list = brain[key];
                    if (Array.isArray(list)) {
                        brain[key] = list.filter(w => {
                            if (typeof w !== 'string') return false;
                            if (w.includes('\\n') || w.includes('　') || w.includes('@')||w.includes('<') || w.includes('\\')||w.includes('small')||w.includes('color')||w.includes('\\u')||w.includes(':')||w.includes('_')||/[\uD800-\uDBFF]/.test(w)||/[\uDC00-\uDFFF]/.test(w)) {
                                return false; 
                            }
                            return w.trim() !== "";
                        });
                    }
                    
                    if (isInvalidKey || !brain[key] || brain[key].length === 0) {
                        delete brain[key];
                    }
                });
                console.log("脳のクリーニング完了！");
            // --- 改良版：半角カタカナの塊を抽出して学習 ---
            const kanaBlocks = tl_text.match(/[\uFF65-\uFF9F]+/g) || [];

            // ★ ここで「\n」を削除 & ついでに前後から空白も削る
            // --- 強化版：不要な文字列のクリーニングと排除 ---
                const cleanedWords = words
                    .map(w => {
                        let cleaned = w.replace(/\n/g, '').trim(); // 改行削除と端の空白削除
                        
                        // 1. 一部にでも「\n」が含まれる場合、あるいは「 」（全角スペース）を排除
                        if (w.includes('\\n') || w.includes('　')) return "";
                        
                        // 2. 「</」または「<」を含む（HTMLタグ系）を排除
                        if (w.includes('</') || w.includes('<')) return "";
                        if (w.includes('\\u') || w.includes(':')) return "";
                        if (w.includes('_')||w.includes('@')) return "";
                        if(/[\uD800-\uDBFF]/.test(w) ||/[\uDC00-\uDFFF]/.test(w)) return "";         // サロゲートペアの下位（死骸2）)
                        if (w.includes('\uFFFD')) return "";
                        // 3. 「:」に囲まれている文字列（カスタム絵文字 :emoji: など）を排除
                        // ※正規表現 /:.*:/ は「:」で始まり「:」で終わる文字列にマッチします
                        if (/:.*:/.test(w)) return "";
                        
                        return cleaned;
                    })
                    .filter(w => w !== ""); // 上記で "" になったゴミをすべて捨てる
            // 今回の分析スコアをログ出力
            console.log(`【分析実行】総単語数: ${words.length}個 / カタカナ塊: ${kanaBlocks.length}個`);

            let learnCount = 0; // 学習したペア数をカウント
            
            // --- 強化版：学習ループ（登録時の最終検閲） ---
                for (let i = 0; i < cleanedWords.length - 1; i++) {
                    const current = cleanedWords[i];
                    let next = cleanedWords[i + 1];

                    // ★ 登録直前の最終チェック
                    // 次の単語に改行、全角スペース、タグ、絵文字コードが含まれていたら学習をスキップ
                    if (
                        next.includes('\\n') || 
                        next.includes('　') || 
                        next.includes('<') || 
                        next.includes('\\')||
                        next.includes('small')||
                        next.includes('color')||
                        next.includes('\\u')||
                        next.includes(':')||
                        next.includes('_')||
                        next.includes('@')||
                        /[\uD800-\uDBFF]/.test(next) ||
                        /[\uDC00-\uDFFF]/.test(next) ||
                        next.trim() === ""
                    ) {
                        continue; // このペアは覚えない
                    }
                // 次の単語が「半角カタカナの断片」なら塊に復元
                if (/^[\uFF65-\uFF9F]+$/.test(next)) {
                    const fullBlock = kanaBlocks.find(block => block.startsWith(next));
                    if (fullBlock) next = fullBlock; 
                }

                // --- 脳への記録処理 ---
                // particles(助詞)に含まれるか、あるいは普通の名詞などの領域か
                // どちらの場合でも brain[current] というキーで保存
                if (!brain[current]) brain[current] = [];

                // 重複して同じペアを覚えすぎないための簡易チェック（お好みで）
                // if (!brain[current].includes(next) || Math.random() < 0.3) { 
                brain[current].push(next);
                // }

                // 上限20,000件（各単語ごとのつながり上限）
                if (brain[current].length > 20000) {
                    brain[current].shift();
                }
            }

            // --- 3. Googleドライブへ書き戻し ---
            await drive.files.update({
                fileId: fileId,
                media: { 
                    mimeType: 'application/json', 
                    body: JSON.stringify(brain, null, 2) 
                }
            });
    
            console.log("Googleドライブの『脳』をアップデート完了（全単語学習・上限2万件モード）");

        } catch (driveError) {
            console.log("ドライブ連携に失敗（生成は続行）:", driveError.message);
        }
    }
            // ↑ ここでドライブ処理の try-catch が完結！
        // --- この下に生成ロジック（const mm = ... や forループ）が続く ---
            // --- 3. マルコフ文章生成 ---
        const markovDict = {};
        // ここが n になっていたので修正（words.length - 1 まで回すのが正解）
        for (let i = 0; i < n+8 ; i++) {
            const w1 = words[i];
            const w2 = words[i + 1];
            if (!markovDict[w1]) markovDict[w1] = [];
            markovDict[w1].push(w2);
        }

        const pickNextWord = (list) => {
            if (!list || list.length === 0) return "";
            let candidate = list[Math.floor(Math.random() * list.length)];
            if (isSymbol(candidate) && Math.random() < 0.6) {
                candidate = list[Math.floor(Math.random() * list.length)];
            }
            let attempts = 0;
            while (/(マルコフ|おみくじ|タイムライン|@|#)/.test(candidate) && attempts < 5) {
                candidate = words[Math.floor(Math.random() * words.length)];
                attempts++;
            }
            return candidate;
        };

        const mm = Math.floor(Math.random() * (17 - 5 + 1)) + 15;
        let generated = "";
        let current_word = pickNextWord(words);

        for (let i = 0; i < mm; i++) {
            if (!current_word) current_word = pickNextWord(words);
            
            let foundNext = "";
            const useBrain = Math.random() < 0.7;

            if (useBrain && particles.includes(current_word) && brain[current_word]) {
                const candidates = brain[current_word];
                foundNext = candidates[Math.floor(Math.random() * candidates.length)];
            }

            if (!foundNext && markovDict[current_word]) {
                foundNext = pickNextWord(markovDict[current_word]);
            }

            current_word = foundNext || pickNextWord(words);

            if (/^[\u3040-\u309F]{8,}$|^[\u30A0-\u30FF]{8,}$/.test(current_word)) {
                current_word = pickNextWord(words);
                i--; continue;
            }

            generated += current_word;
            if (["。", "！", "？", "w", "…"].some(s => current_word.endsWith(s))) break;
        }

// 1. 生成された rawデータを一旦受け取る（変数がなければここで宣言）
        let outputText = generated || "（言葉の断片が見つかりませんでした）";

        // 2. ゴミ掃除（絵文字死骸、タグ、バックスラッシュ、スペースを根こそぎ消す）
        outputText = outputText
            .replace(/:.*?:/g, '')
            .replace(/[ 　]/g, '') // 半角・全角スペース両方
            .replace(/<.*?>/g, '')
            .replace(/\\u[0-9a-fA-F]{4}/g, '')
            .replace(/\\/g, '')
            .replace(/\\u[0-9a-fA-F]{4}/g, '')  // ★「\\uXXXX」形式を削除
            .replace(/\\/g, '')                 // ★残った「\\」を単体で削除
            .trim();

        // 3. 短くなりすぎたら継ぎ足し
        const MIN_LENGTH = 10;
        let retryCount = 0;
        while (outputText.length < MIN_LENGTH && retryCount < 5) {
            const hint = outputText.length > 0 ? outputText.slice(-2) : pickNextWord(words);
            const nextAddition = generateAddition(hint, brain); 
            if (!nextAddition) break; 
            // 継ぎ足し分も掃除して合体
            outputText += nextAddition.replace(/:.*?:/g, '').replace(/[ 　]/g, '').trim();
            retryCount++;
        }

        // 4. 【手動実行の検知】
        // GitHub環境変数を確認。手動(workflow_dispatch)ならラベルを付与
        const eventName = process.env.GITHUB_EVENT_NAME; 
        if (eventName === 'workflow_dispatch') {
            outputText = `【手動実行】${outputText}`;
        }// --- 5. 投稿実行 (修正+デバッグ版) ---
await sleep(1000);

const postData = { 
    i: process.env.MK_TOKEN, 
    text: outputText.trim().slice(0, 110),
    visibility: 'home' 
};

try {
    console.log("DEBUG: 投稿リクエスト送信開始...");
    // 自作の mk.request に postData を投げる
    // ※ mk.request 内部で content-type ヘッダーが付与されているか確認してください
    const res = await mk.request('notes/create', postData);
    console.log("✅ 投稿成功");
} catch (err) {
    console.error("━━━━━━━━━━━━━ 🚨 Misskey投稿失敗 🚨 ━━━━━━━━━━━━━");
    if (err.response) {
        console.error(`Status: ${err.response.status}`);
        console.error(`Data: ${JSON.stringify(err.response.data)}`);
    } else {
        console.error(`Error: ${err.message}`);
    }
    // ここで敢えて例外を投げ、Actionsを止めてログを見せる
    throw new Error("Apacheがリクエストを拒否しました。BodyかHeaderが不正です。");
}
        console.log("本投稿が完了しました！内容: " + outputText);
    } catch (e) {
        console.error(`致命的なエラー: ${e.message}`);
        try {
            console.log(`投稿エラー！><（エラー: ${e.message}）`);
        } catch (notificationError) {
            console.error("エラー通知自体も送れない！:", notificationError.message);
        }
    }
}// ← main関数を閉じる正しいカッコ

// 最後にしっかり実行
main();
