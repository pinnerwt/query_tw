-- 104 人力銀行 mid-level functional taxonomy (~20 buckets).
-- Canonical is the human-facing label; aliases include English + casual variants
-- the LLM is likely to emit. Add more aliases as needed.
INSERT INTO categories (canonical, aliases, approved) VALUES
  ('軟體/工程',     ARRAY['軟體工程','Software','Engineering','SWE','後端','前端','全端','Backend','Frontend','Fullstack'], true),
  ('MIS/網管',      ARRAY['MIS','IT','資訊管理','系統管理','網管','DevOps','SRE'], true),
  ('工程研發',      ARRAY['硬體研發','韌體','嵌入式','半導體','機電','Hardware','Firmware','Embedded'], true),
  ('生技/醫療研發', ARRAY['生技研發','醫材研發','BioTech','製藥研發'], true),
  ('醫療專業',      ARRAY['醫師','護理師','藥師','醫檢師','醫療','Clinical','Doctor','Nurse'], true),
  ('醫療/保健服務', ARRAY['長照','照服員','物理治療','保健','美容醫學'], true),
  ('財會/金融',     ARRAY['會計','財務','稅務','審計','金融','Banking','Accounting','Finance','CPA'], true),
  ('經營/人資/行政', ARRAY['經營企劃','幕僚','HR','人力資源','行政','總務','法務','智財','秘書'], true),
  ('行銷/企劃',     ARRAY['行銷','企劃','品牌','PM','Product Manager','專案管理','Project Manager','Marketing'], true),
  ('業務銷售',      ARRAY['業務','銷售','Sales','BD','Business Development','貿易','門市'], true),
  ('客服支援',      ARRAY['客服','客戶服務','Customer Service','CS','Support'], true),
  ('設計',          ARRAY['UI','UX','平面設計','視覺設計','Graphic','Designer','UI/UX','工業設計','室內設計'], true),
  ('傳播/編譯',     ARRAY['傳播','記者','編輯','編譯','文字','翻譯','編劇','製作','Translator','Editor','Journalist'], true),
  ('教育/研究',     ARRAY['老師','教師','補教','講師','教育','學術','研究員','Teacher','Lecturer','Researcher'], true),
  ('餐飲/旅遊/美容', ARRAY['餐飲','廚師','旅遊','美容','美髮','Barista','Chef','Stylist'], true),
  ('製造/品管',     ARRAY['作業員','製程','品保','品管','QA','QC','生產管理','環安衛','Manufacturing'], true),
  ('營建/製圖',     ARRAY['營建','工地','監工','建築','土木','製圖','測量','Construction','Drafting'], true),
  ('操作/維修/物流', ARRAY['操作','維修','技師','倉管','採購','物流','司機','Logistics','Warehouse','Driver'], true),
  ('軍警保全/農林漁牧', ARRAY['軍警','保全','警衛','消防','農','林','漁','牧','Security','Farmer'], true),
  ('其他',          ARRAY['Other','其他類'], true);
