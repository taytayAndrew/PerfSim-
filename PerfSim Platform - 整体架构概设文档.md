# **&#x20;1. 文档说明**



## **1.1 文档目的**



本文档旨在阐述 PerfSim Platform 的整体技术架构设计,主要包括:



* 系统整体架构和分层设计

* Chrome Extension 与 Node.js Server 的分离式架构理念

* Extension ↔ Server 通信协议详细设计

* Monorepo 代码仓库组织结构

* 开发环境搭建与联调指南

本文档为开发团队提供实施指导,为技术评审团队提供架构合理性论证。



## **1.2 适用范围**



* **项目阶段**: 从零开始的全新项目,一次性完整实施

* **技术范围**: 覆盖 Chrome Extension 和 Node.js Server 两个子系统

* **功能范围**: 基于 Lighthouse 性能数据的规则分析、理论推演、真实验证

## **1.3 阅读对象**



**A类受众 - 开发团队(实施者)**:

* 前端工程师(Extension 开发)

* 后端工程师(Server 开发)

* 测试工程师

需要关注: API设计、数据模型、通信协议、错误处理机制



**B类受众 - 技术评审团队(决策者)**:

* 技术架构师

* 技术经理

* 产品经理

需要关注: 架构合理性、技术风险、扩展性设计



## **1.4 相关文档**



| 文档名称                | 路径                                                                                                                                | 说明             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 产品需求文档(PRD)         | [ PerfSim Platform 优化建议&本地推演需求文档](https://xiaopeng.feishu.cn/wiki/AV3Aw772qihsbrkxiKtcEIB6ndh?fromScene=spaceOverview)            | 业务需求和功能定义      |
| Chrome Extension 概设 | [` Design Document - Chrome Extension 规则引擎`](https://xiaopeng.feishu.cn/wiki/XrcQwPSVDiYns1koHBAcn9KYnnb?fromScene=spaceOverview) | Extension 详细设计 |
| Node.js Server 概设   | [` Design Document - Node.js Server`](https://xiaopeng.feishu.cn/wiki/AKezw7Nr4iJIsTkthZfc5RxunUf?fromScene=spaceOverview)        | Server 详细设计    |



# **2. 项目概述**



## **2.1 项目背景**



现有 Lighthouse 性能分析工具仅提供通用的性能优化建议,存在以下局限性:



* **缺乏专家经验**: 未能覆盖前端专家日常关注的实际性能瓶颈

* **建议泛化**: 缺少针对性的优化策略和理论依据

* **验证困难**: 无法直接验证优化建议的实际效果

PerfSim Platform 旨在将前端专家经验固化为可执行规则,通过理论推演和真实验证帮助开发者精准定位性能问题并评估优化效果。



## **2.2 业务目标**



**核心目标**:

* 用前端专家经验替换 Lighthouse 的通用性能优化建议

* 提供"理论推演"和"真实验证"双模式分析能力

* 支持一键推演,自动生成优化前后对比报告

**MVP阶段目标**:

* 落地"接口耗时"类瓶颈分析规则

* 实现串行请求链深度检测(深度 > 3 即视为阻塞)

* 完成理论推演与真实推演的闭环验证

## **2.3 系统定位**



PerfSim Platform 是一个 **Chrome Extension + 本地 Node.js Server** 的前端性能优化辅助工具:



| 特性       | 说明                                   |
| -------- | ------------------------------------ |
| **部署形式** | Chrome Extension + 本地 Server 双进程     |
| **工作模式** | 理论推演(Extension 本地) + 真实推演(Server 执行) |
| **数据来源** | Lighthouse JSON 报告                   |
| **输出结果** | 性能问题分析 + 理论收益预测 + 实际效果对比             |
| **扩展性**  | 可插拔规则引擎,支持自定义规则                      |



## **2.4 核心功能**



### **2.4.1 规则驱动分析**



* 基于可配置规则引擎分析 Lighthouse 性能数据

* 首期内置"串行请求链深度检测"规则

* 支持规则插拔,后续可扩展更多专家规则

### **2.4.2 双模式推演**



**理论推演模式**:

* Extension 本地即时计算

* 基于规则算法预测优化收益

* 无需启动 Server,用户可快速查看

**真实推演模式**:

* 用户主动触发(点击"推演"按钮)

* Server 注入优化脚本并运行 Lighthouse

* 返回实际优化后的性能数据

### **2.4.3 效果对比验证**



* 对比理论预测 vs 实际效果

* 展示理论准确度(如 95.8%)

* 生成可视化对比报告

## **2.5 用户操作流程**



**流程说明**:



1. **基线数据获取**: 用户手动运行 Lighthouse,导出 JSON 报告并上传到 Extension

2. **规则分析**: Extension 本地分析 JSON,识别性能问题

3) **理论推演**: Extension 即时计算优化收益,无需 Server

4) **真实推演**(可选):

   * 用户点击"推演"按钮

   * Extension 检测本地 Server 是否启动

   * Server 注入优化脚本,运行 Lighthouse

   * 返回优化后的实际性能数据

5. **效果对比**: Extension 对比理论 vs 实际,展示准确度

# **3. 整体技术架构**



## **3.1 系统架构设计**



### **3.1.1 架构理念**



PerfSim Platform 采用 **分离式架构**,将系统职责清晰划分为两个独立进程:



* **Chrome Extension (规则引擎)**: 负责数据分析、理论推演、脚本生成、UI展示

* **Node.js Server (执行引擎)**: 负责脚本注入、浏览器控制、Lighthouse 执行

**核心设计原则**:

1. **职责分离**: Extension 处理逻辑,Server 处理执行,避免职责混淆

2. **按需连接**: 理论推演无需 Server,真实推演才建立连接,降低依赖

3) **本地优先**: 所有数据在本地处理,不涉及远程服务器,保证安全性

