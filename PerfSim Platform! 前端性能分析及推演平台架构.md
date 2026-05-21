# 1. 产品愿景与核心理念 (Vision & Core Concepts)

## 1.1 产品定义：推演驱动的性能工程平台

**PerfSim Platform** 是一款**推演驱动 (Simulation-Driven)** 的前端性能工程平台，旨在将性能优化从传统的“事后监控”前置为“开发期验证”。

平台不仅仅是一个调试工具，更是开发者&#x7684;**“性能风洞实验室”**。它深度整合了**智能分析引擎**与**真实环境推演内核**，为开发者提供了一套从**自动诊断**、**智能建议**、**模拟推演**到**收益验证**的完整闭环工具链。

## 1.2 核心价值主张

1. **拒绝估算，真实推演 (Simulation-Driven)**：利用内置的 Playwright 执行引擎和环境模拟器（弱网、CPU 节流），在代码提交前精准预测 LCP、INP 等关键指标的变化，量化优化的 ROI。

2. **本地优先，数据安全 (Local-First)**：核心能力运行在本地环境，确保数据隐私、离线可用性和即时反馈，同时通过远端层提供协作扩展。

3) **智能协作，资产沉淀 (MCP-Enabled)**：通过 **MCP (Model Context Protocol)** 无缝接入 AI 能力与云端协作服务，将离散的性能调试转化为结构化的团队资产，辅助建立可持续的性能规范。

## 1.3 双核驱动闭环

平台采用"双核驱动"架构，打通性能优化的全链路：

```mermaid
flowchart LR
    A[Audit<br/>审计诊断] -->|发现瓶颈| B[Suggest<br/>智能建议]
    B -->|生成方案| C[Simulate<br/>模拟推演]
    C -->|量化预测| D[Verify<br/>收益验证]
    D -->|闭环迭代| A
    
    style A fill:#e1f5fe,stroke:#01579b
    style B fill:#fff3e0,stroke:#e65100
    style C fill:#f3e5f5,stroke:#4a148c
    style D fill:#e8f5e9,stroke:#1b5e20

```

# 2. 系统架构设计 (System Architecture)

## 2.1 架构设计原则

* **本地优先 (Local-First)**: 核心交互与推演在本地完成，数据优先存储于客户端 IndexedDB。

* **关注点分离 (SoC)**: 交互层专注可视化，执行层专注模拟，协作层专注信息共享。

* **双通道通信 (Dual Channels)**: Chrome Extension 与 PerfSim Server 通信进行本地执行，直接与 Task Service 通信进行任务同步。

* **协议解耦**: 通过 MCP (Model Context Protocol) 实现远端 AI 能力的标准化接入。

## 2.2 架构分层全景图

平台架构分为两个核心平面：**本地核心平面**（隐私与速度）与**远端协作平面**（共享与智能）。

```mermaid
graph TD
    User([开发者/QA]) -->|交互控制| Extension
    AI([AI Agent]) -.-|MCP协议| Bridge
    
    subgraph LocalCore [本地核心平面 Local Core Plane]
        subgraph ExtensionLayer [Chrome Extension 本地]
            Extension[Chrome Extension]
        Analyzer[智能分析引擎]
        Dashboard[可视化仪表盘]
        LocalDB[(IndexedDB)]
        end
    
        subgraph ServerLayer [PerfSim Server 本地]
            Server[PerfSim Server]
        Orchestrator[任务编排器]
        TempStorage[临时数据存储]
        
            subgraph ExecutionEngine [执行引擎]
            Network[网络拦截器]
            Audit[Lighthouse Runner]
            end
        end
        
        subgraph SimulatorLayer [Local Simulator 本地]
            Simulator[Local Simulator]
        end
    end
    
    subgraph RemoteExtension [远端协作平面 Remote Collaboration Plane]
        subgraph TaskServiceLayer [Task Service 远端]
            TaskMgr[Task Manager]
            TaskDB[(Task DB)]
            
            subgraph BridgeLayer [MCP Adapter]
                Bridge[MCP Bridge]
            end
        end
    end

    %% 核心通信路径
    Extension <-->|HTTP/WebSocket<br/>本地控制| Server
    Extension <-->|HTTPS<br/>任务同步| TaskMgr
    Extension <-->|Read/Write| LocalDB
    Extension -.-|使用| Analyzer
    
    %% Server 内部协调
    Server --> Orchestrator
    Orchestrator --> ExecutionEngine
    Server <-->|协调调用| Simulator
    Server <-->|同步| TempStorage
    
    %% 远端协作
    TaskMgr --> TaskDB
    Bridge <-->|内部调用| TaskMgr

    classDef local fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef remote fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    class ExtensionLayer,ServerLayer,SimulatorLayer local
    class TaskServiceLayer,BridgeLayer remote

```

