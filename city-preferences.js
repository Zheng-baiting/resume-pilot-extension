(function initResumePilotCities(global) {
  const popularCities = [
    "北京", "上海", "深圳", "广州", "杭州", "南京", "苏州", "成都",
    "武汉", "西安", "重庆", "天津", "长沙", "合肥", "东莞", "佛山",
    "厦门", "福州", "济南", "青岛", "郑州", "宁波", "无锡", "珠海"
  ];

  function clean(value = "") {
    return String(value).replace(/\s+/g, " ").trim();
  }

  function isUnlimitedTerm(value = "") {
    return /^(?:不限|全国|任意|任意城市|不限城市)$/i.test(clean(value));
  }

  function split(value = "") {
    const seen = new Set();
    const result = [];
    for (const raw of String(value).split(/[，,、;；\n]+/)) {
      const city = clean(raw);
      if (!city) continue;
      const normalized = isUnlimitedTerm(city) ? "不限" : city;
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
    const haystack = String(text).toLowerCase();
    const matched = unrestricted ? [] : cities.filter((city) => haystack.includes(city.toLowerCase()));
    return { cities, matched, unrestricted };
  }

  function analyze(text = "", value = "") {
    const preference = match(text, value);
    if (preference.unrestricted) {
      return { ...preference, status: "unrestricted", foundCities: [], flexible: false };
    }
    const haystack = String(text).toLowerCase();
    const foundCities = popularCities.filter((city) => haystack.includes(city.toLowerCase()));
    const flexible = /(?:全国(?:可选|多地|岗位|招聘)?|工作地点不限|地点不限|远程办公|远程岗位|remote(?:\s+work)?)/i.test(haystack);
    const status = preference.matched.length
      ? "matched"
      : (flexible ? "flexible" : (foundCities.length ? "mismatch" : "unknown"));
    return { ...preference, status, foundCities, flexible };
  }

  function first(value = "") {
    return isUnlimited(value) ? "" : (split(value).find((city) => city !== "不限") || "");
  }

  global.ResumePilotCities = { popularCities, split, normalize, toggle, isUnlimited, forSearch, match, analyze, first };
})(globalThis);
