# Cloudflare Pagesへの移行

このリポジトリはCloudflare Pagesで静的ページとFunctions APIを一緒に配信できます。デプロイ前に次の設定を行ってください。

## Pagesプロジェクト

1. Cloudflare Dashboardの **Workers & Pages** からPagesプロジェクトを作り、GitHubの **misumisankaku/Duenoa** リポジトリを接続します。
2. Production branchは `main` にします。
3. Build commandを `npm run pages:build`、Build output directoryを `dist` にします。
4. 初回デプロイが成功したら、Cloudflareが発行した `*.pages.dev` URLでゲームを開きます。

Git連携は、`main` に変更が入るたびにCloudflare Pagesを自動デプロイします。Functionsは `functions/api/` から `/api/` へルーティングされ、静的ファイルは `dist/` から配信します。 `_routes.json` はFunctionsをAPIのみに限定します。

## 環境変数とシークレット

Cloudflare Dashboardの **Workers & Pages → プロジェクト → Settings → Variables and Secrets** で、少なくともProduction環境に以下を設定し、保存後に再デプロイします。

| 名前 | 種類 | 用途 |
| --- | --- | --- |
| `UPSTASH_REDIS_REST_URL` | Variable | ランダム戦キューと利用者数の保存先 |
| `UPSTASH_REDIS_REST_TOKEN` | Secret | Upstashへのアクセス認証 |
| `DUENOA_METRICS_PASSWORD` | Secret | 管理用の利用者数ページ |

値は現在のVercelプロジェクトにある同名の環境変数と同じものを設定します。値をHTML、README、GitHubに書き込まないでください。Vercel側はCloudflareの動作確認が終わるまで停止しないでください。

## 移行後

- CloudflareのPages URLでランダム戦と利用者数ページを確認します。
- AdSenseと忍者AdMaxを使い続ける場合は、新しいPages URLも各サービスのサイト設定に追加します。
- DNSや独自ドメインを使う場合は、Cloudflare Pagesの設定画面に表示される案内に従って接続します。