## 2.3 模块职责定义

<table><colgroup><col width="80"><col width="158"><col width="395"><col width="189"></colgroup>
<thead>
<tr>
<th>所属平面</th>
<th>模块 (Module)</th>
<th>核心职责 (Core Responsibilities)</th>
<th>交互与备注</th>
</tr>
</thead>
<tbody>
<tr>
<td rowspan="3">本地核心</td>
<td>Chrome Extension<br />(交互分析)</td>
<td><ol>
<li>Data Visualization: 渲染性能图表</li>
<li>Report Analysis: 解析报告，生成诊断</li>
</ol><ol start="3">
<li>Generate Suggestions: 规则引擎生成建议</li>
</ol></td>
<td>用户交互主入口<br />对接 Server (本地) 与 Task Service (远端)</td>
</tr>
<tr>
<td>PerfSim Server<br />(执行协调)</td>
<td><ol>
<li>Task Orchestration: 管理任务队列</li>
<li>Browser Mgmt: 管理 Chrome 实例生命周期</li>
</ol><ol start="3">
<li>Coord Simulator: 调度底层推演引擎</li>
</ol></td>
<td>本地单实例服务<br />Extension 与推演引擎的中间层</td>
</tr>
<tr>
<td>Local Simulator<br />(底层推演)</td>
<td><ol>
<li>Env Simulation: 模拟弱网、CPU 降频</li>
<li>Execute PW: 执行 Playwright 真实渲染</li>
</ol></td>
<td>专注底层执行<br />无外部依赖，确保可复现</td>
</tr>
<tr>
<td rowspan="2">远端协作</td>
<td>Task Service<br />(任务协作)</td>
<td><ol>
<li>Task Management: 管理优化任务</li>
<li>Context Storage: 存储 DOM 快照、指标</li>
</ol><ol start="3">
<li>State Transition: 任务生命周期管理</li>
</ol></td>
<td>远端信息中枢<br />包含 MCP Bridge</td>
</tr>
<tr>
<td>MCP Bridge<br />(AI 接入)</td>
<td><ol>
<li>Expose Resources: 暴露任务为 perf://tasks/...</li>
<li>Protocol Translation: MCP 转内部调用</li>
</ol></td>
<td>Task Service 内部组件<br />AI Agent 通过标准协议接入</td>
</tr>
</tbody>
</table>

# 3. 核心子系统深度解析 (Core Subsystems)

## 3.1 交互分析平面：智能建议引擎

**Chrome Extension** 是平台的"驾驶舱"。其核心组件 **Analyzer** 不仅负责渲染报告，更是**生产建议**的工厂，将枯燥的数据转化为可行动的洞察。

