export interface SkillInfo {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

export interface SkillDetail extends SkillInfo {
  readonly content: string;
  readonly body: string;
}

export interface SkillsResponse {
  readonly success: boolean;
  readonly data: SkillInfo[];
}

export interface SkillDetailResponse {
  readonly success: boolean;
  readonly data: SkillDetail;
}

export interface SkillFormData {
  readonly name: string;
  readonly description: string;
  readonly content: string;
}

export const SKILL_TEMPLATES: readonly SkillTemplate[] = [
  {
    id: "blank",
    name: "空白技能",
    description: "从空白开始",
    content: "",
  },
  {
    id: "code-review",
    name: "代码审查",
    description: "从质量、安全和最佳实践角度审查代码",
    content: `# 代码审查技能

## 目标
审查代码变更的质量、安全性和最佳实践遵循情况。

## 步骤
1. 分析代码 diff 或文件内容
2. 检查常见问题：
   - 安全漏洞（注入、XSS 等）
   - 性能瓶颈
   - 代码风格问题
   - 缺少错误处理
3. 给出带具体位置的可执行反馈
4. 用代码示例提出改进建议

## 输出格式
- **严重**：合并前必须修复
- **警告**：建议修复，存在潜在问题
- **建议**：可选优化项`,
  },
  {
    id: "data-analysis",
    name: "数据分析",
    description: "分析数据集并生成洞察",
    content: `# 数据分析技能

## 目标
分析给定数据并生成有意义的洞察。

## 步骤
1. 理解数据结构和字段类型
2. 识别关键指标和趋势
3. 寻找模式、异常和相关性
4. 在适合时生成可视化
5. 总结发现并给出可执行建议

## 规范
- 始终先验证数据质量
- 在适合时使用统计方法
- 用清晰、非技术化的语言呈现发现
- 对预测结果说明置信度`,
  },
  {
    id: "api-design",
    name: "API 设计",
    description: "按照最佳实践设计 RESTful API 接口",
    content: `# API 设计技能

## 目标
设计清晰、一致的 RESTful API 接口。

## 原则
- 使用面向资源的 URL
- 正确应用 HTTP 方法（GET、POST、PUT、DELETE）
- 合理规划 API 版本
- 列表接口包含分页
- 使用一致的错误响应格式

## 模板
\`\`\`
GET    /api/v1/{resources}          - 列表
GET    /api/v1/{resources}/:id      - 详情
POST   /api/v1/{resources}          - 创建
PUT    /api/v1/{resources}/:id      - 更新
DELETE /api/v1/{resources}/:id      - 删除
\`\`\`

## 错误格式
\`\`\`json
{
  "success": false,
  "error": "面向用户的错误信息",
  "code": "MACHINE_READABLE_CODE"
}
\`\`\``,
  },
  {
    id: "writing",
    name: "内容写作",
    description: "为不同格式撰写清晰、有吸引力的内容",
    content: `# 内容写作技能

## 目标
创作清晰、有吸引力且结构良好的内容。

## 规范
- 用有吸引力的开头抓住读者
- 使用短段落和短句
- 加入相关示例
- 保持一致的语气和风格
- 以明确行动建议或总结收尾

## 支持格式
- 博客文章
- 文档
- 社交媒体
- 邮件活动
- 技术指南`,
  },
] as const;

export interface SkillTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly content: string;
}
