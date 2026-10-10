# HTTP 接口契约

[简体中文](README.md) · [English](README.en.md) · [开发文档](../development/README.md)

此目录描述仓库中实际存在的 HTTP 宿主。Java 核心不提供 HTTP 服务；这里的静态文件不会新增登录、详情查询、Swagger UI 或 `/v3/api-docs` 端点。

<!-- topic:navigation -->

## 按任务查阅

- 调用接口、理解授权与重试：[接口参考](API_REFERENCE.md)
- 运行完整请求：[可执行示例](examples/README.md)，共 16 个合成请求文件
- 导入兼容 OpenAPI 3.1 的工具：[独立宿主](openapi/standalone.openapi.json)、[若依宿主](openapi/ruoyi.openapi.json)
- 查阅复用模型：[JSON Schema](openapi/schemas.json)，覆盖请求、响应、错误、九类业务文档、流程及有限条件
- 核对控制器：[30 项路由清单](endpoint-inventory.json)

独立宿主契约有 21 项操作，包括通用审批、六场景及专用报价案例。若依契约有 9 项操作，使用宿主身份、权限和响应包装。用印的固定路径与参数化场景路径是两个真实处理器，不能合并计数。两份契约共用模型，但不能互换认证方式、状态码或响应结构。

<!-- topic:format-scope -->

## 契约格式与范围

采用 [OpenAPI 3.1.0](https://spec.openapis.org/oas/v3.1.0.html) 和 [JSON Schema 2020-12](https://json-schema.org/draft/2020-12)。结构化文件只保留一份，协议标识符与说明使用英文；中文和英文叙述分别在对应文档中维护。引用均为仓库内相对路径；导入工具时应保留整个 `openapi` 目录以及相邻 `examples` 目录，不要仅复制一个文件。

- 模型区分输入与输出，拒绝把身份、历史、摘要、衍生金额或路由快照作为提交字段。
- `runIf` 仅覆盖费用总额、付款净额、收货拒收标记和合同条款种类四类事实，不执行表达式或脚本。
- JSON Schema 描述结构；实时身份、版本、并发、报价来源、精确跨字段关系等仍由领域与宿主执行。
- Java 的 UTF-16 长度、整数词法、`BigDecimal` 标度、空白规则等通过 `x-*` 扩展明确记录。通用 OpenAPI 工具可能忽略这些扩展，结构通过不表示服务端一定接受。
- 受控独立错误使用 `{message}`；若依受控错误使用 `AjaxResult` 的 `code/msg`。宿主认证失败及未捕获异常保留未约定的默认响应，不能据此承诺所有错误都具有统一包装。

<!-- topic:offline-checks -->

## 离线检查

在仓库根目录运行，仅需要 Python 标准库：

```sh
python3 scripts/check_api_contract.py
python3 scripts/test_api_contract.py
python3 scripts/verify_developer_docs.py
```

检查器核对实际控制器与清单、OpenAPI 路径/方法/处理器/返回类型/成功状态、原生权限、必需请求头、请求及响应包装、JSON 引用、Java 记录字段、业务类型、注册场景和条件族；它按原始数字词法验证全部 16 个请求示例，并检查已实现的跨字段约束。负向测试主动修改源文件、契约或样例，确认错误不能悄悄通过。

这是针对本仓库所用关键字的封闭检查器，不是通用 OpenAPI 或 JSON Schema 校验器。增加结构关键字时必须同步扩展其校验与测试，不能依赖忽略未知关键字。它不启动服务器，也不证明认证、持久化或所有运行时分支已通过；继续运行[真实 HTTP 示例验证](examples/README.md#运行已校验示例)及完整测试集。

<!-- topic:change-workflow -->

## 变更流程

1. 先审阅控制器、DTO、领域校验和宿主安全配置，明确兼容性及迁移影响。
2. 同步修改两种语言的接口参考、适用宿主的 OpenAPI、共享模型、样例及相关测试。
3. 运行离线检查和真实 HTTP 验证；不要为了满足文档而发明端点或放宽服务端规则。
4. [行为复核清单](openapi/source-contract.json)对 18 个相关 Java 文件记录去注释、忽略空白后的令牌摘要。语义改动会阻止检查通过，要求重新审阅结构校验无法证明的行为。只有完成契约和测试复核后才更新相应摘要；它不是代码生成源，不能仅为消除失败而刷新。
5. 路由有意变化时，审阅后使用现有 `python3 scripts/verify_developer_docs.py --write-inventory` 更新路由清单，再更新接口总数和回归测试。持续集成不执行自动刷新。
