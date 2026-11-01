# tts-announce

OpenCode 插件：以 [faster-qwen3-tts](https://github.com/andimarafioti/faster-qwen3-tts) 之声源播报会话事件。

## CLI 播报

插件目录附 CLI，任意文本即播（测试、脚本皆宜）：

```bash
# 仓库根
tts.bat 编译完成,测试通过
# 或
bun run .opencode/plugins/tts-announce/cli.ts --voice alloy "自定义文本"
```

选项：`--base-url`（默认 `http://127.0.0.1:8000`）、`--model`、`--voice`。服务器不在线则报错退出（非静默）。

## 事件与套语

| 事件 | 默认套语 |
|------|----------|
| `session.execution.succeeded`（工毕，v2.2.x 实发者） | 任务完成 |
| `session.idle`（旧版行为，留作兼容） | 任务完成 |
| `session.execution.failed`（出错） | 出错了 |
| `permission.asked`（待授权） | 需要授权 |

> 注：服务端非流式响应仍用流式 WAV 头（尺寸字段为 `0xFFFFFFFF`），Windows SoundPlayer 拒播。
> 插件已于播放前归一化其头（`normalizeWav`）；上游 `examples/openai_server.py` 亦可修，一劳永逸。

## 依赖

先启动 TTS 服务器（模型热驻）：

```bash
start_tts_server.bat
```

（等价于 `python examples/openai_server.py --ref-audio ref_audio.wav ... --port 8000`，默认 0.6B 模型，`--model` 可传参换之；已设 `HF_HUB_OFFLINE=1` 以免无网时卡于 HuggingFace 校验。）

服务器不在线时插件静默跳过，不报错。

## 加载

**本项目**：插件位于 `.opencode/plugins/tts-announce/`，OpenCode 自动加载，默认即可用。

**全局**（欲用于诸项目）：在 `~/.config/opencode/opencode.json` 加入：

```jsonc
{
  "plugins": [
    {
      "package": "C:/gh/faster-qwen3-tts/.opencode/plugins/tts-announce",
      "options": {
        "baseUrl": "http://127.0.0.1:8000",
        "voice": "alloy",
        "phrases": { "idle": "任务完成", "error": "出错了", "permission": "需要授权" }
      }
    }
  ]
}
```

**可配置项**（`options`，皆可选）：

- `baseUrl` — 声源地址，默认 `http://127.0.0.1:8000`
- `model` — 请求体之 model，默认 `tts-1`
- `voice` — 服务器所配之声，默认 `alloy`
- `phrases` — 覆写套语 `{ idle, error, permission }`

## 行为

- 语音队列串行，先后有序，不相互叠。
- 请求超时 120 秒；TTS 或播放失败皆默然。
- 播放：Windows 用 PowerShell `SoundPlayer`，macOS 用 `afplay`，Linux 依次试 `paplay`、`aplay`。

## 测试与自检

```bash
cd .opencode/plugins/tts-announce
bun install
bun test          # 单元测试
bun run selfcheck.ts   # 端到端：先启动 start_tts_server.bat，再跑此脚本，应闻其声
```