4) **可扩展性**: 规则引擎可插拔,支持后续添加更多性能优化规则

### **3.1.2 整体架构图**



## **3.2 技术选型说明**



### **3.2.1 技术栈总览**



| 技术领域            | 选择                           | 版本  | 理由                             |
| --------------- | ---------------------------- | --- | ------------------------------ |
| **包管理**         | Yarn Workspaces              | -   | Monorepo 支持,依赖共享,统一版本管理        |
| **构建工具**        | Vite<br />                   | 5+  | 快速 HMR,现代化构建,开发体验优秀            |
| **Extension框架** | @crxjs/vite-plugin           | -   | Manifest V3 原生支持,与 Vite 无缝集成   |
| **UI框架**        | React                        | 18  | 组件化,生态成熟,团队熟悉                  |
| **样式方案**        | TailwindCSS                  | 3+  | 快速开发,可定制,无需写 CSS               |
| **状态管理**        | Zustand                      | 4.x | 轻量级(\~1KB),TypeScript 友好,学习成本低 |
| **规则引擎**        | json-rules-engine<br />      | -   | JSON 配置化,易扩展,支持复杂规则            |
| **性能测试**        | Puppeteer + Lighthouse<br /> | -   | Google 官方工具,标准化,社区支持好          |
| **HTTP Server** | Express.js                   | -   | 轻量稳定,中间件丰富,适合简单 API            |
| **类型系统**        | TypeScript                   | 5+  | 类型安全,IDE 支持,降低运行时错误            |
| **测试框架**        | Vitest                       | -   | 与 Vite 集成,快速,现代化               |



### **3.2.2 关键技术决策**



**为什么选择 Chrome Extension + 本地 Server 分离架构?**



| 方案               | 优势               | 劣势                    | 是否采用 |
| ---------------- | ---------------- | --------------------- | ---- |
| **Extension 单体** | 部署简单,无需额外进程      | 无法运行 Puppeteer,无法真实推演 | ❌    |
| **远程 Server**    | Extension 轻量化    | 需要部署服务器,成本高,数据安全风险    | ❌    |
| **本地 Server**    | 真实推演,数据本地,无服务器成本 | 需要用户启动 Server         | ✅ 采用 |



**为什么选择 HTTP + SSE 通信?**



| 方案             | 优势                  | 劣势                     | 是否采用 |
| -------------- | ------------------- | ---------------------- | ---- |
| **WebSocket**  | 全双工,实时性好            | Extension 支持复杂,需要保持长连接 | ❌    |
| **HTTP 轮询**    | 简单易实现               | 延迟高,资源浪费               | ❌    |
| **HTTP + SSE** | 单向流式推送,简单可靠,浏览器原生支持 | 仅支持服务端推送<br />         | ✅ 采用 |



**为什么选择 Zustand 而非 Redux?**



* Redux: 成熟但配置复杂,样板代码多,对于简单状态管理过重

* Zustand: 体积小(\~1KB),API 简洁,TypeScript 支持好,满足需求

