# 凭据同步服务部署记录

当前个人自用服务的客户端 HTTPS 入口为 `https://100.100.1.1:18444`，后端诊断地址为 Tailscale 地址 `100.100.1.1:18443`，容器名为 `cockpit-credential-sync-personal`，数据目录为服务器上的 `~/services/cockpit-credential-sync-server/data`。该端口独立于服务器已有的 8080、8089 和其他服务。

健康检查：

```bash
curl --fail --cacert docs/credential-sync/server-ca.pem https://100.100.1.1:18444/health
```

正常返回协议版本和状态，不返回 Token、设备密钥或管理员密钥。

管理员密钥只保存在服务器的受限 `.env` 文件中；不写入 Git，也不放入客户端配置。客户端只使用设备密钥签名请求。服务器当前以 Docker 非 root 用户运行，容器设置了 `no-new-privileges` 和 `cap-drop ALL`。

已完成验证：

- Rust 服务单元和协议测试通过。
- 新数据库启动和 HTTP 健康检查通过。
- 签名请求、nonce 防重放、撤销设备、备份版本冲突、密文篡改拒绝通过。
- 服务端和客户端加密测试覆盖 AES-GCM、HKDF、Ed25519、X25519 密钥封装、稳定账号标识和密钥轮换。

尚未完成：

- 尚未让 Cockpit Tools 客户端接入该地址。
- 尚未进行真实 OAuth 凭据上传或恢复。
- 已配置绑定 Tailscale 地址的 HTTPS 自用证书，证书公钥位于 `docs/credential-sync/server-ca.pem`；客户端需要显式信任这份证书，不能关闭 TLS 校验。公网发布和正式域名证书不在本次部署范围。
- 管理员密钥轮换、数据库备份恢复和设备配对的真实多设备验收仍需完成。
