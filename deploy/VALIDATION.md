# 交付前驗證（在一台非開發機的乾淨 GPU 機器上執行）

- [ ] 依 DEPLOY.md 從零安裝前提（驅動/Toolkit/Docker）
- [ ] `docker compose up -d --build` 一次成功（僅 .env 的 HF_TOKEN 供 build）
- [ ] 三容器 healthy：/health、/api/llm/models、breeze /health(device=cuda)
- [ ] 端到端冒煙（合成音檔）status=done
- [ ] 真實會議音檔迴歸：與本機版比 逐字稿內容 / 講者分離段數 / 總耗時，
      差異在可接受範圍（人工判定，記錄數字）
- [ ] App 改指部署機 :8780，實機錄音→轉錄→講者→繁中記錄 全流程通
- [ ] 重開機後 compose 自動恢復（restart policy）
- [ ] 音檔即刪驗證：轉錄完 `docker exec haoji-haoji-backend-1 ls /data/uploads/parts` 為空