## **3.3 代码仓库组织（Monorepo结构）**



### **3.3.1 目录结构设计**





**各包职责说明**:

* `extension/`: Chrome Extension 相关代码,包含 UI、规则引擎、通信层

* `server/`: Node.js Server 相关代码,包含 API 路由、Lighthouse 集成

* `shared/`: 共享类型定义和工具函数,供 Extension 和 Server 使用

### **3.3.2 Monorepo 配置**



**根 package.json**:



**依赖管理策略**:

* 公共依赖(TypeScript、Vitest等)提升到根 package.json

* 特定依赖(React、Express等)保留在各子包

* 共享类型通过 `@perf-sim/shared` 包引用

## **3.4 模块划分与职责**



### **3.4.1 Chrome Extension 模块**



| 模块                 | 职责                                            | 关键技术                 |
| ------------------ | --------------------------------------------- | -------------------- |
| **Popup UI**       | 用户界面展示,问题列表,推演按钮,对比报告                         | React, TailwindCSS   |
| **Service Worker** | Extension 生命周期管理,后台事件协调                       | Chrome Extension API |
| **规则引擎**           | 规则注册、执行、结果聚合                                  | json-rules-engine    |
| **规则实现**<br />     | 具体规则逻辑(analyze, calculate, generate, compare) | TypeScript           |
| **API Client**     | 与 Server 通信,SSE 事件处理,错误重试                     | EventSource API      |
| **存储管理**           | 配置持久化,规则启用状态管理                                | Chrome Storage API   |



### **3.4.2 Node.js Server 模块**



| 模块                 | 职责                           | 关键技术                  |
| ------------------ | ---------------------------- | --------------------- |
| **HTTP Server**    | 接收请求,路由分发,CORS 处理            | Express.js            |
| **API 路由**         | 健康检查 API、Lighthouse 优化 API   | Express Router        |
| **Lighthouse 集成器** | 协调 Puppeteer 和 Lighthouse 执行 | Puppeteer, Lighthouse |
| **脚本注入器**          | 将优化脚本注入到页面加载前                | evaluateOnNewDocument |
| **Puppeteer 控制器**  | 浏览器启动、页面控制、Cookie 管理         | Puppeteer             |
| **错误处理器**          | 统一异常捕获、日志记录、错误格式化            | Express Middleware    |



### **3.4.3 Shared 共享模块**



| 模块       | 职责                            | 使用方                |
| -------- | ----------------------------- | ------------------ |
| **类型定义** | Lighthouse 数据类型、规则接口、API 消息格式 | Extension + Server |
| **工具函数** | 数据验证、格式化、计算辅助函数               | Extension + Server |



## **3.5 完整数据流转图**



### **3.5.1 理论推演数据流**



**数据流说明**:

1. 用户上传 Lighthouse JSON 报告

2. Extension 解析 JSON,提取性能数据

3) 规则引擎执行 `analyze` 方法,识别性能问题

4) 规则引擎执行 `calculateTheoretical` 方法,预测优化收益

5. Popup UI 展示问题卡片和理论推演结果

### **3.5.2 真实推演数据流**



**数据流说明**:

1. 用户触发推演,Extension 先检查 Server 健康状态

2. Server 正常则生成优化脚本

3) Extension 发送脚本到 Server,Server 通过 SSE 推送进度

4) Server 启动 Puppeteer,注入脚本,运行 Lighthouse

5. Server 返回优化后报告

6. Extension 对比实际 vs 理论,展示结果

# **4. Extension ↔ Server 通信设计 ⭐**



## **4.1 通信架构**



### **4.1.1 通信方式选择（HTTP + SSE）**



**技术组合**: HTTP 请求 + Server-Sent Events (SSE) 流式响应



**选型理由**:

* HTTP: 简单可靠,Extension 原生支持,无需额外配置

* SSE: 服务端单向推送,支持进度实时更新,浏览器原生支持 EventSource API

* 避免 WebSocket: Extension 中 WebSocket 支持复杂,且本场景无需客户端向服务端推送

**通信模式**:



### **4.1.2 架构设计原则**



1. **按需连接**: 仅在真实推演时建立连接,理论推演不依赖 Server

2. **容错优先**: Server 未启动时友好提示,不阻断其他功能

3) **进度可见**: 通过 SSE 实时推送执行进度,提升用户体验

4) **超时保护**: 设置合理超时时间,避免长时间等待

5. **本地通信**: 固定使用 localhost,降低安全风险

