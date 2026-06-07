# Handoff 文件夹传输

> 创建：2026-06-07 | 状态：待实现

## 目标

iOS 选择整个文件夹 → 自动压缩为 .zip → 上传到 Windows → 自动解压到同名文件夹。

## 流程

```
iOS 选择文件夹 → FolderZipper 递归打包 .zip → 存临时目录
→ uploadFile(tempZipURL) 上传
→ 成功后删除临时 zip
→ Windows 收到 .zip → 自动解压到 downloadDir/<文件夹名>/
```

## 改动清单

### 新建
| 文件 | 说明 |
|------|------|
| `ios/.../Services/FolderZipper.swift` | 递归遍历文件夹 + 创建 .zip |

### 修改
| 文件 | 改动 |
|------|------|
| `ios/.../Views/FilePickerView.swift` | 新增文件夹选择模式 |
| `ios/.../Views/ContentView.swift` | 新增"发送文件夹"按钮 |
| `ios/.../Services/ConnectionManager.swift` | 上传成功后删除临时 zip |
| `src/handoff-service/http-server.ts` | 收到 .zip 自动解压 |

## 错误处理

| 阶段 | 处理 |
|------|------|
| 打包失败 | 提示用户，返回 |
| 上传中断 | error 回调删除临时 zip |
| 服务端半截数据 | req.on('end') 才写文件，中断不产生残留 |
| 解压失败 | 保留 .zip，不删除 |
