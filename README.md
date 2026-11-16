# デュエノア

かわいいファンタジーTCGのブラウザーゲームです。CPU対戦、部屋コード式オンライン対戦、ランダム戦に対応しています。

## 対戦方法

- CPU対戦：デッキを選び、「CPU戦を開始」を押します。
- 部屋コード対戦：部屋を作ってコードを共有し、相手が参加します。
- ランダム戦：「ランダム戦を探す」を押すと、待ち時間と待機人数が表示され、待っている人と自動で対戦します。勝率やレートは記録しません。

## ランダム戦の設定

ランダム戦の待ち列にはUpstash Redisを使います。Vercelのプロジェクトで **Storage → Create Database → Upstash Redis → Free** を選んでプロジェクトへ接続してください。接続すると、必要な `UPSTASH_REDIS_REST_URL` と `UPSTASH_REDIS_REST_TOKEN` がVercelに設定されます。

## オンライン通信

画面はGitHub Pages、マッチングAPIはVercel Functions、対戦中の通信はPeerJS CloudのWebRTCを使います。プレイにはインターネット接続が必要です。

- [GitHub Pages](https://docs.github.com/en/pages)
- [PeerJS Cloud](https://peerjs.com/server/cloud)
- [Vercel Storage](https://vercel.com/docs/marketplace-storage)
- [Upstash Redis pricing](https://upstash.com/pricing/redis)