```mermaid
graph TB
    subgraph ExtensionLocal [Chrome Extension 本地]
        direction TB
        UI[UI Panel]
        
        subgraph LogicLayer [核心逻辑层]
            direction LR
            Analyzer[智能分析引擎]
            Config[配置管理器]
        end
        
        subgraph DataLayer [数据与通信层]
            direction LR
            Storage[存储适配器]
            Client[通信客户端]
        end

        IDB[(IndexedDB)]
    end
    
    subgraph External [外部服务平面]
        direction LR
        Server[PerfSim Server 本地]
        TaskSvc[Task Service 远端]
    end

    %% UI 交互入口
    UI -->|请求分析| Analyzer
    UI -->|触发推演| Config
    
    %% 内部逻辑流
    Analyzer -->|展示建议| UI
    Analyzer -->|保存| Storage
    Storage -->|持久化| IDB
    
    Config -->|生成参数| Client
    Client -->|展示结果| UI

    %% 外部通信流
    Client <-->|HTTP/WS| Server
    Client -->|HTTPS| TaskSvc

```

## 3.2 执行与编排引擎：本地闭环

**PerfSim Server** 采用**串行单实例**模型，作为本地协调中心，确保性能测试环境的纯净与稳定。

```mermaid
stateDiagram-v2
    [*] --> Pending: Extension 请求入队
    Pending --> Initializing: Server 调度器提取
    Initializing --> Decision: 选择执行方式
    Decision --> InternalExec: 内部执行
    Decision --> CoordSim: 协调 Simulator
    
    state InternalExec {
        BrowserInit: 启动浏览器/注入环境
        NetworkSetup: 网络环境配置
        LatencyInject: 延迟规则注入
        Navigation: 页面导航
        Auditing: Lighthouse 审计
    }
    
    state CoordSim {
        SimCall: 调用 Local Simulator
        SimExec: Simulator 执行推演
    }
    
    InternalExec --> Reporting: 生成 JSON 报告
    CoordSim --> Reporting: 接收 Simulator 结果
    Reporting --> Finished: 清理上下文
    Finished --> [*]: 返回 Extension

```

## 3.3 本地通信与数据流

Chrome Extension 仅与 PerfSim Server 通信，所有底层数据交互均通过 Server 统一协调，确保逻辑统一。

```mermaid
sequenceDiagram
    participant Ext as Chrome Extension
    participant Server as PerfSim Server
    participant Sim as Local Simulator

    loop 健康检查 (Health Check)
        Ext->>Server: GET /health
        Server-->>Ext: 200 OK
    end

    rect rgb(230, 240, 255)
        Note right of Ext: 本地分析阶段
        Ext->>Ext: 1. 从 IndexedDB 加载/生成原始报告
        Ext->>Ext: 2. 运行分析引擎 (生成建议 + 关键指标)
        Ext->>Ext: 3. 保存分析结果到 IndexedDB
    end

    rect rgb(255, 240, 230)
        Note over Ext,Server: 推演请求阶段
        Ext->>Server: POST /api/simulate
        Note right of Ext: 负载: { url, config, suggestions }
        
        alt Server 内部执行
            Server->>Server: 启动浏览器/注入环境
            Server->>Server: 执行 Lighthouse 审计
        else Server 协调 Simulator
            Server->>Sim: 调用本地推演
            Sim->>Sim: Playwright 执行
            Sim-->>Server: 返回推演结果
        end
        
        Server-->>Ext: 返回推演报告
    end

```

## 3.4 协作与 AI 平面：MCP 赋能

**Task Service** 引入了 **MCP Bridge**，将优化任务转化为 AI 可读写的标准资源。AI 不再是外部的旁观者，而是通过 MCP 协议直接参与到任务的分析与解决中。

```mermaid
graph TD
    subgraph LocalCore [本地核心平面]
        Ext[Chrome Extension]
    end

    subgraph RemoteExtension [远端协作平面]
        subgraph TaskService [任务服务]
            TM[任务管理器]
            TaskDB[(任务数据库)]
            Analysis[分析引擎]
            
            subgraph BridgeLayer [MCP 适配层]
                Bridge[MCP 桥接器]
            end
        end
    end

    subgraph DevEnv [研发环境]
        Dev[开发者]
        Agent[AI 助手 IDE]
    end

    %% 交互
    Ext -->|直接任务同步| TM
    TM --> TaskDB
    
    %% 分析与规范
    TaskDB --> Analysis
    Analysis -->|项目洞察| Bridge
    
    %% AI 辅助
    Agent <-->|MCP 协议| Bridge
    Bridge <-->|内部调用| TM
    Bridge -.-|输出| Standards[性能规范 / 预算]

```

