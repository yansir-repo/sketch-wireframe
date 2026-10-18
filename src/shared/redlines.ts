/**
 * 公开预览的红线：草图地址公开、不过 Access，里面不能有真实价格 / 账号密码 / 密钥。
 * 扫的是整份 Sketch 序列化后的文本——客户浏览器拿到的就是这些字节，写在哪个字段里都一样。
 */
export type Finding = { level: "error" | "warn"; rule: string; message: string };

const SCANS: ReadonlyArray<{
  re: RegExp;
  level: Finding["level"];
  rule: string;
  message: (m: string) => string;
}> = [
  {
    re: /(?:密码|password|passwd|pwd)\s*[:：=]\s*["']?[^\s"'<>,;]{3,}/gi,
    level: "error",
    rule: "secret-password",
    message: (m) => `像是写死的密码：${m}`,
  },
  {
    re: /\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{12,}|ghp_[A-Za-z0-9]{20,}|xox[bp]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g,
    level: "error",
    rule: "secret-token",
    message: (m) => `像是密钥/令牌：${m.slice(0, 12)}…`,
  },
  {
    re: /Bearer\s+[A-Za-z0-9._-]{16,}/g,
    level: "error",
    rule: "secret-token",
    message: () => "像是 Bearer 令牌",
  },
  {
    re: /[¥￥$€£]\s?\d[\d,.]*|\d[\d,.]*\s?(?:元|万元|美元|美金|欧元|USD|RMB|人民币)(?![A-Za-z])/g,
    level: "error",
    rule: "price",
    message: (m) => `像是真实价格：${m}（草图只用客户已知的业务信息，不放价格）`,
  },
  {
    re: /(?:单价|报价|价格|合同金额|总价|金额)\s*[:：=]\s*\d/g,
    level: "error",
    rule: "price",
    message: (m) => `像是真实价格：${m}`,
  },
  {
    // 占位/解释性文案：草图的内容是给客户看的，“for testing”“Demo only”“Synthetic row”这种话是写给自己的；
    // 拦发布（不是提示）：有没有资料依据的内容都留空，空就是波浪线，说明文字要写进 note
    re: /\b(?:placeholder|for testing|lorem ipsum|demo(?:[- ](?:only|data|row|record|product|copy))?|synthetic|(?:sample|test|dummy|fake) (?:data|row|record|copy|content)|no [a-z ]{1,24} claim(?:ed)?)\b|待填写|占位/gi,
    level: "error",
    rule: "placeholder-copy",
    message: (m) =>
      `像是占位或解释性文案：“${m}”——客户会读到它；没有资料依据的内容留空（波浪线），别写说明`,
  },
  {
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    level: "warn",
    rule: "contact-email",
    message: (m) => `邮箱：${m}`,
  },
  {
    re: /(?<![\d])1[3-9]\d{9}(?![\d])/g,
    level: "warn",
    rule: "contact-phone",
    message: (m) => `手机号：${m}`,
  },
];

export const scanText = (text: string): Finding[] =>
  SCANS.flatMap(({ re, level, rule, message }) =>
    [...text.matchAll(re)].map((m) => ({ level, rule, message: message(m[0]) })),
  );
