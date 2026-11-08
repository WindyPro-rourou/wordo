# 移动端构建说明（Android / iPadOS）

WORDO 前端是**原生 HTML/CSS/JS、无框架**，`apps/desktop/src` 即全部界面；移动端与桌面端**共用同一套前端与同一份 JSON 契约**，差别只在壳的构建目标（Tauri 2 的 Android / iOS 目标）。这与公理 **A1 节点对等**一致：形态只决定怎么用，不决定功能。

> **诚实声明**：本目录当前是构建说明，**尚未在本机实机构建/联调**。移动端 UI 已用 Chromium 无头在 360×740 等手机视口验证布局与交互（见 `tools/preview/`），但真实 Tauri 移动运行时的行为需按下列步骤在真机/模拟器上验证。

## 前置环境
- **Android**：Android SDK（platform-tools / build-tools / platform）、NDK、**JDK 17**；`adb` 可用。
- **iOS/iPadOS**：macOS + **Xcode** + CocoaPods；Apple 开发者签名（真机）。
- **Rust**：稳定版工具链 + 对应目标
  - Android：`rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android i686-linux-android`
  - iOS：`rustup target add aarch64-apple-ios aarch64-apple-ios-sim`
- **Tauri CLI**：`npm i -D @tauri-apps/cli`（在 `apps/desktop` 下）。

## Android（从桌面壳初始化移动端工程）
```powershell
cd apps/desktop
npm install
npx tauri android init        # 生成 src-tauri/gen/android
npx tauri android dev         # 连真机/模拟器调试
npx tauri android build       # 产物：APK/AAB
```
注意：
- `tauri.conf.json` 的 `identifier` 已在桌面配置（`app.wordo.desktop`），移动端沿用或另设（Android 包名需全局唯一）。
- 移动端后台限制（Android 15+ 前台服务 24h 内合计约 6h）：同步发生在「打开 App 时」，不做常驻后台同步。
- 安全区：前端已用 `env(safe-area-inset-*)` + `100dvh` 处理刘海/Home 条。

## iPadOS / iOS
```bash
cd apps/desktop
npx tauri ios init            # 生成 src-tauri/gen/apple（需在 macOS 上）
npx tauri ios dev             # 模拟器/真机
npx tauri ios build
```
注意：iOS 只能在 macOS 上构建；`BGProcessingTask` 约 60s，同步同样以「打开 App 时」为准。

## 与同步的关系
移动端也是**完整节点**：数据同样落在账号域目录（各节点只追加自己的 `ledger/<node>.jsonl`），多设备通过同步盘合并。见 [../../docs/同步指南.md](../../docs/同步指南.md)。

## 验证边界（本仓库已做 / 未做）
- ✅ 前端布局与交互：6 视口（含 360×740、844×390）× 页签，无头 Chromium 巡检 `issues=[]`。
- ✅ 软键盘避让、学科胶囊、对话抽屉等移动端专项。
- ❌ 真实 Tauri Android/iOS 运行时、真机触控与系统返回手势：**未在本机验证**，需按上面步骤实测。
