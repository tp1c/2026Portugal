# ✈️ 2026 Portugal Travel Planner 行為準則 (ANTIGRAVITY.md)

本文件定義了 `2026Portugal` 專案的開發規範、工作流與敏感資料處理機制。

---

## 📂 專案定位與結構
* **定位**：自動生成/更新葡萄牙 12 日旅行計畫（包含里斯本 4 日與 Douro 河郵輪行程）的工具。
* **主要程式**：[generate_lisbon_itinerary.js](file:///d:/Data/Home/Antigravity/2026Portugal/generate_lisbon_itinerary.js)
* **輸出成品**：
  * **Google Sheet** (日程、預訂與行李清單)
  * **Google Doc** (排版精美的 PDF/Doc 指南)
  * **HTML Report** (本機網頁 [travel_guide.html](file:///d:/Data/Home/Antigravity/2026Portugal/travel_guide.html))

---

## 🔒 敏感資料保護 (極重要)
本專案整合了 Google OAuth 憑證。請務必遵守以下規定：
- **`credentials.json`** 與 **`token.json`** 已列入 `.gitignore`，**嚴禁**將其 stage 或 commit 至 Git 儲存庫。
- 本機執行 `node generate_lisbon_itinerary.js` 前，確認這兩個檔案存在於根目錄。
- 嚴禁在程式碼中硬編碼任何 API Key 或 OAuth Token。

---

## ⚙️ 開發與執行規範
1. **依賴管理**：
   - 專案使用 `googleapis` 進行 Google API 串接。
   - 安裝依賴時，使用 `npm install`。
2. **日程修改**：
   - 若要調整行程內容，請直接編輯 `generate_lisbon_itinerary.js` 中的 `scheduleValues`、`bookingValues` 及 `packingValues` 資料陣列。
   - 修改完成後，執行以下指令重新生成所有端點資料與網頁：
     ```bash
     node generate_lisbon_itinerary.js
     ```
3. **HTML 報告驗證**：
   - 重新生成後，於瀏覽器開啟 [travel_guide.html](file:///d:/Data/Home/Antigravity/2026Portugal/travel_guide.html)，確認樣式、連結與資料是否正確渲染。

---

## 🔄 每日開工/收工與知識庫連動
* **開工**：
  1. 檢視本 `ANTIGRAVITY.md` 及專案的 `README.md`。
  2. 檢查 Obsidian 中的專案筆記（若有）。
  3. 執行 `git status` 盤點。
* **收工**：
  1. 檢查 `git diff`，確保無敏感憑證檔案被誤加。
  2. 精確 stage 修改的檔案（如行程調整的 `.js` 檔），**避免**直接使用 `git add .`。
  3. 將本日踩坑與學習所得（如 GAS、CORS 解決方案）記錄於當日 `Daily/` 筆記，並於下一次 `Reorg` 時整理至第二大腦知識庫。
