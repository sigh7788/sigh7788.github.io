(function () {
  "use strict";

  var C = window.CURRICULUM || [];
  var TOTAL = C.length;
  var KEY = "money.learn.v1";
  var WEEK_NAME = {
    1: "第 1 周 · 地基",
    2: "第 2 周 · 工具与配置",
    3: "第 3 周 · A 股规则",
    4: "第 4 周 · 行为与风险"
  };

  // ---------- helpers ----------
  function pad(n) { return String(n).padStart(2, "0"); }
  function dayKey(d) { d = d || new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  function qidOf(l, i) { return l.id + ":" + i; }
  function fmtDate(d) { return (d.getMonth() + 1) + "月" + d.getDate() + "日"; }
  function weekday(d) { return "日一二三四五六"[d.getDay()]; }

  function toast(msg) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("show"); }, 2200);
  }

  // ---------- question index ----------
  var QINDEX = {};
  C.forEach(function (l) {
    if (!l.quiz) return;
    l.quiz.forEach(function (q, i) {
      QINDEX[qidOf(l, i)] = {
        qid: qidOf(l, i), lessonId: l.id, day: l.day, tag: l.tag,
        lessonTitle: l.title, q: q.q, options: q.options, answer: q.answer, explain: q.explain
      };
    });
  });

  // ---------- state ----------
  var state = null;
  var view = "today";
  var saveTimer = null;

  function freshState() {
    return {
      v: 1, id: uid(), created: Date.now(), updated: Date.now(),
      lessons: {}, qs: {},
      streak: { count: 0, best: 0, last: null },
      daily: {}, xp: 0
    };
  }

  function normalize(s) {
    s.lessons = s.lessons || {};
    s.qs = s.qs || {};
    s.daily = s.daily || {};
    s.streak = s.streak || { count: 0, best: 0, last: null };
    s.xp = s.xp || 0;
    s.id = s.id || uid();
    s.created = s.created || Date.now();
    return s;
  }

  function save() {
    state.updated = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    clearTimeout(saveTimer);
    saveTimer = setTimeout(push, 600);
  }

  // 只有跑在本地/局域网服务上时才回传进度（公网部署时没有这个接口）
  var syncEnabled = false;

  function isLocal() {
    var h = location.hostname;
    if (location.protocol === "file:") return false;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" ||
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
  }

  function push() {
    if (!syncEnabled) return;
    try {
      fetch("api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ progress: state, report: buildReport() })
      }).catch(function () {});
    } catch (e) {}
  }

  // ---------- derived ----------
  function lessonDone(id) { return !!(state.lessons[id] && state.lessons[id].done); }
  function doneCount() { return C.filter(function (l) { return lessonDone(l.id); }).length; }
  function nextLesson() { return C.filter(function (l) { return !lessonDone(l.id); })[0] || null; }
  function wrongIds() {
    return Object.keys(state.qs).filter(function (k) { return state.qs[k] && !state.qs[k].ok && QINDEX[k]; });
  }
  function totals() {
    var tries = 0, right = 0;
    Object.keys(state.qs).forEach(function (k) { var r = state.qs[k]; tries += r.tries || 0; right += r.right || 0; });
    return { tries: tries, right: right, acc: tries ? Math.round(right / tries * 100) : 0 };
  }
  function tagStats() {
    var m = {};
    Object.keys(state.qs).forEach(function (k) {
      var q = QINDEX[k]; if (!q) return;
      var t = q.tag; m[t] = m[t] || { tries: 0, right: 0 };
      m[t].tries += state.qs[k].tries || 0;
      m[t].right += state.qs[k].right || 0;
    });
    return m;
  }
  function doneToday() {
    var t = dayKey();
    return Object.keys(state.lessons).filter(function (k) { return state.lessons[k].done && dayKey(new Date(state.lessons[k].at)) === t; }).length;
  }
  function bumpStreak() {
    var t = dayKey();
    var y = dayKey(new Date(Date.now() - 864e5));
    var s = state.streak;
    if (s.last === t) return;
    s.count = s.last === y ? (s.count || 0) + 1 : 1;
    s.last = t;
    s.best = Math.max(s.best || 0, s.count);
  }
  function addDaily(answers) {
    var k = dayKey();
    var d = state.daily[k] || { answered: 0, correct: 0 };
    d.answered += answers.length;
    d.correct += answers.filter(function (a) { return a.correct; }).length;
    state.daily[k] = d;
  }

  // ---------- questions for a lesson ----------
  function questionsFor(lesson) {
    if (lesson.quiz) {
      return lesson.quiz.map(function (q, i) { return QINDEX[qidOf(lesson, i)]; });
    }
    // review day: draw from its scope
    var scope = lesson.id === "d30" ? C : C.filter(function (l) { return l.week === lesson.week; });
    var pool = [];
    scope.forEach(function (l) {
      if (!l.quiz) return;
      l.quiz.forEach(function (q, i) { pool.push(QINDEX[qidOf(l, i)]); });
    });
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    return pool.slice(0, Math.min(6, pool.length));
  }

  // ---------- view: today ----------
  function renderToday() {
    var host = document.getElementById("view");
    var lesson = nextLesson();
    var now = new Date();

    if (!lesson) {
      host.innerHTML =
        '<div class="card" style="text-align:center;padding:38px 22px">' +
          '<div style="font-size:40px;line-height:1">🎓</div>' +
          '<h1 style="font-size:22px;margin:14px 0 8px">30 天走完了</h1>' +
          '<p class="muted" style="margin:0 0 6px">你已经把地基、配置、A 股规则、行为和加密宏观过了一遍。</p>' +
          '<p class="hint" style="margin:14px 0 20px">接下来最重要的事只有一件：把这套规则搬到真金白银上，先小额，再放大。</p>' +
          '<button class="btn primary" id="toReview">去复习错题</button>' +
        '</div>' +
        '<div class="card">' +
          '<div class="section-title" style="margin-top:0">下一步建议</div>' +
          '<ul class="points">' +
            '<li>按第 5 课的三道门，确认这 4 万是「真闲钱」。</li>' +
            '<li>写一页纸的 IPS：目标、比例、买卖条件、绝不做什么。</li>' +
            '<li>用场外基金按月定投，宽基先建仓，分 6 个月买入。</li>' +
            '<li>加密部分不超过 10%，且只碰现货。</li>' +
          '</ul>' +
        '</div>';
      document.getElementById("toReview").onclick = function () { switchTab("review"); };
      return;
    }

    var n = doneCount();
    var done = doneToday();
    var qs = questionsFor(lesson);
    var banner = done
      ? '<div class="card" style="background:var(--good-soft);border-color:transparent;padding:13px 16px;margin-bottom:14px;display:flex;gap:10px;align-items:center">' +
        '<span style="font-size:18px">✅</span><div style="font-size:14px;font-weight:600;color:var(--good)">今天已完成 ' + done + ' 课。' +
        '<span style="font-weight:500;opacity:.8">继续学也行，留到明天也行。</span></div></div>'
      : "";

    var html = banner;
    html += '<div class="lesson-head">' +
      '<span class="chip">' + esc(lesson.tag) + '</span>' +
      '<span class="lesson-day">DAY ' + pad(lesson.day) + ' / ' + TOTAL + ' · ' + esc(WEEK_NAME[lesson.week] || "") + '</span>' +
      '</div>';
    html += '<h1 class="lesson-title">' + esc(lesson.title) + '</h1>';
    html += '<p class="lesson-hook">' + esc(lesson.hook) + '</p>';

    if (lesson.points) {
      html += '<ul class="points">' + lesson.points.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul>";
    }
    if (lesson.takeaway) html += '<div class="takeaway">' + esc(lesson.takeaway) + '</div>';

    html += '<div style="margin-top:20px;display:flex;align-items:center;gap:6px;margin-bottom:12px">' +
      '<div style="flex:1;height:6px;border-radius:3px;background:var(--line);overflow:hidden">' +
      '<div style="width:' + Math.round(n / TOTAL * 100) + '%;height:100%;background:var(--accent)"></div></div>' +
      '<span style="font-size:12px;color:var(--muted);font-weight:600">' + n + "/" + TOTAL + '</span></div>';

    html += '<button class="btn primary" id="startQuiz">开始自测 · ' + qs.length + ' 题</button>';
    html += '<p class="hint" style="text-align:center;margin:10px 0 0">' + fmtDate(now) + ' 周' + weekday(now) + ' · 大约 5 分钟</p>';

    host.innerHTML = '<div class="card">' + html + '</div>' +
      '<div class="card">' +
        '<div class="section-title" style="margin-top:0">怎么用这个页面 <span>30 秒读完</span></div>' +
        '<ul class="points" style="font-size:14.5px">' +
          '<li>每天一节，读完直接做 3 道题，答错会告诉你为什么。</li>' +
          '<li>答错的题自动进「复习」页，做对一次才会移出。</li>' +
          '<li>「进度」页可以生成学习报告，复制给我，我来帮你分析薄弱点。</li>' +
        '</ul>' +
      '</div>';

    document.getElementById("startQuiz").onclick = function () {
      startQuiz(qs, { mode: "lesson", lesson: lesson, title: "第 " + lesson.day + " 天 · " + lesson.title });
    };
  }

  // ---------- view: review ----------
  function renderReview() {
    var host = document.getElementById("view");
    var ids = wrongIds();
    var html = "";

    html += '<div class="section-title" style="margin-top:6px">错题本 <span>' + ids.length + ' 题待巩固</span></div>';

    if (!ids.length) {
      html += '<div class="card"><div class="empty" style="padding:30px 8px">' +
        '<div class="big">🌱</div>没有待复习的错题。<br>保持就好——每天的新课会自动检验你。</div></div>';
    } else {
      html += '<button class="btn primary" id="startReview" style="margin-bottom:18px">开始复习 · ' + Math.min(ids.length, 10) + ' 题</button>';
      ids.slice(0, 30).forEach(function (k) {
        var q = QINDEX[k];
        var r = state.qs[k];
        html += '<div class="list-item wrong-item">' +
          '<div class="n">' + pad(q.day) + '</div>' +
          '<div class="t"><b>' + esc(q.q) + '</b>' +
          '<span>' + esc(q.lessonTitle) + ' · 答错 ' + (r.tries || 1) + ' 次</span></div>' +
          '</div>';
      });
    }

    var learned = C.filter(function (l) { return lessonDone(l.id); });
    html += '<div class="section-title">随机巩固 <span>从已学内容里抽</span></div>';
    if (learned.length) {
      html += '<div class="card"><p class="hint" style="margin:0 0 14px">不针对错题，随机抽 5 道已学过的题，检验是否还记得。</p>' +
        '<button class="btn ghost" id="randomQuiz">随机 5 题</button></div>';
    } else {
      html += '<div class="card"><p class="hint" style="margin:0">还没有学过的内容，先去「今日」开始第一天。</p></div>';
    }

    host.innerHTML = html;

    var sr = document.getElementById("startReview");
    if (sr) sr.onclick = function () {
      var pool = ids.map(function (k) { return QINDEX[k]; }).slice(0, 10);
      startQuiz(pool, { mode: "review", title: "错题复习 · " + pool.length + " 题" });
    };

    var rq = document.getElementById("randomQuiz");
    if (rq) rq.onclick = function () {
      var pool = [];
      learned.forEach(function (l) {
        if (!l.quiz) return;
        l.quiz.forEach(function (q, i) { pool.push(QINDEX[qidOf(l, i)]); });
      });
      for (var i = pool.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      startQuiz(pool.slice(0, Math.min(5, pool.length)), { mode: "review", title: "随机巩固 · 5 题" });
    };
  }

  // ---------- view: progress ----------
  function renderProgress() {
    var host = document.getElementById("view");
    var n = doneCount();
    var t = totals();
    var tg = tagStats();
    var now = new Date();

    var html = "";
    html += '<div class="stat-grid">' +
      stat("已学课程", n + "<small> / " + TOTAL + "</small>") +
      stat("累计正确率", (t.tries ? t.acc + "<small> %</small>" : "—")) +
      stat("连续打卡", state.streak.count + "<small> 天</small>") +
      stat("累计 XP", state.xp + "") +
      '</div>';

    // 7-day activity
    var bars = "", labels = "", max = 1;
    var days = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date(now.getTime() - i * 864e5);
      var k = dayKey(d);
      var v = (state.daily[k] && state.daily[k].answered) || 0;
      days.push({ d: d, v: v, k: k });
      max = Math.max(max, v);
    }
    days.forEach(function (x) {
      var h = x.v ? Math.max(8, Math.round(x.v / max * 64)) : 3;
      bars += '<div class="cbar' + (x.v ? "" : " zero") + '" style="height:' + h + 'px"></div>';
      labels += '<span>' + (x.d.getMonth() + 1) + "/" + x.d.getDate() + '</span>';
    });
    html += '<div class="section-title">最近 7 天答题量</div><div class="card">' +
      '<div class="chart">' + bars + '</div>' +
      '<div class="chart-labels">' + labels + '</div>' +
      '<p class="hint" style="margin:10px 0 0;text-align:center">共 ' + days.reduce(function (a, b) { return a + b.v; }, 0) + ' 题</p></div>';

    // tag accuracy
    var keys = Object.keys(tg).sort(function (a, b) { return (tg[b].tries - tg[a].tries); });
    if (keys.length) {
      html += '<div class="section-title">分类掌握度</div><div class="card">';
      keys.forEach(function (k) {
        var acc = Math.round(tg[k].right / tg[k].tries * 100);
        html += '<div class="tag-row"><div class="name">' + esc(k) + '</div>' +
          '<div class="track"><div class="fill" style="width:' + acc + '%"></div></div>' +
          '<div class="pct">' + acc + '%</div></div>';
      });
      html += '</div>';
    }

    // weak point
    var weak = keys.filter(function (k) { return tg[k].tries >= 2 && tg[k].right / tg[k].tries < 0.75; });
    html += '<div class="card">' +
      '<div class="section-title" style="margin-top:0">学习建议</div>' +
      '<p style="margin:0;font-size:15px">' + advice(n, t, weak) + '</p>' +
      '</div>';

    html += '<div class="section-title">工具</div>' +
      '<div class="card" style="padding:14px">' +
      '<button class="btn primary" id="copyReport" style="margin-bottom:10px">生成学习报告（复制给 AI）</button>' +
      '<div class="btn-row" style="margin-bottom:10px">' +
      '<button class="btn ghost" id="exportBtn">导出进度</button>' +
      '<button class="btn ghost" id="importBtn">导入进度</button>' +
      '</div>' +
      '<button class="btn ghost" id="allLessons" style="margin-bottom:10px">查看全部课程</button>' +
      '<button class="btn ghost" id="reset" style="color:var(--bad)">重置所有进度</button>' +
      '<p class="hint" style="margin:12px 2px 0">' +
      (isLocal()
        ? "进度同时存在本机和服务端，电脑上的 <code>学习报告.md</code> 我可以直接读取。"
        : "进度存在这台设备上。<b>换设备</b>时用「导出进度」拿到文件，在新设备上「导入进度」即可。") +
      '</p>' +
      '</div>';

    host.innerHTML = html;

    document.getElementById("copyReport").onclick = function () {
      var md = buildReport();
      copyText(md);
      toast("报告已复制，粘贴给 AI 即可");
    };
    document.getElementById("exportBtn").onclick = exportProgress;
    document.getElementById("importBtn").onclick = importProgress;
    document.getElementById("allLessons").onclick = openAllLessons;
    document.getElementById("reset").onclick = function () {
      if (!confirm("确定清空所有学习记录？这个操作无法撤销。")) return;
      state = freshState();
      save();
      switchTab("today");
      toast("已重置");
    };
  }

  function stat(k, v) {
    return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div></div>';
  }

  function advice(n, t, weak) {
    if (!n) return "先去「今日」完成第一课。前 3 天的内容会决定你后面 25 天看得懂多少。";
    if (weak.length) return "目前偏弱的是「" + weak.map(function (x) { return x; }).join("」「") + "」。建议在「复习」页把相关错题连做两遍，比继续学新内容更划算。";
    if (t.acc >= 85 && n >= 14) return "掌握度已经很稳了。下一步可以把重心从「学概念」转到「写自己的 IPS」，把知识变成规则。";
    if (t.acc >= 85) return "正确率很高，保持节奏即可。别跳课——后面的内容依赖前面的概念。";
    return "正确率还有提升空间。每天把错题过一遍，比多刷新课更有效。";
  }

  // ---------- quiz engine ----------
  var session = null;

  function startQuiz(questions, meta) {
    session = { questions: questions, meta: meta, i: 0, answers: questions.map(function () { return null; }), done: false };
    openOverlay(meta.title);
    renderQuiz();
  }

  function renderQuiz() {
    var body = document.getElementById("ovBody");
    var foot = document.getElementById("ovFoot");
    var footInner = document.getElementById("ovFootInner");

    if (session.done) return renderResult();

    var i = session.i;
    var q = session.questions[i];
    var a = session.answers[i];
    var n = session.questions.length;

    var dots = "";
    for (var k = 0; k < n; k++) {
      var cls = "dot";
      var an = session.answers[k];
      if (an) cls += an.correct ? " ok" : " no";
      else if (k === i) cls += " on";
      dots += '<div class="' + cls + '"></div>';
    }

    var html = '<div class="quiz-wrap">' +
      '<div class="quiz-meta"><span class="idx">第 ' + (i + 1) + " / " + n + ' 题</span><div class="dots">' + dots + '</div></div>' +
      '<div class="q-text">' + esc(q.q) + '</div><div class="opts">';

    q.options.forEach(function (opt, idx) {
      var cls = "opt";
      if (a) {
        if (idx === q.answer) cls += " correct";
        else if (idx === a.chosen) cls += " wrong";
      }
      html += '<button class="' + cls + '" data-opt="' + idx + '"' + (a ? " disabled" : "") + '>' +
        '<span class="key">' + "ABCD"[idx] + '</span><span>' + esc(opt) + '</span></button>';
    });
    html += '</div>';

    if (a) {
      html += '<div class="explain">' +
        '<span class="verdict ' + (a.correct ? "ok" : "no") + '">' + (a.correct ? "✓ 答对了" : "✕ 正确答案是 " + "ABCD"[q.answer]) + '</span>' +
        esc(q.explain) + '</div>';
    }
    html += '</div>';

    body.innerHTML = html;
    body.scrollTop = 0;

    Array.prototype.forEach.call(body.querySelectorAll("[data-opt]"), function (btn) {
      btn.onclick = function () { choose(parseInt(btn.getAttribute("data-opt"), 10)); };
    });

    foot.hidden = false;
    var isLast = i === n - 1;
    footInner.innerHTML = '<button class="btn primary" id="nextBtn"' + (a ? "" : " disabled") + '>' +
      (isLast ? "查看结果" : "下一题") + '</button>';
    document.getElementById("nextBtn").onclick = function () {
      if (session.i >= session.questions.length - 1) finishQuiz();
      else { session.i++; renderQuiz(); }
    };
  }

  function choose(idx) {
    if (session.answers[session.i]) return;
    var q = session.questions[session.i];
    session.answers[session.i] = { chosen: idx, correct: idx === q.answer };
    renderQuiz();
  }

  function finishQuiz() {
    var answers = session.answers;
    var correct = answers.filter(function (a) { return a && a.correct; }).length;
    var total = answers.length;

    // per-question records
    session.questions.forEach(function (q, i) {
      var a = answers[i];
      if (!a || !q.qid) return;
      var rec = state.qs[q.qid] || { tries: 0, right: 0, ok: true };
      rec.tries = (rec.tries || 0) + 1;
      rec.right = (rec.right || 0) + (a.correct ? 1 : 0);
      rec.ok = !!a.correct;
      rec.at = Date.now();
      rec.chosen = a.chosen;
      state.qs[q.qid] = rec;
    });

    if (session.meta.mode === "lesson") {
      var L = session.meta.lesson;
      state.lessons[L.id] = { done: true, at: Date.now(), correct: correct, total: total };
      bumpStreak();
      state.xp += correct * 10 + 10;
    } else {
      state.xp += correct * 10;
    }
    addDaily(answers);
    save();

    session.done = true;
    session.result = { correct: correct, total: total };
    renderResult();
  }

  function renderResult() {
    var body = document.getElementById("ovBody");
    var foot = document.getElementById("ovFoot");
    var footInner = document.getElementById("ovFootInner");
    var r = session.result;
    var pct = Math.round(r.correct / r.total * 100);
    var color = pct >= 80 ? "var(--good)" : pct >= 50 ? "var(--accent)" : "var(--bad)";
    var verdict = pct === 100 ? "全对。这一课拿下了。" : pct >= 67 ? "基本掌握，把下面错的过一遍。" : "这节还需要再看一遍，别急。";

    var html = '<div class="result">' +
      '<div class="score" style="color:' + color + '">' + r.correct + '<small> / ' + r.total + '</small></div>' +
      '<div class="verdict-text">' + verdict + '</div>' +
      '<div class="xp">+' + (r.correct * 10 + (session.meta.mode === "lesson" ? 10 : 0)) + ' XP</div>' +
      '</div>';

    var wrong = [];
    session.questions.forEach(function (q, i) {
      var a = session.answers[i];
      if (a && !a.correct) wrong.push({ q: q, a: a });
    });

    if (wrong.length) {
      html += '<div class="section-title">需要再看一眼</div>';
      wrong.forEach(function (w) {
        html += '<div class="card" style="padding:15px;margin-bottom:10px">' +
          '<div style="font-weight:650;font-size:15px;line-height:1.55;margin-bottom:8px">' + esc(w.q.q) + '</div>' +
          '<div style="font-size:14px;color:var(--bad);margin-bottom:4px">你的答案：' + esc(w.q.options[w.a.chosen]) + '</div>' +
          '<div style="font-size:14px;color:var(--good);margin-bottom:8px">正确答案：' + esc(w.q.options[w.q.answer]) + '</div>' +
          '<div style="font-size:13.5px;color:var(--muted);line-height:1.6">' + esc(w.q.explain) + '</div>' +
          '</div>';
      });
    } else {
      html += '<div class="card" style="text-align:center;padding:22px;color:var(--good);font-weight:600">没有错题，继续保持。</div>';
    }

    body.innerHTML = html;
    body.scrollTop = 0;

    foot.hidden = false;
    footInner.innerHTML = '<button class="btn primary" id="doneBtn">完成</button>';
    var wasLesson = session.meta.mode === "lesson";
    document.getElementById("doneBtn").onclick = function () {
      closeOverlay();
      render();
      if (wasLesson) toast("已打卡 · 连续 " + state.streak.count + " 天");
    };
  }

  // ---------- overlay ----------
  function openOverlay(title) {
    var ov = document.getElementById("overlay");
    document.getElementById("ovTitle").textContent = title;
    ov.hidden = false;
    document.body.style.overflow = "hidden";
    document.getElementById("ovFoot").hidden = true;
    document.getElementById("ovBody").innerHTML = "";
  }
  function closeOverlay() {
    document.getElementById("overlay").hidden = true;
    document.body.style.overflow = "";
    document.getElementById("ovFoot").hidden = true;
    session = null;
  }

  function openLesson(lesson) {
    var body = document.getElementById("ovBody");
    var foot = document.getElementById("ovFoot");
    openOverlay("DAY " + pad(lesson.day) + " · " + lesson.title);
    var html = '<div class="lesson-head"><span class="chip">' + esc(lesson.tag) + '</span><span class="lesson-day">' + esc(WEEK_NAME[lesson.week] || "") + '</span></div>' +
      '<h1 class="lesson-title">' + esc(lesson.title) + '</h1>' +
      '<p class="lesson-hook">' + esc(lesson.hook) + '</p>';
    if (lesson.points) html += '<ul class="points">' + lesson.points.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul>";
    if (lesson.takeaway) html += '<div class="takeaway">' + esc(lesson.takeaway) + '</div>';
    body.innerHTML = html;

    var qs = questionsFor(lesson);
    foot.hidden = false;
    document.getElementById("ovFootInner").innerHTML = '<button class="btn primary" id="redoBtn">' + (lesson.quiz ? "重做这天的自测" : "开始这天的复习") + '</button>';
    document.getElementById("redoBtn").onclick = function () {
      startQuiz(qs, { mode: lessonDone(lesson.id) ? "review" : "lesson", lesson: lesson, title: "DAY " + pad(lesson.day) });
    };
  }

  function openAllLessons() {
    var body = document.getElementById("ovBody");
    openOverlay("全部课程");
    var html = "";
    var lastWeek = 0;
    C.forEach(function (l) {
      if (l.week !== lastWeek) {
        lastWeek = l.week;
        html += '<div class="section-title"' + (lastWeek === 1 ? ' style="margin-top:0"' : "") + '>' + esc(WEEK_NAME[l.week]) + '</div>';
      }
      var rec = state.lessons[l.id];
      html += '<button class="list-item' + (lessonDone(l.id) ? " done" : "") + '" data-lid="' + l.id + '">' +
        '<div class="n">' + pad(l.day) + '</div>' +
        '<div class="t"><b>' + esc(l.title) + '</b><span>' + (l.review ? "复习日" : l.tag) + '</span></div>' +
        '<div class="s ' + (rec ? (rec.correct / rec.total >= 0.67 ? "ok" : "no") : "") + '">' +
        (rec ? rec.correct + "/" + rec.total : "未学") + '</div></button>';
    });
    body.innerHTML = html;
    Array.prototype.forEach.call(body.querySelectorAll("[data-lid]"), function (btn) {
      btn.onclick = function () {
        var l = C.filter(function (x) { return x.id === btn.getAttribute("data-lid"); })[0];
        openLesson(l);
      };
    });
  }

  // ---------- report ----------
  function buildReport() {
    var n = doneCount();
    var t = totals();
    var tg = tagStats();
    var now = new Date();
    var lines = [];

    lines.push("# 投资学习报告");
    lines.push("");
    lines.push("- 生成时间：" + now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + " " + pad(now.getHours()) + ":" + pad(now.getMinutes()));
    lines.push("- 已学课程：" + n + " / " + TOTAL);
    lines.push("- 连续打卡：" + state.streak.count + " 天（最长 " + (state.streak.best || 0) + " 天）");
    lines.push("- 累计答题：" + t.tries + " 题，答对 " + t.right + " 题，正确率 " + t.acc + "%");
    lines.push("- 累计 XP：" + state.xp);
    lines.push("");

    lines.push("## 分类掌握度");
    Object.keys(tg).sort(function (a, b) { return tg[b].tries - tg[a].tries; }).forEach(function (k) {
      var acc = Math.round(tg[k].right / tg[k].tries * 100);
      lines.push("- " + k + "：" + acc + "%（" + tg[k].right + "/" + tg[k].tries + "）");
    });
    lines.push("");

    var doneList = C.filter(function (l) { return lessonDone(l.id); });
    if (doneList.length) {
      lines.push("## 已完成课程");
      doneList.forEach(function (l) {
        var r = state.lessons[l.id];
        lines.push("- DAY " + pad(l.day) + " " + l.title + "（" + r.correct + "/" + r.total + "）");
      });
      lines.push("");
    }

    var ids = wrongIds();
    lines.push("## 错题（待巩固）");
    if (!ids.length) {
      lines.push("暂无。");
    } else {
      ids.forEach(function (k, i) {
        var q = QINDEX[k];
        lines.push((i + 1) + ". [DAY " + pad(q.day) + " · " + q.lessonTitle + "] " + q.q);
        lines.push("   - 正确：" + q.options[q.answer]);
        lines.push("   - 解析：" + q.explain);
      });
    }
    lines.push("");

    var weak = Object.keys(tg).filter(function (k) { return tg[k].tries >= 2 && tg[k].right / tg[k].tries < 0.75; });
    lines.push("## 待 AI 分析");
    lines.push("（请 AI 根据以上数据：1) 指出最薄弱的 2 个概念并补充讲解；2) 给出接下来 3 天的学习重点；3) 判断是否已具备开始小额实操的条件。）");
    if (weak.length) lines.push("");
    if (weak.length) lines.push("机器判定的薄弱分类：" + weak.join("、"));

    return lines.join("\n");
  }

  // ---------- 进度导出 / 导入（换设备用） ----------
  function exportProgress() {
    var d = new Date();
    var name = "投资日课-进度-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + ".json";
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    toast("已导出：" + name);
  }

  function importProgress() {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var obj;
        try { obj = JSON.parse(String(reader.result)); } catch (e) { toast("文件格式不对"); return; }
        var data = obj && obj.progress ? obj.progress : obj;
        if (!data || typeof data !== "object" || !data.lessons || !data.qs) { toast("这不是有效的进度文件"); return; }
        var n = Object.keys(data.lessons).length;
        if (!confirm("导入后会用文件里的记录覆盖当前进度（已学 " + n + " 课），确定吗？")) return;
        state = normalize(data);
        save();
        switchTab("progress");
        toast("已导入 " + n + " 课记录");
      };
      reader.readAsText(f);
    };
    input.click();
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
  }

  // ---------- shell ----------
  function render() {
    var pill = document.getElementById("streakPill");
    pill.innerHTML = "🔥 连续 <b>" + state.streak.count + "</b> 天";
    var badge = document.getElementById("badge");
    var w = wrongIds().length;
    if (w > 0) { badge.hidden = false; badge.textContent = w > 99 ? "99+" : w; }
    else badge.hidden = true;

    if (view === "today") renderToday();
    else if (view === "review") renderReview();
    else renderProgress();
  }

  function switchTab(name) {
    view = name;
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
      b.classList.toggle("active", b.getAttribute("data-tab") === name);
    });
    window.scrollTo(0, 0);
    render();
  }

  document.getElementById("tabbar").addEventListener("click", function (e) {
    var b = e.target.closest(".tab");
    if (b) switchTab(b.getAttribute("data-tab"));
  });
  document.getElementById("ovClose").onclick = closeOverlay;
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !document.getElementById("overlay").hidden) closeOverlay(); });
  window.addEventListener("scroll", function () {
    document.getElementById("topbar").classList.toggle("scrolled", window.scrollY > 4);
  });

  // ---------- boot ----------
  async function boot() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}
    if (raw) {
      try { state = JSON.parse(raw); } catch (e) { state = null; }
    }
    // 先探测本地服务是否在线：在线才读写进度（公网静态托管时自动关闭）
    if (isLocal()) {
      try {
        var hres = await fetch("api/health", { cache: "no-store" });
        syncEnabled = hres.ok;
      } catch (e) { syncEnabled = false; }
    }
    if (!state && syncEnabled) {
      try {
        var res = await fetch("api/progress", { cache: "no-store" });
        if (res.ok) {
          var j = await res.json();
          if (j && j.progress && j.progress.id) state = j.progress;
        }
      } catch (e) {}
    }

    state = normalize(state || freshState());
    render();

    // 离线可用（仅 https 或 localhost 会生效；局域网 http 会被浏览器忽略）
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }

  boot();
})();
