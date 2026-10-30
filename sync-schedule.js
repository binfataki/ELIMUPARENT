/* Planification client : le portail ne sollicite le service qu'après
 * identification et pendant le créneau attribué à l'utilisateur. */
(function (global) {
  // Quatre fenêtres quotidiennes décalées pour éviter un pic Apps Script.
  // Les parents consultent le dernier snapshot local entre deux fenêtres.
  var PARENT_WINDOWS = [
    { hour: 6, minute: 0 },
    { hour: 9, minute: 0 },
    { hour: 12, minute: 0 },
    { hour: 15, minute: 0 }
  ];
  var PARENT_JITTER_MINUTES = 60;
  function text(v) { return String(v == null ? "" : v); }
  function hash(value) {
    var h = 2166136261, input = text(value);
    for (var i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function normalized(policy) {
    var p = policy || {};
    return { timezone: p.timezone || "Africa/Lubumbashi", groupCount: Math.max(1, Number(p.groupCount) || 1),
      slotMinutes: Math.max(1, Number(p.slotMinutes) || 15), anchorTime: p.anchorTime || "06:00" };
  }
  function parentPlan(identity, now) {
    var current = now instanceof Date ? now : new Date();
    var jitterSeconds = hash(text(identity || "anonymous") + ":parent-window") % (PARENT_JITTER_MINUTES * 60);
    var candidates = [];
    for (var dayOffset = -1; dayOffset <= 1; dayOffset++) {
      var day = new Date(current.getFullYear(), current.getMonth(), current.getDate() + dayOffset);
      PARENT_WINDOWS.forEach(function (window) {
        var candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), window.hour, window.minute, 0, 0);
        candidate.setSeconds(jitterSeconds, 0);
        candidates.push(candidate);
      });
    }
    candidates.sort(function (a, b) { return a - b; });
    var next = candidates.find(function (d) { return d.getTime() > current.getTime(); });
    var past = candidates.filter(function (d) { return d.getTime() <= current.getTime(); });
    var last = past.length ? past[past.length - 1] : null;
    return { group: 1, groupCount: 1, slotMinutes: PARENT_JITTER_MINUTES,
      nextAt: next ? next.toISOString() : null,
      lastAt: last ? last.toISOString() : null,
      label: next ? next.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—" };
  }
  function anchors(role, policy) { return String(role).toUpperCase() === "PROFESSEUR" ? [policy.anchorTime, "12:00"] : [policy.anchorTime]; }
  function at(day, hm, seconds) {
    var p = text(hm).split(":");
    var d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(p[0]) || 0, Number(p[1]) || 0, 0, 0);
    d.setSeconds(seconds || 0, 0); return d;
  }
  function plan(policy, role, identity, now) {
    if (String(role).toUpperCase() === "PARENTS") return parentPlan(identity, now);
    var p = normalized(policy), current = now instanceof Date ? now : new Date();
    var group = hash(identity || "anonymous") % p.groupCount;
    var jitter = hash(text(identity || "anonymous") + ":jitter") % (p.slotMinutes * 60);
    var candidates = [];
    for (var dayOffset = 0; dayOffset <= 1; dayOffset++) {
      var day = new Date(current.getFullYear(), current.getMonth(), current.getDate() + dayOffset);
      anchors(role, p).forEach(function (anchor) { candidates.push(at(day, anchor, group * p.slotMinutes * 60 + jitter)); });
    }
    candidates.sort(function (a, b) { return a - b; });
    var next = candidates.find(function (d) { return d.getTime() > current.getTime(); });
    return { group: group + 1, groupCount: p.groupCount, slotMinutes: p.slotMinutes,
      nextAt: next ? next.toISOString() : null,
      label: next ? next.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—" };
  }
  function schedule(policy, role, identity, callback) {
    var cancelled = false, timer = null;
    function arm() {
      if (cancelled) return null;
      var current = plan(policy, role, identity, new Date());
      timer = setTimeout(function () { if (!cancelled) Promise.resolve(callback(current)).finally(arm); },
        Math.max(1000, new Date(current.nextAt).getTime() - Date.now()));
      return current;
    }
    return { initial: arm(), cancel: function () { cancelled = true; if (timer) clearTimeout(timer); } };
  }
  // Dernier créneau déjà passé pour un parent (ISO) : permet un rattrapage unique
  // à l'ouverture si le dernier snapshot local est plus ancien que ce créneau.
  function lastSlot(role, identity, now) {
    if (String(role).toUpperCase() !== "PARENTS") return null;
    return parentPlan(identity, now).lastAt;
  }
  global.ELIMU_SYNC_SCHEDULE = { hash: hash, plan: plan, schedule: schedule, lastSlot: lastSlot };
})(window);
