# 首批 UE5 数据资产清单

## 必须创建

| 资产 | 用途 | 依赖 |
|---|---|---|
| `DA_PlayerProfile` | 主角移动、镜头、动画和输入参数 | Character、Input |
| `DA_TideTraceVehicle` | 车辆驾驶、碰撞、灯光和镜头参数 | Vehicle、Input |
| `DA_TideDistrictMission` | 蓝潮货单完整任务链 | Mission、Dialogue |
| `DA_QualityProfiles` | 高端、中端、低端画质配置 | Core、Presentation |
| `DA_DistrictStreamingRules` | 街区分区加载与释放规则 | World Streaming |
| `DA_InteractionPromptSet` | 移动端交互按钮与提示 | UI、Input |
| `DA_AudioMixProfiles` | 环境、车辆、任务和演出混音 | Audio |
| `DA_Dialogue_TideTrace` | 岚潮与玩家的首段对话 | Dialogue、UI |
| `DA_Reward_TideTrace` | 任务奖励和解锁内容 | Mission、Save |

## 命名与版本

数据资产使用 `DA_` 前缀，蓝图组件使用 `BP_` 前缀，动画蓝图使用 `ABP_` 前缀，材质实例使用 `MI_` 前缀。所有资产在提交前必须记录创建人、版本、依赖、平台限制和是否允许移动端降级。

## 依赖规则

任务数据不能直接依赖具体关卡中的临时 Actor。目标点使用 Gameplay Tag 或稳定 ID 查找，避免关卡重新摆放后任务失效。画质数据不能在材质蓝图中硬编码平台判断，统一由质量管理器在启动时下发参数。

## 首轮实现顺序

先创建输入、画质和存档数据，再创建玩家和车辆数据；随后创建任务、对话和奖励数据。最后接入街区流式数据。这样即使环境资产延期，程序也可以用代理对象跑完整任务流程。
