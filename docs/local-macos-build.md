# 本机 macOS SDK 验证

2026-11-17 在仅安装 Command Line Tools 的本机环境中，macOS 27.2 SDK 的 SwiftUI `@State` 需要 `SwiftUIMacros.StateMacro`，但该工具链未包含对应宏插件。Rust 的 `build.rs` 调用 Swift 编译原生菜单，因此整个 `cargo check` 会在进入应用 Rust 检查前失败。

这个错误与 Apple Developer ID 签名或公证无关。不能把它作为 GitHub CI 前端检查失败的解释，也不能通过关闭检查来掩盖。

本机已有 macOS 26.5 SDK，隔离选择该 SDK 后，原生菜单和完整 Rust 检查均已通过：

```bash
node scripts/check-rust-macos-sdk.cjs /Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk
```

此脚本只为当前检查命令建立临时 `xcrun` 包装，结束后清理，不改变 `xcode-select`、系统 SDK 链接、全局环境或正常 CI 配置。没有对应 SDK 的设备应使用已安装的兼容完整工具链，不应填写不存在的路径。

PR #3 最初的 CI 失败是另一独立问题：新增界面漏加两个翻译键，违反 `scripts/check_locales.cjs`。18 份语言文件已补齐，翻译检查和前端构建在本地通过，并推送到远端重跑。
