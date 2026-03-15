# 更新日志

## 2025-03-15 (续2) - 隧道管理优化

### 新增功能

#### 13. 隧道"随节点启动"配置
- 数据库 `tunnels` 表新增 `auto_start` 字段（默认 1）
- 隧道编辑弹窗新增"随节点启动"开关
- 隧道创建向导新增"随节点启动"开关
- 节点自动启动时，只启动 `enabled=1 AND auto_start=1` 的隧道
- 手动启动节点时，仍使用所有 `enabled=1` 的隧道

### 移除功能

#### 14. 移除隧道列表复选框和批量操作
- 移除隧道列表中的复选框
- 移除批量启用/停用/删除功能
- 移除"全选本组"按钮
- 简化界面，提升操作效率

### 数据库变更

```sql
-- 新增字段
ALTER TABLE tunnels ADD COLUMN auto_start INTEGER DEFAULT 1;
```

## 2025-03-15 (续) - 流量统计按节点隔离

### 新增功能

#### 12. 流量统计按节点筛选
- `monitorStore` 改用 `Map<nodeId, TrafficPoint[]>` 按节点隔离流量数据
- `TrafficChart` 组件新增 `nodeId` prop，支持筛选特定节点或查看全部
- 新增 `getAggregatedTraffic()` 方法聚合所有节点数据
- 新增 `getRecentTraffic(nodeId, minutes)` 方法获取单节点数据
- Monitor 页面节点卡片新增「全部节点」选项
- 流量图表标题显示当前筛选的节点名称
- 清空日志时同时清空该节点的流量数据

## 2025-03-15 - 多节点支持与自动启动

### 新增功能

#### 1. 多节点独立 frpc 进程管理
- 每个节点可独立启动 frpc 进程，互不干扰
- 每个节点使用独立的配置文件 (`frpc_node_{id}.toml`)
- 支持多节点同时运行

#### 2. 节点自动启动
- 新增 `auto_start` 字段，记录节点是否在应用启动时自动启动
- 节点表单中新增自动启动开关
- 应用启动时自动启动标记为自动启动的节点
- 支持系统托盘图标显示所有运行节点状态

### 功能重构

#### 3. frpc 控制逻辑迁移
- frpc 启动/停止/状态查询从 `tunnel handlers` 迁移到 `node handlers`
- 新增 `node:list-auto-start` 接口用于查询自动启动节点
- 新增 `frpc:status-all` 接口用于获取所有节点状态

#### 4. 日志按节点隔离
- 日志存储结构改为按节点 ID 隔离
- 日志面板新增节点筛选器，可查看单个节点或全部节点的日志
- 导出日志时自动包含节点名称

#### 5. 状态管理重构
- `frpcStatus` 从 `tunnel store` 迁移到 `node store`
- 新增 `node store` 方法：
  - `startFrpc(nodeId)` - 启动指定节点
  - `stopFrpc(nodeId)` - 停止指定节点
  - `fetchFrpcStatus(nodeId)` - 获取单节点状态
  - `fetchAllFrpcStatus()` - 获取所有节点状态
  - `updateFrpcStatus(nodeId, status)` - 更新节点状态

### UI 改进

#### 6. 节点卡片 (NodeCard)
- 新增运行状态指示器
- 新增启动/停止按钮
- 新增运行状态栏（显示 PID、启动时间）
- 新增自动启动开关
- 显示启用隧道数量

#### 7. 侧边栏指示器
- 显示运行中的节点数量而非单一状态

#### 8. 仪表盘 (Dashboard)
- 新增「运行中的节点」快速列表
- 显示节点名称、地址、隧道数
- 隧道列表显示所属节点名称
- 节点列表显示运行状态

#### 9. 监控页面 (Monitor)
- 改为显示运行节点卡片网格
- 每个卡片显示节点名称、PID、运行时长、隧道数
- 点击卡片可查看对应节点日志

#### 10. 隧道页面 (Tunnel)
- 移除 frpc 启动/停止控制（已移至节点卡片）
- 新增隧道所属节点名称显示
- 导出时使用当前筛选的节点

#### 11. 系统托盘
- 显示所有运行节点列表
- 显示运行节点数量
- **可直接启动/停止节点**（无需打开主窗口）
- 启动/停止操作后显示系统通知
- 退出时自动停止所有 frpc 进程

### 数据库变更

```sql
-- 新增字段
ALTER TABLE nodes ADD COLUMN auto_start INTEGER DEFAULT 0;
```

### API 变更

| 接口 | 方法 | 说明 |
|------|------|------|
| `node:list-auto-start` | GET | 获取自动启动节点列表 |
| `frpc:start` | POST | 参数新增 nodeId（必需） |
| `frpc:stop` | POST | 参数新增 nodeId（必需） |
| `frpc:status` | GET | 参数新增 nodeId（必需） |
| `frpc:status-all` | GET | 获取所有节点状态 |

### 事件变更

| 事件 | 负载 |
|------|------|
| `frpc:log` | `{ nodeId, type, line, timestamp }` |
| `frpc:status` | `{ nodeId, status }` |
