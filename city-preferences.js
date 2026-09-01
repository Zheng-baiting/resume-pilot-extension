(function initResumePilotCities(global) {
  const popularCities = [
    "北京", "上海", "深圳", "广州", "杭州", "南京", "苏州", "成都",
    "武汉", "西安", "重庆", "天津", "长沙", "合肥", "东莞", "佛山",
    "厦门", "福州", "济南", "青岛", "郑州", "宁波", "无锡", "珠海"
  ];
  const cityAliases = {
    北京: ["北京", "beijing"], 上海: ["上海", "shanghai"], 深圳: ["深圳", "shenzhen"], 广州: ["广州", "guangzhou"],
    杭州: ["杭州", "hangzhou"], 南京: ["南京", "nanjing"], 苏州: ["苏州", "suzhou"], 成都: ["成都", "chengdu"],
    武汉: ["武汉", "wuhan"], 西安: ["西安", "xi'an", "xian"], 重庆: ["重庆", "chongqing"], 天津: ["天津", "tianjin"],
    长沙: ["长沙", "changsha"], 合肥: ["合肥", "hefei"], 东莞: ["东莞", "dongguan"], 佛山: ["佛山", "foshan"],
    厦门: ["厦门", "xiamen"], 福州: ["福州", "fuzhou"], 济南: ["济南", "jinan"], 青岛: ["青岛", "qingdao"],
    郑州: ["郑州", "zhengzhou"], 宁波: ["宁波", "ningbo"], 无锡: ["无锡", "wuxi"], 珠海: ["珠海", "zhuhai"]
  };

  function clean(value = "") {
    return String(value).replace(/\s+/g, " ").trim();
  }

  function isUnlimitedTerm(value = "") {
    return /^(?:不限|全国|任意|任意城市|不限城市)$/i.test(clean(value));
  }

  function canonicalCity(value = "") {
    const normalized = clean(value).replace(/市$/, "").toLowerCase();
    for (const [city, aliases] of Object.entries(cityAliases)) {
      if (aliases.some((alias) => alias.toLowerCase() === normalized)) return city;
    }
    return clean(value);
  }

  function mentionsCity(text = "", city = "") {
    const haystack = String(text).toLowerCase();
    const canonical = canonicalCity(city);
    return (cityAliases[canonical] || [canonical]).some((alias) => haystack.includes(alias.toLowerCase()));
  }

  function split(value = "") {
    const seen = new Set();
    const result = [];
    for (const raw of String(value).split(/[，,、;；\n]+/)) {
      const city = clean(raw);
      if (!city) continue;
      const normalized = isUnlimitedTerm(city) ? "不限" : canonicalCity(city);
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(normalized);
    }
    return result;
  }

  function isUnlimited(value = "") {
    return split(value).some((city) => city === "不限");
  }

  function normalize(value = "") {
    const cities = split(value);
    if (cities.some((city) => city === "不限")) return "不限";
    return cities.join("、");
  }

  function toggle(value, city) {
    const requested = isUnlimitedTerm(city) ? "不限" : clean(city);
    if (!requested) return normalize(value);
    const current = split(value);
    if (requested === "不限") return current.includes("不限") ? "" : "不限";
    const cities = current.filter((item) => item !== "不限");
    const index = cities.findIndex((item) => item.toLowerCase() === requested.toLowerCase());
    if (index >= 0) cities.splice(index, 1);
    else cities.push(requested);
    return normalize(cities.join("、"));
  }

  function forSearch(value = "") {
    return isUnlimited(value) ? "" : normalize(value);
  }

  function match(text = "", value = "") {
    const cities = split(value).filter((city) => city !== "不限");
    const unrestricted = !cities.length || isUnlimited(value);
    const matched = unrestricted ? [] : cities.filter((city) => mentionsCity(text, city));
    return { cities, matched, unrestricted };
  }

  function analyze(text = "", value = "") {
    const preference = match(text, value);
    if (preference.unrestricted) {
      return { ...preference, status: "unrestricted", foundCities: [], flexible: false };
    }
    const haystack = String(text).toLowerCase();
    const foundCities = popularCities.filter((city) => mentionsCity(haystack, city));
    const flexible = /(?:全国(?:可选|多地|岗位|招聘)?|工作地点不限|地点不限|远程办公|远程岗位|remote(?:\s+work)?)/i.test(haystack);
    const status = preference.matched.length
      ? "matched"
      : (flexible ? "flexible" : (foundCities.length ? "mismatch" : "unknown"));
    return { ...preference, status, foundCities, flexible };
  }

  function first(value = "") {
    return isUnlimited(value) ? "" : (split(value).find((city) => city !== "不限") || "");
  }

  global.ResumePilotCities = { popularCities, cityAliases, split, normalize, toggle, isUnlimited, forSearch, match, analyze, first };
})(globalThis);
