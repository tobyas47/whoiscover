# 谁是卧底 - 在线多人版

支持多人同时在线的谁是卧底游戏，可部署到 Google Cloud Run。

## 游戏规则

| 角色 | 描述 |
|------|------|
| 好人 | 拿到好人词，但不知道自己是好人还是卧底 |
| 卧底 | 拿到坏人词，但不知道自己是卧底 |
| 天使 | 知道两个词，但不知道哪个是好人词哪个是坏人词 |
| 白板 | 没有任何词 |

### 夜晚阶段
- 所有存活玩家可以选择"刀"一个人
- **卧底**刀人 → 目标死亡
- **好人/天使/白板**刀人 → 自己会自杀
- 可以选择跳过不行动

### 白天阶段
- 自由讨论
- 投票淘汰一人

### 胜利条件
- **好人阵营胜**：所有卧底被淘汰
- **卧底阵营胜**：卧底人数 ≥ 好人阵营人数

## 本地运行

```bash
npm install
npm start
```

打开浏览器访问 `http://localhost:8080`

## 部署到 Google Cloud Run

```bash
# 1. 设置项目
gcloud config set project YOUR_PROJECT_ID

# 2. 构建并部署（Cloud Run 会自动构建 Docker 镜像）
gcloud run deploy whoiscover \
  --source . \
  --region asia-east1 \
  --allow-unauthenticated \
  --session-affinity \
  --min-instances 1 \
  --max-instances 10
```

> **重要**: `--session-affinity` 确保同一个 WebSocket 连接被路由到同一实例。`--min-instances 1` 避免冷启动导致连接中断。

## 技术栈

- **后端**: Node.js + Express + Socket.IO
- **前端**: 原生 HTML/CSS/JS
- **部署**: Docker + Google Cloud Run
