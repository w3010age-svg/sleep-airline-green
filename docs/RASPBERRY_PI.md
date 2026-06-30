# Raspberry Pi 按鈕語音互動設定

這份設定會讓 Raspberry Pi 變成 Sleep Airline 的實體按鈕控制器：

- 按一下 GPIO17 按鈕
- 如果乘客尚未飛行，就觸發起飛
- 如果乘客正在飛行，就觸發降落
- 取得機長廣播文字
- 透過 OpenAI TTS 產生 MP3
- 從 Raspberry Pi 外接喇叭播放

## 1. 硬體接線

按鈕用最簡單的下拉到 GND 接法：

| 按鈕腳位 | Raspberry Pi |
|---|---|
| 一端 | GPIO17，也就是實體 pin 11 |
| 另一端 | GND，例如實體 pin 9 |

程式使用 `gpiozero.Button(17, pull_up=True)`，所以不需要外接電阻。按下時 GPIO17 會被接到 GND。

## 2. Raspberry Pi 需要安裝的東西

在 Raspberry Pi 終端機執行：

```bash
sudo apt update
sudo apt install -y python3-gpiozero python3-requests mpg123 git
```

如果你要在 Raspberry Pi 本機跑網站後端，也需要 Node.js：

```bash
sudo apt install -y nodejs npm
```

如果你只想讓 Raspberry Pi 呼叫 Vercel 網址，就不一定要在 Pi 上跑 Node.js。

## 3. 喇叭設定與測試

先確認系統看得到音訊裝置：

```bash
aplay -l
```

測試喇叭：

```bash
speaker-test -t wav -c 2
```

如果沒有聲音，可以開 Raspberry Pi 設定工具：

```bash
sudo raspi-config
```

到音訊相關選項，把輸出切到你的喇叭，例如 HDMI、耳機孔，或 USB 音效卡。

也可以用這個指令看目前預設音訊裝置：

```bash
pactl info
```

## 4. 設定 Pi 腳本

在專案根目錄建立 `.env.pi`：

```bash
SLEEP_AIRLINE_BASE_URL=https://你的-vercel-網址.vercel.app
SLEEP_AIRLINE_PASSENGER_ID=pi_001
SLEEP_AIRLINE_PASSENGER_NAME=Raspberry Pi
SLEEP_AIRLINE_GROUP_ID=group_15
SLEEP_AIRLINE_ROUTE_DIRECTION=auto
SLEEP_AIRLINE_BROADCAST_STYLE=flight_attendant
SLEEP_AIRLINE_BUTTON_GPIO=17
SLEEP_AIRLINE_AUDIO_PLAYER=mpg123
SLEEP_AIRLINE_IMAGE_OUTPUT_DIR=pi-output
```

如果你是在 Raspberry Pi 本機跑 `npm run dev` 或 `npm start`，可以改成：

```bash
SLEEP_AIRLINE_BASE_URL=http://127.0.0.1:3000
```

## 5. 先手動測試

在專案根目錄執行：

```bash
python3 scripts/pi_button_voice.py
```

看到這些訊息就代表程式正在等按鈕：

```text
Sleep Airline Pi button controller
Server: ...
GPIO: BCM 17
Press Ctrl+C to stop.
```

接著按 GPIO17 按鈕：

- 第一次：建立/登入乘客，觸發起飛，播放起飛廣播
- 第二次：觸發降落，播放降落廣播，並把風景圖/美食圖存到 `pi-output`
- 再按一次：會重新起飛

看 Raspberry Pi 產生的圖片：

```bash
ls pi-output
```

如果你在 Raspberry Pi 桌面環境，可以開檔案管理器到專案資料夾裡的 `pi-output` 看圖片。

## 6. 開機自動啟動

建立 systemd service：

```bash
sudo nano /etc/systemd/system/sleep-airline-button.service
```

貼上以下內容，請把 `WorkingDirectory` 和 `ExecStart` 的路徑改成你 Raspberry Pi 上的專案路徑：

```ini
[Unit]
Description=Sleep Airline GPIO button voice controller
After=network-online.target sound.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/pi/SleepAirlineS2-main
ExecStart=/usr/bin/python3 /home/pi/SleepAirlineS2-main/scripts/pi_button_voice.py
Restart=always
RestartSec=3
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

啟用：

```bash
sudo systemctl daemon-reload
sudo systemctl enable sleep-airline-button
sudo systemctl start sleep-airline-button
```

看狀態：

```bash
sudo systemctl status sleep-airline-button
```

看即時紀錄：

```bash
journalctl -u sleep-airline-button -f
```

## 7. Vercel 端要確認的環境變數

如果 Raspberry Pi 呼叫的是 Vercel 網址，Vercel 至少要有：

```bash
OPENAI_API_KEY=sk-...
OPENAI_TTS_MODEL=tts-1
OPENAI_IMAGE_MODEL=gpt-image-1-mini
```

如果要資料真的進主辦 Notion，也要有主辦提供的：

```bash
NOTION_API_KEY=ntn_...
NOTION_DASHBOARD_DB_ID=...
NOTION_LANDSCAPE_DB_ID=...
```

不要把這些 key 放進 GitHub。

## 8. 常見問題

### 按鈕沒有反應

確認接線是 GPIO17 到 GND，不是 3.3V。

確認腳位模式是 BCM 17，也就是實體 pin 11。

可以先跑：

```bash
python3 scripts/pi_button_voice.py
```

看按下時終端機有沒有出現 `Button pressed`。

### 有 API 錯誤

確認 `.env.pi` 的 `SLEEP_AIRLINE_BASE_URL` 沒有打錯，而且網址可以從 Raspberry Pi 開啟。

例如：

```bash
curl https://你的-vercel-網址.vercel.app/api/config
```

### 沒聲音

先測：

```bash
speaker-test -t wav -c 2
```

再確認 `mpg123` 已安裝：

```bash
which mpg123
```

### TTS 沒有產生

確認 Vercel 有設定 `OPENAI_API_KEY` 和 `OPENAI_TTS_MODEL=tts-1`，設定後要 Redeploy。
