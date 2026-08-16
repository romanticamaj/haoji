# 授權清單（商用散佈前確認）

本可部署單元內含以下第三方元件。散佈（含交付給其他公司部署）時，本清單須隨附。

| 元件 | 授權 | 商用/散佈 | 備註 |
|---|---|---|---|
| Breeze-ASR-25（MediaTek-Research） | Apache 2.0 | ✅ | 附授權副本＋標註出處即可 |
| Whisper-large-v2（OpenAI，Breeze 之 base model） | MIT | ✅ | |
| pyannote/speaker-diarization-3.1 ＋ segmentation-3.0 | MIT | ✅ | HF 下載屬 gated（接受條款＋token），**授權本身為 MIT、權重可再散佈**；已於 build 時預烤進 image。**正式商業交付前請人工複核 HF gate 條款措辭一次** |
| gemma4:e4b-it-qat（Google，經 Ollama） | Gemma Terms of Use | ✅ 有條件 | 須遵守 Google 的 Gemma 使用政策（禁止用途清單） |
| Ollama | MIT | ✅ | |
| PyTorch / transformers / pyannote.audio / FastAPI 等 Python 相依 | BSD/Apache/MIT | ✅ | 標準開源授權 |
| 好記後端程式碼（`backend/`、`deploy/`） | 自有 | — | 依交付合約 |

> pyannote 權重已於 build 時預烤進 image；其授權為 MIT，散佈時保留本清單即可。
> build 用的 HF token 經 BuildKit secret 傳入，**不存在於 image 任何 layer**。
