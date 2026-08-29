(function initResumePilotScoring(global) {
  const companies = [
    {
      company: "腾讯",
      aliases: ["Tencent"],
      domains: ["jobs.tencent.com", "careers.tencent.com", "join.qq.com"],
      careerUrl: "https://jobs.tencent.com/",
      jobListUrls: { campus: "https://join.qq.com/post.html", intern: "https://join.qq.com/post.html" },
      tags: ["互联网", "游戏", "云计算", "人工智能"],
      dimensions: { stability: 90, growth: 82, student: 88, transparency: 90 },
      evidence: [
        { label: "官方财务报告", url: "https://www.tencent.com/investors/financial-reports/" },
        { label: "官方人才培养说明", url: "https://careers.tencent.com/" }
      ]
    },
    {
      company: "字节跳动",
      aliases: ["ByteDance", "抖音集团"],
      domains: ["jobs.bytedance.com"],
      careerUrl: "https://jobs.bytedance.com/campus/",
      jobListUrls: { campus: "https://jobs.bytedance.com/campus/position", intern: "https://jobs.bytedance.com/campus/position" },
      tags: ["互联网", "人工智能", "内容", "电商"],
      dimensions: { stability: 72, growth: 92, student: 85, transparency: 66 },
      evidence: [
        { label: "官方公司与规模信息", url: "https://www.bytedance.com/en/" },
        { label: "官方学生招聘入口", url: "https://jobs.bytedance.com/campus/" }
      ]
    },
    {
      company: "华为",
      aliases: ["Huawei"],
      domains: ["career.huawei.com"],
      careerUrl: "https://career.huawei.com/cn/campus-recruitment",
      jobListUrls: { campus: "https://career.huawei.com/cn/campus-recruitment-job-list?recruitmentType=FRESH_GRADUATE", intern: "https://career.huawei.com/cn/campus-recruitment-job-list?recruitmentType=INTERN" },
      tags: ["通信", "硬件", "人工智能", "软件", "芯片"],
      dimensions: { stability: 90, growth: 91, student: 90, transparency: 91 },
      evidence: [
        { label: "2025 年官方年报", url: "https://www.huawei.com/cn/annual-report/2025" },
        { label: "官方校园招聘入口", url: "https://career.huawei.com/cn/campus-recruitment" }
      ]
    },
    {
      company: "阿里巴巴",
      aliases: ["Alibaba"],
      domains: ["campus-talent.alibaba.com", "talent.alibaba.com"],
      careerUrl: "https://campus-talent.alibaba.com/campus/position",
      jobListUrls: { campus: "https://campus-talent.alibaba.com/campus/position", intern: "https://campus-talent.alibaba.com/campus/position" },
      tags: ["互联网", "电商", "云计算", "人工智能"],
      dimensions: { stability: 88, growth: 88, student: 92, transparency: 91 },
      evidence: [
        { label: "官方财务报告", url: "https://www.alibabagroup.com/en-US/ir-financial-reports-financial-results" },
        { label: "官方员工发展说明", url: "https://home.alibabagroup.com/en-US/esg-employee-development" }
      ]
    },
    {
      company: "百度",
      aliases: ["Baidu"],
      domains: ["talent.baidu.com"],
      careerUrl: "https://talent.baidu.com/jobs/campus",
      jobListUrls: { campus: "https://talent.baidu.com/jobs/list?projectType=1", intern: "https://talent.baidu.com/jobs/list?projectType=2" },
      tags: ["互联网", "人工智能", "搜索", "自动驾驶", "云计算"],
      dimensions: { stability: 84, growth: 87, student: 88, transparency: 88 },
      evidence: [{ label: "官方校园招聘与职位", url: "https://talent.baidu.com/jobs/campus" }]
    },
    {
      company: "京东",
      aliases: ["JD", "JD.com"],
      domains: ["zhaopin.jd.com"],
      careerUrl: "https://zhaopin.jd.com/",
      jobListUrls: { campus: "https://zhaopin.jd.com/", intern: "https://zhaopin.jd.com/" },
      tags: ["互联网", "电商", "物流", "零售", "人工智能"],
      dimensions: { stability: 84, growth: 80, student: 82, transparency: 78 },
      evidence: [{ label: "官方招聘入口", url: "https://zhaopin.jd.com/" }]
    },
    {
      company: "美团",
      aliases: ["Meituan"],
      domains: ["job.meituan.com", "career.meituan.com"],
      careerUrl: "https://career.meituan.com/",
      jobListUrls: { campus: "https://job.meituan.com/web/campus", intern: "https://job.meituan.com/web/campus" },
      tags: ["互联网", "本地生活", "零售", "人工智能", "物流"],
      dimensions: { stability: 82, growth: 84, student: 86, transparency: 82 },
      evidence: [{ label: "官方校园招聘入口", url: "https://job.meituan.com/web/campus" }]
    },
    {
      company: "小米",
      aliases: ["Xiaomi"],
      domains: ["hr.xiaomi.com", "career.mi.com"],
      careerUrl: "https://hr.xiaomi.com/campus",
      jobListUrls: { campus: "https://hr.xiaomi.com/campus", intern: "https://hr.xiaomi.com/campus" },
      tags: ["硬件", "互联网", "汽车", "人工智能", "芯片", "IoT"],
      dimensions: { stability: 82, growth: 89, student: 87, transparency: 83 },
      evidence: [{ label: "官方校园招聘入口", url: "https://hr.xiaomi.com/campus" }]
    },
    {
      company: "网易",
      aliases: ["NetEase"],
      domains: ["campus.163.com", "hr.163.com"],
      careerUrl: "https://campus.163.com/",
      jobListUrls: { campus: "https://campus.163.com/", intern: "https://campus.163.com/" },
      tags: ["互联网", "游戏", "教育", "音乐", "人工智能"],
      dimensions: { stability: 82, growth: 80, student: 85, transparency: 80 },
      evidence: [{ label: "官方校园招聘入口", url: "https://campus.163.com/" }]
    },
    {
      company: "大疆",
      aliases: ["DJI", "大疆创新"],
      domains: ["careers.dji.com", "apply.careers.dji.com"],
      careerUrl: "https://careers.dji.com/zh-CN/campus",
      jobListUrls: { campus: "https://careers.dji.com/zh-CN/campus/hot-jobs", intern: "https://careers.dji.com/zh-CN/campus" },
      tags: ["硬件", "机器人", "无人机", "人工智能", "嵌入式"],
      dimensions: { stability: 79, growth: 90, student: 90, transparency: 86 },
      evidence: [{ label: "官方校园招聘与热招职位", url: "https://careers.dji.com/zh-CN/campus/hot-jobs" }]
    },
    {
      company: "OPPO",
      aliases: ["欧珀"],
      domains: ["careers.oppo.com"],
      careerUrl: "https://careers.oppo.com/campus",
      jobListUrls: { campus: "https://careers.oppo.com/university/oppo/campus/post", intern: "https://careers.oppo.com/university/oppo/campus/post" },
      tags: ["硬件", "手机", "人工智能", "软件", "芯片"],
      dimensions: { stability: 79, growth: 84, student: 86, transparency: 82 },
      evidence: [{ label: "官方校园招聘与岗位列表", url: "https://careers.oppo.com/campus" }]
    },
    {
      company: "联想",
      aliases: ["Lenovo"],
      domains: ["talent.lenovo.com.cn"],
      careerUrl: "https://talent.lenovo.com.cn/",
      jobListUrls: { campus: "https://talent.lenovo.com.cn/position?projectType=1", intern: "https://talent.lenovo.com.cn/position?projectType=2" },
      tags: ["硬件", "人工智能", "软件", "云计算", "供应链"],
      dimensions: { stability: 86, growth: 84, student: 88, transparency: 85 },
      evidence: [{ label: "官方校园招聘与岗位列表", url: "https://talent.lenovo.com.cn/position?projectType=1" }]
    },
    {
      company: "招商银行",
      aliases: ["CMB", "招行"],
      domains: ["career.cmbchina.com"],
      careerUrl: "https://career.cmbchina.com/",
      jobListUrls: { campus: "https://career.cmbchina.com/campus/home", intern: "https://career.cmbchina.com/campus/home" },
      tags: ["金融", "银行", "数据", "软件", "人工智能"],
      dimensions: { stability: 91, growth: 78, student: 86, transparency: 88 },
      evidence: [{ label: "官方校园招聘入口", url: "https://career.cmbchina.com/" }]
    }
  ];

  const focusWeights = {
    balanced: { stability: 0.3, growth: 0.25, student: 0.3, transparency: 0.15 },
    stability: { stability: 0.5, growth: 0.15, student: 0.2, transparency: 0.15 },
    growth: { stability: 0.2, growth: 0.5, student: 0.2, transparency: 0.1 },
    student: { stability: 0.2, growth: 0.15, student: 0.55, transparency: 0.1 }
  };

  function evaluateCompany(text, url, preferences = {}) {
    const normalizedText = `${text || ""} ${url || ""}`.toLowerCase();
    const known = findCompany(normalizedText, url);
    const verifiedDomain = known ? isVerifiedDomain(known, url) : false;
    const focus = preferences.qualityFocus || "balanced";
    const weights = focusWeights[focus] || focusWeights.balanced;
    const reasons = [];
    const warnings = [];
    let dimensions;
    let confidence;
    let evidence;

    if (known) {
      dimensions = { ...known.dimensions };
      confidence = verifiedDomain ? Math.min(95, Math.round(70 + known.evidence.length * 13)) : 70;
      evidence = known.evidence;
      reasons.push("具有官方企业资料");
      if (verifiedDomain) reasons.unshift("招聘域名已核验");
      else warnings.push("识别到企业名称，但当前链接不是已核验招聘域名");
      if (known.dimensions.student >= 85) reasons.push("学生培养信息较充分");
      if (known.dimensions.transparency >= 85) reasons.push("公开披露较充分");
    } else {
      const official = /(官方|官网|official)/i.test(normalizedText);
      const report = /(年报|财务报告|annual report|investor relations|投资者关系)/i.test(normalizedText);
      const scale = /(上市|世界500强|大型企业|集团|global|全球)/i.test(normalizedText);
      const innovation = /(人工智能|ai|研发|创新|科技|research|technology)/i.test(normalizedText);
      const student = /(校园招聘|校招|应届|实习|graduate|campus|intern|培训|导师)/i.test(normalizedText);
      dimensions = {
        stability: Math.min(75, 42 + (scale ? 18 : 0) + (report ? 15 : 0)),
        growth: Math.min(75, 42 + (innovation ? 22 : 0)),
        student: Math.min(75, 35 + (student ? 30 : 0)),
        transparency: Math.min(75, 25 + (official ? 20 : 0) + (report ? 25 : 0))
      };
      confidence = Math.min(60, 15 + (official ? 15 : 0) + (report ? 15 : 0) + (scale ? 8 : 0) + (student ? 7 : 0));
      evidence = [];
      if (official) reasons.push("搜索摘要含官网信号");
      if (student) reasons.push("发现学生招聘信号");
      if (innovation) reasons.push("发现创新/技术信号");
      warnings.push("企业资料未进入已核验库，质量结论需要人工核实");
    }

    const avoided = splitList(preferences.avoidCompanyKeywords).filter((term) => normalizedText.includes(term.toLowerCase()));
    let score = weightedScore(dimensions, weights);
    if (avoided.length) {
      score -= Math.min(40, avoided.length * 20);
      warnings.push(`命中企业排除词：${avoided.join("、")}`);
    }

    return {
      company: known?.company || inferCompany(text, url),
      companyScore: clamp(Math.round(score)),
      confidence,
      dimensions,
      reasons: unique(reasons).slice(0, 4),
      warnings: unique(warnings),
      evidence,
      verified: verifiedDomain
    };
  }

  function evaluateJob(text, url, profile = {}) {
    const haystack = `${text || ""} ${url || ""}`.toLowerCase();
    const roleTerms = splitTerms(profile.targetRole);
    const skillTerms = splitTerms(profile.skills);
    const city = clean(profile.targetCity);
    const positionType = clean(profile.positionType);
    const graduationYear = clean(profile.graduationYear);
    const reasons = [];
    const warnings = [];
    let score = 0;
    let hardBlocked = false;

    const matchedRoles = roleTerms.filter((term) => haystack.includes(term.toLowerCase()));
    if (roleTerms.length) {
      const ratio = matchedRoles.length / roleTerms.length;
      score += Math.round(35 * Math.min(1, ratio + (matchedRoles.length ? 0.2 : 0)));
      if (matchedRoles.length) reasons.push(`岗位方向：${matchedRoles.slice(0, 3).join("、")}`);
      else warnings.push("未发现目标岗位关键词");
    } else {
      score += 18;
      warnings.push("尚未填写目标岗位");
    }

    if (city) {
      if (haystack.includes(city.toLowerCase())) { score += 15; reasons.push(`地点：${city}`); }
      else warnings.push("地点未确认");
    } else score += 7;

    const matchedSkills = skillTerms.filter((term) => skillTermMatches(haystack, term));
    if (skillTerms.length) {
      // 任一明确技能命中就应进入候选；命中数量继续影响排序，但不再因简历技能较多而稀释到接近 0 分。
      score += matchedSkills.length ? Math.min(35, 18 + matchedSkills.length * 5) : 0;
      if (matchedSkills.length) reasons.push(`技能命中：${matchedSkills.slice(0, 5).join("、")}`);
      else warnings.push("摘要中未发现简历技能词");
    } else score += 8;

    if (!positionType || positionType === "不限") score += 6;
    else if (haystack.includes(positionType.toLowerCase()) || (positionType === "校园招聘" && /(校招|应届|campus|graduate)/i.test(haystack))) {
      score += 10;
      reasons.push(positionType);
    } else warnings.push(`未确认属于${positionType}`);

    if (graduationYear) {
      if (haystack.includes(graduationYear)) { score += 10; reasons.push(`毕业年份：${graduationYear}`); }
      else score += 5;
    } else score += 5;

    score += 10;
    const experience = extractNumber(haystack, /(?:至少|minimum|要求)?\s*(\d+)\s*(?:年|years?).{0,8}(?:经验|experience)/i);
    const maxExperience = Number(profile.maxExperienceYears || 0);
    if (experience != null && experience > maxExperience) {
      score -= 25;
      hardBlocked = true;
      warnings.push(`岗位可能要求 ${experience} 年经验`);
    }

    const requiredDays = extractNumber(haystack, /(?:每周|一周|weekly).{0,8}?([1-7])\s*(?:天|days?)/i);
    const availableDays = Number(profile.availableDays || 0);
    if (requiredDays && availableDays && requiredDays > availableDays) {
      score -= 18;
      hardBlocked = true;
      warnings.push(`可能要求每周 ${requiredDays} 天，你填写的是 ${availableDays} 天`);
    }

    const requiredMonths = extractNumber(haystack, /(?:至少|连续|minimum)?\s*(\d+)\s*(?:个?月|months?)/i);
    const availableMonths = Number(profile.internshipMonths || 0);
    if (requiredMonths && availableMonths && requiredMonths > availableMonths) {
      score -= 15;
      hardBlocked = true;
      warnings.push(`可能要求实习 ${requiredMonths} 个月，你填写的是 ${availableMonths} 个月`);
    }

    if (/(硕士及以上|硕士以上|master'?s? degree required)/i.test(haystack) && /本科|大专/.test(profile.degree || "")) {
      score -= 25;
      hardBlocked = true;
      warnings.push("学历要求可能高于当前学历");
    }

    const avoided = splitList(profile.avoidJobKeywords).filter((term) => haystack.includes(term.toLowerCase()));
    if (avoided.length) {
      score -= Math.min(45, avoided.length * 18);
      hardBlocked = true;
      warnings.push(`命中岗位排除词：${avoided.join("、")}`);
    }

    const compensation = evaluateCompensation(haystack, profile);
    return {
      jobScore: clamp(Math.round(score)),
      matchedSkills: unique(matchedSkills),
      skillEligible: matchedSkills.length > 0,
      hardBlocked,
      compensationScore: compensation.score,
      compensationLabel: compensation.label,
      reasons: unique(reasons).slice(0, 5),
      warnings: unique([...warnings, ...compensation.warnings]).slice(0, 6)
    };
  }

  function skillTermMatches(haystack, rawTerm) {
    const term = clean(rawTerm).toLowerCase();
    if (!term) return false;
    const aliases = {
      js: ["js", "javascript"],
      javascript: ["javascript", "js"],
      ts: ["ts", "typescript"],
      typescript: ["typescript", "ts"],
      "node.js": ["node.js", "nodejs"],
      nodejs: ["nodejs", "node.js"],
      vue: ["vue", "vue.js", "vuejs"],
      react: ["react", "react.js", "reactjs"],
      "c++": ["c++", "cpp"],
      cpp: ["cpp", "c++"],
      "c#": ["c#", "csharp"],
      csharp: ["csharp", "c#"],
      ai: ["ai", "人工智能"],
      人工智能: ["人工智能", "ai"],
      数据分析: ["数据分析", "data analysis"],
      机器学习: ["机器学习", "machine learning"],
      深度学习: ["深度学习", "deep learning"]
    };
    return (aliases[term] || [term]).some((candidate) => {
      if (/^[a-z0-9+#.]+$/i.test(candidate)) {
        const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(haystack);
      }
      return haystack.includes(candidate.toLowerCase());
    });
  }

  function evaluateCompensation(text, profile) {
    const benefits = [
      /五险一金|社会保险|公积金/i,
      /奖金|年终奖|绩效奖|bonus/i,
      /餐补|交通补贴|住房补贴|房补|补贴/i,
      /商业保险|补充医疗/i,
      /带薪年假|年假|paid leave/i,
      /弹性工作|flexible/i,
      /员工宿舍|住房|租房/i
    ];
    const benefitCount = benefits.filter((pattern) => pattern.test(text)).length;
    const monthly = extractRange(text, [
      /(\d+(?:\.\d+)?)\s*[kK千]\s*(?:-|~|—|–|至)\s*(\d+(?:\.\d+)?)\s*[kK千]?\s*(?:\/月|月薪|monthly)?/i,
      /(\d{4,5})\s*(?:-|~|—|–|至)\s*(\d{4,5})\s*(?:元)?\s*(?:\/月|每月|月薪)/i
    ]);
    const daily = extractRange(text, [
      /(\d{2,4})\s*(?:-|~|—|–|至)\s*(\d{2,4})\s*元\s*(?:\/|每)?天/i,
      /(?:日薪|每天)\s*(\d{2,4})\s*(?:-|~|—|–|至)\s*(\d{2,4})\s*元/i
    ]);
    const warnings = [];
    let score = 25 + Math.min(20, benefitCount * 4);
    let label = benefitCount ? `薪资未公开 · ${benefitCount} 类福利信号` : "待遇未公开";

    if (daily) {
      const minimum = Number(profile.minDailySalary || 0);
      score = minimum ? (daily.max >= minimum ? 82 : 25) : 70;
      score += Math.min(18, benefitCount * 4);
      label = `${daily.min}–${daily.max} 元/天`;
      if (minimum && daily.max < minimum) warnings.push(`日薪上限低于期望的 ${minimum} 元/天`);
      else if (minimum) warnings.push("薪资达到期望仅依据页面公开区间，需确认口径");
    } else if (monthly) {
      const range = monthly.max > 1000 ? { min: monthly.min / 1000, max: monthly.max / 1000 } : monthly;
      const minimum = Number(profile.minMonthlySalary || 0);
      score = minimum ? (range.max >= minimum ? 82 : 25) : 70;
      score += Math.min(18, benefitCount * 4);
      label = `${formatNumber(range.min)}–${formatNumber(range.max)}k/月`;
      if (minimum && range.max < minimum) warnings.push(`月薪上限低于期望的 ${minimum}k`);
      else if (minimum) warnings.push("薪资达到期望仅依据页面公开区间，需确认薪资构成");
    } else {
      warnings.push("岗位未公开薪资，待遇分保持保守");
    }

    return { score: clamp(Math.round(score)), label, warnings };
  }

  function findCompany(text, url) {
    let host = "";
    try { host = new URL(url).hostname.toLowerCase(); } catch {}
    return companies.find((entry) =>
      entry.domains.some((domain) => host === domain || host.endsWith(`.${domain}`)) ||
      [entry.company, ...entry.aliases].some((name) => text.includes(name.toLowerCase()))
    );
  }

  function isVerifiedDomain(company, url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return company.domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
    } catch {
      return false;
    }
  }

  function weightedScore(dimensions, weights) {
    return Object.keys(weights).reduce((sum, key) => sum + dimensions[key] * weights[key], 0);
  }

  function splitTerms(value = "") {
    return String(value).split(/[\s，,、;；/|·()（）\-]+/).map(clean).filter((term) => term.length > 1);
  }

  function splitList(value = "") {
    return String(value).split(/[，,、;；\n]/).map(clean).filter(Boolean);
  }

  function extractNumber(text, regex) {
    const value = text.match(regex)?.[1];
    return value == null ? null : Number(value);
  }

  function extractRange(text, patterns) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const first = Number(match[1]);
      const second = Number(match[2]);
      if (Number.isFinite(first) && Number.isFinite(second)) return { min: Math.min(first, second), max: Math.max(first, second) };
    }
    return null;
  }

  function formatNumber(value) { return Number.isInteger(value) ? String(value) : value.toFixed(1); }

  function clean(value = "") { return String(value).replace(/\s+/g, " ").trim(); }
  function clamp(value) { return Math.max(0, Math.min(100, value)); }
  function unique(values) { return [...new Set(values)]; }
  function inferCompany(text, url) {
    const title = clean(text).split(/[|｜\-_—]/)[0];
    if (title && title.length <= 24) return title;
    try { return new URL(url).hostname.replace(/^www\./, "").split(".")[0]; } catch { return "待核验企业"; }
  }

  global.ResumePilotScoring = { companies, evaluateCompany, evaluateJob, findCompany, splitTerms };
})(globalThis);
