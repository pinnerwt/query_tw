package extract

import (
	"fmt"
	"strings"
)

const promptTemplate = `你是一個 zh-TW 求職資料抽取器。輸入是一則 Threads 貼文文字。
任務：判斷貼文是否為徵才/找人，若是，抽出每個工作機會的結構化欄位，輸出 JSON。

輸出 schema (JSON):
{
  "jobs": [
    {
      "title": string,
      "company": string?,
      "city": string?,             // 例: 台北市, 新北市
      "district": string?,         // 例: 信義區
      "remote": bool,
      "job_type": "full_time"|"part_time"|"freelance"|"intern"|"contract",
      "pay_min": int?,             // 月薪以新台幣表示
      "pay_max": int?,
      "pay_period": "hourly"|"daily"|"monthly"|"per_case",
      "pay_raw": string?,          // 原文薪資描述, 例: "5-7萬"
      "skills":     [{"name": string, "years_min": int?}],
      "experience": [{"role": string, "years_min": int?}],
      "languages":  [{"name": string, "level": string?}],
      "tags":       [string],
      "categories": [string],      // 從下方類別字典中挑選 1-2 個最貼切；不適用時可空
      "raw_excerpt": string        // 原文 ≤200 字摘要
    }
  ],
  "spam_score": float,             // 0..1; MLM/酒店/博弈/「無經驗高薪」≥0.7
  "_new_skills": [string],         // 不在已知字典中的技能
  "_new_roles":  [string],
  "_new_categories": [string]      // 不在已知字典中的職類
}

規則:
- 一則貼文可能含 0、1 或多個職缺。完全不是徵才/找人，回 {"jobs": [], "spam_score": <該貼文 spam 分數>}
- 多薪資不同職缺請分別輸出
- 若僅見原文薪資描述（如「5-7萬」、「面議」），保留 pay_raw 並盡力填 min/max
- city 必須是台灣行政區劃（直轄市或縣市）
- 不要捏造未出現的欄位

已核可技能字典（僅參考，未列者放入 _new_skills）:
%s

已核可職務字典（僅參考，未列者放入 _new_roles）:
%s

已核可職類字典（必填欄位 categories，僅從此清單挑選；找不到貼切者放入 _new_categories 並暫填 "其他"）:
%s

只輸出 JSON，不要解釋或附加文字。
`

// BuildPrompt renders the system prompt with the dictionaries inlined.
func BuildPrompt(skills, roles, categories []string) string {
	return fmt.Sprintf(promptTemplate,
		strings.Join(skills, ", "),
		strings.Join(roles, ", "),
		strings.Join(categories, ", "),
	)
}
