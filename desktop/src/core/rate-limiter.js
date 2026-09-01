class DomainRateLimiter {
  constructor(options = {}) {
    this.minimumIntervalMs = Math.max(1000, Number(options.minimumIntervalMs || 6000));
    this.maximumBackoffMs = Math.max(this.minimumIntervalMs, Number(options.maximumBackoffMs || 60 * 60 * 1000));
    this.domains = new Map();
  }

  hostFor(url = "") {
    try { return new URL(url).hostname.toLowerCase(); } catch { return "unknown"; }
  }

  state(host) {
    if (!this.domains.has(host)) this.domains.set(host, { nextAllowedAt: 0, failures: 0, active: false });
    return this.domains.get(host);
  }

  availability(url, now = Date.now()) {
    const host = this.hostFor(url);
    const state = this.state(host);
    return { host, allowed: !state.active && now >= state.nextAllowedAt, waitMs: Math.max(0, state.nextAllowedAt - now), ...state };
  }

  claim(url, now = Date.now()) {
    const availability = this.availability(url, now);
    if (!availability.allowed) return availability;
    const state = this.state(availability.host);
    state.active = true;
    return { ...availability, allowed: true };
  }

  complete(url, result = {}, now = Date.now()) {
    const host = this.hostFor(url);
    const state = this.state(host);
    state.active = false;
    if (Number(result.httpStatus) === 429 || result.status === "rate_limited") {
      state.failures += 1;
      const exponential = this.minimumIntervalMs * (2 ** Math.min(state.failures, 8));
      const requested = Math.max(0, Number(result.retryAfterMs || 0));
      state.nextAllowedAt = now + Math.min(this.maximumBackoffMs, Math.max(exponential, requested));
      return { host, rateLimited: true, retryAt: state.nextAllowedAt, failures: state.failures };
    }
    state.failures = 0;
    state.nextAllowedAt = now + this.minimumIntervalMs;
    return { host, rateLimited: false, retryAt: state.nextAllowedAt, failures: 0 };
  }
}

module.exports = { DomainRateLimiter };