### **4.1.3 完整交互流程**



## **4.2 消息协议**



### **4.2.1 请求消息格式**



**健康检查 API**:



**响应**:



**Lighthouse 优化推演 API**:



**请求参数说明**:



| 字段                     | 类型     | 必填 | 说明                              |
| ---------------------- | ------ | -- | ------------------------------- |
| url                    | string | 是  | 目标页面 URL                        |
| scripts                | array  | 是  | 优化脚本数组,至少包含一个脚本                 |
| scripts\[].name        | string | 是  | 脚本名称,用于日志记录                     |
| scripts\[].code        | string | 是  | 优化脚本代码(JavaScript)              |
| scripts\[].description | string | 否  | 脚本说明                            |
| options                | object | 否  | 可选配置                            |
| options.timeout        | number | 否  | 超时时间(ms),默认 60000               |
| options.device         | string | 否  | 设备类型(desktop/mobile),默认 desktop |



**登录态处理**:

* 登录态由 Server 端内部管理,Extension 无需传递 Cookie

* Server 支持从配置文件或环境变量读取 Cookie

* 详见 Server 概设文档中的"Cookie 管理机制"章节

### **4.2.2 SSE 事件类型**



Server 通过 SSE 推送以下类型的事件:



**1. progress 事件 - 进度更新**:



**2. complete 事件 - 执行完成**:



**3. error 事件 - 执行错误**:



### **4.2.3 消息体结构定义**



**Progress 消息结构**:

**Complete 消息结构:**


**Error 消息结构:**

**错误码定义:**

| 错误码                       | 说明              | 处理建议        |
| ------------------------- | --------------- | ----------- |
| `INVALID_URL`             | URL 格式无效        | 检查 URL 格式   |
| `SCRIPT_INJECTION_FAILED` | 脚本注入失败          | 检查脚本语法      |
| `LIGHTHOUSE_FAILED`       | Lighthouse 执行失败 | 查看详细日志      |
| `TIMEOUT`                 | 执行超时            | 增加超时时间或优化脚本 |
| `BROWSER_CRASHED`         | 浏览器崩溃           | 重启 Server   |

## **4.3 连接管理**



### **4.3.1 健康检查机制**



**检查时机**:

* 用户点击"推演"按钮时

* Extension 启动时(可选,用于提前检测)

**检查流程**:


**健康检查结果处理:**

* ✅ 检查通过: 继续推演流程

* ❌ 检查失败: 显示提示 "本地 Server 未启动,请先启动 Server"

### **4.3.2 超时与重试策略**



**超时配置**:



| 操作类型   | 超时时间 | 说明                       |
| ------ | ---- | ------------------------ |
| 健康检查   | 3秒   | 快速失败,避免用户等待              |
| 推演请求   | 60秒  | Lighthouse 执行需要时间,给予充足时长 |
| SSE 连接 | 90秒  | 包含推演 + 缓冲时间              |



**重试策略**:



**健康检查重试**:

* 不自动重试,失败即提示用户

* 理由: 用户主动操作,快速反馈更重要

**推演请求重试**:

* 不自动重试,失败后展示错误信息

* 理由: Lighthouse 执行耗时长,重试成本高

**异常处理**:

&#x20; &#x20;

### **4.3.3 连接失败处理流程**



**错误提示文案**:



| 错误场景          | 提示文案                                  | 用户操作建议    |
| ------------- | ------------------------------------- | --------- |
| Server 未启动    | "本地 Server 未启动,请先启动 Server (端口 3000)" | 启动 Server |
| 连接超时          | "推演请求超时,请检查网络连接或 Server 状态"           | 重试或查看日志   |
| 脚本注入失败        | "脚本注入失败,请检查优化脚本语法"                    | 联系开发者     |
| Lighthouse 失败 | "性能测试失败,请查看 Server 日志获取详细信息"          | 查看日志      |



## **4.4 安全性考虑**



### **4.4.1 本地端口校验**



**固定端口策略**:

* Server 固定监听 `localhost:3000`

* Extension 仅连接 `http://localhost:3000`

* 禁止连接其他域名或 IP,防止恶意重定向

**代码实现**:

&#x20;

### **4.4.2 CORS 配置**



**Server 端 CORS 配置**:

**为什么允许所有 Extension?**

* Extension ID 在开发和生产环境不同

* 本地 Server 仅监听 localhost,已具备安全性

* 恶意 Extension 无法访问用户本地 Server

