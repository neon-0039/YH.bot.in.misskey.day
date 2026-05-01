import * as misskey from 'misskey-js';

async function main() {
    console.log("=== 最小構成テスト開始 ===");

    const domain = process.env.MK_DOMAIN;
    const token = process.env.MK_TOKEN;

    if (!domain || !token) {
        console.error("エラー: MK_DOMAIN または MK_TOKEN が設定されていません。");
        return;
    }

    const mk = new misskey.api.APIClient({
        origin: `https://${domain}`,
        credential: token
    });

    try {
        console.log(`接続先: ${domain}`);
        
        // 1. 自分の情報を取得できるかテスト
        const me = await mk.request('i');
        console.log(`ログイン成功: @${me.username}`);

        // 2. 投稿テスト
        console.log("投稿を試行中...");
        const res = await mk.request('notes/create', {
            text: "テスト投稿（最小構成）",
            visibility: 'home'
        });

        console.log("✅ 投稿成功！ ID:", res.createdNote.id);

    } catch (e) {
        console.error("━━━━━━━━━━━━━ 🚨 エラー発生 🚨 ━━━━━━━━━━━━━");
        if (e.response) {
            console.error(`Status: ${e.response.status}`);
            console.error(`Data: ${JSON.stringify(e.response.data)}`);
        } else {
            console.error(`Message: ${e.message}`);
        }
        console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    }
}

main();
