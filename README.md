# OPC-UA 工业节点浏览与数据采集系统

基于 OPC-UA 协议的工业数据监控平台，支持节点树浏览、实时数据采集、趋势图表展示和报警管理。

## 功能特性

- **OPC-UA 节点树浏览** - 层级化展示 OPC-UA 服务器节点结构，支持节点详情查看
- **实时数据仪表盘** - 温度、压力、流量、阀门开度、电机转速、泵状态等工业参数实时展示
- **数据趋势图表** - 基于 ECharts 的实时趋势曲线，支持历史数据回溯
- **报警事件管理** - 自动检测超限报警，支持严重程度分级（严重/高/中/低/信息），报警确认与清除
- **节点采集方案** - 为多个节点分别设定采样周期、发布周期与队列上限，保存为可复用方案；统一取值范围校验（采样周期 50~60000ms、发布周期 100~300000ms、队列上限 1~100 条），任一项越界整份配置拒绝保存并定位到具体节点与参数；启用时按节点逐条反馈，连接异常节点单独列为待生效；方案与订阅共用同一份参数，单点订阅入口保持不变
- **数据质量指示** - Good / Bad / Uncertain 三级质量码标识

## 技术栈

### 前端
- **Vue 3** + TypeScript + Vite
- **Element Plus** - UI 组件库
- **ECharts** + vue-echarts - 数据可视化
- **Pinia** - 状态管理
- **TailwindCSS** - 样式框架

### 后端
- **Java 17** + Spring Boot 3.2.0
- **Eclipse Milo** - OPC-UA SDK 客户端
- **Spring WebSocket** - 实时通信
- **Maven** - 项目构建

## 项目结构

```
solo-6600024/
├── frontend/               # Vue 3 前端
│   ├── src/
│   │   ├── components/
│   │   │   ├── NodeTree.vue        # OPC-UA 节点树组件
│   │   │   └── DataDashboard.vue   # 数据仪表盘组件
│   │   ├── store/
│   │   │   └── opcua.ts            # Pinia 状态管理
│   │   ├── types/
│   │   │   └── index.ts            # TypeScript 类型定义
│   │   └── App.vue                 # 主布局
│   ├── package.json
│   └── vite.config.ts
├── backend/                # Spring Boot 后端
│   ├── src/main/java/com/opcua/
│   │   ├── OpcuaApplication.java
│   │   ├── controller/
│   │   │   └── NodeController.java
│   │   ├── service/
│   │   │   └── OpcuaClientService.java
│   │   └── model/
│   │       ├── NodeModel.java
│   │       └── DataValueModel.java
│   └── pom.xml
└── README.md
```

## 工业节点结构

```
Server
└── Objects
    ├── PLC_Area1 (1号生产区域)
    │   ├── Temperature_Sensor    (Double, 25.6°C)
    │   ├── Pressure_Transmitter  (Double, 3.45 MPa)
    │   └── Pump_Status           (Boolean, true)
    └── PLC_Area2 (2号生产区域)
        ├── Flow_Meter            (Double, 156.7 L/min)
        ├── Valve_Position        (Double, 75%)
        └── Motor_Speed           (Int32, 1480 RPM)
```

## 快速启动

### 前端
```bash
cd frontend
npm install
npm run dev
```

### 后端
```bash
cd backend
mvn spring-boot:run
```

## API 接口

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/nodes` | 获取所有 OPC-UA 节点 |
| GET | `/api/nodes/{id}/value` | 获取指定节点当前值 |
| GET | `/api/nodes/{id}/subscription` | 查询节点当前生效采集参数（含来源 manual/plan） |
| POST | `/api/nodes/{id}/connectivity` | 设置节点连接状态（模拟连接异常/恢复） |
| POST | `/api/subscribe` | 单点订阅节点数据变更（入口保持原样） |
| DELETE | `/api/subscribe/{nodeId}` | 取消订阅 |
| GET | `/api/collection/limits` | 获取采样周期/发布周期/队列上限统一取值范围 |
| GET | `/api/collection/plans` | 采集方案列表（含覆盖节点与启用状态） |
| POST | `/api/collection/plans` | 保存（新增/更新）采集方案；校验失败返回 400 及节点级错误 |
| DELETE | `/api/collection/plans/{id}` | 删除方案 |
| POST | `/api/collection/plans/{id}/enable` | 启用方案，返回逐节点反馈与待生效节点列表 |
| POST | `/api/collection/plans/{id}/disable` | 停用方案 |
| POST | `/api/collection/pending/retry` | 重试待生效节点（可按方案过滤） |