# 4. 关键业务流程 (Key Workflows)

## 4.1 本地开发闭环 (Local Core Loop)

无需网络依赖，单兵作战时的性能调试流：

1. **性能审计与分析**: 触发审计 -> 智能分析 -> 生成建议 -> 本地存储。

2. **推演请求**: 选择建议 -> 配置推演参数 -> 发送至 Server。

3) **结果展示**: 接收推演报告 -> 生成 Diff 视图 -> 验证收益。

## 4.2 团队协作与 AI 工作流 (Team & AI Collaboration)

基于 MCP 实现“人-AI”深度协作：

```mermaid
sequenceDiagram
    actor Dev as 开发者
    participant Ext as Chrome Extension
    participant TaskSvc as 任务服务
    participant Agent as AI 助手 IDE
    participant Server as PerfSim Server
    participant Sim as Local Simulator

    Note over Ext,TaskSvc: 1. 任务协同（本地 → 远端）
    Ext->>TaskSvc: POST /api/tasks (创建任务)
    Note right of Ext: 负载: { context, suggestions, metrics }
    TaskSvc-->>Ext: 任务创建成功 (ID: 101)

    Note over Dev,Agent: 2. AI 辅助优化
    Dev->>Agent: "帮我处理 Task-101"
    Agent->>TaskSvc: MCP 读取: perf://tasks/101/context
    TaskSvc-->>Agent: 返回指标快照、DOM信息、优化建议
    
    Note over Dev,Sim: 3. 编码与验证
    Agent->>Dev: 生成代码修改建议
    Dev->>Dev: 应用代码修改
    Dev->>Server: 触发本地推演验证
    Server->>Sim: 协调调用本地推演
    Sim-->>Server: 返回推演结果
    Server-->>Ext: 反馈推演结果
    
    Note over Dev,TaskSvc: 4. 闭环归档
    Dev->>TaskSvc: 更新任务状态为 Resolved

```

## 4.3 生态演进：从个案到规范

Task Service 聚合历史数据，AI 充当“性能架构师”：

1. **聚合分析**: 识别高频问题（如“图片未优化”、“主线程阻塞”）。

2. **生成报告**: AI 生成“项目健康度报告”。

3) **提议规范**: AI 建议更新 `performance-budget.json` 或工程指南。

4) **团队共识**: 审查通过后，将规范合入代码仓库，形成新的基线。

# 5. 演进路线图 (Roadmap)

```mermaid
%%{init: {'gantt': {'leftPadding': 200}}}%%
gantt
    dateFormat  YYYY-MM-DD
    axisFormat  %Y-%m
    excludes weekends

    section 阶段一：本地核心建设(1月-2月)
    Extension基础UI与存储      :active,  p1_1, 2026-01-01, 2026-02-28
    Server基础与任务编排       :active,  p1_2, 2026-01-01, 2026-02-28
    Local Simulator集成       :active,  p1_3, 2026-01-01, 2026-02-28

    section 阶段二：本地能力增强(3月)
    智能分析与建议生成         :         p2_1, 2026-03-01, 2026-03-31
    推演性能优化              :         p2_2, 2026-03-01, 2026-03-31

    section 阶段三：远端协作扩展(Q2)
    Task Service服务部署      :         p3_1, 2026-04-01, 2026-05-15
    MCP Bridge与AI接入       :         p3_2, 2026-05-15, 2026-06-30

    section 阶段四：生态集成(下半年)
    CI/CD流水线集成           :         p4_1, 2026-07-01, 45d
    高级趋势分析              :         p4_2, after p4_1, 45d

```



